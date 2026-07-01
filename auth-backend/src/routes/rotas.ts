import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { usuarioDaSessao } from "../session.js"

// Chaveamento do Plano de Fuga: modo por processo (n8n | auto | api) em pi.rotas_processo.
// GET = qualquer sessão (o front precisa saber pra onde chamar). PATCH = admin (flip manual).

const MODOS = new Set(["n8n", "auto", "api"])

export async function rotasRotas(app: FastifyInstance): Promise<void> {
  app.get("/api/rotas", async (req: FastifyRequest, reply: FastifyReply) => {
    const u = await usuarioDaSessao(req)
    if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
    const { rows } = await query<{ processo: string; modo: string }>(
      `SELECT processo, modo FROM rotas_processo`,
    )
    const mapa: Record<string, string> = {}
    for (const r of rows) mapa[r.processo] = r.modo
    reply.header("Cache-Control", "private, max-age=60")
    return { rotas: mapa }
  })

  app.patch(
    "/api/rotas/:processo",
    async (
      req: FastifyRequest<{ Params: { processo: string }; Body: { modo?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin") return reply.code(403).send({ erro: "sem_permissao" })
      const processo = String(req.params.processo ?? "").trim()
      const modo = String(req.body?.modo ?? "").trim()
      if (!processo) return reply.code(400).send({ erro: "processo_obrigatorio" })
      if (!MODOS.has(modo)) return reply.code(400).send({ erro: "modo_invalido" })
      await query(
        `INSERT INTO rotas_processo (processo, modo) VALUES ($1, $2)
         ON CONFLICT (processo) DO UPDATE SET modo = EXCLUDED.modo, atualizado_em = now()`,
        [processo, modo],
      )
      return { ok: true, processo, modo }
    },
  )
}
