import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { usuarioDaSessao } from "../session.js"

// Histórico de ações (Postgres) — populado pelo frontend a cada acao de escrita.
// Quem fez = usuario da sessao (carimbado aqui, nao vem do front). n8n/board intocados.

interface LinhaAtividade {
  id: string
  acao: string
  uuid_alvo: string | null
  pessoa_nome: string | null
  contrato: string | null
  payload_resumo: unknown
  criado_em: string
  operador_email: string | null
  operador_nome: string | null
}

export async function rotasAtividade(app: FastifyInstance): Promise<void> {
  // Registra uma acao do usuario logado.
  app.post(
    "/api/atividade",
    async (
      req: FastifyRequest<{
        Body: {
          acao?: string
          alvo?: string | null
          pessoa?: string | null
          contrato?: string | null
          resumo?: unknown
        }
      }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const acao = (req.body?.acao ?? "").trim()
      if (!acao) return reply.code(400).send({ erro: "acao_obrigatoria" })
      const nomeOperador = [u.nome, u.sobrenome].filter(Boolean).join(" ").trim() || u.email
      await query(
        `INSERT INTO audit_lancamentos
           (user_id, operador_email, operador_nome, acao, uuid_alvo, pessoa_nome, contrato, payload_resumo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          u.id,
          u.email,
          nomeOperador,
          acao,
          req.body?.alvo ?? null,
          req.body?.pessoa ?? null,
          req.body?.contrato ?? null,
          req.body?.resumo != null ? JSON.stringify(req.body.resumo) : null,
        ],
      )
      return { ok: true }
    },
  )

  // Lista atividade. Padrao: so a propria. Admin com ?todos=1: de todos (com quem fez).
  app.get(
    "/api/atividade",
    async (
      req: FastifyRequest<{ Querystring: { todos?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      // "todos" liberado p/ DP e Admin (operacional/RH só vê o próprio).
      const todos = req.query.todos === "1" && (u.papel === "admin" || u.papel === "dp")
      const { rows } = await query<LinhaAtividade>(
        `SELECT id, acao, uuid_alvo, pessoa_nome, contrato, payload_resumo,
                criado_em, operador_email, operador_nome
           FROM audit_lancamentos
          ${todos ? "" : "WHERE user_id = $1"}
          ORDER BY criado_em DESC
          LIMIT 200`,
        todos ? [] : [u.id],
      )
      return { atividades: rows, escopo: todos ? "todos" : "proprio" }
    },
  )
}
