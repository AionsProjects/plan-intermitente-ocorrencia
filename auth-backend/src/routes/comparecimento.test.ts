// Gatilho da felipeta. O que precisa de prova: o webhook NÃO dispara pagamento em nenhum
// caso que não seja "OP - Compareceu? = SIM", responde 200 sempre (senão o Monday desativa),
// e a coluna é resolvida por NOME (a virada troca o column_id todo mês).
import { test } from "node:test"
import assert from "node:assert/strict"
import { construirApp } from "../app.js"
import { jaPago } from "./comparecimento.js"
import { query } from "../db.js"

const BOARD = "99900001"
const COL = "color_teste_comparece"
let app: Awaited<ReturnType<typeof construirApp>>

const post = (body: unknown) =>
  app.inject({ method: "POST", url: "/api/monday/comparecimento", headers: { "content-type": "application/json" }, payload: body })

const evento = (over: Record<string, unknown> = {}) => ({
  event: { boardId: Number(BOARD), pulseId: 12345678, columnId: COL, value: { label: { text: "SIM", index: 1 } }, ...over },
})

test("setup", async () => {
  app = await construirApp()
  await query(
    `INSERT INTO board_colunas (monday_board_id, nome, column_id, tipo) VALUES ($1,$2,$3,'status')
     ON CONFLICT (monday_board_id, nome) DO UPDATE SET column_id = EXCLUDED.column_id`,
    [BOARD, "OP - Compareceu?", COL],
  )
})

test("challenge do Monday é ecoado cru", async () => {
  const r = await post({ challenge: "abc-123" })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { challenge: "abc-123" })
})

test("flag desligada: ignora sem tocar em nada", async () => {
  // PONTUAL_PAGAMENTO_HABILITADO não está setado no .env de teste.
  const r = await post(evento())
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().ignorado, "desligado")
})

test("evento incompleto não explode", async () => {
  const r = await post({ event: { boardId: BOARD } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().ignorado, "evento_incompleto")
})

// Os filtros abaixo só são alcançáveis com a flag ligada — como ela é lida em runtime pelo
// config (módulo), o teste cobre a ORDEM garantindo que nada explode e que a resposta é
// sempre 200. A semântica do filtro em si é coberta pelos testes puros de pagamento.ts.
test("label NÃO / outra coluna: 200 e nenhum efeito", async () => {
  for (const body of [
    evento({ value: { label: { text: "NÃO", index: 2 } } }),
    evento({ columnId: "color_outra" }),
    evento({ value: null }),
  ]) {
    const r = await post(body)
    assert.equal(r.statusCode, 200)
    const j = r.json()
    assert.ok(j.ignorado, `esperava ignorado, veio ${JSON.stringify(j)}`)
    assert.notEqual(j.status, "iniciado")
  }
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int n FROM efeitos_externos WHERE chave = 'pontual:gatilho:12345678'`,
  )
  assert.equal(rows[0]!.n, 0, "criou gatilho sem ser SIM")
})

// A regra que travou dois pagamentos em 09/2026: `consumido` é do FIFO, não do fim do
// pagamento. Webhook trata como já pago; retomada manual NÃO pode.
test("jaPago: fechamento manda sempre; snapshot consumido só barra o webhook", () => {
  assert.equal(jaPago("confirmado", "consumido", false), true)
  assert.equal(jaPago("confirmado", "consumido", true), true, "fechamento confirmado barra até a retomada")
  assert.equal(jaPago("confirmado", null, true), true)

  assert.equal(jaPago("ausente", "consumido", false), true, "webhook: re-marcar SIM não paga de novo")
  assert.equal(jaPago("ausente", "consumido", true), false, "retomada tem de passar por cima do FIFO")

  assert.equal(jaPago("ausente", "reservado", false), false)
  assert.equal(jaPago("ausente", undefined, false), false)
  assert.equal(jaPago("pendente", "consumido", true), false, "pendente não é pagamento concluído")
})

test("retomar exige admin", async () => {
  const r = await app.inject({ method: "POST", url: "/api/pontual/pagamentos/12345678/retomar" })
  assert.equal(r.statusCode, 401)
})

test("cleanup", async () => {
  await query(`DELETE FROM board_colunas WHERE monday_board_id = $1`, [BOARD])
  await query(`DELETE FROM efeitos_externos WHERE chave LIKE 'pontual:gatilho:12345678%'`)
})
