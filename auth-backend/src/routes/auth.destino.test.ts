// Guard de open-redirect do `?next=`, no SERVIDOR.
//
// O front tem o espelho em src/lib/proximaUrl.ts, mas validação que só existe no
// cliente não é validação: o cookie `pi_oauth_next` é lido e usado pelo backend pra
// montar o redirect final do OAuth. Sem este guard, `/login?next=https://phishing/`
// levaria a pessoa pra fora DEPOIS de autenticar — com a sessão já criada.
//
// O front não tem test runner configurado (só eslint + tsc), então o teste do par vive
// aqui, que é onde a garantia importa.
import { test } from "node:test"
import assert from "node:assert/strict"
import { destinoSeguro } from "./auth.js"

test("aceita caminho relativo do proprio app", () => {
  assert.equal(destinoSeguro("/atividade"), "/atividade")
  assert.equal(destinoSeguro("/atividade?exec=abc-123"), "/atividade?exec=abc-123")
  assert.equal(destinoSeguro("/atividade?exec=abc#e:48213"), "/atividade?exec=abc#e:48213")
})

test("recusa URL absoluta", () => {
  assert.equal(destinoSeguro("https://evil.com"), null)
  assert.equal(destinoSeguro("http://evil.com/x"), null)
})

test("recusa protocol-relative (//host)", () => {
  // O caso clássico: `//evil.com` é URL absoluta pro navegador, mas começa com "/".
  assert.equal(destinoSeguro("//evil.com"), null)
  assert.equal(destinoSeguro("//evil.com/atividade"), null)
})

test("recusa a variante com barra invertida", () => {
  // Alguns navegadores normalizam `/\host` como protocol-relative.
  assert.equal(destinoSeguro("/\\evil.com"), null)
})

test("recusa esquema disfarcado de caminho", () => {
  assert.equal(destinoSeguro("javascript:alert(1)"), null)
  assert.equal(destinoSeguro("/javascript:alert(1)"), null)
  assert.equal(destinoSeguro("/data:text/html,x"), null)
})

test("recusa vazio e nulo", () => {
  assert.equal(destinoSeguro(""), null)
  assert.equal(destinoSeguro(null), null)
  assert.equal(destinoSeguro(undefined), null)
})

test("corta destino absurdamente longo", () => {
  const longo = "/atividade?q=" + "a".repeat(2000)
  assert.equal(destinoSeguro(longo)?.length, 512)
})
