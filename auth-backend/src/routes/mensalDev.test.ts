// Gate do modo desenvolvedor na rota de aprovação — quem pode e o que é recusado.
// A validação roda ANTES de aprovarRun, então runId inexistente basta (sem fixture de run).
// Roda: node --env-file=.env --import tsx --test src/routes/mensalDev.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.AUTH_DEV_BYPASS = "1"
process.env.MENSAL_WORKFLOW_ENABLED = "1"

const { construirApp } = await import("../app.js")
const { query } = await import("../db.js")

const RUN_FANTASMA = "00000000-0000-4000-8000-00000000d1de"
let app: Awaited<ReturnType<typeof construirApp>>

/**
 * Loga via dev-bypass e devolve o cookie de sessão.
 *
 * O papel é garantido por UPDATE, não pelo `payload.papel`: o dev-login só aplica papel a
 * usuário NOVO desde 13/08 — ele reescrevia o papel de quem já existia, e como o
 * DATABASE_URL de dev aponta pro banco de produção, isso promovia/rebaixava gente real
 * (aconteceu com a Mayra). O teste passa a declarar o que precisa em vez de depender de um
 * efeito colateral do login.
 */
async function cookieDe(email: string, papel: string): Promise<string> {
  const r = await app.inject({
    method: "POST",
    url: "/auth/dev-login",
    headers: { "content-type": "application/json" },
    payload: { email, papel },
  })
  await query(`UPDATE users SET papel = $2::papel WHERE email = $1`, [email, papel])
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


test("previa com antifraude desligada NAO pode virar run normal — so modo dev", async () => {
  // A trava existe porque furar a antifraude é útil pra teste (competência já paga bloqueia
  // tudo) mas aprovar isso como run normal pagaria DE NOVO quem já recebeu.
  const { query } = await import("../db.js")
  const RUN = "00000000-0000-4000-8000-00000000d2aa"
  await query(`DELETE FROM mensal_run WHERE run_id=$1`, [RUN])
  await query(
    `INSERT INTO mensal_run (run_id, papel, competencia, modo, status, snapshot)
     VALUES ($1,'atual','2099-01','producao','aguardando_aprovacao',
             '{"alertas":["antifraude_desabilitada_teste_homologacao"],"contratos":[]}'::jsonb)`,
    [RUN],
  )
  const c = await cookieDe("admin.teste@contatoserv.com.br", "admin")
  const semDev = await app.inject({
    method: "POST", url: `/api/mensal/runs/${RUN}/aprovar`,
    headers: { "content-type": "application/json", cookie: c }, payload: {},
  })
  assert.equal(semDev.statusCode, 400)
  assert.equal(semDev.json().erro, "previa_sem_antifraude_exige_modo_dev")

  // Com modo dev, a trava libera (segue o fluxo normal de aprovação).
  const comDev = await app.inject({
    method: "POST", url: `/api/mensal/runs/${RUN}/aprovar`,
    headers: { "content-type": "application/json", cookie: c },
    payload: { familiasReais: ["rm_convocacao"] },
  })
  assert.notEqual(comDev.json().erro, "previa_sem_antifraude_exige_modo_dev")
  await query(`DELETE FROM mensal_run WHERE run_id=$1`, [RUN])
})

test("teardown", async () => { await app.close() })
