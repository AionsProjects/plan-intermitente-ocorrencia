import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CORTE_PAGAMENTO_HORA,
  dataPagamentoSolicitacao,
  diaManaus,
  ehDiaUtilBancario,
  horaManaus,
  proximoDiaUtilBancario,
} from "./dataPagamento.js"

// Manaus = UTC-4 o ano inteiro (sem horário de verão).

test("dia e hora saem em Manaus, não em UTC", () => {
  // 2026-09-17T02:00Z ainda é 16/09 22h em Manaus — o dia UTC já virou, o de Manaus não.
  assert.equal(diaManaus(new Date("2026-09-17T02:00:00Z")), "2026-09-16")
  assert.equal(horaManaus(new Date("2026-09-17T02:00:00Z")), 22)
  // Meia-noite de Manaus tem de ser 0, não 24 (o "24" mandaria a madrugada pro dia seguinte).
  assert.equal(horaManaus(new Date("2026-09-17T04:00:00Z")), 0)
})

test("antes do corte paga no mesmo dia", () => {
  // Quinta 17/09/2026, 13:59 em Manaus.
  assert.equal(dataPagamentoSolicitacao(new Date("2026-09-17T17:59:00Z")), "2026-09-17")
})

test("a partir do corte vai pro dia seguinte", () => {
  // Quinta 17/09/2026, 14:00 em Manaus — o corte é inclusive.
  assert.equal(dataPagamentoSolicitacao(new Date("2026-09-17T18:00:00Z")), "2026-09-18")
  // 17:30 de Manaus = 21:30Z, mesmo dia.
  assert.equal(dataPagamentoSolicitacao(new Date("2026-09-17T21:30:00Z")), "2026-09-18")
})

test("depois do corte na sexta pula o fim de semana", () => {
  // Sexta 18/09/2026, 15h em Manaus.
  assert.equal(dataPagamentoSolicitacao(new Date("2026-09-18T19:00:00Z")), "2026-09-21")
})

test("sábado de manhã também não é pago no sábado", () => {
  // Sábado 19/09/2026, 09h em Manaus — antes do corte, mas banco fechado.
  assert.equal(dataPagamentoSolicitacao(new Date("2026-09-19T13:00:00Z")), "2026-09-21")
})

test("feriado nacional é pulado", () => {
  // 06/10/2026 é terça; 12/10 (N. Sra. Aparecida) cai numa segunda.
  assert.equal(ehDiaUtilBancario("2026-10-12"), false)
  assert.equal(proximoDiaUtilBancario("2026-10-12"), "2026-10-13")
  // Sexta 09/10 depois do corte → sábado/domingo/feriado → terça 13.
  assert.equal(dataPagamentoSolicitacao(new Date("2026-10-09T19:00:00Z")), "2026-10-13")
})

test("corte configurável", () => {
  const quinta13h = new Date("2026-09-17T17:00:00Z")
  assert.equal(dataPagamentoSolicitacao(quinta13h, 12), "2026-09-18")
  assert.equal(dataPagamentoSolicitacao(quinta13h, CORTE_PAGAMENTO_HORA), "2026-09-17")
})
