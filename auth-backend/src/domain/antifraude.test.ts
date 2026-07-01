import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addDays,
  effectivePeriod,
  overlaps,
  acharConflito,
  type ConvocacaoExistente,
} from "./antifraude.js"

test("addDays", () => {
  assert.equal(addDays("2026-06-01", -1), "2026-05-31")
  assert.equal(addDays("2026-06-30", 1), "2026-07-01")
})

test("overlaps", () => {
  assert.equal(overlaps("2026-06-01", "2026-06-10", "2026-06-05", "2026-06-15"), true)
  assert.equal(overlaps("2026-06-01", "2026-06-10", "2026-06-11", "2026-06-15"), false)
  assert.equal(overlaps("2026-06-01", "2026-06-10", "2026-06-10", "2026-06-20"), true) // borda
})

test("effectivePeriod: cancelada/bloqueada = null", () => {
  assert.equal(effectivePeriod("2026-06-01", "2026-06-10", "Cancelada", null), null)
  assert.equal(effectivePeriod("2026-06-01", "2026-06-10", "Bloqueada - conflito", null), null)
})

test("effectivePeriod: válida = período cheio", () => {
  assert.deepEqual(effectivePeriod("2026-06-01", "2026-06-10", "Válida", null), {
    start: "2026-06-01", end: "2026-06-10",
  })
})

test("effectivePeriod: parcial trunca até cancelInicio-1", () => {
  assert.deepEqual(
    effectivePeriod("2026-06-01", "2026-06-10", "Cancelada parcialmente", "2026-06-06"),
    { start: "2026-06-01", end: "2026-06-05" },
  )
  // cancelInicio no 1º dia -> effectiveEnd < start -> null (nada bloqueia)
  assert.equal(
    effectivePeriod("2026-06-01", "2026-06-10", "Cancelada parcialmente", "2026-06-01"),
    null,
  )
})

test("acharConflito: ignora cancelada, pega válida sobreposta", () => {
  const existentes: ConvocacaoExistente[] = [
    { itemId: "1", dataInicio: "2026-06-01", dataFim: "2026-06-05", statusConvocacao: "Cancelada", cancelamentoInicio: null },
    { itemId: "2", dataInicio: "2026-06-08", dataFim: "2026-06-12", statusConvocacao: "Válida", cancelamentoInicio: null },
  ]
  // novo período sobrepõe item 2
  const c = acharConflito({ dataInicio: "2026-06-10", dataFim: "2026-06-15" }, existentes)
  assert.equal(c?.itemId, "2")
  // novo período só toca a cancelada (item 1) -> sem conflito
  assert.equal(acharConflito({ dataInicio: "2026-06-02", dataFim: "2026-06-04" }, existentes), null)
})

test("acharConflito: parcial só bloqueia o trecho válido", () => {
  const existentes: ConvocacaoExistente[] = [
    { itemId: "9", dataInicio: "2026-06-01", dataFim: "2026-06-20", statusConvocacao: "Cancelada parcialmente", cancelamentoInicio: "2026-06-10" },
  ]
  // efetivo = 01..09. novo 05..07 conflita
  assert.equal(acharConflito({ dataInicio: "2026-06-05", dataFim: "2026-06-07" }, existentes)?.itemId, "9")
  // novo 12..15 cai no trecho cancelado -> sem conflito
  assert.equal(acharConflito({ dataInicio: "2026-06-12", dataFim: "2026-06-15" }, existentes), null)
})
