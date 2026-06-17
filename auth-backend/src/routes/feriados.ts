import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { lerItens } from "../monday.js"

// Le o board FERIADOS do Monday ao vivo (DP edita la). Substitui o n8n
// /intermitente-feriados. Publico (/preencher e link publico usam). Cache curto
// em memoria da funcao (reduz chamadas Monday em invocacoes quentes).
const BOARD_FERIADOS = "18415442661"
const COL_DATA = "date_mm3t5bgd"
const COL_TIPO = "color_mm3t72h3"
const COL_CONTRATOS = "dropdown_mm3t4wjp"
const CACHE_MS = 5 * 60 * 1000

interface Feriado {
  data: string
  nome: string
  tipo: string
  contratos: string[]
}

let cache: { em: number; dados: Feriado[] } | null = null

function parseContratos(text: string | null): string[] {
  if (!text) return []
  // dropdown vem como "A, B, C"
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

async function carregar(): Promise<Feriado[]> {
  const itens = await lerItens(BOARD_FERIADOS, [COL_DATA, COL_TIPO, COL_CONTRATOS])
  const out: Feriado[] = []
  for (const it of itens) {
    const byId = new Map(it.column_values.map((c) => [c.id, c.text]))
    const data = byId.get(COL_DATA) ?? ""
    if (!data) continue
    out.push({
      data,
      nome: it.name,
      tipo: byId.get(COL_TIPO) ?? "",
      contratos: parseContratos(byId.get(COL_CONTRATOS) ?? null),
    })
  }
  return out
}

export async function rotasFeriados(app: FastifyInstance): Promise<void> {
  app.get("/api/feriados", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!cache || Date.now() - cache.em > CACHE_MS) {
        cache = { em: Date.now(), dados: await carregar() }
      }
      return { feriados: cache.dados }
    } catch (e) {
      req.log.error(e, "erro carregar feriados")
      // Forma compativel: front cai no fallback NACIONAL se vier vazio/erro.
      return reply.code(502).send({ erro: "monday_falhou", feriados: [] })
    }
  })
}
