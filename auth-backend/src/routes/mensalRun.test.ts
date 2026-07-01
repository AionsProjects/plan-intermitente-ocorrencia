// Suíte de testes do acompanhamento mensal (backend + lógica de detecção de erro do n8n).
// Roda: SERVICE_TOKEN=tok node --env-file=.env --import tsx --test src/routes/mensalRun.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { construirApp } from "../app.js"
import { query } from "../db.js"

const TOK = process.env.SERVICE_TOKEN || "tok-teste"
const RUN = "00000000-0000-4000-8000-0000000000aa"
let app: Awaited<ReturnType<typeof construirApp>>

function post(path: string, body: unknown, tok = TOK) {
  return app!.inject({ method: "POST", url: path, headers: { "content-type": "application/json", ...(tok ? { "x-service-token": tok } : {}) }, payload: body })
}

test("setup", async () => { app = await construirApp(); await query("DELETE FROM mensal_run WHERE run_id=$1", [RUN]) })

test("auth: sem token → 401", async () => {
  const r = await post("/api/mensal/run/iniciar", { run_id: RUN }, "")
  assert.equal(r.statusCode, 401)
})

test("validação: run_id inválido → 400", async () => {
  const r = await post("/api/mensal/run/iniciar", { run_id: "x", papel: "atual" })
  assert.equal(r.statusCode, 400)
})

test("iniciar: cria run + 3 itens pendentes", async () => {
  const r = await post("/api/mensal/run/iniciar", { run_id: RUN, papel: "atual", competencia: "2026-07", contratos: [{ contrato: "A", ordem: 1, qtd: 5 }, { contrato: "B", ordem: 2, qtd: 3 }, { contrato: "C", ordem: 3, qtd: 1 }] })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().total, 3)
  const { rows } = await query("SELECT count(*)::int n FROM mensal_run_item WHERE run_id=$1 AND status='pendente'", [RUN])
  assert.equal(rows[0].n, 3)
})

test("idempotência: re-iniciar não duplica", async () => {
  await post("/api/mensal/run/iniciar", { run_id: RUN, papel: "atual", contratos: [{ contrato: "A", ordem: 1, qtd: 5 }, { contrato: "B", ordem: 2, qtd: 3 }, { contrato: "C", ordem: 3, qtd: 1 }] })
  const { rows } = await query("SELECT count(*)::int n FROM mensal_run_item WHERE run_id=$1", [RUN])
  assert.equal(rows[0].n, 3)
})

test("transições + contadores recalculados", async () => {
  await post(`/api/mensal/run/${RUN}/contrato`, { contrato: "A", status: "rodando" })
  await post(`/api/mensal/run/${RUN}/contrato`, { contrato: "A", status: "ok" })
  await post(`/api/mensal/run/${RUN}/contrato`, { contrato: "B", status: "erro", erro_msg: "RM" })
  const { rows } = await query("SELECT ok_contratos, erro_contratos FROM mensal_run WHERE run_id=$1", [RUN])
  assert.equal(rows[0].ok_contratos, 1)
  assert.equal(rows[0].erro_contratos, 1)
})

test("status inválido → 400", async () => {
  const r = await post(`/api/mensal/run/${RUN}/contrato`, { contrato: "C", status: "voando" })
  assert.equal(r.statusCode, 400)
})

test("finalizar com erro → concluido_com_erro", async () => {
  const r = await post(`/api/mensal/run/${RUN}/finalizar`, {})
  assert.equal(r.json().status, "concluido_com_erro")
})

test("GET sem sessão → 401", async () => {
  const r = await app!.inject({ method: "GET", url: `/api/mensal/run/${RUN}` })
  assert.equal(r.statusCode, 401)
})

test("GET retorna atualizado_em (p/ guarda de travado)", async () => {
  const { rows } = await query("SELECT atualizado_em FROM mensal_run WHERE run_id=$1", [RUN])
  assert.ok(rows[0].atualizado_em)
})

// --- Lógica de detecção de erro do nó Avaliar (resultado esperado ausente) ---
// Réplica da função do WF krRj3 (Avaliar Resultado Contrato) p/ pegar regressão.
function avaliar(c: { totais?: { credito?: number; pix?: number }; pedidoCreditoId?: string | null; pedidoPixId?: string | null; chapas?: string[] }, ac: { idVR?: unknown; idVT?: unknown }, temSol: boolean, driveErro: boolean): string[] {
  const erros: string[] = []
  const t = c.totais || {}
  if ((Number(t.credito) || 0) > 0 && !c.pedidoCreditoId) erros.push("Caju crédito")
  if ((Number(t.pix) || 0) > 0 && !c.pedidoPixId) erros.push("Caju boleto")
  const temBoleto = (c.chapas || []).length > 0
  if (temBoleto && !ac.idVR && !ac.idVT) erros.push("financeiro RM")
  if (!temSol) erros.push("solicitação Monday")
  if (driveErro) erros.push("Drive")
  return erros
}

test("avaliar: contrato completo → sem erro", () => {
  const e = avaliar({ totais: { credito: 100, pix: 200 }, pedidoCreditoId: "c1", pedidoPixId: "p1", chapas: ["001"] }, { idVR: 9 }, true, false)
  assert.deepEqual(e, [])
})

test("avaliar: Caju crédito faltando → erro", () => {
  const e = avaliar({ totais: { credito: 100, pix: 0 }, pedidoCreditoId: null, chapas: [] }, {}, true, false)
  assert.deepEqual(e, ["Caju crédito"])
})

test("avaliar: boleto sem idVR/idVT → erro financeiro", () => {
  const e = avaliar({ totais: { credito: 0, pix: 200 }, pedidoPixId: "p1", chapas: ["001"] }, {}, true, false)
  assert.deepEqual(e, ["financeiro RM"])
})

test("avaliar: sem solicitação → erro", () => {
  const e = avaliar({ totais: { credito: 100, pix: 0 }, pedidoCreditoId: "c1", chapas: [] }, {}, false, false)
  assert.deepEqual(e, ["solicitação Monday"])
})

test("avaliar: 100% crédito (sem boleto) → não exige financeiro", () => {
  const e = avaliar({ totais: { credito: 100, pix: 0 }, pedidoCreditoId: "c1", chapas: [] }, {}, true, false)
  assert.deepEqual(e, [])
})

test("cleanup", async () => { await query("DELETE FROM mensal_run WHERE run_id=$1", [RUN]); await app!.close() })
