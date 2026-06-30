// Testes PUROS dos helpers de parsing do client Monday (sem rede).
// Rodar: npm test  (node --import tsx --test)
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  indexarColunas,
  texto,
  dataApenas,
  timestamp,
  boolSim,
  numero,
  jsonParse,
  idDeLink,
} from "./monday.parse.js"

test("indexarColunas indexa por id", () => {
  const cv = indexarColunas([
    { id: "a", text: "x", value: null },
    { id: "b", text: null, value: "1" },
  ])
  assert.equal(cv.a!.text, "x")
  assert.equal(cv.b!.value, "1")
  assert.equal(texto(cv, "a"), "x")
  assert.equal(texto(cv, "inexistente"), null)
})

test("dataApenas corta hora", () => {
  assert.equal(dataApenas("2026-06-30 17:00:00"), "2026-06-30")
  assert.equal(dataApenas("2026-06-30"), "2026-06-30")
  assert.equal(dataApenas(null), null)
})

test("timestamp vira ISO", () => {
  assert.equal(timestamp("2026-06-30 17:00:00"), "2026-06-30T17:00:00")
  assert.equal(timestamp(null), null)
})

test("boolSim", () => {
  assert.equal(boolSim("SIM"), true)
  assert.equal(boolSim("Sim "), true)
  assert.equal(boolSim("NÃO"), false)
  assert.equal(boolSim("qualquer"), false)
  assert.equal(boolSim(null), null)
})

test("numero trata vírgula decimal e vazio", () => {
  assert.equal(numero("12,5"), 12.5)
  assert.equal(numero("1234.56"), 1234.56)
  assert.equal(numero(""), null)
  assert.equal(numero(null), null)
  assert.equal(numero("abc"), null)
})

test("jsonParse seguro", () => {
  assert.deepEqual(jsonParse('{"a":1}'), { a: 1 })
  assert.deepEqual(jsonParse("[1,2]"), [1, 2])
  assert.equal(jsonParse("não é json"), null)
  assert.equal(jsonParse(null), null)
})

test("idDeLink extrai pulse id de várias formas", () => {
  const cv = indexarColunas([
    { id: "l1", text: null, value: '{"url":"https://x.monday.com/boards/123/pulses/18408773953"}' },
    { id: "l2", text: "https://x.monday.com/boards/1/pulses/99999999", value: null },
    { id: "l3", text: null, value: null },
  ])
  assert.equal(idDeLink(cv, "l1"), 18408773953)
  assert.equal(idDeLink(cv, "l2"), 99999999)
  assert.equal(idDeLink(cv, "l3"), null)
})
