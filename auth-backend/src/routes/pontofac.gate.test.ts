// Gate de papel do Ponto Facultativo.
//
// Estas rotas nasceram como espelho dos webhooks n8n, que eram abertos, e ficaram abertas
// também — `aplicar` desconta VR/VT de TODOS os intermitentes de um contrato × unidade ×
// data. Enquanto o processo estava em modo `n8n` ninguém batia aqui; como rota primária,
// aberta na internet, é outra história.
//
// O teste vale offline de propósito: `usuarioDaSessao` devolve null SEM consultar o banco
// quando não há cookie (session.ts), então a recusa é exercitada sem Postgres, sem Monday
// e sem RM. É a checagem que precisa rodar mesmo com a infra fora.
import { test } from "node:test"
import assert from "node:assert/strict"
import { construirApp } from "../app.js"

let app: Awaited<ReturnType<typeof construirApp>>

const CORPO = { contrato: "SEMSA", unidades: ["HOSPITAL X"], data: "2026-08-20", beneficios: ["vr"] }

test("setup", async () => {
  app = await construirApp()
})

test("GET /api/ponto-facultativo-opcoes recusa sem sessao", async () => {
  const r = await app.inject({ method: "GET", url: "/api/ponto-facultativo-opcoes" })
  assert.equal(r.statusCode, 401)
  assert.equal(r.json().erro, "nao_autenticado")
})

test("POST /api/ponto-facultativo-preview recusa sem sessao", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/ponto-facultativo-preview",
    headers: { "content-type": "application/json" },
    payload: CORPO,
  })
  assert.equal(r.statusCode, 401)
  assert.equal(r.json().erro, "nao_autenticado")
})

test("POST /api/ponto-facultativo-aplicar recusa sem sessao ANTES de qualquer efeito", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/ponto-facultativo-aplicar",
    headers: { "content-type": "application/json" },
    payload: CORPO,
  })
  assert.equal(r.statusCode, 401)
  assert.equal(r.json().erro, "nao_autenticado")
  // 401 e não 500: se a recusa viesse DEPOIS de `selecionar()`, a rota teria ido ao Monday
  // antes de negar — e o teste quebraria aqui por falta de rede, não por permissão.
})

test("teardown", async () => {
  await app.close()
})
