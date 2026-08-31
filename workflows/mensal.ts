import { FatalError, getStepMetadata, sleep } from "workflow"
import { confirmarEfeito, detalheEfeito, reservarEfeito } from "../auth-backend/src/jobs/repo.js"
import {
  buscarEmployeeId,
  buscarPedido,
  confirmarPedido,
  criarPedido,
  extrairQrBase64,
  juntarIdsCaju,
  montarPedidoCaju,
  resetTokenCaju,
  summaryUrlCaju,
  type BeneficioCaju,
  type PedidosCajuIds,
  type PessoaPedidoCaju,
  type TipoPedidoCaju,
} from "../auth-backend/src/clients/caju.js"
import {
  criarSolicitacaoMensal,
  rotuloLinha,
  type LinhaSolicitacaoCriada,
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
import { ehFatal, mensagemErro } from "../auth-backend/src/mensal/erros.js"
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
// ⚠️ Modo desenvolvedor e convocação no RM entram por import DINÂMICO, dentro dos steps.
//
// O corpo do workflow é avaliado numa VM isolada (`Script.runInContext`) que NÃO tem `require`.
// Importar estes módulos no topo arrasta o driver `pg` (CommonJS) para dentro dessa VM e o
// workflow inteiro morre no load com `ReferenceError: require is not defined` — derrubando o
// mensal todo, não só o passo novo. Os steps rodam em Node normal, então lá o import é seguro.
// Só os TIPOS podem vir no topo: são apagados na compilação.
import type {
  AlvoConvocacaoMensal,
  RelatorioConvocacaoMensal,
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

/**
 * Nome da etapa no ledger. Um por combinação natureza × benefício — quatro no total.
 *
 * ⚠️ NUNCA reaproveitar os nomes antigos `caju_credito`/`caju_pix` para uma das metades. Numa
 * competência já executada, `reservarEfeito` devolveria "confirmado" para a metade com nome velho e
 * "novo" para a nova: o run pagaria METADE e marcaria o contrato `ok`, em silêncio. É o modo de
 * falha do run `e173b1ef` (ver `chaveEfeito` acima). Os nomes antigos seguem só na lista de
 * `contratosMensalJaExecutados` (jobs/repo.ts), para que competências pré-split continuem casando.
 */
function etapaPedidoCaju(tipo: TipoPedidoCaju, beneficio: BeneficioCaju): string {
  return `caju_${tipo === "credito" ? "credito" : "pix"}_${beneficio.toLowerCase()}`
}

// --- Caju: criar (e confirmar, no PIX) pedido. DINHEIRO REAL — GATED. -------
// Um pedido por benefício: VR e VT não compartilham mais o mesmo allowance_order.
async function executarPedidoCaju(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: string,
  tipo: TipoPedidoCaju,
  beneficio: BeneficioCaju,
  pessoas: PessoaPedidoCaju[],
): Promise<{ orderId: string | null; qr: string; pulado: boolean; simulado: boolean }> {
  "use step"
  const etapa = etapaPedidoCaju(tipo, beneficio)
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })

  // Só produção usa a chave por competência; simulação é por RUN (ver chaveEfeito).
  const chave = chaveEfeito(modo, runId, competencia, contrato, etapa)
  const reserva = await reservarEfeito(chave, `mensal_${etapa}`, { runId, competencia, contrato, modo, tipo, beneficio })
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

  const pedido = montarPedidoCaju(pessoas, tipo, beneficio, modo === "teste" ? `TESTE ${contrato}` : contrato, mes, ano)
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
    metadados: { orderId, beneficio, totalCentavos: pedido.totalCentavos, temQr: qr.length > 0, summary: summaryUrlCaju(orderId) },
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
  boardIdDoRun: string,
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
  const { lerItensConvocacaoMensal, planejarAlvosMensal, resolverEcoConvocacaoRm } =
    await import("../auth-backend/src/services/convocacaoMensal.js")
  // Board vem do snapshot do run, não de `papel='atual'`: o mensal roda com `papel='proximo'` e
  // depois da virada `atual` é a cópia do mês fechado.
  const itens = await lerItensConvocacaoMensal(contrato, boardIdDoRun)
  const { alvos, previa } = planejarAlvosMensal(contrato, itens)
  const eco = await resolverEcoConvocacaoRm(boardIdDoRun)
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

  // O eco do codigo no board e escrita no Monday, entao segue a familia `monday_escritas`: num
  // run dev que so marcou `rm_convocacao`, grava no RM e NAO toca no board. Fora de run dev o eco
  // acontece sempre — e onde o C03S###### fica visivel pro DP.
  const { familiaRealNoRunDev } = await import("../auth-backend/src/mensal/devEfeitos.js")
  const { processarLoteConvocacaoMensal } = await import("../auth-backend/src/services/convocacaoMensal.js")
  const ecoNoBoard = modo !== "homologacao" || (await familiaRealNoRunDev(runId, "monday_escritas"))
  const rel = await processarLoteConvocacaoMensal(contrato, alvos, { boardId, colCodRm, ecoNoBoard })

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
      sub: `lote${loteIdx}`, eco_no_board: ecoNoBoard, gravados: rel.gravados, ja_existiam: rel.jaExistiam,
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
 * Soma dois relatórios do mesmo contrato. Vive AQUI, e não importado do serviço, porque
 * `executarConvocacaoRmContrato` roda no CORPO do workflow (a VM sem `require`) — importar de lá
 * arrastaria `pg` pra dentro dela. É função pura; duplicar é mais barato que quebrar o load.
 */
function mesclarRelatoriosPuro(
  a: RelatorioConvocacaoMensal,
  b: RelatorioConvocacaoMensal,
): RelatorioConvocacaoMensal {
  return {
    contrato: a.contrato,
    total: a.total + b.total,
    gravados: a.gravados + b.gravados,
    jaExistiam: a.jaExistiam + b.jaExistiam,
    cobertos: a.cobertos + b.cobertos,
    canceladasSemDias: a.canceladasSemDias + b.canceladasSemDias,
    requerDecisao: [...a.requerDecisao, ...b.requerDecisao],
    conciliando: [...a.conciliando, ...b.conciliando],
    falhas: [...a.falhas, ...b.falhas],
    invalidos: [...a.invalidos, ...b.invalidos],
    pessoas: [...a.pessoas, ...b.pessoas],
    temPendencia: a.temPendencia || b.temPendencia,
  }
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
  boardIdDoRun: string,
): Promise<void> {
  const plano = await etapaConvocacaoRmPlano(runId, contrato, boardIdDoRun)
  if (!plano) return
  let agregado = plano.previa
  for (let i = 0; i * TAMANHO_LOTE_CONVOCACAO_RM < plano.alvos.length; i++) {
    const fatia = plano.alvos.slice(i * TAMANHO_LOTE_CONVOCACAO_RM, (i + 1) * TAMANHO_LOTE_CONVOCACAO_RM)
    const rel = await etapaConvocacaoRmLote(
      runId, modo, competencia, contrato, fatia, i, plano.boardId, plano.colCodRm,
    )
    if (rel) agregado = mesclarRelatoriosPuro(agregado, rel)
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
  const { etapaRealNoRunDev } = await import("../auth-backend/src/mensal/devEfeitos.js")
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
  /** Ids dos pedidos de crédito (VR e VT são pedidos separados desde 08/2026). */
  creditos: { creditoVR: string | null; creditoVT: string | null },
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
        pedidoCreditoId: juntarIdsCaju([creditos.creditoVR, creditos.creditoVT]),
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

/**
 * monday_solicitacao: cria a Solicitação de Pagamento — UMA LINHA POR BENEFÍCIO desde o split de
 * 08/2026. Retorna as linhas criadas (o status OK marca todas).
 */
async function etapaMondaySolicitacao(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
  boardId: string,
  grupoSolicitacao: string | null,
  caixa: string | undefined,
  refs: PedidosCajuIds & { idVR?: string | null; idVT?: string | null },
): Promise<LinhaSolicitacaoCriada[]> {
  "use step"
  const etapa = "monday_solicitacao"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return []
  if (r.acao === "simular") { await simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt); return [] }
  // Gaveta de caixa: cria o grupo do mês se a prévia (read-only) não achou.
  const grupoDestino = grupoSolicitacao ?? (await garantirGrupoCaixa("solicitacao", caixa))
  const { mes, ano } = competenciaPartes(competencia)
  const criadas = await criarSolicitacaoMensal({
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
    pedidoCreditoVR: refs.pedidoCreditoVR, pedidoCreditoVT: refs.pedidoCreditoVT,
    pedidoPixVR: refs.pedidoPixVR, pedidoPixVT: refs.pedidoPixVT,
    planBoardId: boardId,
    dataIso: new Date().toISOString().slice(0, 10),
    // A gaveta decide o grupo E o formato: até 08/2026 uma linha com VR+VT, de 09/2026 em diante
    // uma linha por benefício (domain/splitBeneficio.ts).
    caixa,
  }, grupoDestino)
  // A referência do efeito lista as duas linhas: uma reexecução precisa saber o que já existe no
  // board, e um id só esconderia a linha do outro benefício.
  await confirmarEfeito(r.chave, `monday:solicitacao:${criadas.map((c) => `${rotuloLinha(c.beneficios)}=${c.id}`).join(";")}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { linhas: criadas.map((c) => ({ beneficio: rotuloLinha(c.beneficios), itemId: c.id, url: c.url })) },
  })
  return criadas
}
etapaMondaySolicitacao.maxRetries = 5

/** monday_status_ok: marca AUTOMAÇÃO - OK na Solicitação — SÓ depois de todas as etapas do contrato. */
async function etapaMondayStatusOk(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: string,
  solicitacoes: LinhaSolicitacaoCriada[],
): Promise<void> {
  "use step"
  const etapa = "monday_status_ok"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato, etapa, r.chave, metadata.attempt)
  if (!solicitacoes.length) throw new FatalError("solicitacao_id_ausente_para_status_ok")
  // TODAS as linhas do contrato: deixar a do VT em NÃO INICIADO faria o DP tratar como pendente.
  for (const s of solicitacoes) await setarStatusAutomacaoOk(s.id)
  const ids = solicitacoes.map((s) => s.id)
  await confirmarEfeito(r.chave, `monday:status_ok:${ids.join(";")}`)
  await registrarEvento({ runId, contrato, etapa, estado: "concluido", tentativa: metadata.attempt, metadados: { solicitacaoIds: ids } })
}
etapaMondayStatusOk.maxRetries = 5

// --- Drive: arquiva boleto/comprovante/QR nas pastas CAJU e linka na Solicitação. ---
async function etapaDrive(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
  refs: PedidosCajuIds & {
    qrBoletoVRBase64: string
    qrBoletoVTBase64: string
    idVR: string | null
    idVT: string | null
    solicitacaoId: string | null
  },
): Promise<{ relatorioUrl: string | null; pastaUrl: string | null }> {
  "use step"
  const etapa = "drive"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  // Retomada: o PDF já subiu; os links vivem no payload do efeito. Sem reler, a linha do board
  // nasceria sem o link do relatório que está lá no Drive.
  if (r.acao === "pular") {
    const det = await detalheEfeito(r.chave)
    const pay = (det?.payload ?? {}) as { relatorioUrl?: string; pastaUrl?: string }
    return { relatorioUrl: pay.relatorioUrl ?? null, pastaUrl: pay.pastaUrl ?? null }
  }
  if (r.acao === "simular") {
    await simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)
    return { relatorioUrl: null, pastaUrl: null }
  }
  const { mes } = competenciaPartes(competencia)
  const { montarDadosRelatorioMensal } = await import("../auth-backend/src/mensal/relatorioMensal.js")
  const { nomeArquivoRelatorio } = await import("../auth-backend/src/services/relatorioPagamento.js")
  // `pastaDriveUrl` fica de fora do PDF: a pasta só é conhecida DEPOIS deste upload, e um
  // documento que aponta pra pasta onde ele mesmo está não informa nada. A linha do board é
  // que leva o link — lá ele serve.
  const dados = montarDadosRelatorioMensal({
    contrato,
    competencia,
    competenciaLabel: MESES_LABEL[mes - 1]!,
    refs,
    geradoPor: "automação (mensal)",
    geradoEm: new Date(),
  })
  const resultados = await arquivarDriveMensal(contrato, competencia, MESES_LABEL[mes - 1]!, {
    pedidoCreditoVR: refs.pedidoCreditoVR,
    pedidoCreditoVT: refs.pedidoCreditoVT,
    pedidoPixVR: refs.pedidoPixVR,
    pedidoPixVT: refs.pedidoPixVT,
    idVR: refs.idVR,
    idVT: refs.idVT,
    qrBoletoVRBase64: refs.qrBoletoVRBase64,
    qrBoletoVTBase64: refs.qrBoletoVTBase64,
    solicitacaoId: refs.solicitacaoId,
    relatorio: dados,
    nomePrefixo: modo === "teste" ? "TESTE - " : undefined,
  })
  const uploads = resultados.flatMap((x) => x.resultado.uploads.map((u) => u.id))
  const nomeRel = nomeArquivoRelatorio(dados)
  const relatorioUrl = resultados
    .flatMap((x) => x.resultado.uploads)
    .find((u) => u.name === nomeRel)?.url ?? null
  const pastaUrl = resultados[0]?.resultado.pasta_convocacao_drive_url ?? null
  await confirmarEfeito(r.chave, `drive:${uploads.join(",") || "sem_upload"}`, { relatorioUrl, pastaUrl })
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { uploads: uploads.length, pastaConvocacao: pastaUrl, relatorioUrl },
  })
  return { relatorioUrl, pastaUrl }
}
etapaDrive.maxRetries = 3

/**
 * monday_notas: uma linha por pedido Caju no board "Notas e Relatórios Caju".
 *
 * Mesmo board e mesmos builders do pontual — o DP consulta pedido de crédito e de boleto no
 * mesmo lugar, venha de onde vier. Aqui são até quatro linhas (crédito VR/VT + boleto VR/VT),
 * porque o mensal separa o pedido por benefício.
 */
async function etapaMondayNotas(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
  refs: PedidosCajuIds & { idVR: string | null; idVT: string | null; solicitacaoId: string | null },
  drive: { relatorioUrl: string | null; pastaUrl: string | null },
): Promise<void> {
  "use step"
  const etapa = "monday_notas"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)

  const { mes } = competenciaPartes(competencia)
  const { montarDadosRelatorioMensal } = await import("../auth-backend/src/mensal/relatorioMensal.js")
  const { linhasNotaDeRelatorio, registrarNotasCaju } = await import("../auth-backend/src/services/notasCaju.js")
  const dados = montarDadosRelatorioMensal({
    contrato,
    competencia,
    competenciaLabel: MESES_LABEL[mes - 1]!,
    refs,
    pastaDriveUrl: drive.pastaUrl,
    geradoPor: "automação (mensal)",
    geradoEm: new Date(),
  })
  const res = await registrarNotasCaju(linhasNotaDeRelatorio(dados, { relatorioUrl: drive.relatorioUrl }))
  if (res.pulado) {
    // Board não registrado (ou contrato sem pedido) não é erro: o pagamento aconteceu.
    await confirmarEfeito(r.chave, `monday:notas:${res.pulado}`)
    await registrarEvento({
      runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
      metadados: { pulado: res.pulado },
    })
    return
  }
  await confirmarEfeito(r.chave, `monday:notas:${res.criados.map((c) => c.itemId).join(",")}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { itens: res.criados.length, faltando: res.faltando },
  })
}
etapaMondayNotas.maxRetries = 3

/**
 * monday_balao: um update no item de CADA pessoa que teve desconto abatido.
 *
 * Mesmo texto e mesmo link do pontual (`montarTextoBalao`) — a informação que o operacional
 * precisa é idêntica nos dois fluxos: quanto saiu do benefício, se a dívida quitou, e onde
 * conferir. Um só builder pros dois evita a divergência que sempre aparece quando o mesmo
 * aviso é escrito duas vezes.
 *
 * A ligação dívida→pessoa vem do `pessoaKey` propagado em `descontoUpdates` (calculo.ts):
 * `descontoUpdates` é por CONTRATO, e sem a chave não haveria como dizer, no item de cada um,
 * qual dívida era dele.
 *
 * Quem não teve desconto não recebe update. Balão em toda pessoa de todo contrato seria ~60
 * updates por rodada dizendo "nada foi abatido" — e aí o aviso que importa vira ruído.
 */
async function etapaMondayBalao(
  runId: string,
  modo: ModoExec,
  competencia: string,
  contrato: ContratoPreviaMensal,
): Promise<void> {
  "use step"
  const etapa = "monday_balao"
  const metadata = getStepMetadata()
  await registrarEvento({ runId, contrato: contrato.contrato, etapa, estado: "rodando", tentativa: metadata.attempt })
  const r = await reservarOuPular(runId, modo, competencia, contrato.contrato, etapa, metadata.attempt)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simularEfeito(runId, contrato.contrato, etapa, r.chave, metadata.attempt)

  const { montarTextoBalao } = await import("../auth-backend/src/pontual/mondayPontual.js")
  const { criarUpdate } = await import("../auth-backend/src/monday.js")
  const updates = contrato.descontoUpdates ?? []
  let postados = 0
  for (const p of contrato.pessoas) {
    const chave = (p.cpf || "").replace(/\D/g, "") || p.chapa?.trim()
    const dele = updates.filter((u) => u.pessoaKey && chave && u.pessoaKey === chave)
    const texto = montarTextoBalao(p, dele.map((u) => ({
      descontoMondayItemId: u.id,
      vr: u.abatidoVR ?? 0,
      vt: u.abatidoVT ?? 0,
      residualVR: u.residualVR,
      residualVT: u.residualVT,
      status: u.status,
    })))
    if (!texto) continue
    // Uma pessoa pode ter várias linhas no Plano (convocação partida): o balão vai na
    // primeira, senão o mesmo aviso se repete em cada linha dela.
    const item = (p.itemIds ?? [p.itemId])[0]
    if (!item) continue
    await criarUpdate(item, texto)
    postados++
  }
  await confirmarEfeito(r.chave, `monday:balao:${postados}`)
  await registrarEvento({
    runId, contrato: contrato.contrato, etapa, estado: "concluido", tentativa: metadata.attempt,
    metadados: { postados, pessoasComDesconto: postados, pessoas: contrato.pessoas.length },
  })
}
etapaMondayBalao.maxRetries = 3

async function marcarContratoRodando(runId: string, contrato: string): Promise<void> {
  "use step"
  await atualizarContrato(runId, contrato, "rodando")
  await registrarEvento({ runId, contrato, etapa: "contrato", estado: "rodando" })
}

async function marcarContratoFinal(
  runId: string,
  contrato: string,
  status: "ok" | "parcial" | "erro" | "bloqueado",
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

    // Quatro pedidos: natureza (crédito/boleto) × benefício (VR/VT). O pedido de VR e o de VT são
    // separados desde 08/2026 para que cada benefício tenha boleto e rastro próprios.
    // creditoVT é sempre 0 hoje (tetoVT=0 em calculo.ts), então creditoVT nasce vazio e não chama a
    // Caju — mas a etapa existe no ledger, o que mantém o run correto se a regra do crédito mudar.
    const creditoVR = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "credito", "VR", pessoasComId)
    const creditoVT = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "credito", "VT", pessoasComId)
    const pixVR = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "boleto", "VR", pessoasComId)
    const pixVT = await executarPedidoCaju(runId, modo, competencia, contrato.contrato, "boleto", "VT", pessoasComId)

    // RM DEGRADÁVEL — decisão do Isaac (31/08/2026).
    //
    // Antes, qualquer falha aqui derrubava o contrato inteiro no `catch` lá embaixo e o Monday, o
    // Drive, as notas e o status NÃO rodavam. Foi o que aconteceu no run `b4a1f614`: os 5
    // contratos criaram pedido na Caju (dinheiro real), morreram no `rm_integrar` com o RM fora do
    // ar, e o DP ficou com boleto emitido e NADA no board de Solicitação — o pior dos dois mundos,
    // porque o dinheiro saiu e o rastro não existiu.
    //
    // O lançamento no RM é a única perna que depende do RM. As outras não têm por que esperar por
    // ele. Então a falha aqui vira PENDÊNCIA, não aborto: o contrato segue, grava tudo o que
    // consegue e fecha `parcial` com o motivo — em vez de `erro` sem board.
    //
    // O que NÃO muda: os ids do RM (IDFINANC) vão vazios pra Solicitação, e é por isso que o
    // desfecho é `parcial` e não `ok`. Retomar o run refaz só a perna do RM (o ledger pula o
    // resto), mas a linha da Solicitação já existirá e não recebe os ids sozinha — completar isso
    // é trabalho à parte, e enquanto não existir o `parcial` é o aviso de que falta.
    let rmIds: { idVR: string | null; idVT: string | null } = { idVR: null, idVT: null }
    let rmPendencia: string | null = null
    try {
      // Convocação no RM (S-2260) ANTES do financeiro — decisão 2 do Isaac: a convocação precede o
      // pagamento na ordem do eSocial. Pendência humana lança FatalError e o contrato marca erro
      // (decisão 4): o pagamento deste contrato só roda depois que o DP resolver e retomar.
      await executarConvocacaoRmContrato(runId, modo, competencia, contrato.contrato, snapshot.boardId)

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
      rmIds = await etapaRmIntegrar(runId, modo, competencia, contrato, temFinanceiro)
      for (let i = 0; i < nLotesCredito; i++) {
        await etapaRmHistoricoLote(runId, modo, competencia, contrato, "credito", i)
        if (i < nLotesCredito - 1 && esperaLoteMs > 0) await sleep(esperaLoteMs)
      }
    } catch (e) {
      // FatalError NÃO degrada: efeito pendente à espera de conciliação e convocação que exige
      // decisão do DP continuam derrubando o contrato. Degradar apagaria a única coisa que faz
      // alguém olhar — e são justamente os casos em que seguir gravando seria mentir.
      if (ehFatal(e)) throw e
      rmPendencia = mensagemErro(e)
      await registrarEvento({
        runId, contrato: contrato.contrato, etapa: "rm_pendencia", estado: "aviso",
        mensagem: rmPendencia,
        metadados: { segue: "monday+drive+notas", idfinanc: "pendente" },
      })
    }

    // Monday (adaptador real, gated por producao+ledger).
    await etapaMondayPlano(runId, modo, competencia, contrato, snapshot.boardId, snapshot.apoio.colunasPlano)
    await etapaMondayControleCaju(
      runId, modo, competencia, contrato, snapshot.apoio.grupoControleCaju, snapshot.apoio.caixa,
      { creditoVR: creditoVR.orderId, creditoVT: creditoVT.orderId },
    )
    const pedidos = {
      pedidoCreditoVR: creditoVR.orderId,
      pedidoCreditoVT: creditoVT.orderId,
      pedidoPixVR: pixVR.orderId,
      pedidoPixVT: pixVT.orderId,
    }
    const solicitacoes = await etapaMondaySolicitacao(
      runId, modo, competencia, contrato, snapshot.boardId, snapshot.apoio.grupoSolicitacao ?? null,
      snapshot.apoio.caixa,
      { idVR: rmIds.idVR, idVT: rmIds.idVT, ...pedidos },
    )
    // Drive e relatório linkam UM item — a linha do VR quando existe, senão a do VT. O Drive grava
    // a pasta numa coluna do item, e são as duas linhas do mesmo pagamento: o link não se perde.
    const solicitacaoId = solicitacoes[0]?.id ?? null

    const refsPagamento = { ...pedidos, idVR: rmIds.idVR, idVT: rmIds.idVT, solicitacaoId }

    // Drive (adaptador real, gated). Dois boletos = dois QRs, mais o relatório em PDF.
    const drive = await etapaDrive(runId, modo, competencia, contrato, {
      ...refsPagamento,
      qrBoletoVRBase64: pixVR.qr,
      qrBoletoVTBase64: pixVT.qr,
    })

    // Uma linha por pedido no board de notas — depois do Drive, que é quem devolve os links.
    await etapaMondayNotas(runId, modo, competencia, contrato, refsPagamento, drive)

    // Balãozinho do desconto no item de quem teve dívida abatida.
    await etapaMondayBalao(runId, modo, competencia, contrato)

    // AUTOMAÇÃO - OK só depois de TODAS as etapas do contrato confirmadas.
    await etapaMondayStatusOk(runId, modo, competencia, contrato.contrato, solicitacoes)

    const referencias: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(pedidos)) if (v) referencias[k] = v
    // Uma referência por linha: com um `solicitacaoId` só, a linha do outro benefício ficaria
    // fora da lista de artefatos do run.
    for (const s of solicitacoes) referencias[`solicitacaoId${rotuloLinha(s.beneficios)}`] = s.id
    // `parcial` quando o RM ficou pra trás: tudo o que não depende dele foi gravado, e o motivo
    // fica na linha do contrato em vez de sumir num log.
    await marcarContratoFinal(
      runId, contrato.contrato,
      rmPendencia ? "parcial" : "ok",
      rmPendencia ? `rm_pendente: ${rmPendencia}` : undefined,
      Object.keys(referencias).length ? referencias : undefined,
    )
  } catch (e) {
    await marcarContratoFinal(runId, contrato.contrato, "erro", mensagemErro(e))
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
