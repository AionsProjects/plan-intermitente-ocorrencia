// O id da execução passou a ser cunhado pelo FRONT. Este arquivo prova que isso não
// duplica linha nem abre porta pra mexer na execução de outra pessoa.
//
// O bug que motivou: o front esperava a resposta desta rota pra saber o id, com teto de
// 1500 ms. Quando o POST ficava preso atrás da própria função da convocação, o cliente
// abortava e seguia com `execucao_id: null` — a ROTA abria a própria execução (motor
// 'backend') e a abertura abortada gravava a SEGUNDA linha (motor 'app') quando a
// instância liberava. Cinco casos em produção, sempre com essa assinatura; a órfã virava
// 'abandonada' e alertava no WhatsApp sobre convocação que deu certo.
import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { construirApp } from "../app.js"
import { config } from "../config.js"
import { query } from "../db.js"
import { abrirExecucao } from "../services/execucao.js"

const MARCA_A = "idcliente.a@local"
const MARCA_B = "idcliente.b@local"
let app: Awaited<ReturnType<typeof construirApp>>
let sessaoA = ""
let userA = ""
let userB = ""

async function criarUsuario(email: string): Promise<{ userId: string; sessao: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, nome, papel, ativo, perfil_completo)
     VALUES ($1,'TESTE ID','dp',true,true) RETURNING id`, [email],
  )
  const userId = rows[0]!.id
  const s = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, expira_em) VALUES ($1, now() + interval '1 hour') RETURNING id`,
    [userId],
  )
  return { userId, sessao: s.rows[0]!.id }
}

const abrir = (corpo: unknown, sessao = sessaoA) =>
  app.inject({
    method: "POST", url: "/api/atividade",
    headers: { "content-type": "application/json", cookie: `${config.sessionCookieName}=${sessao}` },
    payload: corpo,
  })

const contarPorId = (id: string) =>
  query<{ n: number }>("SELECT count(*)::int n FROM audit_lancamentos WHERE id=$1::uuid", [id])
    .then((r) => r.rows[0]!.n)

test("setup", async () => {
  app = await construirApp()
  const a = await criarUsuario(MARCA_A)
  const b = await criarUsuario(MARCA_B)
  userA = a.userId; sessaoA = a.sessao
  userB = b.userId
})

test("id cunhado pelo front e honrado", async () => {
  const id = randomUUID()
  const r = await abrir({ id, acao: "convocacao", pessoa: "PESSOA UM" })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().id, id, "servidor ignorou o id do front")
  assert.equal(await contarPorId(id), 1)
})

// O CENÁRIO DA FANTASMA. Antes: rota cria a linha dela, abertura atrasada cria OUTRA.
// Agora o id é o mesmo, então a abertura atrasada não tem o que criar.
test("abertura ATRASADA no id que a rota ja usou nao cria segunda linha", async () => {
  const id = randomUUID()
  // A rota do processo chega primeiro e faz o trabalho todo.
  const ex = await abrirExecucao({
    id, acao: "convocacao", motor: "backend",
    operador: { userId: userA, email: MARCA_A }, alvo: "12895813874",
    pessoa: "FABIANA MATEUS GONCALVES",
  })
  await ex.fechar("ok")
  // Só então a abertura do front consegue rodar.
  const r = await abrir({ id, acao: "convocacao", pessoa: "FABIANA MATEUS GONCALVES" })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().id, id)
  assert.equal(r.json().jaExistia, true)
  assert.equal(await contarPorId(id), 1, "voltou a duplicar a linha")

  const { rows } = await query<{ estado: string; motor: string; uuid_alvo: string | null }>(
    "SELECT estado, motor, uuid_alvo FROM audit_lancamentos WHERE id=$1::uuid", [id],
  )
  // Nada da execução real foi mexido: nem o desfecho, nem o motor, nem o alvo.
  assert.equal(rows[0]!.estado, "ok", "a abertura atrasada reabriu/alterou o desfecho")
  assert.equal(rows[0]!.motor, "backend", "relabelou como 'app' um run que rodou no backend")
  assert.equal(rows[0]!.uuid_alvo, "12895813874")
})

test("id de OUTRA pessoa e recusado, e a linha dela fica intacta", async () => {
  const id = randomUUID()
  const ex = await abrirExecucao({
    id, acao: "convocacao", motor: "backend",
    operador: { userId: userB, email: MARCA_B }, pessoa: "PESSOA DO OUTRO",
  })
  await ex.fechar("ok")
  const r = await abrir({ id, acao: "convocacao", pessoa: "TENTATIVA DE SEQUESTRO" })
  assert.equal(r.statusCode, 200)
  assert.notEqual(r.json().id, id, "aceitou id de execucao de outra pessoa")

  const { rows } = await query<{ motor: string; pessoa_nome: string; user_id: string }>(
    "SELECT motor, pessoa_nome, user_id FROM audit_lancamentos WHERE id=$1::uuid", [id],
  )
  assert.equal(rows[0]!.motor, "backend")
  assert.equal(rows[0]!.pessoa_nome, "PESSOA DO OUTRO")
  assert.equal(rows[0]!.user_id, userB)
})

test("id malformado nao derruba: servidor cunha o dele", async () => {
  const r = await abrir({ id: "nao-e-uuid", acao: "convocacao", pessoa: "PESSOA TRES" })
  assert.equal(r.statusCode, 200)
  assert.match(r.json().id, /^[0-9a-f-]{36}$/)
})

test("cleanup", async () => {
  await query("DELETE FROM audit_lancamentos WHERE user_id = ANY($1)", [[userA, userB]])
  await query("DELETE FROM sessions WHERE user_id = ANY($1)", [[userA, userB]])
  await query("DELETE FROM users WHERE email = ANY($1)", [[MARCA_A, MARCA_B]])
})
