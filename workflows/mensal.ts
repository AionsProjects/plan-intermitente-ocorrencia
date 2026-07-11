import { FatalError, getStepMetadata, sleep } from "workflow"
import { confirmarEfeito, reservarEfeito } from "../auth-backend/src/jobs/repo.js"
import {
  buscarEmployeeId,
  buscarPedido,
  confirmarPedido,
  criarPedido,
  extrairQrBase64,
  montarPedidoCaju,
  resetTokenCaju,
  summaryUrlCaju,
  type PessoaPedidoCaju,
  type TipoPedidoCaju,
} from "../auth-backend/src/clients/caju.js"
import {
  atualizarContrato,
  finalizarRun,
  registrarEvento,
} from "../auth-backend/src/mensal/repo.js"
import type { ContratoPreviaMensal, SnapshotPreviaMensal } from "../auth-backend/src/mensal/types.js"

export interface MensalWorkflowInput {
  runId: string
  modo: "homologacao" | "producao"
  snapshot: SnapshotPreviaMensal
  somenteContratos?: string[]
}

// Efeitos que NÃO passam por Caju (RM/Monday/Drive). Adaptadores reais ainda não portados
// -> em "producao" lançam not_implemented; em "homologacao" simulam atrás do ledger.
const EFEITOS_GENERICOS = [
  "rm_gerar",
  "rm_aguardar",
  "rm_integrar",
  "monday_plano",
  "monday_controle_caju",
  "monday_solicitacao",
  "drive",
] as const

// Trava de produção financeira. Só libera com modo=producao E env=1. Hoje 0 em todo ambiente.
const PRODUCAO_LIBERADA = process.env.MENSAL_PRODUCTION_ENABLED === "1"

function normContrato(contrato: string): string {
  return contrato.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
}

function competenciaPartes(competencia: string): { mes: number; ano: number } {
  const [ano, mes] = competencia.split("-").map(Number)
  return { mes: mes || 1, ano: ano || new Date().getUTCFullYear() }
}

// --- Etapa sem efeito externo (validação). ---------------------------------
async function etapaValidacao(runId: string, contrato: string): Promise<void> {
  "use step"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa: "validacao", estado: "rodando", tentativa: metadata.attempt })
  await registrarEvento({ runId, contrato, etapa: "validacao", estado: "concluido", tentativa: metadata.attempt })
}

// --- Caju: resolver employeeIds do contrato (GET, READ-ONLY). ---------------
async function resolverEmployeesCaju(
  runId: string,
  modo: "homologacao" | "producao",
  contrato: string,
  pessoas: Array<{ cpf: string }>,
): Promise<Record<string, string>> {
  "use step"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa: "caju_pessoas", estado: "rodando", tentativa: metadata.attempt })
  if (modo !== "producao") {
    await registrarEvento({ runId, contrato, etapa: "caju_pessoas", estado: "concluido", tentativa: metadata.attempt, metadados: { simulado: true } })
    return {}
  }
  if (!PRODUCAO_LIBERADA) throw new FatalError("execucao_mensal_producao_bloqueada_ate_cutover")
  resetTokenCaju() // token Caju expira rápido -> um por contrato
  const mapa: Record<string, string> = {}
  let achados = 0
  for (const p of pessoas) {
    const id = await buscarEmployeeId(p.cpf)
    if (id) { mapa[p.cpf.replace(/\D/g, "")] = id; achados++ }
  }
  await registrarEvento({ runId, contrato, etapa: "caju_pessoas", estado: "concluido", tentativa: metadata.attempt, metadados: { pessoas: pessoas.length, achados } })
  return mapa
}
resolverEmployeesCaju.maxRetries = 3

// --- Caju: criar (e confirmar, no PIX) pedido. DINHEIRO REAL — GATED. -------
async function executarPedidoCaju(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: string,
  tipo: TipoPedidoCaju,
  pessoas: PessoaPedidoCaju[],
): Promise<{ orderId: string | null; qr: string; pulado: boolean; simulado: boolean }> {
  "use step"
  const etapa = tipo === "credito" ? "caju_credito" : "caju_pix"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })

  const chave = `mensal:${competencia}:${normContrato(contrato)}:${etapa}`
  const reserva = await reservarEfeito(chave, `mensal_${etapa}`, { runId, competencia, contrato, modo, tipo })
  if (reserva === "confirmado") {
    await registrarEvento({ runId, contrato, etapa, estado: "pulado_idempotencia", tentativa: metadata.attempt })
    return { orderId: null, qr: "", pulado: true, simulado: false }
  }
  if (reserva === "pendente") throw new FatalError(`efeito_pendente_requer_conciliacao:${etapa}`)

  const { mes, ano } = competenciaPartes(competencia)

  // Homologação: simula, nenhum efeito externo.
  if (modo !== "producao") {
    await confirmarEfeito(chave, `homologacao:${runId}:${contrato}:${etapa}`)
    await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { simulado: true } })
    return { orderId: null, qr: "", pulado: false, simulado: true }
  }

  // Produção: gate duplo.
  if (!PRODUCAO_LIBERADA) throw new FatalError("execucao_mensal_producao_bloqueada_ate_cutover")

  const pedido = montarPedidoCaju(pessoas, tipo, contrato, mes, ano)
  if (!pedido.tem || !pedido.payload) {
    await confirmarEfeito(chave, `caju:${etapa}:vazio`)
    await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { vazio: true } })
    return { orderId: null, qr: "", pulado: false, simulado: false }
  }

  const { orderId } = await criarPedido(pedido.payload)
  let qr = ""
  if (tipo === "boleto" && orderId) {
    // PIX: confirma (nó "Confirmar Pedido PIX Caju" ligado no n8n). Crédito NÃO confirma (nó disabled).
    await confirmarPedido(orderId, pedido.confirmPayload)
    // Poll do QR do boleto (assíncrono no Caju).
    qr = extrairQrBase64(await buscarPedido(orderId))
    if (!qr) { await sleep("3s"); qr = extrairQrBase64(await buscarPedido(orderId)) }
  }

  await confirmarEfeito(chave, orderId ? `caju:${etapa}:${orderId}` : `caju:${etapa}:sem-id`)
  await registrarEvento({
    runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { orderId, totalCentavos: pedido.totalCentavos, temQr: qr.length > 0, summary: summaryUrlCaju(orderId) },
  })
  return { orderId: orderId ?? null, qr, pulado: false, simulado: false }
}
executarPedidoCaju.maxRetries = 5

// --- Efeito genérico (RM/Monday/Drive): simula em homologação, bloqueia em produção. ---
async function executarEfeitoGenerico(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: string,
  etapa: string,
): Promise<{ pulado: boolean }> {
  "use step"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })

  if (modo === "producao") {
    // Adaptadores reais RM/Monday/Drive ainda não portados -> produção continua bloqueada.
    throw new FatalError(`efeito_real_nao_implementado:${etapa}`)
  }

  const chave = `mensal:${competencia}:${normContrato(contrato)}:${etapa}`
  const reserva = await reservarEfeito(chave, `mensal_${etapa}`, { runId, competencia, contrato, modo })
  if (reserva === "confirmado") {
    await registrarEvento({ runId, contrato, etapa, estado: "pulado_idempotencia", tentativa: metadata.attempt })
    return { pulado: true }
  }
  if (reserva === "pendente") throw new FatalError(`efeito_pendente_requer_conciliacao:${etapa}`)
  await confirmarEfeito(chave, `homologacao:${runId}:${contrato}:${etapa}`)
  await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { simulado: true } })
  return { pulado: false }
}
executarEfeitoGenerico.maxRetries = 5

async function marcarContratoRodando(runId: string, contrato: string): Promise<void> {
  "use step"
  await atualizarContrato(runId, contrato, "rodando")
  await registrarEvento({ runId, contrato, etapa: "contrato", estado: "rodando" })
}

async function marcarContratoFinal(
  runId: string,
  contrato: string,
  status: "ok" | "erro" | "bloqueado",
  erro?: string,
  referencias?: Record<string, unknown>,
): Promise<void> {
  "use step"
  await atualizarContrato(runId, contrato, status, erro, referencias)
  await registrarEvento({ runId, contrato, etapa: "contrato", estado: status, mensagem: erro, metadados: referencias })
}

async function encerrarRun(runId: string): Promise<void> {
  "use step"
  await finalizarRun(runId)
}

async function processarContrato(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
): Promise<void> {
  await marcarContratoRodando(runId, contrato.contrato)
  try {
    await etapaValidacao(runId, contrato.contrato)

    const employees = await resolverEmployeesCaju(runId, modo, contrato.contrato, contrato.pessoas)
    const pessoasComId: PessoaPedidoCaju[] = contrato.pessoas.map((p) => ({
      employeeId: employees[p.cpf.replace(/\D/g, "")] ?? null,
      contrato: p.contrato,
      interior: p.interior,
      creditoVR: p.creditoVR,
      creditoVT: p.creditoVT,
      pixVR: p.pixVR,
      pixVT: p.pixVT,
    }))

    await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "credito", pessoasComId)
    const pix = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "boleto", pessoasComId)

    for (const etapa of EFEITOS_GENERICOS) {
      await executarEfeitoGenerico(runId, modo, competencia, contrato.contrato, etapa)
      if (etapa === "rm_gerar") await sleep("2s") // AIONS não aguenta volume -> serial + espera
    }

    await marcarContratoFinal(runId, contrato.contrato, "ok", undefined, pix.orderId ? { pedidoPixId: pix.orderId } : undefined)
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "erro_desconhecido"
    await marcarContratoFinal(runId, contrato.contrato, "erro", mensagem)
  }
}

export async function executarMensalWorkflow(input: MensalWorkflowInput): Promise<{ runId: string }> {
  "use workflow"

  console.info("mensal workflow iniciado", { runId: input.runId, modo: input.modo })
  const filtro = new Set(input.somenteContratos ?? [])
  for (const contrato of input.snapshot.contratos) {
    if (filtro.size && !filtro.has(contrato.contrato)) continue
    if (contrato.bloqueado) {
      await marcarContratoFinal(input.runId, contrato.contrato, "bloqueado", contrato.motivoBloqueio ?? undefined)
      continue
    }
    await processarContrato(input.runId, input.modo, input.snapshot.competencia, contrato)
    await sleep("1s") // espaçamento entre contratos (serial, sem paralelismo)
  }
  await encerrarRun(input.runId)
  return { runId: input.runId }
}
