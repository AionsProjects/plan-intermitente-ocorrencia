import { test } from "node:test"
import assert from "node:assert/strict"
import { ehFatal, mensagemErro } from "./erros.js"

test("mensagemErro: Error normal", () => {
  assert.equal(mensagemErro(new Error("RM /consultar-rm timeout apos 30000ms")), "RM /consultar-rm timeout apos 30000ms")
})

test("mensagemErro: erro SERIALIZADO pelo step — o caso que virava erro_desconhecido", () => {
  assert.equal(mensagemErro({ name: "Error", message: "fetch failed" }), "fetch failed")
  assert.equal(mensagemErro({ errorName: "Error", errorMessage: "socket hang up" }), "socket hang up")
  // Só o nome, sem mensagem: melhor que "erro_desconhecido".
  assert.equal(mensagemErro({ name: "TimeoutError" }), "TimeoutError")
})

test("mensagemErro: string crua e objeto opaco", () => {
  assert.equal(mensagemErro("boom"), "boom")
  assert.equal(mensagemErro({ codigo: 500 }), '{"codigo":500}')
  assert.equal(mensagemErro(null), "erro_desconhecido")
  assert.equal(mensagemErro({}), "erro_desconhecido")
})

test("ehFatal: exige gente — não degrada para pendência", () => {
  assert.equal(ehFatal({ name: "FatalError", message: "qualquer" }), true)
  assert.equal(ehFatal(new Error("efeito_pendente_requer_conciliacao:rm_integrar")), true)
  assert.equal(ehFatal(new Error("convocacao_rm_requer_decisao_dp")), true)
})

test("ehFatal: RM fora do ar NÃO é fatal — é o caso que vira pendência", () => {
  assert.equal(ehFatal(new Error("RM /executar-processo-rm timeout apos 120000ms — desfecho DESCONHECIDO no RM")), false)
  assert.equal(ehFatal({ name: "Error", message: "fetch failed" }), false)
  assert.equal(ehFatal(new Error("RM /consultar-rm HTTP 502")), false)
})
