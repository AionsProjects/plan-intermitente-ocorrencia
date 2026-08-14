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
