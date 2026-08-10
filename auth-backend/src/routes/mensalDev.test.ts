// Gate do modo desenvolvedor na rota de aprovação — quem pode e o que é recusado.
// A validação roda ANTES de aprovarRun, então runId inexistente basta (sem fixture de run).
// Roda: node --env-file=.env --import tsx --test src/routes/mensalDev.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.AUTH_DEV_BYPASS = "1"
process.env.MENSAL_WORKFLOW_ENABLED = "1"

const { construirApp } = await import("../app.js")

const RUN_FANTASMA = "00000000-0000-4000-8000-00000000d1de"
let app: Awaited<ReturnType<typeof construirApp>>

/** Loga via dev-bypass e devolve o cookie de sessão. */
async function cookieDe(email: string, papel: string): Promise<string> {
  const r = await app.inject({
    method: "POST",
    url: "/auth/dev-login",
    headers: { "content-type": "application/json" },
    payload: { email, papel },
  })
  const c = r.headers["set-cookie"]
  const bruto = Array.isArray(c) ? c[0] : c
  assert.ok(bruto, `dev-login falhou (${r.statusCode}): ${r.body.slice(0, 120)}`)
  return bruto!.split(";")[0]!
}

function aprovar(cookie: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/api/mensal/runs/${RUN_FANTASMA}/aprovar`,
    headers: { "content-type": "application/json", cookie },
    payload: body,
  })
}

test("setup", async () => { app = await construirApp() })

test("DP não pode usar modo dev — envio real fora do fluxo oficial é coisa de admin", async () => {
  const c = await cookieDe("dp.teste@contatoserv.com.br", "dp")
  const r = await aprovar(c, { familiasReais: ["rm_convocacao"] })
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().erro, "modo_dev_requer_admin")
})

test("família desconhecida é 400 com a lista das válidas — typo não pode virar 'simulou calado'", async () => {
  const c = await cookieDe("admin.teste@contatoserv.com.br", "admin")
  const r = await aprovar(c, { familiasReais: ["rm_convocacoes"] })
  assert.equal(r.statusCode, 400)
  const j = r.json()
  assert.equal(j.erro, "familia_invalida")
  assert.ok(Array.isArray(j.validas) && j.validas.includes("rm_convocacao"))
})

test("lista vazia também é 400 — modo dev sem nada real é intenção ambígua", async () => {
  const c = await cookieDe("admin.teste@contatoserv.com.br", "admin")
  const r = await aprovar(c, { familiasReais: [] })
  assert.equal(r.statusCode, 400)
})

test("caju é recusado na v1 (gate inline sob edição de outra sessão)", async () => {
  const c = await cookieDe("admin.teste@contatoserv.com.br", "admin")
  const r = await aprovar(c, { familiasReais: ["rm_convocacao", "caju_credito"] })
  assert.equal(r.statusCode, 400)
})

test("sem familiasReais o fluxo normal segue intacto (cai no 404/409 do run, não no gate dev)", async () => {
  const c = await cookieDe("admin.teste@contatoserv.com.br", "admin")
  const r = await aprovar(c, {})
  assert.notEqual(r.statusCode, 400)
  assert.notEqual(r.statusCode, 403)
})

test("teardown", async () => { await app.close() })
