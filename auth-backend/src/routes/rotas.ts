import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { query } from "../db.js"
import { usuarioDaSessao } from "../session.js"
import { temRmSoap } from "../clients/rmSoap.js"

// Chaveamento do Plano de Fuga: modo por processo (n8n | auto | api) em pi.rotas_processo.
// GET = qualquer sessão (o front precisa saber pra onde chamar). PATCH = admin (flip manual).

const MODOS = new Set(["n8n", "auto", "api"])

/**
 * Estado das flags que ligam efeito real no RM. BOOLEANOS, nunca valores.
 *
 * Existe porque `vercel env pull` não devolve valor nenhum neste projeto (volta vazio até pra
 * DATABASE_URL), então não havia como conferir se uma flag pegou depois do deploy. E flag
 * desligada aqui não dá erro: o serviço volta `nota: "desligado"` e não faz nada — no mesmo dia
 * isso comeu duas execuções antes de alguém perceber.
 */
function flagsRm(): Record<string, boolean> {
  return {
    convocacao_rm: config.convocacaoRmHabilitada,
    // Lida direto do env: esta flag só é consumida no workflow (workflows/mensal.ts), que roda
    // fora do config do backend.
    convocacao_rm_mensal: process.env.CONVOCACAO_RM_MENSAL_HABILITADA === "1",
    atestado_quebra: config.atestadoQuebraConvocacao,
    split_rm: config.convocacaoRmHabilitada && String(process.env.SPLIT_RM_HABILITADO ?? "1") !== "0",
    rm_soap_configurado: temRmSoap(),
  }
}

export async function rotasRotas(app: FastifyInstance): Promise<void> {
  app.get("/api/rotas", async (req: FastifyRequest, reply: FastifyReply) => {
    // Sessão OU token de serviço: sem o segundo, conferir flag depois do deploy exigia navegador
    // logado, que é justamente o que não se tem num check de linha de comando.
    const tokenOk =
      !!config.serviceToken &&
      String(req.headers["x-service-token"] ?? "").trim() === config.serviceToken
    if (!tokenOk && !(await usuarioDaSessao(req))) return reply.code(401).send({ erro: "nao_autenticado" })
    const { rows } = await query<{ processo: string; modo: string }>(
      `SELECT processo, modo FROM rotas_processo`,
    )
    const mapa: Record<string, string> = {}
    for (const r of rows) mapa[r.processo] = r.modo
    reply.header("Cache-Control", "private, max-age=60")
    return { rotas: mapa, flags_rm: flagsRm() }
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
