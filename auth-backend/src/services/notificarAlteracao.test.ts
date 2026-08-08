// Notificador + receptor de webhook, contra o banco real.
// Envio real fica DESLIGADO (MONITOR_ENVIO_HABILITADO ausente): nenhuma mensagem sai.
// Roda: node --env-file=.env --import tsx --test src/services/notificarAlteracao.test.ts
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { construirApp } from "../app.js"
import { query, pool } from "../db.js"
import { abrirBloqueio, gravarAlteracoes, type Bloqueio } from "../repo/bloqueio.js"
import { notificarAlteracoes } from "./notificarAlteracao.js"
import type { AlteracaoClassificada } from "../domain/alteracaoBoard.js"

const COMPETENCIA = "1997-03"
const BOARD = 888888888
let app: Awaited<ReturnType<typeof construirApp>>
let b: Bloqueio
let seq = 0

function alt(over: Partial<AlteracaoClassificada> = {}): AlteracaoClassificada {
  seq++
  return {
    activityLogId: `nt-${COMPETENCIA}-${seq}`, evento: "update_column_value", boardId: BOARD,
    itemId: 1000 + seq, itemNome: `INTERMITENTE - PESSOA ${seq}`, grupoId: null,
    colunaId: "c", colunaTitulo: "OP - Data/Fim", colunaTipo: "date",
    valorAnterior: { date: "2026-08-31" }, valorNovo: null, resumo: "31/08/2026 -> (vazio)",
    mudou: true, qtdItens: 1, autorId: "98079621", autorNome: "Kamilly",
    ocorridoEm: new Date("2026-08-07T12:00:00Z"),
    origem: "monday_direto", severidade: "critica",
    operadorNome: null, operadorEmail: null, auditId: null, ...over,
  }
}

async function novaJanela(teto: number, modo: "imediato" | "digest" = "imediato") {
  await query(`DELETE FROM competencia_bloqueio WHERE competencia=$1`, [COMPETENCIA])
  return abrirBloqueio({
    competencia: COMPETENCIA, boards: [BOARD], usuarioId: null, email: "teste@x.test",
    motivo: "teste notificador", tetoMsgsHora: teto, modo,
    destino: "000000000000000000@g.us",
  })
}

before(async () => {
  app = await construirApp()
  b = await novaJanela(20)
})
after(async () => {
  await query(`DELETE FROM competencia_bloqueio WHERE competencia=$1`, [COMPETENCIA])
  await app.close()
  await pool.end()
})

// ---------------------------------------------------------------------------
test("envio desligado: mensagem e MONTADA e GRAVADA, mas nao sai", async () => {
  const lote = [alt(), alt()]
  await gravarAlteracoes(b.id, lote, "sweep")
  const r = await notificarAlteracoes(b, lote)

  assert.equal(r.envioAtivo, false, "sem MONITOR_ENVIO_HABILITADO nada e enviado")
  assert.equal(r.candidatas, 2)
  assert.equal(r.mensagens, 2, "2 acoes distintas = 2 mensagens")
  assert.equal(r.enviadas, 0)
  assert.equal(r.falhas, 0, "envio fechado nao e falha")

  const { rows } = await query<{ enviado_em: Date | null; erro: string; corpo: string; destino: string }>(
    `SELECT enviado_em, erro, corpo, destino FROM board_notificacao WHERE bloqueio_id=$1 ORDER BY id`,
    [b.id],
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.enviado_em, null)
  assert.equal(rows[0]!.erro, "nao_enviado:desabilitado")
  assert.equal(rows[0]!.destino, "000000000000000000@g.us", "usa o destino da janela")
  assert.match(rows[0]!.corpo, /Alteração no Plan de Intermitente 03\/97/)
})

test("alteracao notificada sai da fila (notificacao_id amarrado)", async () => {
  const { rows } = await query<{ pendentes: string }>(
    `SELECT count(*)::text pendentes FROM board_alteracao
      WHERE bloqueio_id=$1 AND notificacao_id IS NULL
        AND severidade='critica' AND origem NOT IN ('motor','dp_direto')`,
    [b.id],
  )
  assert.equal(rows[0]!.pendentes, "0", "nada reentra na fila na proxima varredura")
})

test("uma acao do app com 6 colunas vira UMA mensagem", async () => {
  const janela = await novaJanela(20)
  const colunas = ["DESCONTO - VR", "DESCONTO - VT", "CREDITO VT", "CREDITO CAJU", "VR - Unitário", "VT - Diário"]
  const lote = colunas.map((c) =>
    alt({ origem: "app", operadorNome: "THALLISON GOMES SOUZA SOUZA", auditId: "11111111-1111-4111-8111-111111111111", colunaTitulo: c, itemId: 5000, itemNome: "INTERMITENTE - MARCILENE" }),
  )
  await gravarAlteracoes(janela.id, lote, "sweep")
  const r = await notificarAlteracoes(janela, lote)
  assert.equal(r.candidatas, 6)
  assert.equal(r.mensagens, 1, "mesmo audit_id = mesma acao = 1 mensagem")

  const { rows } = await query<{ corpo: string; qtd_alteracoes: number }>(
    `SELECT corpo, qtd_alteracoes FROM board_notificacao WHERE bloqueio_id=$1`, [janela.id])
  assert.equal(rows[0]!.qtd_alteracoes, 6)
  assert.match(rows[0]!.corpo, /6 alterações em 1 item/)
  assert.match(rows[0]!.corpo, /THALLISON GOMES SOUZA\b/, "sobrenome duplicado limpo na mensagem")
  assert.ok(!/SOUZA SOUZA/.test(rows[0]!.corpo))
})

test("fusivel: acima do teto por hora, o excedente colapsa numa mensagem so", async () => {
  const janela = await novaJanela(2) // teto baixo de proposito
  const lote = [alt(), alt(), alt(), alt(), alt()] // 5 acoes distintas
  await gravarAlteracoes(janela.id, lote, "sweep")
  const r = await notificarAlteracoes(janela, lote)

  assert.equal(r.candidatas, 5)
  assert.equal(r.mensagens, 3, "2 individuais (o teto) + 1 colapsada com o resto")
  assert.equal(r.colapsadas, 3)

  const { rows } = await query<{ colapsada: boolean; qtd_alteracoes: number; corpo: string }>(
    `SELECT colapsada, qtd_alteracoes, corpo FROM board_notificacao
      WHERE bloqueio_id=$1 ORDER BY id`, [janela.id])
  assert.equal(rows.filter((x) => x.colapsada).length, 1)
  const colapsada = rows.find((x) => x.colapsada)!
  assert.equal(colapsada.qtd_alteracoes, 3)
  assert.match(colapsada.corpo, /volume alto/)
})

test("modo digest manda tudo junto, sem depender do teto", async () => {
  const janela = await novaJanela(20, "digest")
  const lote = [alt(), alt(), alt()]
  await gravarAlteracoes(janela.id, lote, "sweep")
  const r = await notificarAlteracoes(janela, lote)
  assert.equal(r.mensagens, 1)
  assert.equal(r.colapsadas, 3)
})

test("motor e dp_direto nunca viram mensagem", async () => {
  const janela = await novaJanela(20)
  const lote = [
    alt({ origem: "motor", severidade: "informativa" }),
    alt({ origem: "dp_direto", autorNome: "Thifany Castro" }),
    alt({ severidade: "informativa" }),
  ]
  await gravarAlteracoes(janela.id, lote, "sweep")
  const r = await notificarAlteracoes(janela, lote)
  assert.equal(r.candidatas, 0)
  assert.equal(r.mensagens, 0)
})

// ---------------------------------------------------------------------------
test("webhook: handshake devolve o challenge cru", async () => {
  const r = await app.inject({
    method: "POST", url: "/api/webhooks/monday/auditoria",
    headers: { "content-type": "application/json" },
    payload: { challenge: "abc-123" },
  })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { challenge: "abc-123" })
})

test("webhook: board sem janela aberta responde 200 ignorado", async () => {
  // 200 de proposito — o Monday desativa webhook que erra demais, e o board fica
  // com o webhook registrado o ano todo, fora da janela.
  const r = await app.inject({
    method: "POST", url: "/api/webhooks/monday/auditoria",
    headers: { "content-type": "application/json" },
    payload: { event: { boardId: 123456789, pulseId: 1 } },
  })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().ignorado, "sem_janela_aberta")
})

test("webhook: evento sem board da 400", async () => {
  const r = await app.inject({
    method: "POST", url: "/api/webhooks/monday/auditoria",
    headers: { "content-type": "application/json" },
    payload: { event: { pulseId: 1 } },
  })
  assert.equal(r.statusCode, 400)
})

// --- piso da janela ---
test("varredura NUNCA olha antes da ativacao do DP", async () => {
  const { inicioDaVarredura } = await import("./sweepBloqueio.js")
  const aberto = new Date("2026-08-08T15:00:00Z")

  // cursor nulo (1a varredura) -> comeca na ativacao, nao no comeco dos tempos
  assert.equal(inicioDaVarredura(aberto, null).toISOString(), aberto.toISOString())

  // cursor ANTES da ativacao (gravado errado, ou janela reaberta) -> ignora e usa a ativacao.
  // Sem esse piso, a janela alertaria sobre o que o OP fez ANTES do fechamento comecar.
  assert.equal(
    inicioDaVarredura(aberto, new Date("2026-08-01T00:00:00Z")).toISOString(),
    aberto.toISOString(),
  )

  // cursor DEPOIS da ativacao (varredura em andamento) -> continua de onde parou
  const meio = new Date("2026-08-08T18:00:00Z")
  assert.equal(inicioDaVarredura(aberto, meio).toISOString(), meio.toISOString())
  assert.equal(inicioDaVarredura(aberto, meio.toISOString()).toISOString(), meio.toISOString())
})
