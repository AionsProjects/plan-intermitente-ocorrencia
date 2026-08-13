// Builders da felipeta — o que precisa de prova é dinheiro: o recompose do FIFO (residual
// nunca negativo, FINALIZADO só quando zera TUDO), a validação (cancelada recusa antes de
// recalcular; consumido é no-op) e os adaptadores não perderem campo de valor.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  montarDescontoUpdatesPontual,
  montarPessoaPagamento,
  motivosRecusa,
  validarPagamento,
  type ItemBoardValidacao,
} from "./pagamento.js"
import { montarNomePedidoPontual, montarPedidoCajuPontual } from "./cajuPontual.js"
import { competenciaPontual, eventosPontual, registrosHistoricoPontual } from "./rmPontual.js"
import { montarTextoBalao, montarValuesSolicitacaoPontual } from "./mondayPontual.js"
import type { PrePagamentoCompleto } from "./prepagamento.js"
import type { PessoaPreviaMensal } from "../mensal/types.js"

const snapshot = (over: Partial<PrePagamentoCompleto> = {}): PrePagamentoCompleto => ({
  id: "p1", item_origem_id: "111", monday_board_id: "18418191275",
  chapa: "007282", cpf: "762.366.332-15", nome: "VALCLEBER", contrato: "SEMSA",
  cod_secao: "01.01.0085.01.0112", data_inicio: "2026-08-17", data_fim: "2026-08-18",
  dias_vr: 2, dias_vt: 2, vr_dia: 24.5, vt_dia: 10, bruto_vr: 49, bruto_vt: 20,
  desconto_vr: 10, desconto_vt: 0, liquido_vr: 39, liquido_vt: 20,
  credito_vr: 39, credito_vt: 20, pix_vr: 0, pix_vt: 0, regra_aplicada: "r",
  calculo: { entrada: { funcao: "AUX", interior: "SIM", optanteVT: true } },
  reservas: [{ descontoMondayItemId: "d1", vr: 10, vt: 0 }],
  estado: "reservado", motivo_invalido: null,
  pasta_convocacao_drive_id: "pc", pasta_pessoa_drive_id: "pp",
  pasta_convocacao_nome: "17 A 18/08/2026", pasta_estado: "pronta",
  ...over,
})

const itemBoard = (over: Partial<ItemBoardValidacao> = {}): ItemBoardValidacao => ({
  statusConvocacao: "Válida", dataInicio: "2026-08-17", dataFim: "2026-08-18",
  chapa: "007282", cancelamentoInicio: "", ...over,
})

// ---------- adaptador ----------

test("montarPessoaPagamento carrega valores e a entrada do calculo", () => {
  const p = montarPessoaPagamento(snapshot())
  assert.equal(p.liquidoVR, 39)
  assert.equal(p.creditoVT, 20)
  assert.equal(p.cpf, "76236633215") // só dígitos
  assert.equal(p.interior, "SIM") // veio de calculo->entrada
  assert.equal(p.funcao, "AUX")
  assert.equal(p.dataInicio, "2026-08-17")
})

// ---------- FIFO recompose ----------

test("descontoUpdates: PARCIAL quando sobra residual, FINALIZADO quando zera tudo", () => {
  const upd = montarDescontoUpdatesPontual(
    [{ descontoMondayItemId: "d1", vr: 10, vt: 5 }],
    [{ id: "d1", residualVR: 30, residualVT: 5, descontadoVR: 0, descontadoVT: 0 }],
  )
  assert.equal(upd[0]!.residualVR, 20)
  assert.equal(upd[0]!.residualVT, 0)
  assert.equal(upd[0]!.descontadoVR, 10)
  assert.equal(upd[0]!.status, "PARCIAL") // VR ainda tem residual

  const fim = montarDescontoUpdatesPontual(
    [{ descontoMondayItemId: "d1", vr: 30, vt: 5 }],
    [{ id: "d1", residualVR: 30, residualVT: 5, descontadoVR: 100, descontadoVT: 40 }],
  )
  assert.equal(fim[0]!.status, "FINALIZADO")
  assert.equal(fim[0]!.descontadoVR, 130)
})

test("descontoUpdates: residual nunca negativo (mensal consumiu no meio)", () => {
  const upd = montarDescontoUpdatesPontual(
    [{ descontoMondayItemId: "d1", vr: 20, vt: 0 }],
    [{ id: "d1", residualVR: 12, residualVT: 0, descontadoVR: 0, descontadoVT: 0 }],
  )
  assert.equal(upd[0]!.residualVR, 0)
})

test("descontoUpdates: reserva de item sumido lança nomeado", () => {
  assert.throws(
    () => montarDescontoUpdatesPontual([{ descontoMondayItemId: "dX", vr: 5, vt: 0 }], []),
    /desconto_reservado_sumiu_do_board/,
  )
})

// ---------- validação ----------

test("cancelada TOTAL recusa antes de qualquer recálculo", () => {
  const v = validarPagamento(null, itemBoard({ statusConvocacao: "Cancelada" }))
  assert.deepEqual(v, { acao: "recusar", motivo: "convocacao_cancelada" })
})

test("consumido é ja_pago mesmo com período divergente", () => {
  const v = validarPagamento(snapshot({ estado: "consumido" }), itemBoard({ dataFim: "2026-08-25" }))
  assert.deepEqual(v, { acao: "ja_pago" })
})

test("snapshot ausente ou período divergente recalcula", () => {
  assert.equal(validarPagamento(null, itemBoard()).acao, "recalcular")
  const v = validarPagamento(snapshot(), itemBoard({ dataFim: "2026-08-20" }))
  assert.deepEqual(v, { acao: "recalcular", motivo: "data_fim_divergente" })
})

test("cancelamento PARCIAL: fim efetivo truncado casa com snapshot recalculado", () => {
  // snapshot já recalculado pra 17→19 (cancelamento a partir de 20) — não re-recalcula
  const s = snapshot({ data_fim: "2026-08-19" })
  const v = validarPagamento(s, itemBoard({
    statusConvocacao: "Cancelada parcialmente", dataFim: "2026-08-25", cancelamentoInicio: "2026-08-20",
  }))
  assert.equal(v.acao, "pagar")
})

test("semSaldo detectado no veredicto", () => {
  const v = validarPagamento(snapshot({ liquido_vr: 0, liquido_vt: 0 }), itemBoard())
  assert.deepEqual(v, { acao: "pagar", semSaldo: true })
})

test("motivosRecusa: chapa/cpf/codSecao só quando há líquido", () => {
  assert.deepEqual(motivosRecusa(snapshot({ chapa: "", cpf: null, cod_secao: null })),
    ["chapa_invalida", "cpf_ausente", "codsecao_ausente"])
  assert.deepEqual(motivosRecusa(snapshot({ chapa: "", cpf: null, liquido_vr: 0, liquido_vt: 0 })), [])
})

// ---------- Caju ----------

test("nome do pedido segue o formato WF5 e trunca em 100", () => {
  assert.equal(
    montarNomePedidoPontual("Valcleber Costa", "007282", "2026-08-17", "credito", "VR"),
    "INTERMITENTE-PONTUAL-VALCLEBER COSTA-007282-17.08 CREDITO VR",
  )
  const longo = montarNomePedidoPontual("A".repeat(120), "007282", "2026-08-17", "boleto", "VT")
  assert.equal(longo.length, 100)
})

const pessoaCaju = (over: Partial<PessoaPreviaMensal> = {}): PessoaPreviaMensal & { employeeId?: string | null } => ({
  itemId: "1", nome: "VALCLEBER", chapa: "007282", cpf: "76236633215", contrato: "SEMSA",
  funcao: "AUX", unidade: "", interior: "NAO", dataInicio: "2026-08-17", dataFim: "2026-08-18",
  creditoVR: 39, creditoVT: 20, pixVR: 60, pixVT: 30, employeeId: "emp-1", ...over,
})

test("pedido: valor zero é tem:false; valor>0 sem employeeId LANÇA", () => {
  const zero = montarPedidoCajuPontual(pessoaCaju({ creditoVR: 0 }), "credito", "VR")
  assert.equal(zero.tem, false)
  assert.equal(zero.payload, null)
  assert.throws(
    () => montarPedidoCajuPontual(pessoaCaju({ employeeId: null }), "boleto", "VR"),
    /pessoa_nao_cadastrada_na_caju: chapa=007282/,
  )
})

test("pedido boleto VT usa categoria por interior e centavos certos", () => {
  const p = montarPedidoCajuPontual(pessoaCaju({ interior: "SIM" }), "boleto", "VT")
  assert.equal(p.paymentType, "PIX_CODE")
  assert.equal(p.totalCentavos, 3000)
  assert.equal(p.payload!.allowances[0]!.amounts[0]!.category, "TRANSPORTATION")
  const capital = montarPedidoCajuPontual(pessoaCaju({ interior: "NAO", contrato: "SEMSA" }), "boleto", "VT")
  assert.equal(capital.payload!.allowances[0]!.amounts[0]!.category, "TRANSPORTATION_VOUCHER")
})

// ---------- RM ----------

test("eventos derivam do valor final: 100/110", () => {
  assert.deepEqual(eventosPontual({ pixVR: 10, pixVT: 0 }), ["100"])
  assert.deepEqual(eventosPontual({ pixVR: 10, pixVT: 5 }), ["100", "110"])
  assert.deepEqual(eventosPontual({ pixVR: 0, pixVT: 0 }), [])
})

test("competência = mês da data_inicio (retroativo)", () => {
  assert.deepEqual(competenciaPontual("2026-07-28"), { anoComp: 2026, mesComp: 7 })
})

test("histórico: TPBEN=0 no boleto, TPBEN=1 no crédito; 1 registro por benefício >0", () => {
  const p = pessoaCaju({ pixVR: 60, pixVT: 0, creditoVR: 39, creditoVT: 20 })
  const pix = registrosHistoricoPontual(p, "pix", { codSecao: "01.01.0085", dataImport: "2026-08-19" })
  assert.equal(pix.length, 1)
  assert.match(pix[0]!.dadosXml, /<TPBEN>0<\/TPBEN>/)
  assert.match(pix[0]!.dadosXml, /<CODBENEFICIO>1<\/CODBENEFICIO>/)
  assert.match(pix[0]!.dadosXml, /<ANOCOMP>2026<\/ANOCOMP>/)
  assert.match(pix[0]!.dadosXml, /<MESCOMP>8<\/MESCOMP>/)
  const cred = registrosHistoricoPontual(p, "credito", { codSecao: "01.01.0085", dataImport: "2026-08-19" })
  assert.equal(cred.length, 2)
  assert.match(cred[0]!.dadosXml, /<TPBEN>1<\/TPBEN>/)
})

// ---------- Monday ----------

test("values da Solicitação: INTERMITENTE + link pro pulse + resumo pontual", () => {
  const v = montarValuesSolicitacaoPontual({
    contrato: "SEMSA", competenciaLabel: "AGOSTO", anoComp: 2026,
    totais: { vr: 39, vt: 20, credito: 59, pix: 90 },
    pessoas: [pessoaCaju({ liquidoVR: 39, liquidoVT: 20 })],
    idVR: "24253", idVT: null, planBoardId: "18418191275", dataIso: "2026-08-19",
    itemPlanoId: "111", pedidoPixVR: "ord-1",
  })
  assert.deepEqual(v.color_mkref5wt, { label: "INTERMITENTE" })
  assert.equal((v.link_mkre40qn as { url: string }).url, "https://contato-serv.monday.com/boards/18418191275/pulses/111")
  assert.match((v.long_text_mkre1qa0 as { text: string }).text, /INTERMITENTE PONTUAL - VALCLEBER/)
  assert.equal(v.text_mkrenhm, "24253")
})

test("balão: null sem desconto; texto com semSaldo e itens quitados", () => {
  assert.equal(montarTextoBalao({ descontoVR: 0, descontoVT: 0, liquidoVR: 10, liquidoVT: 0 }, []), null)
  const txt = montarTextoBalao(
    { descontoVR: 49, descontoVT: 20, liquidoVR: 0, liquidoVT: 0 },
    [{ descontoMondayItemId: "d1", vr: 49, vt: 20 }],
  )
  assert.match(txt!, /VR R\$ 49,00/)
  assert.match(txt!, /NADA a pagar/)
  assert.match(txt!, /item d1/)
  assert.match(txt!, /boards\/18400981023/)
})
