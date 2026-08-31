// A assimetria leitura × escrita no timeout da ponte AIONS.
//
// O que estes testes travam é a decisão de REPETIR, não o valor do timeout: repetir uma escrita
// que estourou o tempo pode gravar duas vezes no RM, porque o AbortSignal corta o nosso lado e
// não o do RM. Foi a morte silenciosa dessa chamada (sem timeout nenhum) que deixou dois efeitos
// `pendente` no ledger em 31/08/2026.
import { test } from "node:test"
import assert from "node:assert/strict"
import { ehLeituraPonte, ehTimeout, podeRepetirAposFalha } from "./rm.js"

const timeoutErr = Object.assign(new Error("signal timed out"), { name: "TimeoutError" })
const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" })
const redeErr = new Error("fetch failed")

test("só /consultar-rm é leitura; processo, envio e delete são escrita", () => {
  assert.equal(ehLeituraPonte("/consultar-rm"), true)
  assert.equal(ehLeituraPonte("/executar-processo-rm"), false)
  assert.equal(ehLeituraPonte("/enviar-rm"), false)
  assert.equal(ehLeituraPonte("/deletar-rm"), false)
})

test("ehTimeout reconhece TimeoutError e AbortError, e só eles", () => {
  assert.equal(ehTimeout(timeoutErr), true)
  assert.equal(ehTimeout(abortErr), true)
  assert.equal(ehTimeout(redeErr), false)
  assert.equal(ehTimeout(null), false)
})

test("escrita NÃO repete depois de timeout — o RM pode ter executado", () => {
  assert.equal(podeRepetirAposFalha("/executar-processo-rm", timeoutErr), false)
  assert.equal(podeRepetirAposFalha("/enviar-rm", timeoutErr), false)
  assert.equal(podeRepetirAposFalha("/deletar-rm", abortErr), false)
})

test("escrita repete em falha que PROVA que nada executou (rede/conexão)", () => {
  assert.equal(podeRepetirAposFalha("/enviar-rm", redeErr), true)
})

test("leitura repete sempre — cair pra ponte de novo custa segundos, não dinheiro", () => {
  assert.equal(podeRepetirAposFalha("/consultar-rm", timeoutErr), true)
  assert.equal(podeRepetirAposFalha("/consultar-rm", redeErr), true)
})
