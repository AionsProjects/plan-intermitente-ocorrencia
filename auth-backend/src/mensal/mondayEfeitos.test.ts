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
  beneficiosDaSolicitacao, montarNomeSolicitacaoMensal,
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
  idVR: "555", idVT: null,
  pedidoCreditoVR: "ord-cvr", pedidoCreditoVT: null,
  pedidoPixVR: "ord-pvr", pedidoPixVT: "ord-pvt",
  planBoardId: "18418191275", dataIso: "2026-07-11",
}

test("solicitação: uma linha por benefício, cada uma só com as colunas dela", () => {
  assert.deepEqual(beneficiosDaSolicitacao(solicitacaoInput), ["VR", "VT"])

  const vr = montarValuesSolicitacao(solicitacaoInput, "VR") as Record<string, unknown>
  const vt = montarValuesSolicitacao(solicitacaoInput, "VT") as Record<string, unknown>

  // Colunas comuns: iguais nas duas linhas — é o mesmo pagamento, do mesmo contrato.
  for (const v of [vr, vt]) {
    assert.deepEqual(v["dropdown_mkretdvv"], { labels: ["TRE PB"] })
    assert.deepEqual(v["date_mkrer5tv"], { date: "2026-07-11" })
    assert.deepEqual(v["status"], { label: "NÃO INICIADO" })
    assert.deepEqual(v["color_mkref5wt"], { label: "MENSAL" })
    assert.deepEqual(v["color_mks0yady"], { label: "JULHO" })
    assert.deepEqual(v["link_mkre40qn"], { url: "https://contato-serv.monday.com/boards/18418191275", text: "Plan Intermitentes" })
  }

  // Tipo pgto: UMA label por linha. As duas juntas no mesmo item morreram com o split.
  assert.deepEqual(vr["dropdown_mkwhxxs2"], { labels: ["CAJU"] })
  assert.deepEqual(vt["dropdown_mkwhxxs2"], { labels: ["CAJU VT"] })

  // VALOR CAJU / VALOR CAJU VT vão na base do PIX (pós-crédito), igual ao RM e ao boleto —
  // não em totais.vr/vt, que são pré-crédito. Fixture: 660 - 66 = 594 e 250,70 - 32,70 = 218.
  assert.equal(vr["numeric_mkrek29b"], "594")
  assert.equal(vr["numeric_mkwhk2xr"], undefined, "linha de VR não escreve a coluna do VT")
  assert.equal(vt["numeric_mkwhk2xr"], "218")
  assert.equal(vt["numeric_mkrek29b"], undefined, "linha de VT não escreve a coluna do VR")

  // IDFINANC do RM: cada linha carrega só o evento dela.
  assert.equal(vr["text_mkrenhm"], "555")
  assert.equal(vr["text_mkwhg4dn"], undefined)
  assert.equal(vt["text_mkwhg4dn"], "")
  assert.equal(vt["text_mkrenhm"], undefined)

  // Id do pedido: UM por linha. O "; " na mesma célula era do tempo do item único; segue valendo
  // para IDFINANC, que pode ser lista de verdade (um PFINANCEIRO por seção).
  // O pedido de crédito não entra na coluna (nasce Rascunho, não confirmado).
  assert.equal(vr["text_mm1zyhcw"], "ord-pvr")
  assert.equal(vt["text_mm1zyhcw"], "ord-pvt")
  assert.equal(vr["text_mm395p8s"], "https://empresa.caju.com.br/classic/#/order/ord-pvr/summary")
  assert.equal(vt["text_mm395p8s"], "https://empresa.caju.com.br/classic/#/order/ord-pvt/summary")
})

test("nome do item carrega o benefício — senão o board fica com dois itens iguais", () => {
  assert.equal(montarNomeSolicitacaoMensal(solicitacaoInput, "VR"), "TRE PB - VR")
  assert.equal(montarNomeSolicitacaoMensal(solicitacaoInput, "VT"), "TRE PB - VT")
  assert.equal(
    montarNomeSolicitacaoMensal({ ...solicitacaoInput, nomePrefixo: "TESTE - " }, "VT"),
    "TESTE - TRE PB - VT",
  )
})

test("VALOR CAJU fica na base do RM/boleto — caso real DETRAN 08/2026", () => {
  // Run 672eb8ee: o board recebeu 4.481,05 (pré-crédito) enquanto o IDFINANC 24096 do RM levou
  // 4.032,70. A diferença era exatamente o crédito (448,35), e o DP corrigia à mão.
  // Com o teto do dia 31, o VR correto cai pra 4.331,60 e o PIX pra 3.883,25 — o número que a
  // Thifany digitou no board em 06/08.
  const detran = {
    ...solicitacaoInput, contrato: "DETRAN", competenciaLabel: "AGOSTO",
    totais: { vr: 4331.6, vt: 630, credito: 448.35, pix: 4513.25 },
    pessoas: [
      { ...solicitacaoInput.pessoas[0]!, liquidoVR: 4331.6, liquidoVT: 630,
        creditoVR: 448.35, creditoVT: 0, pixVR: 3883.25, pixVT: 630 },
    ],
  }
  const vr = montarValuesSolicitacao(detran, "VR") as Record<string, unknown>
  const vt = montarValuesSolicitacao(detran, "VT") as Record<string, unknown>
  assert.equal(vr["numeric_mkrek29b"], "3883.25")
  assert.equal(vt["numeric_mkwhk2xr"], "630")
  // As duas LINHAS somam o boleto, que é o que a Caju cobra. O split mudou empacotamento, não valor.
  assert.equal(Number(vr["numeric_mkrek29b"]) + Number(vt["numeric_mkwhk2xr"]), 4513.25)
})

test("VALOR CAJU: contrato cujo VR coube todo no crédito vai a zero, mas segue rotulado CAJU", () => {
  const tudoCredito = {
    ...solicitacaoInput,
    totais: { vr: 58.8, vt: 0, credito: 58.8, pix: 0 },
    pessoas: [{ ...solicitacaoInput.pessoas[0]!, liquidoVR: 58.8, liquidoVT: 0,
      creditoVR: 58.8, creditoVT: 0, pixVR: 0, pixVT: 0 }],
  }
  // A LINHA existe mesmo com boleto zero — o critério é o benefício apurado, não o que sobra pro
  // boleto. Sumir do board o pagamento que coube inteiro no crédito seria perder o rastro.
  assert.deepEqual(beneficiosDaSolicitacao(tudoCredito), ["VR"])
  const v = montarValuesSolicitacao(tudoCredito, "VR") as Record<string, unknown>
  assert.equal(v["numeric_mkrek29b"], "0")
  assert.deepEqual(v["dropdown_mkwhxxs2"], { labels: ["CAJU"] })
})

test("coluna de pedido fica vazia na linha cujo benefício não gerou boleto", () => {
  const v = montarValuesSolicitacao({ ...solicitacaoInput, pedidoPixVR: null }, "VR") as Record<string, unknown>
  assert.equal(v["text_mm1zyhcw"], "")
  assert.equal(v["text_mm395p8s"], "")
  // E a linha do VT continua com o id dela — uma não contamina a outra.
  const vt = montarValuesSolicitacao({ ...solicitacaoInput, pedidoPixVR: null }, "VT") as Record<string, unknown>
  assert.equal(vt["text_mm1zyhcw"], "ord-pvt")
})

test("coluna de pedido fica vazia quando nenhum boleto saiu", () => {
  const semBoleto = { ...solicitacaoInput, pedidoPixVR: null, pedidoPixVT: null }
  for (const b of ["VR", "VT"] as const) {
    const v = montarValuesSolicitacao(semBoleto, b) as Record<string, unknown>
    assert.equal(v["text_mm1zyhcw"], "")
    assert.equal(v["text_mm395p8s"], "")
  }
})

test("resumo lista pessoas com itens do Plan", () => {
  const r = montarResumoSolicitacao(solicitacaoInput, "VR")
  assert.ok(r.startsWith("MENSAL AGRUPADO VR - TRE PB - JULHO/2026"))
  assert.ok(r.includes("01. Fulana | Chapa: 006534"))
  assert.ok(r.includes("Plan: 1, 2"))
  assert.ok(r.includes("RM idVR: 555 | idVT: -"))
  // Os 4 ids ficam no texto livre — é o único lugar com o rastro do crédito.
  assert.ok(r.includes("Pedido Crédito VR: ord-cvr | VT: -"))
  assert.ok(r.includes("Pedido PIX VR: ord-pvr | VT: ord-pvt"))
})

test("VT zerado não gera linha de VT no board", () => {
  const semVT = { ...solicitacaoInput, totais: { ...solicitacaoInput.totais, vt: 0 } }
  assert.deepEqual(beneficiosDaSolicitacao(semVT), ["VR"])
  const v = montarValuesSolicitacao(semVT, "VR") as Record<string, unknown>
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
