// Relatório PDF do histórico. O que precisa de prova e o typecheck não dá:
// o GATE de papel (OP nunca vê os outros, nem pedindo `todos=1`), as bordas do
// período em Manaus e o corpo ser um PDF de verdade.
import { test } from "node:test"
import assert from "node:assert/strict"
import { construirApp } from "../app.js"
import { config } from "../config.js"
import { query } from "../db.js"

const MARCA_OP = "relatorio.op@local"
const MARCA_DP = "relatorio.dp@local"
let app: Awaited<ReturnType<typeof construirApp>>
let sessaoOp = ""
let sessaoDp = ""
let userOp = ""
let userDp = ""

async function criarUsuario(papel: string, email: string): Promise<{ userId: string; sessao: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, nome, papel, ativo, perfil_completo)
     VALUES ($1,$2,$3,true,true) RETURNING id`,
    [email, `TESTE ${papel}`, papel],
  )
  const userId = rows[0]!.id
  const s = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, expira_em) VALUES ($1, now() + interval '1 hour') RETURNING id`,
    [userId],
  )
  return { userId, sessao: s.rows[0]!.id }
}

const baixar = (sessao: string, qs: string) =>
  app.inject({
    method: "GET",
    url: `/api/atividade/relatorio${qs}`,
    headers: { cookie: `${config.sessionCookieName}=${sessao}` },
  })

async function semear(userId: string, pessoa: string): Promise<void> {
  await query(
    `INSERT INTO audit_lancamentos (user_id, operador_email, acao, pessoa_nome, contrato, estado)
     VALUES ($1, $2, 'convocacao', $3, 'CETAM', 'ok')`,
    [userId, MARCA_OP, pessoa],
  )
}

test("setup", async () => {
  app = await construirApp()
  const op = await criarUsuario("operacional", MARCA_OP)
  const dp = await criarUsuario("dp", MARCA_DP)
  userOp = op.userId; sessaoOp = op.sessao
  userDp = dp.userId; sessaoDp = dp.sessao
  await semear(userOp, "PESSOA DO OP")
  await semear(userDp, "PESSOA DO DP")
})

test("sem sessao -> 401", async () => {
  const r = await app.inject({ method: "GET", url: "/api/atividade/relatorio?periodo=diario" })
  assert.equal(r.statusCode, 401)
})

test("devolve um PDF de verdade (assinatura + nome do arquivo)", async () => {
  const r = await baixar(sessaoDp, "?periodo=diario&todos=1")
  assert.equal(r.statusCode, 200)
  assert.equal(r.headers["content-type"], "application/pdf")
  assert.match(String(r.headers["content-disposition"]), /relatorio-atividade-.*\.pdf/)
  const corpo = r.rawPayload
  // Assinatura do formato — se quebrar, o leitor abre com "arquivo corrompido".
  assert.equal(corpo.subarray(0, 5).toString("latin1"), "%PDF-")
  assert.match(corpo.toString("latin1"), /%%EOF/)
  assert.ok(corpo.length > 1000, "pdf suspeito de vazio")
})

// O gate central: `todos=1` de um OP é IGNORADO, não recusado — ele recebe o
// relatório dele, nunca um 403 que o ensinaria a pedir de outro jeito.
test("OP com todos=1 recebe SO as proprias execucoes", async () => {
  const r = await baixar(sessaoOp, "?periodo=mensal&todos=1")
  assert.equal(r.statusCode, 200)
  const texto = r.rawPayload.toString("latin1")
  assert.ok(texto.includes("PESSOA DO OP"), "nao trouxe a execucao do proprio OP")
  assert.ok(!texto.includes("PESSOA DO DP"), "VAZOU execucao de outra pessoa pro OP")
})

test("DP com todos=1 recebe de todo mundo", async () => {
  const r = await baixar(sessaoDp, "?periodo=mensal&todos=1")
  const texto = r.rawPayload.toString("latin1")
  assert.ok(texto.includes("PESSOA DO OP"))
  assert.ok(texto.includes("PESSOA DO DP"))
})

test("DP sem todos=1 recebe so o proprio (mesmo default da lista)", async () => {
  const r = await baixar(sessaoDp, "?periodo=mensal")
  const texto = r.rawPayload.toString("latin1")
  assert.ok(!texto.includes("PESSOA DO OP"))
  assert.ok(texto.includes("PESSOA DO DP"))
})

test("personalizado exige de/ate validos", async () => {
  assert.equal((await baixar(sessaoDp, "?periodo=personalizado")).statusCode, 400)
  assert.equal((await baixar(sessaoDp, "?periodo=personalizado&de=2026-08-01&ate=alo")).statusCode, 400)
  assert.equal((await baixar(sessaoDp, "?periodo=personalizado&de=2026-08-10&ate=2026-08-01")).statusCode, 400)
  assert.equal((await baixar(sessaoDp, "?periodo=personalizado&de=2024-01-01&ate=2026-08-01")).statusCode, 400)
})

test("personalizado com fim INCLUSIVE pega execucao do proprio dia `ate`", async () => {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Manaus" })
  const r = await baixar(sessaoDp, `?periodo=personalizado&de=${hoje}&ate=${hoje}&todos=1`)
  assert.equal(r.statusCode, 200)
  const texto = r.rawPayload.toString("latin1")
  // As execuções semeadas são de agora — dentro do "até hoje" só se o fim for inclusive.
  assert.ok(texto.includes("PESSOA DO DP"), "fim exclusivo cortou o proprio dia")
})

test("personalizado fora do periodo NAO traz as execucoes de hoje", async () => {
  const r = await baixar(sessaoDp, "?periodo=personalizado&de=2026-01-01&ate=2026-01-31&todos=1")
  assert.equal(r.statusCode, 200)
  const texto = r.rawPayload.toString("latin1")
  assert.ok(!texto.includes("PESSOA DO DP"), "trouxe execucao fora do periodo")
})

test("periodo desconhecido -> 400", async () => {
  assert.equal((await baixar(sessaoDp, "?periodo=quinzenal")).statusCode, 400)
})

test("cleanup", async () => {
  await query("DELETE FROM audit_lancamentos WHERE operador_email = $1", [MARCA_OP])
  await query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [userOp, userDp])
  await query("DELETE FROM users WHERE id IN ($1, $2)", [userOp, userDp])
})
