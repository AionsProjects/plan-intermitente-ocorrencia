// Pagamento PONTUAL na felipeta (fase 2 da bifurcação) — workflow durável.
//
// Disparo: operacional marca "OP - Compareceu?" = SIM no item do Plano → webhook Monday →
// POST /api/monday/comparecimento → start() daqui. A fase 1 já deixou tudo calculado em
// pi.pontual_prepagamento; este workflow CONSOME o snapshot e move o dinheiro:
// FIFO no board Desconto → Caju (crédito DRAFT + boleto PIX) → RM (hist TPBEN=0 →
// FopRotinas 100/110 → integrar → hist crédito TPBEN=1) → Controle Caju → Solicitação →
// Drive → balão → AUTOMAÇÃO-OK → fechamento.
//
// As regras de dinheiro herdadas do WF5 que NÃO podem quebrar estão comentadas em cada
// step. A trava mestra: o histórico do CRÉDITO só entra no ZMD DEPOIS do FopRotinas —
// é a ORDEM (não um if) que impede lançamento financeiro sobre o crédito.
import { FatalError, sleep } from "workflow"
import { confirmarEfeito, detalheEfeito, estadoEfeito, liberarEfeito, reservarEfeito } from "../auth-backend/src/jobs/repo.js"
import {
  buscarEmployeeId,
  buscarPedido,
  confirmarPedido,
  criarPedido,
  extrairOrderId,
  extrairPixCopiaECola,
  extrairQrBase64,
  juntarIdsCaju,
  resetTokenCaju,
  summaryUrlCaju,
  type TipoPedidoCaju,
} from "../auth-backend/src/clients/caju.js"
import {
  criarItemComValores,
  executarUpdatesDescontos,
  garantirGrupoCaixa,
  montarValuesPlanUpdate,
  registrarDebitoControleCaju,
  setarStatusAutomacaoOk,
} from "../auth-backend/src/mensal/mondayEfeitos.js"
import {
  RM_COLIGADA,
  codSecaoBase,
  consultarIdfinanc,
  enviarHistoricoRm,
  executarFopRotinas,
  integrarIdfinanc,
} from "../auth-backend/src/mensal/rmEfeitos.js"
import { criarUpdate, mondayGraphql } from "../auth-backend/src/monday.js"
import {
  montarDescontoUpdatesPontual,
  montarPessoaPagamento,
  motivosRecusa,
  validarPagamento,
  type ItemBoardValidacao,
  type ItemDescontoAtual,
} from "../auth-backend/src/pontual/pagamento.js"
import { montarPedidoCajuPontual } from "../auth-backend/src/pontual/cajuPontual.js"
import {
  classificarLancamentosIdfinanc,
  competenciaPontual,
  eventosPontual,
  registrosHistoricoPontual,
} from "../auth-backend/src/pontual/rmPontual.js"
import {
  type AbatimentoBalao,
  beneficiosDaSolicitacaoPontual,
  montarNomeDebitoPontual,
  montarNomeSolicitacaoPontual,
  montarResumoSolicitacaoPontual,
  montarTextoBalao,
  montarValuesSolicitacaoPontual,
} from "../auth-backend/src/pontual/mondayPontual.js"
import type { BeneficioCaju } from "../auth-backend/src/clients/caju.js"
import { arquivarDrivePontual, urlDoRelatorio } from "../auth-backend/src/pontual/drivePontual.js"
import { montarDadosRelatorioPontual } from "../auth-backend/src/pontual/relatorioPontual.js"
import {
  linhasNotaDeRelatorio,
  registrarNotasCaju,
  resolverBoardNotas,
  urlItemNota,
} from "../auth-backend/src/services/notasCaju.js"
import type { DadosRelatorioPagamento } from "../auth-backend/src/services/relatorioPagamento.js"
import type { PrePagamentoCompleto } from "../auth-backend/src/pontual/prepagamento.js"
import type { PessoaPreviaMensal } from "../auth-backend/src/mensal/types.js"

const MESES_LABEL = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"] as const

/** Linha criada no board de Solicitação — uma por benefício desde o split de 08/2026. */
interface LinhaSolicitacaoPontual {
  beneficio: BeneficioCaju
  id: string
}

export interface PontualWorkflowInput {
  itemOrigemId: string
  /** Execução aberta pela rota — todos os steps logam nela. */
  execucaoId: string
  modo: "producao" | "simulacao"
}

// Kill switch do dinheiro. Lido no MÓDULO (env no corpo quebra o replay determinístico).
const PAGAMENTO_LIBERADO = process.env.PONTUAL_PAGAMENTO_HABILITADO === "1"

/**
 * Chave de idempotência. Produção = por ITEM (re-marcação do SIM, retry, redeploy — tudo
 * cai na mesma chave). Simulação = namespace por execução, pra nunca envenenar a chave
 * real (lição do run e173b1ef do mensal: simulação confirmou chave de produção e o
 * pagamento real pulou tudo em silêncio).
 */
function chavePontual(modo: PontualWorkflowInput["modo"], execucaoId: string, item: string, etapa: string): string {
  return modo === "producao" ? `pontual:${item}:${etapa}` : `pontual-sim:${execucaoId}:${etapa}`
}

/** Log na execução (pi.atividade_evento). Import dinâmico: execucao.js não roda na VM do corpo. */
async function log(
  execucaoId: string,
  etapa: string,
  estado: "rodando" | "ok" | "erro" | "pulado" | "aviso",
  det?: { mensagem?: string; metadados?: Record<string, unknown> },
): Promise<void> {
  const { abrirExecucao } = await import("../auth-backend/src/services/execucao.js")
  const ex = await abrirExecucao({ id: execucaoId, acao: "pontual_pagamento", motor: "workflow" })
  await ex.etapa(etapa, estado, det)
}

async function reservarOuPular(
  modo: PontualWorkflowInput["modo"],
  execucaoId: string,
  item: string,
  etapa: string,
): Promise<{ chave: string; acao: "executar" | "pular" | "simular" }> {
  const chave = chavePontual(modo, execucaoId, item, etapa)
  const reserva = await reservarEfeito(chave, `pontual_${etapa}`, { item, execucaoId, modo })
  if (reserva === "confirmado") {
    await log(execucaoId, etapa, "pulado", { mensagem: "idempotência: já feito" })
    return { chave, acao: "pular" }
  }
  if (reserva === "pendente" && modo === "producao") {
    throw new FatalError(`efeito_pendente_requer_conciliacao:${etapa}`)
  }
  if (modo === "simulacao") return { chave, acao: "simular" }
  if (!PAGAMENTO_LIBERADO) throw new FatalError("pagamento_pontual_bloqueado_ate_cutover")
  return { chave, acao: "executar" }
}

async function simular(execucaoId: string, etapa: string, chave: string): Promise<void> {
  await confirmarEfeito(chave, `simulacao:${execucaoId}:${etapa}`)
  await log(execucaoId, etapa, "ok", { metadados: { simulado: true } })
}

// ---------------------------------------------------------------------------
// Step 1 — validação. Zero efeito externo; escreve só Postgres (recálculo).
// ---------------------------------------------------------------------------

interface PlanoPagamento {
  snapshot: PrePagamentoCompleto
  pessoa: PessoaPreviaMensal
  semSaldo: boolean
  recalculado: boolean
  jaPago: boolean
}

async function etapaValidacao(input: PontualWorkflowInput): Promise<PlanoPagamento> {
  "use step"
  const { itemOrigemId, execucaoId } = input
  await log(execucaoId, "validacao", "rodando")
  const { lerPrePagamentoCompleto, reservarPrePagamento } = await import("../auth-backend/src/pontual/prepagamento.js")

  let snapshot = await lerPrePagamentoCompleto(itemOrigemId)

  // Item do board — colunas por TÍTULO direto da resposta (a virada troca os ids todo mês).
  const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
  const d = await mondayGraphql<{ items: Array<{ id: string; name: string; board?: { id: string } | null; column_values: Array<{ id: string; text: string | null; column?: { title: string } | null }> }> }>(
    `query($ids:[ID!]){ items(ids:$ids){ id name board{ id } column_values{ id text column{ title } } } }`,
    { ids: [itemOrigemId] },
  )
  const item = d.items?.[0]
  if (!item) throw new FatalError("item_nao_existe_no_monday")
  const val = (titulo: string) =>
    item.column_values.find((c) => norm(c.column?.title ?? c.id) === norm(titulo))?.text?.trim() ?? ""
  const cancelIni = item.column_values.find((c) => c.id === "date_mm3b88ta")?.text?.trim() ?? ""

  const itemVal: ItemBoardValidacao = {
    statusConvocacao: val("Status"),
    dataInicio: val("OP - Data/Inicio"),
    dataFim: val("OP - Data/Fim"),
    chapa: val("Funcionário"),
    cancelamentoInicio: cancelIni,
  }
  const veredicto = validarPagamento(snapshot, itemVal)

  if (veredicto.acao === "recusar") throw new FatalError(veredicto.motivo)
  if (veredicto.acao === "ja_pago") {
    await log(execucaoId, "validacao", "ok", { mensagem: "já pago — encerrando sem efeito" })
    return { snapshot: snapshot!, pessoa: montarPessoaPagamento(snapshot!), semSaldo: false, recalculado: false, jaPago: true }
  }

  let recalculado = false
  if (veredicto.acao === "recalcular") {
    await log(execucaoId, "validacao", "aviso", { mensagem: `recalculando: ${veredicto.motivo}` })
    const { calcularPrePagamentoConvocacao } = await import("../auth-backend/src/pontual/prePagamentoConvocacao.js")
    const { codigoSecaoContrato } = await import("../auth-backend/src/mensal/calculo.js")
    // Fim EFETIVO (cancelamento parcial trunca) — mesma conta do validarPagamento.
    let fim = itemVal.dataFim
    const status = norm(itemVal.statusConvocacao)
    if (status.includes("PARCIAL") && cancelIni) {
      const dt = new Date(cancelIni + "T00:00:00Z")
      dt.setUTCDate(dt.getUTCDate() - 1)
      fim = dt.toISOString().slice(0, 10)
    }
    const optante = norm(val("Vale Transporte"))
    // Colunas do Plano por nome (pro montarValuesPlanUpdate do recálculo).
    const colunas = new Map(item.column_values.map((c) => [c.column?.title ?? c.id, c.id]))
    const r = await calcularPrePagamentoConvocacao(
      {
        itemId: itemOrigemId,
        nome: val("Nome do Empregado") || item.name,
        chapa: itemVal.chapa,
        cpf: val("CPF"),
        contrato: val("Op - Contrato"),
        funcao: val("Função"),
        interior: val("OP - Interior?") || "NAO",
        inicio: itemVal.dataInicio,
        fim,
        trabalhaSabado: norm(val("OP - Sábado?")) === "SIM",
        optanteVT: optante === "SIM" || optante === "SIM*",
        vtSoVolta: optante === "SIM*",
      },
      colunas,
    )
    if (r.motivoInvalido) throw new FatalError(`prepagamento_invalido: ${r.motivoInvalido}`)
    const gravado = await reservarPrePagamento({
      itemOrigemId,
      mondayBoardId: item.board?.id ?? snapshot?.monday_board_id ?? undefined,
      chapa: itemVal.chapa,
      cpf: val("CPF") || null,
      nome: val("Nome do Empregado") || item.name,
      contrato: val("Op - Contrato"),
      codSecao: snapshot?.cod_secao ?? codigoSecaoContrato(val("Op - Contrato")),
      dataInicio: itemVal.dataInicio,
      dataFim: fim,
      pessoa: r.pessoa,
      reservas: r.reservas,
      calculo: r.calculo,
      motivoInvalido: null,
    })
    if (!gravado || gravado.estado !== "reservado") throw new FatalError("recalculo_nao_gravou_snapshot")
    snapshot = await lerPrePagamentoCompleto(itemOrigemId)
    if (!snapshot) throw new FatalError("recalculo_sumiu")
    recalculado = true
  }

  // codSecao: fallback pela seção-base do contrato (linhas antigas da fase 1 têm NULL).
  if (!snapshot!.cod_secao?.trim()) {
    const { codigoSecaoContrato } = await import("../auth-backend/src/mensal/calculo.js")
    snapshot!.cod_secao = codigoSecaoContrato(snapshot!.contrato ?? "") || null
  }
  const recusas = motivosRecusa(snapshot!)
  if (recusas.length) throw new FatalError(`validacao_recusou: ${recusas.join(", ")}`)

  const semSaldo = (Number(snapshot!.liquido_vr) || 0) + (Number(snapshot!.liquido_vt) || 0) <= 0
  const pessoa = montarPessoaPagamento(snapshot!)

  // Identidade + valores na LINHA do log. O webhook do Monday só traz o item_id, então sem
  // isto a execução aparece anônima em /atividade e some da busca por nome e do filtro de
  // pessoa. `abrirExecucao` faz COALESCE nesses campos, então preencher aqui é seguro.
  const { abrirExecucao } = await import("../auth-backend/src/services/execucao.js")
  await abrirExecucao({
    id: execucaoId,
    acao: "pontual_pagamento",
    motor: "workflow",
    alvo: itemOrigemId,
    pessoa: pessoa.nome,
    contrato: pessoa.contrato,
    // Valores por BENEFÍCIO, não só o total: é assim que a Caju (pedidos separados) e o RM
    // (eventos 100/110) tratam, então é assim que o DP confere. O total continua sendo somado
    // na tela — guardar os dois seria a mesma informação em dois lugares, e o que soma nunca
    // divergiria por acidente.
    resumo: {
      chapa: pessoa.chapa,
      data_inicio: snapshot!.data_inicio,
      data_fim: snapshot!.data_fim,
      vr: Number(snapshot!.liquido_vr) || 0,
      vt: Number(snapshot!.liquido_vt) || 0,
      credito_vr: Number(snapshot!.credito_vr) || 0,
      credito_vt: Number(snapshot!.credito_vt) || 0,
      boleto_vr: Number(snapshot!.pix_vr) || 0,
      boleto_vt: Number(snapshot!.pix_vt) || 0,
      desconto_vr: Number(snapshot!.desconto_vr) || 0,
      desconto_vt: Number(snapshot!.desconto_vt) || 0,
      sem_saldo: semSaldo,
      recalculado,
    },
  })

  await log(execucaoId, "validacao", "ok", {
    metadados: { semSaldo, recalculado, liquidoVR: snapshot!.liquido_vr, liquidoVT: snapshot!.liquido_vt },
  })
  return { snapshot: snapshot!, pessoa, semSaldo, recalculado, jaPago: false }
}
etapaValidacao.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 2 — employeeId Caju (read-only).
// ---------------------------------------------------------------------------

async function etapaEmployeeCaju(input: PontualWorkflowInput, plano: PlanoPagamento): Promise<string | null> {
  "use step"
  const { execucaoId } = input
  if (plano.semSaldo) return null
  if (input.modo === "simulacao") {
    await log(execucaoId, "caju_pessoa", "ok", { metadados: { simulado: true } })
    return "sim-employee"
  }
  if (!PAGAMENTO_LIBERADO) throw new FatalError("pagamento_pontual_bloqueado_ate_cutover")
  resetTokenCaju()
  const id = await buscarEmployeeId(plano.pessoa.cpf)
  // A guarda que o WF5/mensal não têm: 1 pessoa sem cadastro = pagamento inteiro sumindo.
  if (!id) throw new FatalError(`pessoa_nao_cadastrada_na_caju: chapa=${plano.pessoa.chapa} nome=${plano.pessoa.nome}`)
  await log(execucaoId, "caju_pessoa", "ok")
  return id
}
etapaEmployeeCaju.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 3 — consumo do FIFO (roda MESMO com semSaldo) + marcarConsumido.
// ---------------------------------------------------------------------------

async function etapaConsumirFifo(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
): Promise<AbatimentoBalao[]> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "fifo"
  await log(execucaoId, etapa, "rodando")
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return []
  if (r.acao === "simular") {
    await simular(execucaoId, etapa, r.chave)
    return []
  }

  const reservas = plano.snapshot.reservas.filter((x) => x.vr > 0 || x.vt > 0)
  let updates = 0
  let abatimentos: AbatimentoBalao[] = []
  if (reservas.length) {
    // Estado ATUAL do board (o mensal pode ter consumido o mesmo item no meio) + deltas.
    const ids = reservas.map((x) => x.descontoMondayItemId)
    const d = await mondayGraphql<{ items: Array<{ id: string; column_values: Array<{ id: string; text: string | null }> }> }>(
      `query($ids:[ID!]){ items(ids:$ids){ id column_values(ids:["numeric_mm0r1691","numeric_mm0rtwwg","numeric_mm0rqy6z","numeric_mm0r6cn0"]){ id text } } }`,
      { ids },
    )
    const num = (it: { column_values: Array<{ id: string; text: string | null }> }, col: string) =>
      Number(String(it.column_values.find((c) => c.id === col)?.text ?? "").replace(",", ".")) || 0
    const itensBoard: ItemDescontoAtual[] = (d.items ?? []).map((it) => ({
      id: it.id,
      residualVR: num(it, "numeric_mm0r1691"),
      residualVT: num(it, "numeric_mm0rtwwg"),
      descontadoVR: num(it, "numeric_mm0rqy6z"),
      descontadoVT: num(it, "numeric_mm0r6cn0"),
    }))
    const upd = montarDescontoUpdatesPontual(reservas, itensBoard)
    updates = await executarUpdatesDescontos(upd)
    // O que o balaozinho conta: quanto foi abatido de cada divida e o que sobrou nela.
    abatimentos = reservas.map((rr) => {
      const u = upd.find((x) => x.id === rr.descontoMondayItemId)
      return {
        descontoMondayItemId: rr.descontoMondayItemId,
        vr: rr.vr, vt: rr.vt,
        residualVR: u?.residualVR, residualVT: u?.residualVT, status: u?.status,
      }
    })
  }
  // MESMA sequência: consumido + DELETE das reservas (senão lerReservasVivas subtrai a
  // mesma dívida DUAS vezes do pool do mensal a partir de agora).
  const { marcarConsumido } = await import("../auth-backend/src/pontual/prepagamento.js")
  await marcarConsumido(plano.snapshot.id)
  await confirmarEfeito(r.chave, `fifo:${updates}itens`, { reservas })
  await log(execucaoId, etapa, "ok", { metadados: { itensAtualizados: updates, abatimentos } })
  return abatimentos
}
etapaConsumirFifo.maxRetries = 5

// ---------------------------------------------------------------------------
// Steps 4-7 — pedidos Caju. Crédito: SÓ cria (DRAFT — nunca confirmar, paridade com o nó
// disabled do WF5). Boleto: cria + confirma PIX_CODE + poll do QR (que vem do GET, não do
// confirm). DINHEIRO REAL — gated.
// ---------------------------------------------------------------------------

async function etapaPedidoCaju(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  employeeId: string | null,
  tipo: TipoPedidoCaju,
): Promise<{ orderId: string | null; qr: string; copiaECola: string }> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = `caju_${tipo === "credito" ? "credito" : "pix"}`

  // GUARDA CONTRA O FORMATO ANTIGO. Até 13/08 o pontual criava um pedido por benefício, com
  // as chaves `..._vr` e `..._vt`. Um item pago naquele formato e retomado agora não veria a
  // chave nova e criaria pedido em cima do que já existe — pagando duas vezes. Se qualquer
  // metade antiga está confirmada, este step não tem nada a fazer.
  if (input.modo === "producao") {
    for (const sufixo of ["_vr", "_vt"]) {
      if ((await estadoEfeito(`pontual:${itemOrigemId}:${etapa}${sufixo}`)) === "confirmado") {
        await log(execucaoId, etapa, "pulado", {
          mensagem: `já pago no formato anterior (pedido por benefício${sufixo})`,
        })
        return { orderId: null, qr: "", copiaECola: "" }
      }
    }
  }

  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return { orderId: null, qr: "", copiaECola: "" }
  if (r.acao === "simular") {
    await simular(execucaoId, etapa, r.chave)
    return { orderId: null, qr: "", copiaECola: "" }
  }

  const pedido = montarPedidoCajuPontual({ ...plano.pessoa, employeeId }, tipo)
  if (!pedido.tem || !pedido.payload) {
    await confirmarEfeito(r.chave, `caju:${etapa}:vazio`)
    await log(execucaoId, etapa, "ok", { metadados: { vazio: true } })
    return { orderId: null, qr: "", copiaECola: "" }
  }

  const criado = await criarPedido(pedido.payload)
  const orderId = criado.orderId ?? extrairOrderId(criado.raw)
  let qr = ""
  let copiaECola = ""
  if (tipo === "boleto" && orderId) {
    await confirmarPedido(orderId, pedido.confirmPayload)
    let resp = await buscarPedido(orderId)
    qr = extrairQrBase64(resp)
    if (!qr) {
      await sleep("3s")
      resp = await buscarPedido(orderId)
      qr = extrairQrBase64(resp)
    }
    // O copia-e-cola vem no MESMO GET do QR — pegar aqui é de graça. Quem paga no celular
    // não consegue ler um PNG de QR que está dentro de uma pasta do Drive.
    copiaECola = extrairPixCopiaECola(resp)
  }
  await confirmarEfeito(r.chave, orderId ? `caju:${etapa}:${orderId}` : `caju:${etapa}:sem-id`)
  await log(execucaoId, etapa, "ok", {
    metadados: {
      orderId,
      centavos: pedido.totalCentavos,
      // Quanto foi de cada benefício DENTRO do pedido único — sem isto, um pedido de
      // R$ 172,50 não diz o que é VR e o que é VT, e é a conferência do DP.
      centavosVR: Math.round((tipo === "credito" ? plano.pessoa.creditoVR : plano.pessoa.pixVR) ?? 0) * 100,
      centavosVT: Math.round((tipo === "credito" ? plano.pessoa.creditoVT : plano.pessoa.pixVT) ?? 0) * 100,
      temQr: qr.length > 0,
      temCopiaECola: copiaECola.length > 0,
      summary: summaryUrlCaju(orderId),
    },
  })
  return { orderId, qr, copiaECola }
}
etapaPedidoCaju.maxRetries = 5

// ---------------------------------------------------------------------------
// Steps 8/11 — histórico ZMDHSTBENFUNC. TPBEN=0 no boleto, 1 no crédito.
// ---------------------------------------------------------------------------

async function etapaRmHistorico(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  tipo: "pix" | "credito",
): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = `rm_gerar_hist_${tipo}_l0`
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simular(execucaoId, etapa, r.chave)

  const registros = registrosHistoricoPontual(plano.pessoa, tipo, {
    codSecao: codSecaoBase(plano.snapshot.cod_secao ?? ""),
    dataImport: new Date().toISOString().slice(0, 10),
  })
  const pks: string[] = []
  let viaPonte = 0
  for (const registro of registros) {
    const res = await enviarHistoricoRm(registro)
    if (res.chave) pks.push(res.chave)
    else viaPonte++
  }
  await confirmarEfeito(r.chave, `rm:hist:${tipo}:${registros.length}`, { pks, semPk: viaPonte })
  await log(execucaoId, etapa, "ok", { metadados: { registros: registros.length, pks: pks.length } })
}
etapaRmHistorico.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 9 — FopRotinas. Eventos 100/110 derivados do VALOR FINAL (pix>0).
// ---------------------------------------------------------------------------

async function etapaRmFopRotinas(input: PontualWorkflowInput, plano: PlanoPagamento): Promise<{ temFinanceiro: boolean }> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "rm_gerar"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  const eventos = eventosPontual(plano.pessoa)
  if (r.acao === "pular") return { temFinanceiro: eventos.length > 0 }
  if (r.acao === "simular") {
    await simular(execucaoId, etapa, r.chave)
    return { temFinanceiro: false }
  }
  if (!eventos.length) {
    // 100% crédito → sem lançamento financeiro (o IF "Tem Boleto p/ Financeiro?" do n8n).
    await confirmarEfeito(r.chave, "rm:foprotinas:sem_boleto")
    await log(execucaoId, etapa, "ok", { metadados: { pulado: "sem_boleto" } })
    return { temFinanceiro: false }
  }
  const hoje = new Date().toISOString().slice(0, 10)
  const { anoComp, mesComp } = competenciaPontual(plano.snapshot.data_inicio)
  const { chapa6 } = await import("../auth-backend/src/mensal/rmEfeitos.js")
  await executarFopRotinas({
    coligada: RM_COLIGADA,
    codSecao: codSecaoBase(plano.snapshot.cod_secao ?? ""),
    chapas: [chapa6(plano.pessoa.chapa)],
    eventos,
    anoComp,
    mesComp,
    dataEmissao: `${hoje}T00:00:00`,
    dataVencimento: `${hoje}T00:00:00`,
  })
  await confirmarEfeito(r.chave, `rm:foprotinas:1chapa:${eventos.join("+")}`)
  await log(execucaoId, etapa, "ok", { metadados: { eventos } })
  return { temFinanceiro: true }
}
etapaRmFopRotinas.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 10 — integrar IDFINANC (dedup forte + filtro por valor ≈ esperado).
// ---------------------------------------------------------------------------

async function etapaRmIntegrar(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  temFinanceiro: boolean,
): Promise<{ idVR: string | null; idVT: string | null }> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "rm_integrar"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return { idVR: null, idVT: null }
  if (r.acao === "simular") {
    await simular(execucaoId, etapa, r.chave)
    return { idVR: null, idVT: null }
  }
  if (!temFinanceiro) {
    await confirmarEfeito(r.chave, "rm:integrar:sem_financeiro")
    await log(execucaoId, etapa, "ok", { metadados: { pulado: "sem_financeiro" } })
    return { idVR: null, idVT: null }
  }
  const hoje = new Date().toISOString().slice(0, 10)
  const rotulados = await consultarIdfinanc({
    coligada: RM_COLIGADA,
    codSecao: codSecaoBase(plano.snapshot.cod_secao ?? ""),
    dataEmissao: `${hoje}T00:00:00`,
  })
  // Mitigação de concorrência na mesma seção/dia (furo herdado do WF5): quando o RM devolve
  // VALORORIGINAL, só integramos lançamento cujo valor bate com o pix esperado (±0,05).
  const esperado = { VR: Number(plano.pessoa.pixVR) || 0, VT: Number(plano.pessoa.pixVT) || 0 }
  const { integrar, divergentes } = classificarLancamentosIdfinanc(rotulados, esperado)

  // Divergente é o caso NORMAL, não um problema: do segundo pagamento do dia em diante, os
  // lançamentos dos anteriores da mesma seção sempre aparecem na consulta. O que separa ruído de
  // problema é quem já integrou — efeito confirmado significa "de outro pagamento, resolvido";
  // ausência de efeito significa que NINGUÉM integrou aquele lançamento, e isso merece o olho.
  let deOutroPagamento = 0
  const orfaos: string[] = []
  for (const row of divergentes) {
    const chave = `pontual:rm_idfinanc:${RM_COLIGADA}:${row.IDFINANC}`
    if ((await estadoEfeito(chave)) === "confirmado") deOutroPagamento++
    else orfaos.push(`${row.IDFINANC} (${row.tipoEvento} ${row.VALORORIGINAL})`)
  }

  const idsVR: string[] = []
  const idsVT: string[] = []
  let integrados = 0
  for (const row of integrar) {
    const chaveId = `pontual:rm_idfinanc:${RM_COLIGADA}:${row.IDFINANC}`
    const reservaId = await reservarEfeito(chaveId, "pontual_rm_idfinanc", { itemOrigemId, tipo: row.tipoEvento })
    if (reservaId === "confirmado") continue
    if (reservaId === "pendente") throw new FatalError(`efeito_pendente_requer_conciliacao:rm_idfinanc:${row.IDFINANC}`)
    await integrarIdfinanc(row.IDFINANC, RM_COLIGADA)
    await confirmarEfeito(chaveId, `rm:idfinanc:${row.IDFINANC}:${row.tipoEvento}`)
    integrados++
    if (row.tipoEvento === "VR") idsVR.push(String(row.IDFINANC))
    else idsVT.push(String(row.IDFINANC))
  }
  const idVR = idsVR.length ? idsVR.join(", ") : null
  const idVT = idsVT.length ? idsVT.join(", ") : null
  await confirmarEfeito(r.chave, `rm:integrar:${integrados}:vr=${idVR ?? "-"}:vt=${idVT ?? "-"}`)
  await log(execucaoId, etapa, "ok", {
    metadados: {
      encontrados: rotulados.length,
      integrados,
      idVR,
      idVT,
      // Contado e registrado, mas SEM aviso: é o vizinho de seção já resolvido.
      deOutroPagamento,
      ...(orfaos.length ? { orfaos } : {}),
    },
  })
  if (orfaos.length) {
    await log(execucaoId, etapa, "aviso", {
      mensagem:
        `${orfaos.length} lançamento(s) na mesma seção/dia que NINGUÉM integrou: ${orfaos.join(", ")}. ` +
        `Não são deste pagamento — confira de quem são.`,
    })
  }
  return { idVR, idVT }
}
etapaRmIntegrar.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 12 — Controle Caju (débito do crédito no grupo do mês corrente).
// ---------------------------------------------------------------------------

async function etapaControleCaju(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  creditos: { vr: string | null; vt: string | null },
): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "monday_controle_caju"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simular(execucaoId, etapa, r.chave)
  const totalCredito = (Number(plano.pessoa.creditoVR) || 0) + (Number(plano.pessoa.creditoVT) || 0)
  const hoje = new Date()
  const dataIso = hoje.toISOString().slice(0, 10)
  const grupo = totalCredito > 0 ? await garantirGrupoCaixa("controle") : null
  const res = totalCredito > 0
    ? await registrarDebitoControleCaju({
        grupoControleCaju: grupo!,
        contrato: plano.pessoa.contrato,
        competenciaLabel: MESES_LABEL[hoje.getUTCMonth()]!,
        anoComp: hoje.getUTCFullYear(),
        totalCredito,
        pedidoCreditoId: juntarIdsCaju([creditos.vr, creditos.vt]),
        dataIso,
        nomeItem: montarNomeDebitoPontual(plano.pessoa.nome, dataIso),
      })
    : ({ pulado: true, motivo: "sem_credito" } as const)
  const ref = "id" in res ? `monday:controle_caju:${res.id}` : `monday:controle_caju:${res.motivo}`
  await confirmarEfeito(r.chave, ref)
  await log(execucaoId, etapa, "ok", {
    metadados: "id" in res ? { itemId: res.id, debito: totalCredito } : { pulado: res.motivo },
  })
}
etapaControleCaju.maxRetries = 5

// ---------------------------------------------------------------------------
// Step 13 — Plano: DESCONTO - VR/VT (+ 7 colunas se recalculado).
// ---------------------------------------------------------------------------

async function etapaMondayPlano(input: PontualWorkflowInput, plano: PlanoPagamento): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "monday_plano"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simular(execucaoId, etapa, r.chave)

  const boardId = plano.snapshot.monday_board_id
  if (!boardId) throw new FatalError("snapshot_sem_board_id")
  // Registry: título → column_id (a virada troca os ids; fallback = ids do WF5).
  const { query } = await import("../auth-backend/src/db.js")
  const { rows } = await query<{ nome: string; column_id: string }>(
    `SELECT nome, column_id FROM board_colunas WHERE monday_board_id = $1`,
    [boardId],
  )
  const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
  const porNome = new Map(rows.map((x) => [norm(x.nome), x.column_id]))
  const cv: Record<string, unknown> = {
    [porNome.get("DESCONTO - VR") ?? "numeric_mkrz4ye5"]: String(Number(plano.pessoa.descontoVR) || 0),
    [porNome.get("DESCONTO - VT") ?? "numeric_mkrz9c4e"]: String(Number(plano.pessoa.descontoVT) || 0),
  }
  if (plano.recalculado) {
    const planUpdate = (plano.snapshot.calculo as { plan_update?: Record<string, unknown> }).plan_update
    if (planUpdate) {
      const colunas = Object.fromEntries([...porNome].map(([nome, id]) => [nome, id]))
      Object.assign(cv, montarValuesPlanUpdate(planUpdate as never, colunas))
    }
  }
  await mondayGraphql(
    `mutation($b:ID!,$i:ID!,$v:JSON!){ change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true){ id } }`,
    { b: boardId, i: itemOrigemId, v: JSON.stringify(cv) },
  )
  await confirmarEfeito(r.chave, `monday:plano:${Object.keys(cv).length}cols`)
  await log(execucaoId, etapa, "ok", { metadados: { colunas: Object.keys(cv).length, recalculado: plano.recalculado } })
}
etapaMondayPlano.maxRetries = 5

// ---------------------------------------------------------------------------
// Step 14 — Solicitação de Pagamento (SÓ com boleto).
// ---------------------------------------------------------------------------

async function etapaSolicitacao(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  refs: { pedidoCreditoVR: string | null; pedidoCreditoVT: string | null; pedidoPixVR: string | null; pedidoPixVT: string | null; idVR: string | null; idVT: string | null },
): Promise<LinhaSolicitacaoPontual[]> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "monday_solicitacao"
  const temBoleto = (Number(plano.pessoa.pixVR) || 0) + (Number(plano.pessoa.pixVT) || 0) > 0
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return []
  if (r.acao === "simular") {
    await simular(execucaoId, etapa, r.chave)
    return []
  }
  if (!temBoleto) {
    await confirmarEfeito(r.chave, "monday:solicitacao:sem_boleto")
    await log(execucaoId, etapa, "ok", { metadados: { pulado: "sem_boleto" } })
    return []
  }
  // Gaveta = mês da DATA_INICIO da convocação (não o mês corrente) — regra do WF5.
  const { anoComp, mesComp } = competenciaPontual(plano.snapshot.data_inicio)
  const caixa = `${anoComp}-${String(mesComp).padStart(2, "0")}`
  const grupo = await garantirGrupoCaixa("solicitacao", caixa)
  const inp = {
    contrato: plano.pessoa.contrato,
    competenciaLabel: MESES_LABEL[mesComp - 1]!,
    anoComp,
    totais: {
      vr: Number(plano.pessoa.liquidoVR) || 0,
      vt: Number(plano.pessoa.liquidoVT) || 0,
      credito: (Number(plano.pessoa.creditoVR) || 0) + (Number(plano.pessoa.creditoVT) || 0),
      pix: (Number(plano.pessoa.pixVR) || 0) + (Number(plano.pessoa.pixVT) || 0),
    },
    pessoas: [plano.pessoa],
    idVR: refs.idVR,
    idVT: refs.idVT,
    pedidoCreditoVR: refs.pedidoCreditoVR,
    pedidoCreditoVT: refs.pedidoCreditoVT,
    pedidoPixVR: refs.pedidoPixVR,
    pedidoPixVT: refs.pedidoPixVT,
    planBoardId: plano.snapshot.monday_board_id ?? "",
    dataIso: new Date().toISOString().slice(0, 10),
    itemPlanoId: itemOrigemId,
  }
  // UMA LINHA POR BENEFÍCIO desde o split de 08/2026: o board deixou de ter um item com as duas
  // colunas de valor. Sequencial de propósito — dois create_item, e escrita concorrente no Monday
  // volta 200 com `errors` dentro; perder a segunda linha calado é o pior modo num #dinheiro-real.
  const criadas: LinhaSolicitacaoPontual[] = []
  for (const beneficio of beneficiosDaSolicitacaoPontual(inp)) {
    const criado = await criarItemComValores(
      "18393673859",
      grupo,
      montarNomeSolicitacaoPontual(plano.pessoa.nome, beneficio),
      montarValuesSolicitacaoPontual(inp, beneficio),
    )
    criadas.push({ beneficio, id: criado.id })
    await log(execucaoId, etapa, "ok", {
      metadados: { beneficio, itemId: criado.id, resumo: montarResumoSolicitacaoPontual(inp, beneficio).slice(0, 200) },
    })
  }
  await confirmarEfeito(r.chave, `monday:solicitacao:${criadas.map((c) => `${c.beneficio}=${c.id}`).join(";")}`)
  return criadas
}
etapaSolicitacao.maxRetries = 5

// ---------------------------------------------------------------------------
// Step 15 — Drive (pasta já resolvida pela fase 1).
// ---------------------------------------------------------------------------

interface RefsPagamento {
  pedidoCreditoVR: string | null
  pedidoCreditoVT: string | null
  pedidoPixVR: string | null
  pedidoPixVT: string | null
  idVR: string | null
  idVT: string | null
  solicitacaoId: string | null
}

/**
 * Dados do relatório montados a partir do que este pagamento produziu.
 *
 * Reconstruído em CADA step que precisa dele em vez de trafegar entre steps: o resultado de um
 * step vira JSON, e `geradoEm: Date` voltaria como string — tipo mentindo em silêncio.
 */
function dadosDoRelatorio(
  plano: PlanoPagamento,
  refs: RefsPagamento,
  abatimentos: AbatimentoBalao[],
  geradoEm: Date,
): DadosRelatorioPagamento {
  return montarDadosRelatorioPontual({
    snapshot: plano.snapshot,
    pessoa: {
      nome: plano.pessoa.nome,
      chapa: plano.pessoa.chapa,
      cpf: plano.pessoa.cpf,
      diasVR: plano.snapshot.dias_vr,
      diasVT: plano.snapshot.dias_vt,
      vrDia: plano.snapshot.vr_dia,
      vtDia: plano.snapshot.vt_dia,
      brutoVR: plano.snapshot.bruto_vr,
      brutoVT: plano.snapshot.bruto_vt,
      descontoVR: plano.pessoa.descontoVR,
      descontoVT: plano.pessoa.descontoVT,
      liquidoVR: plano.pessoa.liquidoVR,
      liquidoVT: plano.pessoa.liquidoVT,
      creditoVR: plano.pessoa.creditoVR,
      creditoVT: plano.pessoa.creditoVT,
      pixVR: plano.pessoa.pixVR,
      pixVT: plano.pessoa.pixVT,
    },
    refs,
    abatimentos,
    geradoPor: "automação (felipeta)",
    geradoEm,
  })
}

async function etapaDrive(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  refs: RefsPagamento & { qrVR: string; qrVT: string; copiaECola: string },
  abatimentos: AbatimentoBalao[],
): Promise<{ relatorioUrl: string | null }> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "drive"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  // Retomada: o PDF já subiu, mas o link só existe no payload do efeito. Sem reler daqui, a
  // linha do board nasceria sem o link do relatório que está lá no Drive.
  if (r.acao === "pular") {
    const det = await detalheEfeito(r.chave)
    return { relatorioUrl: (det?.payload as { relatorioUrl?: string } | null)?.relatorioUrl ?? null }
  }
  if (r.acao === "simular") {
    await simular(execucaoId, etapa, r.chave)
    return { relatorioUrl: null }
  }
  const dados = dadosDoRelatorio(plano, refs, abatimentos, new Date())
  const resultados = await arquivarDrivePontual(plano.snapshot, plano.pessoa, {
    pedidoCreditoVR: refs.pedidoCreditoVR,
    pedidoCreditoVT: refs.pedidoCreditoVT,
    pedidoPixVR: refs.pedidoPixVR,
    pedidoPixVT: refs.pedidoPixVT,
    idVR: refs.idVR,
    idVT: refs.idVT,
    qrBoletoVRBase64: refs.qrVR,
    qrBoletoVTBase64: refs.qrVT,
    pixCopiaECola: refs.copiaECola,
    solicitacaoId: refs.solicitacaoId,
    relatorio: dados,
  })
  const uploads = resultados.flatMap((x) => x.resultado.uploads.map((u) => u.id))
  const relatorioUrl = urlDoRelatorio(resultados, dados)
  await confirmarEfeito(r.chave, `drive:${uploads.join(",") || "sem_upload"}`, { relatorioUrl })
  await log(execucaoId, etapa, "ok", { metadados: { uploads: uploads.length, relatorioUrl } })
  return { relatorioUrl }
}
etapaDrive.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 16 — board "Notas e Relatórios Caju": uma linha por pedido.
// ---------------------------------------------------------------------------

async function etapaNotasCaju(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  refs: RefsPagamento,
  abatimentos: AbatimentoBalao[],
  relatorioUrl: string | null,
): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "monday_notas"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simular(execucaoId, etapa, r.chave)

  const dados = dadosDoRelatorio(plano, refs, abatimentos, new Date())
  const linhas = linhasNotaDeRelatorio(dados, { relatorioUrl })
  const res = await registrarNotasCaju(linhas)
  if (res.pulado) {
    // Board ainda não registrado (ou semSaldo, sem pedido nenhum) não é erro: o pagamento
    // aconteceu. Fica no log pro back-fill saber o que recuperar.
    await confirmarEfeito(r.chave, `monday:notas:${res.pulado}`)
    await log(execucaoId, etapa, "ok", { metadados: { pulado: res.pulado } })
    return
  }
  const { abrirExecucao } = await import("../auth-backend/src/services/execucao.js")
  const ex = await abrirExecucao({ id: execucaoId, acao: "pontual_pagamento", motor: "workflow" })
  const board = res.criados.length ? await resolverBoardNotas() : null
  for (const c of res.criados) {
    await ex.artefato({
      tipo: "monday_item",
      chave: c.itemId,
      rotulo: `Nota Caju do pedido ${c.orderId.slice(0, 8)}`,
      ...(board ? { url: urlItemNota(board.boardId, c.itemId) } : {}),
    })
  }
  await confirmarEfeito(r.chave, `monday:notas:${res.criados.map((c) => c.itemId).join(",")}`)
  await log(execucaoId, etapa, res.faltando.length ? "aviso" : "ok", {
    // `faltando` = coluna do contrato que não existe no board. Aparece como AVISO pra alguém
    // corrigir o nome no Monday, sem derrubar o pagamento.
    ...(res.faltando.length ? { mensagem: `colunas ausentes no board: ${res.faltando.join(", ")}` } : {}),
    metadados: { itens: res.criados.length, faltando: res.faltando },
  })
}
etapaNotasCaju.maxRetries = 3

// ---------------------------------------------------------------------------
// Step 17 — balãozinho de desconto no item do Plano (roda no semSaldo também).
// ---------------------------------------------------------------------------

async function etapaBalao(
  input: PontualWorkflowInput,
  plano: PlanoPagamento,
  abatimentos: AbatimentoBalao[],
): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "monday_balao"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simular(execucaoId, etapa, r.chave)
  // Abatimentos do step do FIFO (tem o residual pos-abatimento). Se o fifo foi pulado por
  // idempotencia, cai nas reservas do snapshot — sem desfecho por divida, mas com os valores.
  const doSnapshot = ((plano.snapshot.calculo as { reservas?: AbatimentoBalao[] }).reservas)
    ?? plano.snapshot.reservas
  const texto = montarTextoBalao(plano.pessoa, abatimentos.length ? abatimentos : (doSnapshot ?? []))
  if (!texto) {
    await confirmarEfeito(r.chave, "monday:balao:sem_desconto")
    await log(execucaoId, etapa, "ok", { metadados: { pulado: "sem_desconto" } })
    return
  }
  const updateId = await criarUpdate(itemOrigemId, texto)
  await confirmarEfeito(r.chave, `monday:balao:${updateId ?? "sem-id"}`)
  await log(execucaoId, etapa, "ok", { metadados: { updateId } })
}
etapaBalao.maxRetries = 5

// ---------------------------------------------------------------------------
// Step 18 — AUTOMAÇÃO-OK na Solicitação (só depois de TUDO).
// ---------------------------------------------------------------------------

async function etapaStatusOk(input: PontualWorkflowInput, solicitacoes: LinhaSolicitacaoPontual[]): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const etapa = "monday_status_ok"
  const r = await reservarOuPular(input.modo, execucaoId, itemOrigemId, etapa)
  if (r.acao === "pular") return
  if (r.acao === "simular") return simular(execucaoId, etapa, r.chave)
  if (!solicitacoes.length) {
    await confirmarEfeito(r.chave, "monday:status_ok:sem_solicitacao")
    await log(execucaoId, etapa, "ok", { metadados: { pulado: "sem_solicitacao" } })
    return
  }
  // TODAS as linhas: deixar a do VT em NÃO INICIADO faria o DP tratar como pendente.
  for (const s of solicitacoes) await setarStatusAutomacaoOk(s.id)
  const ids = solicitacoes.map((s) => s.id)
  await confirmarEfeito(r.chave, `monday:status_ok:${ids.join(";")}`)
  await log(execucaoId, etapa, "ok", { metadados: { solicitacaoIds: ids } })
}
etapaStatusOk.maxRetries = 5

// ---------------------------------------------------------------------------
// Step 19 — fechamento: artefatos + fechar execução + confirmar o gatilho.
// ---------------------------------------------------------------------------

async function etapaFechamento(
  input: PontualWorkflowInput,
  plano: PlanoPagamento | null,
  refs: { pedidoCreditoVR?: string | null; pedidoCreditoVT?: string | null; pedidoPixVR?: string | null; pedidoPixVT?: string | null; idVR?: string | null; idVT?: string | null; solicitacaoId?: string | null },
  desfecho: "ok" | "ja_pago",
): Promise<void> {
  "use step"
  const { execucaoId, itemOrigemId } = input
  const { abrirExecucao } = await import("../auth-backend/src/services/execucao.js")
  const ex = await abrirExecucao({ id: execucaoId, acao: "pontual_pagamento", motor: "workflow", alvo: itemOrigemId })
  for (const [tipo, chave, rotulo] of [
    ["caju_pedido", refs.pedidoCreditoVR, "Pedido crédito VR"],
    ["caju_pedido", refs.pedidoCreditoVT, "Pedido crédito VT"],
    ["caju_boleto", refs.pedidoPixVR, "Boleto PIX VR"],
    ["caju_boleto", refs.pedidoPixVT, "Boleto PIX VT"],
    ["rm_idfinanc", refs.idVR, "IDFINANC VR"],
    ["rm_idfinanc", refs.idVT, "IDFINANC VT"],
    ["solicitacao", refs.solicitacaoId, "Solicitação de Pagamento"],
  ] as const) {
    if (chave) await ex.artefato({ tipo, chave, rotulo })
  }
  // A pasta é RELIDA do banco, não tirada de `plano.snapshot`: quando a fase 1 não
  // conseguiu resolvê-la, quem resolve é o step do Drive — e o objeto em memória do step 1
  // continua com `pasta_estado='pendente'`. Foi o que aconteceu no pagamento da MARCIA
  // (13/08): a pasta existia no board e no banco, mas o log fechou sem o artefato dela.
  const { lerPrePagamentoCompleto } = await import("../auth-backend/src/pontual/prepagamento.js")
  const atual = await lerPrePagamentoCompleto(itemOrigemId).catch(() => null)
  const pastaId = atual?.pasta_convocacao_drive_id ?? plano?.snapshot.pasta_convocacao_drive_id
  if (pastaId) {
    await ex.artefato({
      tipo: "drive_pasta",
      chave: pastaId,
      rotulo: "Pasta da convocação",
      url: `https://drive.google.com/drive/folders/${pastaId}`,
    })
  }
  await ex.fechar("ok", desfecho === "ja_pago" ? { erro: undefined } : undefined)
  if (input.modo === "producao") {
    // A marca de "pagamento concluído", e ela precisa EXISTIR: a rota do webhook consulta
    // `pontual:{item}:fechamento` como primeira barreira de idempotência, e enquanto o step
    // não a criava essa consulta era código morto — o no-op só acontecia pelas outras duas
    // vias (snapshot consumido, gatilho confirmado). Também é o que distingue "pagou tudo"
    // de "parou no meio" numa auditoria do ledger.
    await reservarEfeito(`pontual:${itemOrigemId}:fechamento`, "pontual_fechamento", { execucaoId })
    await confirmarEfeito(`pontual:${itemOrigemId}:fechamento`, execucaoId, { desfecho })
    await confirmarEfeito(`pontual:gatilho:${itemOrigemId}`, execucaoId, { desfecho })
  } else {
    // Simulação não deixa marca de pagamento: o dinheiro não se moveu.
    await liberarEfeito(`pontual:gatilho:${itemOrigemId}`)
  }
}
etapaFechamento.maxRetries = 5

/** Erro fatal: fecha a execução com erro (dispara o alerta WhatsApp) e SOLTA o gatilho. */
async function etapaErro(input: PontualWorkflowInput, mensagem: string): Promise<void> {
  "use step"
  const { abrirExecucao } = await import("../auth-backend/src/services/execucao.js")
  const ex = await abrirExecucao({ id: input.execucaoId, acao: "pontual_pagamento", motor: "workflow", alvo: input.itemOrigemId })
  await ex.fechar("erro", { erro: mensagem, etapaErro: "pagamento" })
  // Nunca solta gatilho confirmado (liberarEfeito ignora confirmado) — re-marcar o SIM rearma.
  await liberarEfeito(`pontual:gatilho:${input.itemOrigemId}`)
}
etapaErro.maxRetries = 5

// ---------------------------------------------------------------------------
// Corpo do workflow — SÓ orquestração (nada de env/Date/imports pesados aqui).
// ---------------------------------------------------------------------------

export async function executarPontualWorkflow(input: PontualWorkflowInput): Promise<{ desfecho: string }> {
  "use workflow"
  try {
    const plano = await etapaValidacao(input)
    if (plano.jaPago) {
      await etapaFechamento(input, plano, {}, "ja_pago")
      return { desfecho: "ja_pago" }
    }

    const employeeId = await etapaEmployeeCaju(input, plano)
    const abatimentos = await etapaConsumirFifo(input, plano)

    if (plano.semSaldo) {
      // Caminho curto do If2#false do WF5: FIFO consumido, balão, fechamento. Zero dinheiro.
      await etapaBalao(input, plano, abatimentos)
      await etapaFechamento(input, plano, {}, "ok")
      return { desfecho: "sem_saldo" }
    }

    // DOIS pedidos, não quatro: VR e VT viajam juntos em cada um (formato WF5, decisão do
    // Isaac 13/08). O crédito nunca é confirmado (fica DRAFT); o boleto é confirmado e
    // devolve o QR.
    const credito = await etapaPedidoCaju(input, plano, employeeId, "credito")
    const boleto = await etapaPedidoCaju(input, plano, employeeId, "boleto")

    await etapaRmHistorico(input, plano, "pix")
    const { temFinanceiro } = await etapaRmFopRotinas(input, plano)
    if (temFinanceiro) await sleep("7s") // FopRotinas é assíncrono no RM
    const { idVR, idVT } = await etapaRmIntegrar(input, plano, temFinanceiro)
    // A TRAVA: histórico do crédito SÓ depois do FopRotinas+integrar.
    await etapaRmHistorico(input, plano, "credito")

    await etapaControleCaju(input, plano, { vr: credito.orderId, vt: null })
    await etapaMondayPlano(input, plano)
    // Pedido ÚNICO por tipo: o id vai no campo VR e o VT fica null. Quem consome junta os
    // não-nulos (idsPedidoParaSolicitacao), então cada consumidor recebe um id por tipo.
    const refsSemSolicitacao = {
      pedidoCreditoVR: credito.orderId,
      pedidoCreditoVT: null,
      pedidoPixVR: boleto.orderId,
      pedidoPixVT: null,
      idVR,
      idVT,
    }
    const solicitacoes = await etapaSolicitacao(input, plano, refsSemSolicitacao)
    // Drive e notas linkam UM item — a linha do VR quando existe, senão a do VT. São as duas
    // linhas do mesmo pagamento, então o rastro não se perde.
    const solicitacaoId = solicitacoes[0]?.id ?? null
    const refs = { ...refsSemSolicitacao, solicitacaoId }
    // O Drive vem antes das notas: a linha do board carrega o link do PDF que sobe aqui.
    const { relatorioUrl } = await etapaDrive(input, plano, {
      ...refs,
      // Um boleto = um QR. O segundo slot existe pro mensal, que tem dois.
      qrVR: boleto.qr,
      qrVT: "",
      copiaECola: boleto.copiaECola,
    }, abatimentos)
    await etapaNotasCaju(input, plano, refs, abatimentos, relatorioUrl)
    await etapaBalao(input, plano, abatimentos)
    await etapaStatusOk(input, solicitacoes)
    await etapaFechamento(input, plano, refs, "ok")
    return { desfecho: "pago" }
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
    await etapaErro(input, msg)
    throw e
  }
}
