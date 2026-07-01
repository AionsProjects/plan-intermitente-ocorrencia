import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isFeriadoNacional,
  nomeFeriadoNacional,
  recebeFeriado,
  isFeriado,
  nomeFeriado,
  norm,
  type Feriado,
} from "./feriado.js"

test("feriados nacionais fixos", () => {
  assert.equal(isFeriadoNacional("2026-01-01"), true)
  assert.equal(isFeriadoNacional("2026-04-21"), true) // Tiradentes
  assert.equal(isFeriadoNacional("2026-12-25"), true)
  assert.equal(isFeriadoNacional("2026-11-20"), true) // Consciência Negra
  assert.equal(isFeriadoNacional("2026-06-30"), false)
  assert.equal(nomeFeriadoNacional("2026-09-07"), "Independência do Brasil")
})

test("Sexta-feira Santa (Páscoa via Meeus)", () => {
  // Páscoa 2026 = 05/abr -> Santa = 03/abr ; 2025 = 20/abr -> Santa = 18/abr
  assert.equal(isFeriadoNacional("2026-04-03"), true)
  assert.equal(nomeFeriadoNacional("2026-04-03"), "Sexta-feira Santa")
  assert.equal(isFeriadoNacional("2025-04-18"), true)
  assert.equal(nomeFeriadoNacional("2025-04-18"), "Sexta-feira Santa")
})

test("norm sem acento/maiúsculo", () => {
  assert.equal(norm("Seduc  Interior"), "SEDUC INTERIOR")
  assert.equal(norm("Detran"), "DETRAN")
})

test("recebeFeriado: SEDUC* e DETRAN recebem (não bloqueiam)", () => {
  assert.equal(recebeFeriado("SEDUC SEDE"), true)
  assert.equal(recebeFeriado("SEDUC INTERIOR"), true)
  assert.equal(recebeFeriado("DETRAN"), true)
  assert.equal(recebeFeriado("TRE PB"), false)
  assert.equal(recebeFeriado("CETAM"), false)
  assert.equal(recebeFeriado(null), false)
})

test("isFeriado efetivo: DETRAN/SEDUC não bloqueiam no nacional", () => {
  // sem lista -> fallback nacional
  assert.equal(isFeriado("2026-01-01", "CETAM"), true)
  assert.equal(isFeriado("2026-01-01", "DETRAN"), false) // recebe
  assert.equal(isFeriado("2026-01-01", "SEDUC SEDE"), false) // recebe
  assert.equal(isFeriado("2026-06-30", "CETAM"), false) // dia comum
})

test("isFeriado com board: ESTADUAL só pro contrato na lista", () => {
  const lista: Feriado[] = [
    { data: "2026-06-24", nome: "São João", tipo: "ESTADUAL", contratos: ["TRE PB"] },
    { data: "2026-01-01", nome: "Ano Novo", tipo: "NACIONAL", contratos: [] },
  ]
  // estadual aplica ao TRE PB
  assert.equal(isFeriado("2026-06-24", "TRE PB", lista), true)
  assert.equal(nomeFeriado("2026-06-24", "TRE PB", lista), "São João")
  // mesmo dia, contrato fora da lista -> não bloqueia
  assert.equal(isFeriado("2026-06-24", "CETAM", lista), false)
  // nacional do board aplica a todos
  assert.equal(isFeriado("2026-01-01", "CETAM", lista), true)
  // mas DETRAN recebe mesmo no nacional do board
  assert.equal(isFeriado("2026-01-01", "DETRAN", lista), false)
})
