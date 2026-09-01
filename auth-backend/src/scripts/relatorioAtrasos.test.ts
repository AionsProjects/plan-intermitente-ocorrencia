// A régua do atraso (decisão do Isaac, 31/08): dias entre o INÍCIO do período e a criação.
// Convocação criada antes do período começar NÃO é atraso — e um número negativo no relatório
// leria como adiantamento, que não é o que se mede aqui.
import { test } from "node:test"
import assert from "node:assert/strict"
import { atrasoEmDias } from "../services/coletaAtividade.js"

test("atraso = dias entre o início do período e o dia da criação", () => {
  // Caso real: C03S003884, período 24–31/08, criada em 31/08.
  assert.equal(atrasoEmDias("2026-08-24", "2026-08-31"), 7)
  assert.equal(atrasoEmDias("2026-08-29", "2026-08-31"), 2)
  assert.equal(atrasoEmDias("2026-08-31", "2026-08-31"), 0, "criada no dia em que começa: em dia")
})

test("criada ANTES do período começar dá número negativo — não é atraso", () => {
  assert.equal(atrasoEmDias("2026-09-05", "2026-08-31"), -5)
})

test("aceita Date além de string (o driver do pg varia)", () => {
  assert.equal(atrasoEmDias(new Date("2026-08-24T00:00:00Z"), "2026-08-31"), 7)
})

test("atravessa a virada do mês sem erro de contagem", () => {
  assert.equal(atrasoEmDias("2026-07-28", "2026-08-02"), 5)
})
