import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"

const {
  montarValuesPlanUpdate, montarMutationPlanUpdates, montarValuesDesconto, montarMutationDescontos,
  montarResumoSolicitacao, montarValuesSolicitacao, saldoAnteriorControleCaju,
  montarNomeDebitoControle, montarValuesDebitoControle,
} = await import("./mondayEfeitos.js")

const planUpdate = {
  itemId: "111", vtDia: 10, vrDia: 20, vrMensal: 0, diasVR: 8, diasVT: 8, creditoVR: 60, creditoVT: 30,
}

test("vrDia null LIMPA a célula VR - Unitário (regra mensal paga por mês)", () => {
  const mensal = montarValuesPlanUpdate({ ...planUpdate, vrDia: null, vrMensal: 588 }, undefined)
  assert.equal(mensal["vr___saldo"], "")           // VR - Unitário vazio, não "0" nem "NaN"
  assert.equal(mensal["numeric_mktdzme6"], "588")  // VR - MENSAL preenchido
  // Regra diária mantém o inverso.
  const diaria = montarValuesPlanUpdate(planUpdate, undefined)
  assert.equal(diaria["vr___saldo"], "20")
  assert.equal(diaria["numeric_mktdzme6"], "0")
})

test("montarValuesPlanUpdate resolve colunas por título com fallback legado", () => {
  // Sem registry -> ids legados.
  const legado = montarValuesPlanUpdate(planUpdate, undefined)
  assert.equal(legado["n_meros0"], "10")       // VT - Diário
  assert.equal(legado["vr___saldo"], "20")     // VR - Unitário
  assert.equal(legado["numeric_mktdzme6"], "0") // VR - MENSAL
  assert.equal(legado["numeric21"], "8")       // Dias VR
  assert.equal(legado["numeric_mm0346q0"], "60") // CREDITO CAJU
  // Com registry (título normalizado) -> id do board novo.
  const novo = montarValuesPlanUpdate(planUpdate, { "VT - DIARIO": "col_x", "CREDITO CAJU": "col_y" })
  assert.equal(novo["col_x"], "10")
  assert.equal(novo["col_y"], "60")
  assert.equal(novo["vr___saldo"], "20") // sem match no registry -> fallback
})

test("VR mensal grava vrMensal e zera unitário", () => {
  const v = montarValuesPlanUpdate({ ...planUpdate, vrDia: 0, vrMensal: 660 }, undefined)
  assert.equal(v["vr___saldo"], "0")
  assert.equal(v["numeric_mktdzme6"], "660")
})

test("montarMutationPlanUpdates agrupa aliases e escapa JSON", () => {
  const m = montarMutationPlanUpdates("18418191275", [planUpdate, { ...planUpdate, itemId: "222" }], undefined)!
  assert.ok(m.includes("p0: change_multiple_column_values(board_id: 18418191275, item_id: 111"))
  assert.ok(m.includes("p1: change_multiple_column_values(board_id: 18418191275, item_id: 222"))
  assert.ok(m.includes("create_labels_if_missing: true"))
  assert.equal(montarMutationPlanUpdates("1", [], undefined), null)
})

test("montarValuesDesconto usa colunas fixas do board 18400981023", () => {
  const v = montarValuesDesconto({ id: "9", residualVR: 0, residualVT: 5.5, descontadoVR: 50, descontadoVT: 14.5, status: "PARCIAL" })
  assert.equal(v["numeric_mm0r1691"], "0")
  assert.equal(v["numeric_mm0rtwwg"], "5.5")
  assert.equal(v["numeric_mm0rqy6z"], "50")
  assert.equal(v["numeric_mm0r6cn0"], "14.5")
  assert.deepEqual(v["color_mm0r8mjr"], { label: "PARCIAL" })
  assert.ok(montarMutationDescontos([{ id: "9", residualVR: 0, residualVT: 0, descontadoVR: 1, descontadoVT: 1, status: "FINALIZADO" }])!.includes("item_id: 9"))
})

const solicitacaoInput = {
  contrato: "TRE PB", competenciaLabel: "JULHO", anoComp: 2026,
  totais: { vr: 660, vt: 250.7, credito: 98.7, pix: 812 },
  pessoas: [{ itemId: "1", itemIds: ["1", "2"], nome: "Fulana", chapa: "006534", cpf: "123", contrato: "TRE PB",
    funcao: "X", unidade: "U", interior: "NAO", dataInicio: "2026-07-01", dataFim: "2026-07-31",
    liquidoVR: 660, liquidoVT: 250.7, creditoVR: 66, creditoVT: 32.7, pixVR: 594, pixVT: 218 }],
  idVR: "555", idVT: null, pedidoCreditoId: "ord-c", pedidoPixId: "ord-p",
  summaryCredito: "sc", summaryPix: "sp", planBoardId: "18418191275", dataIso: "2026-07-11",
}

test("montarValuesSolicitacao espelha o nó Preparar Solicitação", () => {
  const v = montarValuesSolicitacao(solicitacaoInput) as Record<string, unknown>
  assert.deepEqual(v["dropdown_mkwhxxs2"], { labels: ["CAJU", "CAJU VT"] })
  assert.deepEqual(v["dropdown_mkretdvv"], { labels: ["TRE PB"] })
  assert.deepEqual(v["date_mkrer5tv"], { date: "2026-07-11" })
  assert.deepEqual(v["status"], { label: "NÃO INICIADO" })
  assert.deepEqual(v["color_mkref5wt"], { label: "MENSAL" })
  assert.deepEqual(v["color_mks0yady"], { label: "JULHO" })
  assert.equal(v["numeric_mkrek29b"], "660")
  assert.equal(v["numeric_mkwhk2xr"], "250.7")
  assert.equal(v["text_mkrenhm"], "555")
  assert.equal(v["text_mm1zyhcw"], "ord-p") // PIX tem prioridade
  assert.equal(v["text_mm395p8s"], "sp")
  assert.deepEqual(v["link_mkre40qn"], { url: "https://contato-serv.monday.com/boards/18418191275", text: "Plan Intermitentes" })
})

test("resumo lista pessoas com itens do Plan", () => {
  const r = montarResumoSolicitacao(solicitacaoInput)
  assert.ok(r.startsWith("MENSAL AGRUPADO - TRE PB - JULHO/2026"))
  assert.ok(r.includes("01. Fulana | Chapa: 006534"))
  assert.ok(r.includes("Plan: 1, 2"))
  assert.ok(r.includes("RM idVR: 555 | idVT: -"))
})

test("VT zerado não gera label CAJU VT", () => {
  const v = montarValuesSolicitacao({ ...solicitacaoInput, totais: { ...solicitacaoInput.totais, vt: 0 } }) as Record<string, unknown>
  assert.deepEqual(v["dropdown_mkwhxxs2"], { labels: ["CAJU"] })
})

test("saldoAnteriorControleCaju: último item preenchido, entrada+aporte-débito", () => {
  const item = (e: string, a: string, d: string) => ({ column_values: [
    { id: "n_meros__1", text: e }, { id: "n_meros5__1", text: a }, { id: "n_meros9__1", text: d },
  ] })
  assert.equal(saldoAnteriorControleCaju([item("100", "50", "30"), item("120", "0", "20")]), 100)
  assert.equal(saldoAnteriorControleCaju([item("1.234,56", "", "234,56")]), 1000)
  assert.equal(saldoAnteriorControleCaju([{ column_values: [] }]), 0)
  assert.equal(saldoAnteriorControleCaju([]), 0)
})

test("nome e values do débito Controle Caju", () => {
  assert.equal(montarNomeDebitoControle("TRE PB", "JULHO", 2026, "ord-1"), "MENSAL - TRE PB - JULHO/2026 - ord-1")
  assert.equal(montarNomeDebitoControle("TRE PB", "JULHO", 2026, null), "MENSAL - TRE PB - JULHO/2026")
  const v = montarValuesDebitoControle("TRE PB", 500, 98.7, "2026-07-11")
  assert.deepEqual(v["color_mkpef3mp"], { label: "TRE PB" })
  assert.equal(v["n_meros__1"], "500")
  assert.equal(v["n_meros9__1"], "98.7")
  assert.deepEqual(v["dup__of_data_do_cr_dito__1"], { date: "2026-07-11" })
  assert.deepEqual(v["status3__1"], { label: "INTERMITENTE" })
})
