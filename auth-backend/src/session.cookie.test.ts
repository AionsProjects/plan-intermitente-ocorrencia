import { test } from "node:test"
import assert from "node:assert/strict"
import Fastify from "fastify"
import cookie from "@fastify/cookie"
import { config } from "./config.js"
import { reemitirCookieDeSessao } from "./session.js"

// Cobre só o gancho de reemissão do cookie (sem banco). A decisão de renovar está em
// domain/sessao.test.ts; a escrita no Postgres fica a cargo de `usuarioDaSessao`.
async function montar() {
  const app = Fastify()
  await app.register(cookie)
  app.addHook("onSend", async (req, reply, payload) => {
    reemitirCookieDeSessao(req, reply)
    return payload
  })
  app.get("/renovada", async (req) => {
    req.sessaoRenovada = { id: "sessao-xyz", expiraEm: new Date(Date.now() + 10 * 86_400_000) }
    return { ok: true }
  })
  app.get("/normal", async () => ({ ok: true }))
  return app
}

test("sessão renovada na requisição → resposta reemite pi_sess com maxAge novo", async () => {
  const app = await montar()
  const r = await app.inject({ method: "GET", url: "/renovada" })
  const set = String(r.headers["set-cookie"])
  assert.ok(set.startsWith(`${config.sessionCookieName}=sessao-xyz`), set)
  assert.match(set, /HttpOnly/i)
  assert.match(set, /SameSite=Lax/i)
  assert.match(set, /Path=\//)
  const maxAge = Number(/Max-Age=(\d+)/i.exec(set)?.[1])
  // ~10 dias, com folga de alguns segundos pelo tempo do teste.
  assert.ok(maxAge > 10 * 86_400 - 60 && maxAge <= 10 * 86_400, `Max-Age ${maxAge}`)
  await app.close()
})

test("sem renovação, nenhuma resposta mexe no cookie de sessão", async () => {
  const app = await montar()
  const r = await app.inject({ method: "GET", url: "/normal" })
  assert.equal(r.headers["set-cookie"], undefined)
  await app.close()
})
