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
  garantirGrupoCaixa,
  registrarDebitoControleCaju,
  setarStatusAutomacaoOk,
} from "../auth-backend/src/mensal/mondayEfeitos.js"
import { arquivarDriveMensal } from "../auth-backend/src/mensal/driveEfeitos.js"
import {
  atualizarContrato,
  finalizarRun,
  registrarEvento,
  runFoiCancelado,
} from "../auth-backend/src/mensal/repo.js"
import {
  RM_COLIGADA,
  RM_DATA_SERVER_HISTORICO,
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
// Modo desenvolvedor (import isolado de propósito — o bloco acima está sob edição de outra sessão).
import { etapaRealNoRunDev } from "../auth-backend/src/mensal/devEfeitos.js"
// Convocação no RM (S-2260) — serviço testado à parte; aqui só o fatiamento em steps.
import {
  lerItensConvocacaoMensal,
  mesclarRelatorios,
  planejarAlvosMensal,
  processarLoteConvocacaoMensal,
  resolverEcoConvocacaoRm,
  type AlvoConvocacaoMensal,
  type RelatorioConvocacaoMensal,
} from "../auth-backend/src/services/convocacaoMensal.js"

const MESES_LABEL = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"] as const

export interface MensalWorkflowInput {
  runId: string
  modo: "homologacao" | "producao"
  snapshot: SnapshotPreviaMensal
  somenteContratos?: string[]
}

// Todos os efeitos têm adaptador real (Caju/RM/Monday/Drive), gated por producao+ledger.

// Modo de execução dos steps. "teste" (derivado de snapshot.papel==="teste") = sandbox:
// escreve REAL só o Plano (no board de teste), simula todo o resto, e a chave de
// idempotência é por RUN — reenvio ilimitado sem conflito.
type ModoExec = "homologacao" | "producao" | "teste"

// Trava de produção financeira. Só libera com modo=producao E env=1. Hoje 0 em todo ambiente.
const PRODUCAO_LIBERADA = process.env.MENSAL_PRODUCTION_ENABLED === "1"

// Espera entre lotes do histórico RM. Os 60s originais existiam por causa da ponte ngrok
// ("SEMPRE em lotes no chamador — ngrok derruba volume"); com o RM direto o motivo encolhe.
// Lido no MÓDULO, não dentro do workflow: env lida no corpo quebraria o replay determinístico.
const ESPERA_LOTE_MS = Number(process.env.MENSAL_RM_ESPERA_LOTE_MS ?? "15000")

function normContrato(contrato: string): string {
  return contrato.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
}

/**
 * Chave de idempotência do efeito externo. SÓ produção usa a chave real por competência.
 *
 * Simulação (teste/homologação) tem namespace próprio POR RUN. Compartilhar a chave de produção
 * é o que quebrou o run `e173b1ef` (01/08): a simulação `09a1e0c0` da véspera confirmou as 57
 * chaves de `mensal:2026-08:*`, e o pagamento real seguinte pulou TODAS as etapas como
 * "pulado_idempotencia" — terminou `ok 5/5` sem ter feito nada. Silencioso, que é o pior modo
 * de falhar num fluxo financeiro.
 *
 * Efeito colateral aceito: homologação deixa de exercitar o caminho "confirmado -> pular".
 * Esse caminho é exercitado pelos retries de produção, e o risco inverso (pagamento pulado em
 * silêncio) é incomparavelmente pior que a cobertura perdida.
 */
function chaveEfeito(
  modo: ModoExec,
  runId: string,
  competencia: string,
  contrato: string,
  etapa: string,
): string {
  return modo === "producao"
    ? `mensal:${competencia}:${normContrato(contrato)}:${etapa}`
    : `mensal-${modo}:${runId}:${normContrato(contrato)}:${etapa}`
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
  modo: ModoExec,
  contrato: string,
  pessoas: Array<{ cpf: string }>,
): Promise<Record<string, string>> {
  "use step"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa: "caju_pessoas", estado: "rodando", tentativa: metadata.attempt })
  if (modo === "homologacao") {
    await registrarEvento({ runId, contrato, etapa: "caju_pessoas", estado: "concluido", tentativa: metadata.attempt, metadados: { simulado: true } })
    return {}
  }
  // "teste" executa real (sandbox só troca o board do Plano e marca os itens como TESTE).
  if (modo === "producao" && !PRODUCAO_LIBERADA) throw new FatalError("execucao_mensal_producao_bloqueada_ate_cutover")
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
  modo: ModoExec,
  competencia: string,
  contrato: string,
  tipo: TipoPedidoCaju,
  pessoas: PessoaPedidoCaju[],
): Promise<{ orderId: string | null; qr: string; pulado: boolean; simulado: boolean }> {
  "use step"
  const etapa = tipo === "credito" ? "caju_credito" : "caju_pix"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })

  // Só produção usa a chave por competência; simulação é por RUN (ver chaveEfeito).
  const chave = chaveEfeito(modo, runId, competencia, contrato, etapa)
  const reserva = await reservarEfeito(chave, `mensal_${etapa}`, { runId, competencia, contrato, modo, tipo })
  if (reserva === "confirmado") {
    await registrarEvento({ runId, contrato, etapa, estado: "pulado_idempotencia", tentativa: metadata.attempt })
    return { orderId: null, qr: "", pulado: true, simulado: false }
  }
  // "pendente" no teste re-executa direto (retomada nunca trava em conciliação).
  if (reserva === "pendente" && modo !== "teste") throw new FatalError(`efeito_pendente_requer_conciliacao:${etapa}`)

  const { mes, ano } = competenciaPartes(competencia)

  // Homologação: simula, nenhum efeito externo.
  if (modo === "homologacao") {
    await confirmarEfeito(chave, `homologacao:${runId}:${contrato}:${etapa}`)
    await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { simulado: true } })
    return { orderId: null, qr: "", pulado: false, simulado: true }
  }

  // Produção: gate duplo. "teste" executa real, com nome do pedido marcado TESTE.
  if (modo === "producao" && !PRODUCAO_LIBERADA) throw new FatalError("execucao_mensal_producao_bloqueada_ate_cutover")

  const pedido = montarPedidoCaju(pessoas, tipo, modo === "teste" ? `TESTE ${contrato}` : contrato, mes, ano)
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
  modo: ModoExec,
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
  // Guarda a PK de CADA SaveRecord: é o caminho de volta do lote. Antes só a contagem ia pro
  // ledger, e desfazer o run de 01/08 exigiu redescobrir 225 registros por ReadView.
  const pks: string[] = []
  let viaPonte = 0
  for (const registro of registros) {
    const res = await enviarHistoricoRm(registro) // serial por design
    if (res.chave) pks.push(res.chave)
    else viaPonte++
  }
  await confirmarEfeito(r.chave, `rm:hist:${tipo}:l${loteIdx}:${registros.length}`, {
    dataServer: RM_DATA_SERVER_HISTORICO,
    pks,
    // >0 significa lote sem PK registrada (ponte não devolve chave) -> desfazer exige ReadView.
    semPk: viaPonte,
  })
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { sub: `hist_${tipo}_lote${loteIdx}`, registros: registros.length, pks: pks.length, semPk: viaPonte },
  })
}
etapaRmHistoricoLote.maxRetries = 3

/** rm_gerar (parte 2): FopRotinas — gera lançamentos financeiros das chapas com PIX. */
async function etapaRmFopRotinas(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
  /** Vencimento escolhido na aprovação pra ESTE contrato ("YYYY-MM-DD"). Ausente = hoje. */
  dataVencimentoContrato?: string,
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
  // Vencimento vem da aprovação, por contrato. `dataEmissao` NÃO acompanha: consultarIdfinanc
  // filtra por DATAEMISSAO pra achar os lançamentos recém-criados, e mudá-la cegaria a busca.
  const vencimento = dataVencimentoContrato ?? hoje
  await executarFopRotinas({
    coligada: RM_COLIGADA,
    codSecao: codSecaoBase(codigoSecaoContrato(contrato.contrato)),
    chapas, eventos, anoComp: ano, mesComp: mes,
    dataEmissao: `${hoje}T00:00:00`, dataVencimento: `${vencimento}T00:00:00`,
  })
  await confirmarEfeito(
    r.chave,
    `rm:foprotinas:${chapas.length}chapas:${eventos.join("+")}:venc=${vencimento}`,
  )
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { chapas: chapas.length, eventos, dataVencimento: vencimento, dataEmissao: hoje },
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
  modo: ModoExec,
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
  // Integra SÓ a seção-base do contrato — paridade estrita com o n8n (Consultar
  // IDFNAN usava um único CODSECAO). Lançamentos que o RM agrupa em sub-seções
  // fora da base (ex: 0007 ADMINISTRATIVO, 0010 SEDE) são pagos JUNTO com outro
  // processo (folha ADM) e o DP integra por lá — o mensal NÃO deve tocá-los.
  // Dedup por IDFINANC continua (0011 é base de SEDUC ESCOLA e INTERIOR).
  // O RM pode dividir o mesmo evento em N lançamentos (regra interna por pessoa) —
  // comportamento esperado. TODOS os ids vão pra Solicitação, separados por vírgula.
  const idsVR: string[] = []
  const idsVT: string[] = []
  let encontrados = 0
  let integrados = 0
  for (const secao of [secaoBase]) {
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
      if (row.tipoEvento === "VR") idsVR.push(String(row.IDFINANC))
      if (row.tipoEvento === "VT") idsVT.push(String(row.IDFINANC))
    }
  }
  const idVR = idsVR.length ? idsVR.join(", ") : null
  const idVT = idsVT.length ? idsVT.join(", ") : null
  await confirmarEfeito(r.chave, `rm:integrar:${integrados}:vr=${idVR ?? "-"}:vt=${idVT ?? "-"}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { encontrados, integrados, idVR, idVT },
  })
  return { idVR, idVT }
}
etapaRmIntegrar.maxRetries = 3

// --- Convocação no RM (S-2260) — decisões em docs/rm/plano-convocacao-mensal.md. --------------
// Flag PRÓPRIA e desligada por default: convocação é evento eSocial transmitido, não acompanha a
// flag do pontual. Lida no MÓDULO (padrão PRODUCAO_LIBERADA): env no corpo quebraria o replay.
const CONVOCACAO_RM_MENSAL = process.env.CONVOCACAO_RM_MENSAL_HABILITADA === "1"
// ~10 por step: pior caso medido (RM degradado, 20s/SaveRecord) ≈ 200s — cabe no teto da função.
// O contrato inteiro num step só (SEMSA, 27 pessoas) estouraria: 540s.
const TAMANHO_LOTE_CONVOCACAO_RM = 10

/**
 * Lê o board (grupos MENSAL + CANCELADOS PARCIAL) e planeja os alvos com período efetivo já
 * truncado. READ-ONLY — sem ledger; o resultado fica memoizado pelo WDK e os lotes fatiam dele.
 * Ler o board (e não o snapshot) é a decisão 1: líquido-zero e cancelado parcial entram.
 */
async function etapaConvocacaoRmPlano(
  runId: string,
  contrato: string,
): Promise<{
  alvos: AlvoConvocacaoMensal[]
  previa: RelatorioConvocacaoMensal
  boardId: string
  colCodRm: string | null
} | null> {
  "use step"
  const etapa = "convocacao_rm"
  const metadata = getStepMetadata()
  if (!CONVOCACAO_RM_MENSAL) {
    await registrarEvento({
      runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
      metadados: { desligado: true },
    })
    return null
  }
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const itens = await lerItensConvocacaoMensal(contrato)
  const { alvos, previa } = planejarAlvosMensal(contrato, itens)
  const eco = await resolverEcoConvocacaoRm()
  await registrarEvento({
    runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt,
    metadados: {
      sub: "plano", itens: itens.length, alvos: alvos.length,
      invalidos: previa.invalidos.length, canceladas_sem_dias: previa.canceladasSemDias,
      eco_coluna: eco.colCodRm ?? "AUSENTE",
    },
  })
  return { alvos, previa, ...eco }
}
etapaConvocacaoRmPlano.maxRetries = 3

/**
 * Grava UM lote (~10 pessoas). Ledger POR LOTE (`convocacao_rm_lote<N>` — família `rm_convocacao`
 * no modo desenvolvedor); por pessoa, o rastro pi.convocacoes_rm + ledger + pré-voo já seguram o
 * retry — re-executar o step pula quem gravou.
 */
async function etapaConvocacaoRmLote(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: string,
  alvos: AlvoConvocacaoMensal[],
  loteIdx: number,
  boardId: string,
  colCodRm: string | null,
): Promise<RelatorioConvocacaoMensal | null> {
  "use step"
  const etapa = "convocacao_rm"
  const metadata = getStepMetadata()
  await registrarEvento({
    runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt,
    metadados: { sub: `lote${loteIdx}`, pessoas: alvos.length },
  })
  const r = await reservarOuPular(runId, modo, competencia, contrato, `convocacao_rm_lote${loteIdx}`, metadata.attempt)
  if (r.acao === "pular") return null
  if (r.acao === "simular") {
    await simularEfeito(runId, contrato, etapa, r.chave, metadata.attempt)
    return null
  }

  const rel = await processarLoteConvocacaoMensal(contrato, alvos, { boardId, colCodRm })

  // Falha retryável JOGA — o WDK re-executa o step e a idempotência por pessoa pula os gravados.
  if (rel.falhas.length) {
    await registrarEvento({
      runId, contrato, etapa, estado: "erro", tentativa: metadata.attempt,
      mensagem: `lote${loteIdx}: ${rel.falhas.length} falha(s)`,
      metadados: { sub: `lote${loteIdx}`, falhas: rel.falhas.map((f) => `${f.chapa}: ${f.detalhe}`) },
    })
    throw new Error(`convocacao_rm_lote${loteIdx}_falhas: ${rel.falhas.map((f) => f.chapa).join(", ")}`)
  }

  // SÓ confirma lote LIMPO. requer_decisao/conciliando NÃO confirmam de propósito: confirmado é
  // pulado pra sempre — o DP resolveria no RM, retomaria o run, e a pessoa nunca seria reavaliada.
  if (!rel.temPendencia) {
    await confirmarEfeito(r.chave, `convocacao_rm:${contrato}:lote${loteIdx}`)
  }
  await registrarEvento({
    runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: {
      sub: `lote${loteIdx}`, gravados: rel.gravados, ja_existiam: rel.jaExistiam,
      cobertos: rel.cobertos, requer_decisao: rel.requerDecisao.length, conciliando: rel.conciliando.length,
      codigos: rel.pessoas.flatMap((p) => p.codigos ?? []),
    },
  })
  return rel
}
etapaConvocacaoRmLote.maxRetries = 3

/** Evento-resumo do contrato (step próprio: escrita de evento não pode viver no corpo do workflow). */
async function etapaConvocacaoRmResumo(
  runId: string,
  contrato: string,
  agregado: RelatorioConvocacaoMensal,
): Promise<void> {
  "use step"
  const metadata = getStepMetadata()
  await registrarEvento({
    runId, contrato, etapa: "convocacao_rm",
    estado: agregado.temPendencia ? "erro" : "concluido",
    tentativa: metadata.attempt,
    mensagem: agregado.temPendencia
      ? `${agregado.requerDecisao.length} requer decisão DP, ${agregado.conciliando.length} conciliando`
      : undefined,
    metadados: {
      sub: "resumo", total: agregado.total, gravados: agregado.gravados,
      ja_existiam: agregado.jaExistiam, cobertos: agregado.cobertos,
      canceladas_sem_dias: agregado.canceladasSemDias,
      requer_decisao: agregado.requerDecisao.map((p) => `${p.chapa} ${p.nome}: ${p.detalhe}`),
      conciliando: agregado.conciliando.map((p) => p.chapa),
      invalidos: agregado.invalidos.map((p) => `${p.chapa || p.itemId}: ${p.detalhe}`),
    },
  })
}

/**
 * Orquestra plano → lotes → resumo. Pendência humana (requer_decisao/conciliando) lança
 * FatalError DEPOIS do resumo: o contrato marca erro (decisão 4 — AUTOMAÇÃO-OK só com 100%) com
 * o detalhe já registrado na timeline. Retry não conserta decisão humana, por isso Fatal.
 */
async function executarConvocacaoRmContrato(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: string,
): Promise<void> {
  const plano = await etapaConvocacaoRmPlano(runId, contrato)
  if (!plano) return
  let agregado = plano.previa
  for (let i = 0; i * TAMANHO_LOTE_CONVOCACAO_RM < plano.alvos.length; i++) {
    const fatia = plano.alvos.slice(i * TAMANHO_LOTE_CONVOCACAO_RM, (i + 1) * TAMANHO_LOTE_CONVOCACAO_RM)
    const rel = await etapaConvocacaoRmLote(
      runId, modo, competencia, contrato, fatia, i, plano.boardId, plano.colCodRm,
    )
    if (rel) agregado = mesclarRelatorios(agregado, rel)
  }
  await etapaConvocacaoRmResumo(runId, contrato, agregado)
  if (agregado.requerDecisao.length || agregado.conciliando.length) {
    throw new FatalError(
      `convocacao_rm_pendencias: ${agregado.requerDecisao.length} requer decisao DP, ` +
        `${agregado.conciliando.length} em conciliacao`,
    )
  }
}

// --- Monday: helpers de reserva/confirm no ledger + steps reais (gated). -----
async function reservarOuPular(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: string,
  etapa: string,
  tentativa: number,
): Promise<{ chave: string; acao: "executar" | "pular" | "simular" }> {
  // Sandbox (board de teste) e homologação: chave por RUN — cada reenvio é um run novo, nunca
  // conflita com execuções anteriores nem com a chave real. Retry do MESMO run segue idempotente.
  const chave = chaveEfeito(modo, runId, competencia, contrato, etapa)
  const reserva = await reservarEfeito(chave, `mensal_${etapa}`, { runId, competencia, contrato, modo })
  if (reserva === "confirmado") {
    await registrarEvento({ runId, contrato, etapa, estado: "pulado_idempotencia", tentativa })
    return { chave, acao: "pular" }
  }
  // "teste" executa TUDO real (Plano no board sandbox; Solicitação/Controle marcados TESTE),
  // sem exigir a trava de produção — o isolamento vem do board sandbox + chave por run.
  // "pendente" no teste não exige conciliação: re-executa direto (retomada nunca trava).
  if (modo === "teste") return { chave, acao: "executar" }
  if (reserva === "pendente") throw new FatalError(`efeito_pendente_requer_conciliacao:${etapa}`)
  // Modo DESENVOLVEDOR: run de homologação com whitelist de famílias reais (dev_familias_reais no
  // run). Família marcada executa DE VERDADE — mas com a chave por run lá de cima, então o envio
  // de teste nunca marca a etapa como feita pra competência. Depois do check de "pendente" de
  // propósito: envio real de dev que ficou mudo trava em conciliação igual produção.
  if (modo === "homologacao" && (await etapaRealNoRunDev(runId, etapa))) {
    return { chave, acao: "executar" }
  }
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
  modo: ModoExec,
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
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
  grupoControleCaju: string | null,
  caixa: string | undefined,
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
  // Gaveta de caixa: a prévia é read-only, então quem cria o grupo do mês é a execução.
  const grupoControle = totalCredito > 0
    ? (grupoControleCaju ?? (await garantirGrupoCaixa("controle", caixa)))
    : grupoControleCaju
  const res = totalCredito > 0
    ? await registrarDebitoControleCaju({
        grupoControleCaju: grupoControle!,
        contrato: contrato.contrato,
        nomePrefixo: modo === "teste" ? "TESTE - " : undefined,
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
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
  boardId: string,
  grupoSolicitacao: string | null,
  caixa: string | undefined,
  refs: { idVR?: string | null; idVT?: string | null; pedidoCreditoId?: string | null; pedidoPixId?: string | null },
): Promise<string | null> {
  "use step"
  const etapa = "monday_solicitacao"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return null
  if (r.acao === "simular") { await simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt); return null }
  // Gaveta de caixa: cria o grupo do mês se a prévia (read-only) não achou.
  const grupoDestino = grupoSolicitacao ?? (await garantirGrupoCaixa("solicitacao", caixa))
  const { mes, ano } = competenciaPartes(competencia)
  const criado = await criarSolicitacaoMensal({
    contrato: contrato.contrato,
    nomePrefixo: modo === "teste" ? "TESTE - " : undefined,
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
  }, grupoDestino)
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
  modo: ModoExec,
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
  modo: ModoExec,
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
    nomePrefixo: modo === "teste" ? "TESTE - " : undefined,
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

/** Lê o status atual do run — true se o operador cancelou pela tela. */
async function runCancelado(runId: string): Promise<boolean> {
  "use step"
  return runFoiCancelado(runId)
}

async function processarContrato(
  runId: string,
  modo: ModoExec,
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

    // Convocação no RM (S-2260) ANTES do financeiro — decisão 2 do Isaac: a convocação precede o
    // pagamento na ordem do eSocial. Pendência humana lança FatalError e o contrato marca erro
    // (decisão 4): o pagamento deste contrato só roda depois que o DP resolver e retomar.
    await executarConvocacaoRmContrato(runId, modo, competencia, contrato.contrato)

    // RM via ponte AIONS — SERIAL com esperas (a ponte não aguenta volume).
    // Histórico ZMDHSTBENFUNC em lotes de 50 (contagem determinística a partir do snapshot).
    // ORDEM (regra do DP): histórico PIX -> lançamento do boleto (FopRotinas+integrar)
    // -> só DEPOIS o histórico de CRÉDITO. O crédito não pode existir no ZMD quando o
    // FopRotinas roda, senão corre risco de ser somado no boleto.
    const { mes, ano } = competenciaPartes(competencia)
    const ctxContagem = { anoComp: ano, mesComp: mes, codSecao: "", dataImport: "1970-01-01" }
    const lotesPorTipo = (tipo: "pix" | "credito") =>
      lotesHistorico(montarRegistrosHistorico(contrato.pessoas, tipo, ctxContagem)).length
    // Contado UMA vez: antes era reavaliado na condição do for, remontando todos os XMLs a cada volta.
    const nLotesPix = lotesPorTipo("pix")
    const nLotesCredito = lotesPorTipo("credito")
    // Em homologação nada é enviado — esperar entre lotes é desperdício puro (custava 60s por lote).
    // "teste" mantém a espera: o board sandbox escreve no RM de verdade.
    const esperaLoteMs = modo === "homologacao" ? 0 : ESPERA_LOTE_MS
    for (let i = 0; i < nLotesPix; i++) {
      await etapaRmHistoricoLote(runId, modo, competencia, contrato, "pix", i)
      if (i < nLotesPix - 1 && esperaLoteMs > 0) await sleep(esperaLoteMs)
    }
    const { temFinanceiro } = await etapaRmFopRotinas(
      runId, modo, competencia, contrato,
      snapshot.apoio.vencimentos?.[contrato.contrato],
    )
    // FopRotinas é job ASSÍNCRONO no RM (SyncExecution=false): o IDFNAN só lista depois que ele
    // materializa. Não cortar — a leitura direta encurtou a janela, então isso ficou mais crítico.
    if (modo !== "homologacao") await sleep("7s")
    await etapaRmAguardar(runId, contrato.contrato)
    const rmIds = await etapaRmIntegrar(runId, modo, competencia, contrato, temFinanceiro)
    for (let i = 0; i < nLotesCredito; i++) {
      await etapaRmHistoricoLote(runId, modo, competencia, contrato, "credito", i)
      if (i < nLotesCredito - 1 && esperaLoteMs > 0) await sleep(esperaLoteMs)
    }

    // Monday (adaptador real, gated por producao+ledger).
    await etapaMondayPlano(runId, modo, competencia, contrato, snapshot.boardId, snapshot.apoio.colunasPlano)
    await etapaMondayControleCaju(
      runId, modo, competencia, contrato, snapshot.apoio.grupoControleCaju, snapshot.apoio.caixa, credito.orderId,
    )
    const solicitacaoId = await etapaMondaySolicitacao(
      runId, modo, competencia, contrato, snapshot.boardId, snapshot.apoio.grupoSolicitacao ?? null,
      snapshot.apoio.caixa,
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

  // papel "teste" (board sandbox) sobrepõe o modo: Plano real no board de teste, resto simulado.
  const modoExec: ModoExec = input.snapshot.papel === "teste" ? "teste" : input.modo
  console.info("mensal workflow iniciado", { runId: input.runId, modo: modoExec })
  const filtro = new Set(input.somenteContratos ?? [])
  for (const contrato of input.snapshot.contratos) {
    if (filtro.size && !filtro.has(contrato.contrato)) continue
    // Interrupção: se o operador cancelou pela tela, para ANTES do próximo contrato
    // (o contrato em andamento termina; os seguintes não iniciam).
    if (await runCancelado(input.runId)) {
      console.info("mensal workflow interrompido pelo operador", { runId: input.runId })
      return { runId: input.runId }
    }
    if (contrato.bloqueado) {
      await marcarContratoFinal(input.runId, contrato.contrato, "bloqueado", contrato.motivoBloqueio ?? undefined)
      continue
    }
    await processarContrato(input.runId, modoExec, input.snapshot, contrato)
    await sleep("1s") // espaçamento entre contratos (serial, sem paralelismo)
  }
  if (await runCancelado(input.runId)) return { runId: input.runId }
  await encerrarRun(input.runId)
  return { runId: input.runId }
}
