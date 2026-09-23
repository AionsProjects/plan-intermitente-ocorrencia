// Helpers do RM no pontual. Puros — sem RM, sem banco.
import { test } from "node:test"
import assert from "node:assert/strict"
import { classificarLancamentosIdfinanc } from "./rmPontual.js"

// ---------------------------------------------------------------------------
// classificarLancamentosIdfinanc — o caso real de 14/08
// ---------------------------------------------------------------------------

// Os 4 lançamentos que a consulta IDFNAN devolveu pra seção 01.01.0085 em 14/08.
const LANCAMENTOS_14_08 = [
  { IDFINANC: 24285, VALORORIGINAL: 245, tipoEvento: "VR" }, // TRIMEIA (11:45)
  { IDFINANC: 24286, VALORORIGINAL: 130, tipoEvento: "VT" }, // TRIMEIA
  { IDFINANC: 24290, VALORORIGINAL: 49, tipoEvento: "VR" },  // MÁRCIA  (12:25)
  { IDFINANC: 24291, VALORORIGINAL: 20, tipoEvento: "VT" },  // MÁRCIA
]

test("MÁRCIA integra só os dela; os da TRIMEIA saem como divergentes", () => {
  // Toda a SEMSA compartilha a seção, então a run da MÁRCIA VÊ os lançamentos da TRIMEIA.
  // Integrar "todos os que apareceram" lançaria o boleto de uma na conta da outra.
  const r = classificarLancamentosIdfinanc(LANCAMENTOS_14_08, { VR: 49, VT: 20 })
  assert.deepEqual(r.integrar.map((x) => x.IDFINANC), [24290, 24291])
  assert.deepEqual(r.divergentes.map((x) => x.IDFINANC), [24285, 24286])
})

test("TRIMEIA (primeira do dia) integra os dela, zero divergente", () => {
  const soDela = LANCAMENTOS_14_08.slice(0, 2)
  const r = classificarLancamentosIdfinanc(soDela, { VR: 245, VT: 130 })
  assert.deepEqual(r.integrar.map((x) => x.IDFINANC), [24285, 24286])
  assert.equal(r.divergentes.length, 0)
})

test("tolerância de ±0,05 no float do RM", () => {
  const rows = [
    { IDFINANC: 1, VALORORIGINAL: 49.04, tipoEvento: "VR" },
    { IDFINANC: 2, VALORORIGINAL: 49.06, tipoEvento: "VR" },
  ]
  const r = classificarLancamentosIdfinanc(rows, { VR: 49, VT: 0 })
  assert.deepEqual(r.integrar.map((x) => x.IDFINANC), [1])
  assert.deepEqual(r.divergentes.map((x) => x.IDFINANC), [2])
})

test("benefício que este pagamento NÃO tem é ignorado, não integrado", () => {
  // Pagamento só de VR não pode casar com VT alheio — nem com um VT de valor zero.
  const rows = [
    { IDFINANC: 10, VALORORIGINAL: 49, tipoEvento: "VR" },
    { IDFINANC: 11, VALORORIGINAL: 0, tipoEvento: "VT" },
    { IDFINANC: 12, VALORORIGINAL: 130, tipoEvento: "VT" },
  ]
  const r = classificarLancamentosIdfinanc(rows, { VR: 49, VT: 0 })
  assert.deepEqual(r.integrar.map((x) => x.IDFINANC), [10])
  assert.equal(r.divergentes.length, 0, "VT não pedido nem entra como divergente")
})

test("linha sem tipoEvento ou sem VALORORIGINAL", () => {
  const rows = [
    { IDFINANC: 20, VALORORIGINAL: 49, tipoEvento: undefined },
    { IDFINANC: 21, tipoEvento: "VR" }, // sem valor: integra (comportamento herdado do WF5)
  ]
  const r = classificarLancamentosIdfinanc(rows, { VR: 49, VT: 20 })
  assert.deepEqual(r.integrar.map((x) => x.IDFINANC), [21])
  assert.equal(r.divergentes.length, 0)
})

// ---------------------------------------------------------------------------
// Onde está o lançamento — caso real LINCON, 15/09/2026
// ---------------------------------------------------------------------------
import { soLancamentosDoPontual, secoesParaProcurar, escolherSecaoDoLancamento } from "./rmPontual.js"

test("soLancamentosDoPontual: só DIARIO — mensal, CLT e cesta da mesma seção/dia ficam de fora", () => {
  const rows = [
    { IDFINANC: 24544, HISTORICO: "CAJU VR  - INTERMITENTE - DIARIO - SEDUC - INTER" },
    { IDFINANC: 24549, HISTORICO: "CAJU VR  - CLT - MENSAL - SEDUC - ESCOLA" },
    { IDFINANC: 24579, HISTORICO: "CAJU VR  - INTERMITENTE - MENSAL - SEDUC - INT" },
    { IDFINANC: 24662, HISTORICO: "CAJU CESTA  - CLT - MENSAL -" },
    { IDFINANC: 24694, HISTORICO: "CAJU VR  - INTERMITENTE - DIARIO -" },
  ]
  assert.deepEqual(soLancamentosDoPontual(rows).map((r) => r.IDFINANC), [24544, 24694])
})

test("secoesParaProcurar: a esperada primeiro, sem repetir", () => {
  const s = secoesParaProcurar("01.01.0007")
  assert.equal(s[0], "01.01.0007")
  assert.equal(s.filter((x) => x === "01.01.0007").length, 1)
  assert.ok(s.includes("01.01.0085") && s.includes("01.01.0011"))
  assert.equal(secoesParaProcurar("")[0], "01.01.0085")
})

test("escolherSecaoDoLancamento: LINCON — nada na 0085, par completo na 0007", () => {
  // 15/09 15:08: a run procurou em 0085 (seção do contrato) e o lançamento nasceu em 0007.
  const escolha = escolherSecaoDoLancamento([
    { secao: "01.01.0011", novos: [] },
    { secao: "01.01.0007", novos: [
      { IDFINANC: 24694, VALORORIGINAL: 147, tipoEvento: "VR" },
      { IDFINANC: 24695, VALORORIGINAL: 60, tipoEvento: "VT" },
    ] },
  ], { VR: 147, VT: 60 })
  assert.deepEqual(escolha, { secao: "01.01.0007" })
})

test("escolherSecaoDoLancamento: valor solto em outra seção NÃO basta — precisa do par", () => {
  // Um VT de R$ 60 qualquer numa seção, sem o VR do mesmo pagamento: coincidência, não o nosso.
  assert.equal(escolherSecaoDoLancamento([
    { secao: "01.01.0085", novos: [{ IDFINANC: 1, VALORORIGINAL: 60, tipoEvento: "VT" }] },
  ], { VR: 147, VT: 60 }), null)
  // Pagamento só de VT: um VT basta.
  assert.deepEqual(escolherSecaoDoLancamento([
    { secao: "01.01.0085", novos: [{ IDFINANC: 2, VALORORIGINAL: 10, tipoEvento: "VT" }] },
  ], { VR: 0, VT: 10 }), { secao: "01.01.0085" })
})

test("escolherSecaoDoLancamento: duas seções cobrindo = ambíguo, nunca chuta", () => {
  const par = (a: number, b: number) => [
    { IDFINANC: a, VALORORIGINAL: 73.5, tipoEvento: "VR" }, { IDFINANC: b, VALORORIGINAL: 30, tipoEvento: "VT" }]
  assert.deepEqual(escolherSecaoDoLancamento([
    { secao: "01.01.0011", novos: par(1, 2) }, { secao: "01.01.0007", novos: par(3, 4) },
  ], { VR: 73.5, VT: 30 }), { ambiguo: ["01.01.0011", "01.01.0007"] })
})
