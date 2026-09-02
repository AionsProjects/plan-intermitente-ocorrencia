import { test } from "node:test"
import assert from "node:assert/strict"
import { ehFatal, ehPendenciaDeEfeito, mensagemErro } from "./erros.js"

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

test("ehFatal: convocação que exige decisão do DP não degrada", () => {
  assert.equal(ehFatal({ name: "FatalError", message: "qualquer" }), true)
  assert.equal(ehFatal(new Error("convocacao_rm_requer_decisao_dp")), true)
})

test("efeito pendente DEGRADA — a guarda segue, o contrato é que não cai junto (31/08)", () => {
  const pend = new Error("efeito_pendente_requer_conciliacao:rm_integrar")
  assert.equal(ehPendenciaDeEfeito(pend), true)
  assert.equal(ehFatal(pend), false, "não pode derrubar o contrato")
  // Também chega serializado, como FatalError sem classe.
  const serializado = { name: "FatalError", message: "efeito_pendente_requer_conciliacao:rm_idfinanc:24544" }
  assert.equal(ehPendenciaDeEfeito(serializado), true)
  assert.equal(ehFatal(serializado), false)
  // E não confunde com qualquer outra coisa.
  assert.equal(ehPendenciaDeEfeito(new Error("fetch failed")), false)
})

test("ehFatal: RM fora do ar NÃO é fatal — é o caso que vira pendência", () => {
  assert.equal(ehFatal(new Error("RM /executar-processo-rm timeout apos 120000ms — desfecho DESCONHECIDO no RM")), false)
  assert.equal(ehFatal({ name: "Error", message: "fetch failed" }), false)
  assert.equal(ehFatal(new Error("RM /consultar-rm HTTP 502")), false)
})

// O pontual passou a usar a MESMA classificação (02/09/2026), então as mensagens dele entram aqui.
test("ehFatal: mensagens do pontual — RM degrada, guarda de dinheiro não", () => {
  for (const msg of [
    "efeito_pendente_requer_conciliacao:rm_integrar",
    "efeito_pendente_requer_conciliacao:rm_idfinanc:24594",
  ]) {
    assert.equal(ehFatal({ name: "FatalError", message: msg }), false, `${msg} tem de degradar`)
  }
  // Guardas que precisam parar o pagamento ANTES de gravar board, Drive ou notas.
  for (const msg of [
    "caju_chave_antiga_colide_com_split:pontual:12951063085:caju_credito_vr",
    "item_nao_existe_no_monday",
    "convocacao_cancelada",
  ]) {
    assert.equal(ehFatal({ name: "FatalError", message: msg }), true, `${msg} NÃO pode degradar`)
  }
})

