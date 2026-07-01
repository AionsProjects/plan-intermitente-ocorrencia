import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { config } from "../config.js"
import { usuarioDaSessao } from "../session.js"

// Acompanhamento ao vivo do pagamento mensal. O n8n (krRj3) escreve o progresso via X-Service-Token;
// o front lê via sessão DP e faz polling. Estado em pi.mensal_run / pi.mensal_run_item.

const NIVEL: Record<string, number> = { operacional: 0, rh: 1, dp: 2, admin: 3 }

async function exigirDP(req: FastifyRequest, reply: FastifyReply) {
  const u = await usuarioDaSessao(req)
  if (!u) { reply.code(401).send({ erro: "nao_autenticado" }); return null }
  if ((NIVEL[u.papel] ?? 0) < NIVEL.dp) { reply.code(403).send({ erro: "sem_permissao" }); return null }
  return u
}

// Header de serviço (X-Service-Token) — n8n sem sessão. Mesmo padrão de boards.ts.
function temServiceToken(req: FastifyRequest): boolean {
  const t = String(req.headers["x-service-token"] ?? "").trim()
  return !!config.serviceToken && t === config.serviceToken
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Recalcula contadores do run a partir dos itens (não incremental → à prova de retry).
async function recalcular(runId: string): Promise<{ ok: number; erro: number }> {
  const { rows } = await query<{ ok: string; erro: string }>(
    `SELECT
       count(*) FILTER (WHERE status = 'ok')   AS ok,
       count(*) FILTER (WHERE status = 'erro') AS erro
     FROM mensal_run_item WHERE run_id = $1`,
    [runId],
  )
  const ok = Number(rows[0]?.ok ?? 0)
  const erro = Number(rows[0]?.erro ?? 0)
  await query(
    `UPDATE mensal_run SET ok_contratos = $2, erro_contratos = $3, atualizado_em = now() WHERE run_id = $1`,
    [runId, ok, erro],
  )
  return { ok, erro }
}

interface ContratoInit { contrato: string; ordem: number; qtd?: number }

export async function rotasMensalRun(app: FastifyInstance): Promise<void> {
  // n8n: registra o run + a lista real de contratos. Idempotente.
  app.post(
    "/api/mensal/run/iniciar",
    async (
      req: FastifyRequest<{
        Body: { run_id?: string; papel?: string; competencia?: string; operador_email?: string; contratos?: ContratoInit[] }
      }>,
      reply: FastifyReply,
    ) => {
      if (!temServiceToken(req)) return reply.code(401).send({ erro: "nao_autorizado" })
      const runId = String(req.body?.run_id ?? "").trim()
      if (!UUID_RE.test(runId)) return reply.code(400).send({ erro: "run_id_invalido" })
      const contratos = Array.isArray(req.body?.contratos) ? req.body!.contratos! : []
      await query(
        `INSERT INTO mensal_run (run_id, papel, competencia, operador_email, status, total_contratos)
           VALUES ($1, $2, $3, $4, 'rodando', $5)
         ON CONFLICT (run_id) DO UPDATE
           SET papel = EXCLUDED.papel, competencia = EXCLUDED.competencia,
               operador_email = COALESCE(EXCLUDED.operador_email, mensal_run.operador_email),
               status = 'rodando', total_contratos = EXCLUDED.total_contratos, atualizado_em = now()`,
        [runId, req.body?.papel ?? "", req.body?.competencia ?? null, req.body?.operador_email ?? null, contratos.length],
      )
      for (const c of contratos) {
        await query(
          `INSERT INTO mensal_run_item (run_id, ordem, contrato, qtd, status)
             VALUES ($1, $2, $3, $4, 'pendente')
           ON CONFLICT (run_id, contrato) DO NOTHING`,
          [runId, Number(c.ordem) || 0, String(c.contrato ?? ""), Number(c.qtd) || 0],
        )
      }
      return { ok: true, total: contratos.length }
    },
  )

  // n8n: marca um contrato como rodando | ok | erro.
  app.post(
    "/api/mensal/run/:runId/contrato",
    async (
      req: FastifyRequest<{
        Params: { runId: string }
        Body: { contrato?: string; ordem?: number; qtd?: number; status?: string; erro_msg?: string }
      }>,
      reply: FastifyReply,
    ) => {
      if (!temServiceToken(req)) return reply.code(401).send({ erro: "nao_autorizado" })
      const runId = String(req.params.runId ?? "").trim()
      if (!UUID_RE.test(runId)) return reply.code(400).send({ erro: "run_id_invalido" })
      const contrato = String(req.body?.contrato ?? "").trim()
      const status = String(req.body?.status ?? "").trim()
      if (!contrato) return reply.code(400).send({ erro: "contrato_obrigatorio" })
      if (!["rodando", "ok", "erro"].includes(status)) return reply.code(400).send({ erro: "status_invalido" })
      const rodando = status === "rodando"
      await query(
        `INSERT INTO mensal_run_item (run_id, ordem, contrato, qtd, status, erro_msg, iniciado_em, finalizado_em)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN NULL ELSE now() END)
         ON CONFLICT (run_id, contrato) DO UPDATE
           SET status = EXCLUDED.status,
               erro_msg = EXCLUDED.erro_msg,
               ordem = CASE WHEN EXCLUDED.ordem > 0 THEN EXCLUDED.ordem ELSE mensal_run_item.ordem END,
               qtd = CASE WHEN EXCLUDED.qtd > 0 THEN EXCLUDED.qtd ELSE mensal_run_item.qtd END,
               iniciado_em = COALESCE(mensal_run_item.iniciado_em, CASE WHEN $7 THEN now() END),
               finalizado_em = CASE WHEN $7 THEN NULL ELSE now() END`,
        [runId, Number(req.body?.ordem) || 0, contrato, Number(req.body?.qtd) || 0, status, req.body?.erro_msg ?? null, rodando],
      )
      await recalcular(runId)
      return { ok: true }
    },
  )

  // n8n: finaliza o run. Backend decide concluido vs concluido_com_erro pelos contadores.
  app.post(
    "/api/mensal/run/:runId/finalizar",
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      if (!temServiceToken(req)) return reply.code(401).send({ erro: "nao_autorizado" })
      const runId = String(req.params.runId ?? "").trim()
      if (!UUID_RE.test(runId)) return reply.code(400).send({ erro: "run_id_invalido" })
      const { erro } = await recalcular(runId)
      const status = erro > 0 ? "concluido_com_erro" : "concluido"
      await query(
        `UPDATE mensal_run SET status = $2, finalizado_em = now(), atualizado_em = now() WHERE run_id = $1`,
        [runId, status],
      )
      return { ok: true, status }
    },
  )

  // Front: lê o estado do run (polling). Run inexistente → 200 { run: null } (não 404).
  app.get(
    "/api/mensal/run/:runId",
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      if (!(await exigirDP(req, reply))) return
      const runId = String(req.params.runId ?? "").trim()
      if (!UUID_RE.test(runId)) return reply.code(400).send({ erro: "run_id_invalido" })
      const { rows: runs } = await query(
        `SELECT run_id, papel, competencia, status, total_contratos, ok_contratos, erro_contratos,
                criado_em, atualizado_em, finalizado_em
           FROM mensal_run WHERE run_id = $1`,
        [runId],
      )
      if (!runs.length) return { run: null, itens: [] }
      const { rows: itens } = await query(
        `SELECT ordem, contrato, qtd, status, erro_msg FROM mensal_run_item WHERE run_id = $1 ORDER BY ordem`,
        [runId],
      )
      return { run: runs[0], itens }
    },
  )
}
