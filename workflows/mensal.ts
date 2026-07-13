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
  criarSolicitacaoMensal,
  executarUpdatesDescontos,
  executarUpdatesPlano,
  registrarDebitoControleCaju,
  setarStatusAutomacaoOk,
} from "../auth-backend/src/mensal/mondayEfeitos.js"
import { arquivarDriveMensal } from "../auth-backend/src/mensal/driveEfeitos.js"
import {
  atualizarContrato,
  finalizarRun,
  registrarEvento,
} from "../auth-backend/src/mensal/repo.js"
import {
  RM_COLIGADA,
  SECOES_INTERMITENTES,
  chapasEventosPix,
  codSecaoBase,
  consultarIdfinanc,
  enviarHistoricoRm,
  executarFopRotinas,
  integrarIdfinanc,
  lotesHistorico,
  montarRegistrosHistorico,
  type RegistroHistoricoRm,
} from "../auth-backend/src/mensal/rmEfeitos.js"
import { codigoSecaoContrato } from "../auth-backend/src/mensal/calculo.js"
import type { ContratoPreviaMensal, SnapshotPreviaMensal } from "../auth-backend/src/mensal/types.js"

const MESES_LABEL = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"] as const

export interface MensalWorkflowInput {
  runId: string
  modo: "homologacao" | "producao"
  snapshot: SnapshotPreviaMensal
  somenteContratos?: string[]
}

// Todos os efeitos têm adaptador real (Caju/RM/Monday/Drive), gated por producao+ledger.

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

// --- RM (ponte AIONS): histórico ZMDHSTBENFUNC + FopRotinas + IDFNAN + Integrar. ---
// Serial SEMPRE (AIONS não aguenta volume): lotes de 50 no histórico, waits entre passos.

/** rm_gerar (parte 1): grava 1 LOTE de histórico ZMDHSTBENFUNC. Ledger por lote. */
async function etapaRmHistoricoLote(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
  tipo: "pix" | "credito",
  loteIdx: number,
): Promise<void> {
  "use step"
  const etapa = "rm_gerar"
  const metadata = getStepMetadata()
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt,
    metadados: { sub: `hist_${tipo}_lote${loteIdx}` },
  })
  const chaveSub = `${etapa}_hist_${tipo}_l${loteIdx}`
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, chaveSub, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
  const { mes, ano } = competenciaPartes(competencia)
  const codSecao = codSecaoBase(codigoSecaoContrato(contrato.contrato))
  const registros: RegistroHistoricoRm[] = lotesHistorico(montarRegistrosHistorico(contrato.pessoas, tipo, {
    anoComp: ano, mesComp: mes, codSecao, dataImport: new Date().toISOString().slice(0, 10),
  }))[loteIdx] ?? []
  for (const registro of registros) {
    await enviarHistoricoRm(registro) // serial por design
  }
  await confirmarEfeito(r.chave, `rm:hist:${tipo}:l${loteIdx}:${registros.length}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { sub: `hist_${tipo}_lote${loteIdx}`, registros: registros.length },
  })
}
etapaRmHistoricoLote.maxRetries = 3

/** rm_gerar (parte 2): FopRotinas — gera lançamentos financeiros das chapas com PIX. */
async function etapaRmFopRotinas(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
): Promise<{ temFinanceiro: boolean }> {
  "use step"
  const etapa = "rm_gerar"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt, metadados: { sub: "foprotinas" } })
  const { chapas, eventos } = chapasEventosPix(contrato.pessoas)
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return { temFinanceiro: chapas.length > 0 }
  if (r.acao === "simular") {
    await simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
    return { temFinanceiro: false }
  }
  if (!chapas.length) {
    // contrato 100% crédito: sem lançamento financeiro (igual ao IF "Tem Boleto p/ Financeiro?" do n8n)
    await confirmarEfeito(r.chave, "rm:foprotinas:sem_boleto")
    await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { pulado: "sem_boleto" } })
    return { temFinanceiro: false }
  }
  const hoje = new Date().toISOString().slice(0, 10)
  const { mes, ano } = competenciaPartes(competencia)
  await executarFopRotinas({
    coligada: RM_COLIGADA,
    codSecao: codSecaoBase(codigoSecaoContrato(contrato.contrato)),
    chapas, eventos, anoComp: ano, mesComp: mes,
    dataEmissao: `${hoje}T00:00:00`, dataVencimento: `${hoje}T00:00:00`,
  })
  await confirmarEfeito(r.chave, `rm:foprotinas:${chapas.length}chapas:${eventos.join("+")}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { chapas: chapas.length, eventos },
  })
  return { temFinanceiro: true }
}
etapaRmFopRotinas.maxRetries = 3

async function etapaRmAguardar(runId: string, contrato: string): Promise<void> {
  "use step"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa: "rm_aguardar", estado: "concluido", tentativa: metadata.attempt })
}

/** rm_integrar: consulta IDFNAN, integra cada IDFINANC em série (dedup por IDFINANC no ledger). */
async function etapaRmIntegrar(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
  temFinanceiro: boolean,
): Promise<{ idVR: string | null; idVT: string | null }> {
  "use step"
  const etapa = "rm_integrar"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return { idVR: null, idVT: null }
  if (r.acao === "simular") {
    await simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
    return { idVR: null, idVT: null }
  }
  if (!temFinanceiro) {
    await confirmarEfeito(r.chave, "rm:integrar:sem_financeiro")
    await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { pulado: "sem_financeiro" } })
    return { idVR: null, idVT: null }
  }
  const hoje = new Date().toISOString().slice(0, 10)
  const secaoBase = codSecaoBase(codigoSecaoContrato(contrato.contrato))
  // Varre TODAS as seções de intermitentes: o RM agrupa por seção REAL da pessoa
  // (ex: lotados em ADMINISTRATIVO), então lançamentos do contrato podem cair fora
  // da seção-base. Dedup por IDFINANC garante que nada integra 2x entre contratos.
  let idVR: string | null = null
  let idVT: string | null = null
  let encontrados = 0
  let integrados = 0
  for (const secao of SECOES_INTERMITENTES) {
    const rotulados = await consultarIdfinanc({
      coligada: RM_COLIGADA,
      codSecao: secao,
      dataEmissao: `${hoje}T00:00:00`,
    })
    encontrados += rotulados.length
    for (const row of rotulados) {
      // Dedup FORTE por IDFINANC (entre runs e entre contratos).
      const chaveId = `mensal:rm_idfinanc:${RM_COLIGADA}:${row.IDFINANC}`
      const reservaId = await reservarEfeito(chaveId, "mensal_rm_idfinanc", { runId, contrato: contrato.contrato, historico: row.tipoEvento })
      if (reservaId === "confirmado") continue
      if (reservaId === "pendente") throw new FatalError(`efeito_pendente_requer_conciliacao:rm_idfinanc:${row.IDFINANC}`)
      await integrarIdfinanc(row.IDFINANC, RM_COLIGADA)
      await confirmarEfeito(chaveId, `rm:idfinanc:${row.IDFINANC}:${row.tipoEvento}`)
      integrados++
      // idVR/idVT do contrato: primeiro VR/VT achado na SEÇÃO-BASE (paridade com o n8n).
      if (secao === secaoBase && row.tipoEvento === "VR" && !idVR) idVR = String(row.IDFINANC)
      if (secao === secaoBase && row.tipoEvento === "VT" && !idVT) idVT = String(row.IDFINANC)
    }
  }
  await confirmarEfeito(r.chave, `rm:integrar:${integrados}:vr=${idVR ?? "-"}:vt=${idVT ?? "-"}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { encontrados, integrados, idVR, idVT },
  })
  return { idVR, idVT }
}
etapaRmIntegrar.maxRetries = 3

// --- Monday: helpers de reserva/confirm no ledger + steps reais (gated). -----
async function reservarOuPular(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: string,
  etapa: string,
  tentativa: number,
): Promise<{ chave: string; acao: "executar" | "pular" | "simular" }> {
  const chave = `mensal:${competencia}:${normContrato(contrato)}:${etapa}`
  const reserva = await reservarEfeito(chave, `mensal_${etapa}`, { runId, competencia, contrato, modo })
  if (reserva === "confirmado") {
    await registrarEvento({ runId, contrato, etapa, estado: "pulado_idempotencia", tentativa })
    return { chave, acao: "pular" }
  }
  if (reserva === "pendente") throw new FatalError(`efeito_pendente_requer_conciliacao:${etapa}`)
  if (modo !== "producao") return { chave, acao: "simular" }
  if (!PRODUCAO_LIBERADA) throw new FatalError("execucao_mensal_producao_bloqueada_ate_cutover")
  return { chave, acao: "executar" }
}

async function simularEfeito(
  runId: string,
  contrato: string,
  etapa: string,
  chave: string,
  tentativa: number,
): Promise<void> {
  await confirmarEfeito(chave, `homologacao:${runId}:${contrato}:${etapa}`)
  await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa, metadados: { simulado: true } })
}

/** monday_plano: updates por item do Plano + updates do board Desconto FIFO. */
async function etapaMondayPlano(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
  boardId: string,
  colunasPlano: Record<string, string> | undefined,
): Promise<void> {
  "use step"
  const etapa = "monday_plano"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
  const nPlan = await executarUpdatesPlano(boardId, contrato.planUpdates ?? [], colunasPlano)
  const nDesc = await executarUpdatesDescontos(contrato.descontoUpdates ?? [])
  await confirmarEfeito(r.chave, `monday:plan:${nPlan}:desc:${nDesc}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { planItens: nPlan, descontoItens: nDesc },
  })
}
etapaMondayPlano.maxRetries = 5

/** monday_controle_caju: debita o crédito do contrato no grupo da COMPETÊNCIA (fix do bug new Date). */
async function etapaMondayControleCaju(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
  grupoControleCaju: string | null,
  pedidoCreditoId: string | null,
): Promise<void> {
  "use step"
  const etapa = "monday_controle_caju"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
  const { mes, ano } = competenciaPartes(competencia)
  const totalCredito = contrato.totais.credito ?? 0
  if (totalCredito > 0 && !grupoControleCaju) {
    throw new FatalError("grupo_controle_caju_ausente_no_snapshot")
  }
  const res = totalCredito > 0
    ? await registrarDebitoControleCaju({
        grupoControleCaju: grupoControleCaju!,
        contrato: contrato.contrato,
        competenciaLabel: MESES_LABEL[mes - 1]!,
        anoComp: ano,
        totalCredito,
        pedidoCreditoId,
        dataIso: new Date().toISOString().slice(0, 10),
      })
    : ({ pulado: true, motivo: "sem_credito_contrato" } as const)
  const ref = "id" in res ? `monday:controle_caju:${res.id}` : `monday:controle_caju:${res.motivo}`
  await confirmarEfeito(r.chave, ref)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: "id" in res ? { itemId: res.id, saldoAnterior: res.saldoAnterior, debito: totalCredito } : { pulado: res.motivo },
  })
}
etapaMondayControleCaju.maxRetries = 5

/** monday_solicitacao: cria a Solicitação de Pagamento. Retorna o itemId (p/ status OK). */
async function etapaMondaySolicitacao(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
  boardId: string,
  grupoSolicitacao: string | null,
  refs: { idVR?: string | null; idVT?: string | null; pedidoCreditoId?: string | null; pedidoPixId?: string | null },
): Promise<string | null> {
  "use step"
  const etapa = "monday_solicitacao"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return null
  if (r.acao === "simular") { await simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt); return null }
  if (!grupoSolicitacao) throw new FatalError("grupo_solicitacao_ausente_no_snapshot")
  const { mes, ano } = competenciaPartes(competencia)
  const criado = await criarSolicitacaoMensal({
    contrato: contrato.contrato,
    competenciaLabel: MESES_LABEL[mes - 1]!,
    anoComp: ano,
    totais: {
      vr: contrato.totais.vr ?? 0, vt: contrato.totais.vt ?? 0,
      credito: contrato.totais.credito ?? 0, pix: contrato.totais.pix ?? 0,
    },
    pessoas: contrato.pessoas,
    idVR: refs.idVR, idVT: refs.idVT,
    pedidoCreditoId: refs.pedidoCreditoId, pedidoPixId: refs.pedidoPixId,
    summaryCredito: refs.pedidoCreditoId ? `https://empresa.caju.com.br/classic/#/order/${refs.pedidoCreditoId}/summary` : "",
    summaryPix: refs.pedidoPixId ? `https://empresa.caju.com.br/classic/#/order/${refs.pedidoPixId}/summary` : "",
    planBoardId: boardId,
    dataIso: new Date().toISOString().slice(0, 10),
  }, grupoSolicitacao)
  await confirmarEfeito(r.chave, `monday:solicitacao:${criado.id}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { itemId: criado.id, url: criado.url },
  })
  return criado.id
}
etapaMondaySolicitacao.maxRetries = 5

/** monday_status_ok: marca AUTOMAÇÃO - OK na Solicitação — SÓ depois de todas as etapas do contrato. */
async function etapaMondayStatusOk(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: string,
  solicitacaoId: string | null,
): Promise<void> {
  "use step"
  const etapa = "monday_status_ok"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato, etapa, r.chave, metadata.attempt)
  if (!solicitacaoId) throw new FatalError("solicitacao_id_ausente_para_status_ok")
  await setarStatusAutomacaoOk(solicitacaoId)
  await confirmarEfeito(r.chave, `monday:status_ok:${solicitacaoId}`)
  await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { solicitacaoId } })
}
etapaMondayStatusOk.maxRetries = 5

// --- Drive: arquiva boleto/comprovante/QR nas pastas CAJU e linka na Solicitação. ---
async function etapaDrive(
  runId: string,
  modo: "homologacao" | "producao",
  competencia: string,
  contrato: ContratoPreviaMensal,
  refs: {
    pedidoCreditoId: string | null
    pedidoPixId: string | null
    qrBoletoBase64: string
    idVR: string | null
    idVT: string | null
    solicitacaoId: string | null
  },
): Promise<void> {
  "use step"
  const etapa = "drive"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
  const { mes } = competenciaPartes(competencia)
  const resultados = await arquivarDriveMensal(contrato, competencia, MESES_LABEL[mes - 1]!, {
    pedidoCreditoId: refs.pedidoCreditoId,
    pedidoPixId: refs.pedidoPixId,
    summaryCredito: refs.pedidoCreditoId ? `https://empresa.caju.com.br/classic/#/order/${refs.pedidoCreditoId}/summary` : "",
    summaryPix: refs.pedidoPixId ? `https://empresa.caju.com.br/classic/#/order/${refs.pedidoPixId}/summary` : "",
    idVR: refs.idVR,
    idVT: refs.idVT,
    qrBoletoBase64: refs.qrBoletoBase64,
    solicitacaoId: refs.solicitacaoId,
  })
  const uploads = resultados.flatMap((x) => x.resultado.uploads.map((u) => u.id))
  await confirmarEfeito(r.chave, `drive:${uploads.join(",") || "sem_upload"}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: {
      uploads: uploads.length,
      pastaConvocacao: resultados[0]?.resultado.pasta_convocacao_drive_url,
    },
  })
}
etapaDrive.maxRetries = 3

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
  snapshot: SnapshotPreviaMensal,
  contrato: ContratoPreviaMensal,
): Promise<void> {
  const competencia = snapshot.competencia
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

    const credito = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "credito", pessoasComId)
    const pix = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "boleto", pessoasComId)

    // RM via ponte AIONS — SERIAL com esperas (a ponte não aguenta volume).
    // Histórico ZMDHSTBENFUNC em lotes de 50 (contagem determinística a partir do snapshot).
    const { mes, ano } = competenciaPartes(competencia)
    const ctxContagem = { anoComp: ano, mesComp: mes, codSecao: "", dataImport: "1970-01-01" }
    for (const tipo of ["pix", "credito"] as const) {
      const nLotes = lotesHistorico(montarRegistrosHistorico(contrato.pessoas, tipo, ctxContagem)).length
      for (let i = 0; i < nLotes; i++) {
        await etapaRmHistoricoLote(runId, modo, competencia, contrato, tipo, i)
        if (i < nLotes - 1) await sleep("60s") // espera entre lotes (igual ao Wait Hist do n8n)
      }
    }
    const { temFinanceiro } = await etapaRmFopRotinas(runId, modo, competencia, contrato)
    await sleep("7s") // Wait RM Processar (n8n)
    await etapaRmAguardar(runId, contrato.contrato)
    const rmIds = await etapaRmIntegrar(runId, modo, competencia, contrato, temFinanceiro)

    // Monday (adaptador real, gated por producao+ledger).
    await etapaMondayPlano(runId, modo, competencia, contrato, snapshot.boardId, snapshot.apoio.colunasPlano)
    await etapaMondayControleCaju(runId, modo, competencia, contrato, snapshot.apoio.grupoControleCaju, credito.orderId)
    const solicitacaoId = await etapaMondaySolicitacao(
      runId, modo, competencia, contrato, snapshot.boardId, snapshot.apoio.grupoSolicitacao ?? null,
      { idVR: rmIds.idVR, idVT: rmIds.idVT, pedidoCreditoId: credito.orderId, pedidoPixId: pix.orderId },
    )

    // Drive (adaptador real, gated).
    await etapaDrive(runId, modo, competencia, contrato, {
      pedidoCreditoId: credito.orderId,
      pedidoPixId: pix.orderId,
      qrBoletoBase64: pix.qr,
      idVR: rmIds.idVR,
      idVT: rmIds.idVT,
      solicitacaoId,
    })

    // AUTOMAÇÃO - OK só depois de TODAS as etapas do contrato confirmadas.
    await etapaMondayStatusOk(runId, modo, competencia, contrato.contrato, solicitacaoId)

    const referencias: Record<string, unknown> = {}
    if (credito.orderId) referencias.pedidoCreditoId = credito.orderId
    if (pix.orderId) referencias.pedidoPixId = pix.orderId
    if (solicitacaoId) referencias.solicitacaoId = solicitacaoId
    await marcarContratoFinal(runId, contrato.contrato, "ok", undefined, Object.keys(referencias).length ? referencias : undefined)
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
    await processarContrato(input.runId, input.modo, input.snapshot, contrato)
    await sleep("1s") // espaçamento entre contratos (serial, sem paralelismo)
  }
  await encerrarRun(input.runId)
  return { runId: input.runId }
}
