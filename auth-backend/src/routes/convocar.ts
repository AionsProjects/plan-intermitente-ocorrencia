import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { lerColunasSettings } from "../monday.js"

// Opções do form de convocação: labels das colunas status do board Entrada ATUAL
// (resolvido pelo registry, por nome — robusto à virada). unidadesPorContrato vem do RM
// (n8n-thin, F6) — por ora {} e o front usa OPCOES_CONVOCACAO_FALLBACK.
// Nomes canônicos (título) das colunas status no board Entrada:
const NOMES = {
  solicitantes: "Solicitante",
  contratos: "Op - Contrato",
  sabados: "OP - Sábado?",
  insalubridades: "Op - Insalubridade?",
  interiores: "OP - Interior?",
  justificativas: "OP - Justificativa",
} as const
const NOME_UNIDADE = "OP - Local/Unidade"

function extrairLabels(settingsStr: string): string[] {
  try {
    const s = JSON.parse(settingsStr) as { labels?: unknown }
    const labels = s.labels
    if (Array.isArray(labels)) {
      return labels
        .map((l) => (typeof l === "string" ? l : (l as { name?: string })?.name))
        .filter((x): x is string => !!x)
    }
    if (labels && typeof labels === "object") {
      return Object.entries(labels as Record<string, string>)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v)
        .filter(Boolean)
    }
  } catch { /* ignore */ }
  return []
}

export async function rotasConvocar(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/convocar/opcoes",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        // board atual + mapa nome->column_id do registry
        const { rows: br } = await query<{ monday_board_id: string }>(
          `SELECT monday_board_id FROM boards WHERE papel='atual' AND ativo=true LIMIT 1`,
        )
        const boardId = br[0]?.monday_board_id
        if (!boardId) return reply.code(404).send({ erro: "board_atual_nao_registrado" })
        const { rows: cols } = await query<{ nome: string; column_id: string }>(
          `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`, [boardId],
        )
        const idPorNome = new Map(cols.map((c) => [c.nome, c.column_id]))
        const idsParaLer = Object.values(NOMES)
          .map((n) => idPorNome.get(n)).filter((x): x is string => !!x)
        const colsSettings = await lerColunasSettings(boardId, idsParaLer)
        const settingsPorId = new Map(colsSettings.map((c) => [c.id, c.settings_str]))
        const labelsDe = (nome: string): string[] => {
          const id = idPorNome.get(nome)
          const ss = id ? settingsPorId.get(id) : undefined
          return ss ? extrairLabels(ss) : []
        }
        return {
          ok: true,
          opcoes: {
            solicitantes: labelsDe(NOMES.solicitantes),
            contratos: labelsDe(NOMES.contratos),
            sabados: labelsDe(NOMES.sabados),
            insalubridades: labelsDe(NOMES.insalubridades),
            interiores: labelsDe(NOMES.interiores),
            justificativas: labelsDe(NOMES.justificativas),
            unidades_por_contrato: {}, // RM (n8n-thin) — F6; front usa fallback
            unidade_column_id: idPorNome.get(NOME_UNIDADE) ?? null,
          },
        }
      } catch (e) {
        req.log.error(e, "erro convocar-opcoes")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )
}
