import type { FastifyInstance, FastifyRequest } from "fastify"
import { tick } from "../jobs/runner.js"

// Tick da fila de jobs — chamado pelo Vercel Cron. Protegido por header secret
// (CRON_SECRET). Avança jobs devidos 1 passo cada (serverless-safe).
export async function rotasJobs(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/jobs/tick",
    async (req: FastifyRequest<{ Querystring: { limite?: string } }>, reply) => {
      const secret = process.env.CRON_SECRET
      if (secret) {
        const h = req.headers["authorization"] || req.headers["x-cron-secret"]
        const ok = h === `Bearer ${secret}` || h === secret
        if (!ok) return reply.code(401).send({ erro: "nao_autorizado" })
      }
      const limite = Math.min(20, Math.max(1, Number(req.query.limite) || 5))
      const r = await tick(limite)
      return { ok: true, ...r }
    },
  )
}
