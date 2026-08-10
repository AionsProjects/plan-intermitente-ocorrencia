import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { tick } from "../jobs/runner.js"

// Tick da fila de jobs. Avança jobs devidos 1 passo cada (serverless-safe).
//
// ⚠️ Existe o par GET/POST pelo mesmo motivo de routes/bloqueio.ts: o **Vercel Cron só faz GET**,
// então um cron apontando pro POST responderia 404 e pareceria configurado enquanto nada roda.
// O GET é o do cron; o POST é o disparo manual (dev/n8n).
//
// ⚠️ Cadência: a conta é HOBBY e só aceita cron DIÁRIO (o `*/15` foi recusado no deploy — ver
// commit c64eeac). O cron da Vercel aqui é só REDE DE SEGURANÇA pra job que ficou pra trás; o
// caminho normal da convocação pontual é o próprio request do /convocar, que grava inline.
//
// ⚠️ E não tente documentar isso no vercel.json: propriedade extra ali NÃO é ignorada, o deploy
// falha — sem log de build, o que faz parecer problema de infra. Aconteceu duas vezes (commits
// 85f8f895 e o `_comment_crons` deste trabalho, que derrubou 6 deploys seguidos).
export async function rotasJobs(app: FastifyInstance): Promise<void> {
  const autorizado = (req: FastifyRequest): boolean => {
    const secret = process.env.CRON_SECRET
    if (!secret) return true // sem segredo configurado, não trava (mesma escolha de bloqueio.ts)
    const h = req.headers["authorization"] || req.headers["x-cron-secret"]
    return h === `Bearer ${secret}` || h === secret
  }

  const executar = async (
    req: FastifyRequest<{ Querystring: { limite?: string; tipo?: string } }>,
    reply: FastifyReply,
  ) => {
    if (!autorizado(req)) return reply.code(401).send({ erro: "nao_autorizado" })
    const limite = Math.min(20, Math.max(1, Number(req.query.limite) || 5))
    const tipo = (req.query.tipo || "").trim() || undefined
    return { ok: true, ...(await tick(limite, tipo)) }
  }

  app.get("/api/jobs/tick", executar)
  app.post("/api/jobs/tick", executar)
}
