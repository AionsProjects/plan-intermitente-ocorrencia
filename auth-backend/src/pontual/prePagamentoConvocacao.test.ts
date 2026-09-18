// `DESCONTO - VR/VT` do Plan na CRIAÇÃO da convocação.
//
// O defeito que este arquivo trava: as duas colunas só eram escritas no step `monday_plano` do
// PAGAMENTO. Enquanto o pontual disparava no `create_item`, pagar e criar eram o mesmo instante
// e ninguém notava; com o pagamento adiado pra felipeta, convocação nova passou a nascer com as
// células vazias mesmo com o FIFO já tendo reservado a dívida. Medido em 18/09/2026: LINCON com
// 196/80 no snapshot e nada no board.
import { test } from "node:test"
import assert from "node:assert/strict"
import type { PessoaCalculadaMensal } from "../mensal/calculo.js"
import { montarValuesDescontoPlano } from "./prePagamentoConvocacao.js"

const pessoa = (descontoVR: number, descontoVT: number): PessoaCalculadaMensal =>
  ({ descontoVR, descontoVT } as PessoaCalculadaMensal)

test("desconto reservado vai pras colunas do Plan", () => {
  const v = montarValuesDescontoPlano(pessoa(196, 80), {})
  assert.equal(v.numeric_mkrz4ye5, "196")
  assert.equal(v.numeric_mkrz9c4e, "80")
})

test("um benefício sem desconto sai ZERO, não vazio", () => {
  // Célula vazia e "0" leem igual pra gente e diferente pro DP: vazio é "a automação não
  // passou por aqui", zero é "passou e não havia dívida". O step do pagamento já grava 0.
  const v = montarValuesDescontoPlano(pessoa(0, 10.9), {})
  assert.equal(v.numeric_mkrz4ye5, "0")
  assert.equal(v.numeric_mkrz9c4e, "10.9")
})

test("o id vem do registry quando o board do mês renomeou a coluna", () => {
  const v = montarValuesDescontoPlano(pessoa(49, 20), {
    "DESCONTO - VR": "numeric_novo_vr",
    "DESCONTO - VT": "numeric_novo_vt",
  })
  assert.deepEqual(v, { numeric_novo_vr: "49", numeric_novo_vt: "20" })
})

test("sem pessoa não escreve nada — cálculo que falhou não zera coluna alheia", () => {
  assert.deepEqual(montarValuesDescontoPlano(undefined, {}), {})
})
