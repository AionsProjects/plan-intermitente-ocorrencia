// Integração das rotas de bloqueio contra o banco real.
// Cria usuário+sessão descartáveis, exercita o ciclo e apaga tudo no fim.
// Roda: node --env-file=.env --import tsx --test src/routes/bloqueio.test.ts
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { construirApp } from "../app.js"
import { query, pool } from "../db.js"
import { config } from "../config.js"
import { gravarAlteracoes } from "../repo/bloqueio.js"
import type { AlteracaoClassificada } from "../domain/alteracaoBoard.js"

const COMPETENCIA = "1999-01" // fora do universo real — não colide com janela de verdade
const BOARD = 999999999
let app: Awaited<ReturnType<typeof construirApp>>
let sessaoDp = ""
let sessaoOp = ""
let bloqueioId = ""
const usuarios: string[] = []

async function criarUsuario(papel: string, email: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, nome, papel, ativo, perfil_completo)
     VALUES ($1,$2,$3,true,true) RETURNING id`,
    [email, `TESTE ${papel}`, papel],
  )
  const id = rows[0]!.id
  usuarios.push(id)
  const s = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, expira_em) VALUES ($1, now() + interval '1 hour') RETURNING id`,
    [id],
  )
  return s.rows[0]!.id
}

function req(metodo: "GET" | "POST", url: string, sessao: string, payload?: unknown) {
  // content-type json SÓ quando há corpo: o Fastify responde 400
  // (FST_ERR_CTP_EMPTY_JSON_BODY) se o header vier com corpo vazio.
  return app.inject({
    method: metodo,
    url,
    headers: {
      cookie: `${config.sessionCookieName}=${sessao}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  })
}

function alteracao(over: Partial<AlteracaoClassificada> = {}): AlteracaoClassificada {
  return {
    activityLogId: `teste-${Math.round(performance.now() * 1000)}-${usuarios.length}-${Math.round(performance.timeOrigin)}`,
    evento: "update_column_value", boardId: BOARD, itemId: 111, itemNome: "INTERMITENTE - TESTE",
    grupoId: "g1", colunaId: "c1", colunaTitulo: "OP - Data/Fim", colunaTipo: "date",
    valorAnterior: { date: "2026-08-31" }, valorNovo: null, resumo: "31/08/2026 -> (vazio)",
    mudou: true, qtdItens: 1, autorId: "98079621", autorNome: "Kamilly",
    ocorridoEm: new Date("2026-08-07T12:00:00Z"),
    origem: "monday_direto", severidade: "critica",
    operadorNome: null, operadorEmail: null, auditId: null,
    ...over,
  }
}

before(async () => {
  app = await construirApp()
  sessaoDp = await criarUsuario("dp", `teste-dp-${Date.now()}@x.test`)
  sessaoOp = await criarUsuario("operacional", `teste-op-${Date.now()}@x.test`)
  await query(`DELETE FROM competencia_bloqueio WHERE competencia = $1`, [COMPETENCIA])
})

after(async () => {
  if (bloqueioId) await query(`DELETE FROM competencia_bloqueio WHERE id = $1`, [bloqueioId])
  await query(`DELETE FROM competencia_bloqueio WHERE competencia = $1`, [COMPETENCIA])
  if (usuarios.length) await query(`DELETE FROM users WHERE id = ANY($1)`, [usuarios])
  await app.close()
  await pool.end()
})

// ---------------------------------------------------------------------------
test("sem sessao = 401; operacional = 403", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/bloqueio" })
  assert.equal(anon.statusCode, 401)
  const op = await req("GET", "/api/bloqueio", sessaoOp)
  assert.equal(op.statusCode, 403, "OP nao pode abrir/ver janela — quem aciona e o DP")
})

test("competencia invalida nao abre janela", async () => {
  const r = await req("POST", "/api/bloqueio", sessaoDp, { competencia: "agosto" })
  assert.equal(r.statusCode, 400)
  assert.equal(r.json().erro, "competencia_invalida")
})

test("competencia sem board no registry recusa em vez de vigiar cego", async () => {
  const r = await req("POST", "/api/bloqueio", sessaoDp, { competencia: "1998-01" })
  assert.equal(r.statusCode, 422)
  assert.equal(r.json().erro, "sem_board_para_competencia")
})

test("DP abre a janela com boards explicitos", async () => {
  const r = await req("POST", "/api/bloqueio", sessaoDp, {
    competencia: COMPETENCIA, boards: [BOARD], motivo: "teste automatizado",
  })
  assert.equal(r.statusCode, 200)
  const b = r.json().bloqueio
  bloqueioId = b.id
  assert.equal(b.status, "aberto")
  assert.equal(b.modo_notificacao, "imediato", "default = 1 msg por alteracao")
  assert.equal(b.teto_msgs_hora, 20, "fusivel default")
  assert.ok(b.aberto_por_email)
})

test("segunda janela ABERTA na mesma competencia da 409", async () => {
  const r = await req("POST", "/api/bloqueio", sessaoDp, { competencia: COMPETENCIA, boards: [BOARD] })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().erro, "ja_existe_bloqueio_aberto")
})

test("acrescentar board e idempotente (caso da virada no meio da janela)", async () => {
  const r1 = await req("POST", `/api/bloqueio/${bloqueioId}/boards`, sessaoDp, { boards: [BOARD + 1] })
  assert.equal(r1.statusCode, 200)
  assert.equal(r1.json().boards.length, 2)
  const r2 = await req("POST", `/api/bloqueio/${bloqueioId}/boards`, sessaoDp, { boards: [BOARD + 1] })
  assert.equal(r2.json().boards.length, 2, "repetir nao duplica")
})

test("grava TUDO: informativa, motor e dp_direto tambem entram", async () => {
  const lote = [
    alteracao({ activityLogId: "t-critica-op" }),
    alteracao({ activityLogId: "t-motor", origem: "motor", severidade: "informativa", colunaTitulo: "VR - MENSAL" }),
    alteracao({ activityLogId: "t-dp", origem: "dp_direto", autorNome: "Thifany", colunaTitulo: "Status Pedido" }),
    alteracao({ activityLogId: "t-app", origem: "app", operadorNome: "KAMILLY SILVA", operadorEmail: "k@x" }),
    alteracao({ activityLogId: "t-info", severidade: "informativa", colunaTitulo: "Observacao" }),
  ]
  const novos = await gravarAlteracoes(bloqueioId, lote, "sweep")
  assert.equal(novos.length, 5)

  // guardrail entre webhook e sweep: o mesmo activity_log_id nao entra duas vezes
  const repetido = await gravarAlteracoes(bloqueioId, lote, "webhook")
  assert.equal(repetido.length, 0, "ON CONFLICT DO NOTHING segurou")
})

test("lista sem filtro traz o board inteiro; com filtro recorta", async () => {
  const tudo = await req("GET", `/api/bloqueio/${bloqueioId}/alteracoes`, sessaoDp)
  assert.equal(tudo.json().alteracoes.length, 5, "observa todo o board, nao so o que alerta")

  const soMotor = await req("GET", `/api/bloqueio/${bloqueioId}/alteracoes?origem=motor`, sessaoDp)
  assert.equal(soMotor.json().alteracoes.length, 1)

  const criticas = await req("GET", `/api/bloqueio/${bloqueioId}/alteracoes?severidade=critica`, sessaoDp)
  assert.equal(criticas.json().alteracoes.length, 3)
})

test("relatorio agrega a tabela inteira, inclusive o que nao vira alerta", async () => {
  const r = await req("GET", `/api/bloqueio/${bloqueioId}/relatorio`, sessaoDp)
  assert.equal(r.statusCode, 200)
  const rel = r.json().relatorio
  assert.equal(rel.totais.total, "5")
  assert.equal(rel.totais.itens, "1")

  const origens = Object.fromEntries(rel.porOrigem.map((x: { origem: string; n: number }) => [x.origem, x.n]))
  assert.equal(origens.monday_direto, 2)
  assert.equal(origens.motor, 1)
  assert.equal(origens.dp_direto, 1, "edicao do DP ENTRA no relatorio (caso DETRAN)")
  assert.equal(origens.app, 1)

  const quem = rel.porAutor.map((x: { quem: string }) => x.quem)
  assert.ok(quem.includes("KAMILLY SILVA"), "operador real do app aparece por nome")
  // sobrenome repetido do cadastro nao pode vazar pro relatorio (so a mensagem limpava)
  assert.ok(!quem.some((q: string) => /SOUZA SOUZA|ROMASKEVIS DE OLIVEIRA ROMASKEVIS/.test(q)),
    "nomeLimpo aplicado tambem no relatorio")
  assert.ok(rel.porItem.length === 1 && rel.porItem[0].criticas === 3)
  assert.equal(rel.notificacoes[0].enviadas, 0)
})

test("fechar devolve o relatorio; fechar de novo da 409", async () => {
  const r = await req("POST", `/api/bloqueio/${bloqueioId}/fechar`, sessaoDp)
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().bloqueio.status, "fechado")
  assert.ok(r.json().bloqueio.fechado_em)
  assert.equal(r.json().relatorio.totais.total, "5")

  const denovo = await req("POST", `/api/bloqueio/${bloqueioId}/fechar`, sessaoDp)
  assert.equal(denovo.statusCode, 409)
})

test("apos fechar, a mesma competencia pode reabrir", async () => {
  const r = await req("POST", "/api/bloqueio", sessaoDp, { competencia: COMPETENCIA, boards: [BOARD] })
  assert.equal(r.statusCode, 200, "indice unico e parcial (WHERE status='aberto')")
  await query(`DELETE FROM competencia_bloqueio WHERE id = $1`, [r.json().bloqueio.id])
})

// --- cron (Vercel Cron so faz GET) ---
test("GET /api/bloqueio/varrer existe para o cron e responde", async () => {
  // O Vercel Cron dispara GET. Se so existisse o POST, o cron nunca rodaria —
  // e falharia calado, que e o pior modo de falha pra uma rede de seguranca.
  const r = await app.inject({ method: "GET", url: "/api/bloqueio/varrer" })
  assert.equal(r.statusCode, 200)
  const j = r.json()
  assert.equal(j.ok, true)
  assert.equal(typeof j.janelas, "number")
  assert.equal(j.envio_ativo, false, "envio segue desligado")
})

test("GET /api/bloqueio/varrer recusa CRON_SECRET errado", async () => {
  const antes = process.env.CRON_SECRET
  process.env.CRON_SECRET = "segredo-de-teste"
  try {
    const mau = await app.inject({
      method: "GET", url: "/api/bloqueio/varrer",
      headers: { authorization: "Bearer errado" },
    })
    assert.equal(mau.statusCode, 401)
    const bom = await app.inject({
      method: "GET", url: "/api/bloqueio/varrer",
      headers: { authorization: "Bearer segredo-de-teste" },
    })
    assert.equal(bom.statusCode, 200, "header que o Vercel Cron manda")
  } finally {
    if (antes === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = antes
  }
})

test("relatorio limpa sobrenome repetido do operador", async () => {
  const janela = await req("POST", "/api/bloqueio", sessaoDp, { competencia: "1996-05", boards: [BOARD + 9] })
  const id = janela.json().bloqueio.id
  try {
    await gravarAlteracoes(id, [alteracao({
      activityLogId: `nl-${Date.now()}`, origem: "app",
      operadorNome: "THALLISON GOMES SOUZA SOUZA", operadorEmail: "t@x",
    })], "sweep")
    const r = await req("GET", `/api/bloqueio/${id}/relatorio`, sessaoDp)
    const quem = r.json().relatorio.porAutor.map((x: { quem: string }) => x.quem)
    assert.deepEqual(quem, ["THALLISON GOMES SOUZA"], "cadastro tem SOUZA SOUZA; relatorio nao repete")
  } finally {
    await query(`DELETE FROM competencia_bloqueio WHERE id=$1`, [id])
  }
})
