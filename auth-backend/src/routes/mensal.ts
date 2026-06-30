import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { usuarioDaSessao } from "../session.js"
import { mondayGraphql } from "../monday.js"

// Pagamento Mensal Intermitente — leituras pro app (escolher mês + conferir pessoas do grupo MENSAL).
// Só DP/Admin. O disparo do pagamento em si é via webhook do n8n (krRj3), não aqui.

const NIVEL: Record<string, number> = { operacional: 0, rh: 1, dp: 2, admin: 3 }

async function exigirDP(req: FastifyRequest, reply: FastifyReply) {
  const u = await usuarioDaSessao(req)
  if (!u) { reply.code(401).send({ erro: "nao_autenticado" }); return null }
  if ((NIVEL[u.papel] ?? 0) < NIVEL.dp) { reply.code(403).send({ erro: "sem_permissao" }); return null }
  return u
}

interface BoardRow { monday_board_id: string; competencia: string | null }

async function resolverBoard(papel: string): Promise<BoardRow | null> {
  const { rows } = await query<BoardRow>(
    `SELECT monday_board_id, competencia FROM boards
       WHERE papel = $1 AND ativo = true ORDER BY atualizado_em DESC LIMIT 1`,
    [papel],
  )
  return rows[0] ?? null
}
async function grupoMensal(boardId: string): Promise<string> {
  const { rows } = await query<{ group_id: string }>(
    `SELECT group_id FROM board_grupos WHERE monday_board_id = $1 AND upper(titulo) = 'MENSAL' LIMIT 1`,
    [boardId],
  )
  return rows[0]?.group_id ?? "group_mktahh9f"
}


export async function rotasMensal(app: FastifyInstance): Promise<void> {
  // meses disponíveis (atual / proximo) — pra tela de escolha
  app.get("/api/mensal/meses", async (req, reply) => {
    if (!(await exigirDP(req, reply))) return
    const atual = await resolverBoard("atual")
    const proximo = await resolverBoard("proximo")
    return {
      atual: atual ? { existe: true, board_id: atual.monday_board_id, competencia: atual.competencia } : { existe: false },
      proximo: proximo ? { existe: true, board_id: proximo.monday_board_id, competencia: proximo.competencia } : { existe: false },
    }
  })

  // pessoas do grupo MENSAL do board do papel escolhido (réplica pra conferência)
  app.get(
    "/api/mensal/pessoas",
    async (req: FastifyRequest<{ Querystring: { papel?: string } }>, reply) => {
      if (!(await exigirDP(req, reply))) return
      const papel = req.query.papel === "proximo" ? "proximo" : "atual"
      const board = await resolverBoard(papel)
      if (!board) return reply.code(404).send({ erro: "board_nao_encontrado" })
      const group = await grupoMensal(board.monday_board_id)
      let items: { name: string; column_values: { id: string; text: string; column: { title: string } }[] }[] = []
      try {
        const d = await mondayGraphql<{ boards: { groups: { items_page: { items: typeof items } }[] }[] }>(
          `query($ids:[ID!],$g:[String!]){ boards(ids:$ids){ groups(ids:$g){ items_page(limit:500){ items{ name column_values{ id text column{ title } } } } } } }`,
          { ids: [board.monday_board_id], g: [group] },
        )
        items = d.boards?.[0]?.groups?.[0]?.items_page?.items ?? []
      } catch (e) {
        req.log.error(e, "mensal pessoas monday")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
      const val = (cv: typeof items[0]["column_values"], t: string) => cv.find((c) => c.column.title === t)?.text ?? ""
      // Conferência: quem está no grupo MENSAL + de quais contratos. Os VALORES (VR/VT,
      // crédito/PIX) NÃO são calculados aqui — a automação n8n calcula no momento do pagamento
      // (board Valores + dias úteis). Aqui é só "quem/quantos por contrato".
      const pessoas = items
        .map((it) => {
          const cv = it.column_values
          return {
            nome: val(cv, "Nome do Empregado") || it.name,
            chapa: val(cv, "Funcionário"),
            cpf: val(cv, "CPF"),
            contrato: val(cv, "Op - Contrato"),
            funcao: val(cv, "Função"),
            unidade: val(cv, "Local/Unidade"),
            interior: val(cv, "OP - Interior?"),
          }
        })
        .filter((p) => (p.nome && p.nome !== "INTERMITENTE" ? true : !!p.chapa))
      // Agrupa por contrato (só contratos que tiveram convocação = têm pessoas).
      const mapaContratos = new Map<string, number>()
      for (const p of pessoas) {
        const c = (p.contrato || "").trim() || "(sem contrato)"
        mapaContratos.set(c, (mapaContratos.get(c) ?? 0) + 1)
      }
      const porContrato = [...mapaContratos.entries()]
        .map(([contrato, qtd]) => ({ contrato, qtd }))
        .sort((a, b) => b.qtd - a.qtd)
      return {
        papel,
        board_id: board.monday_board_id,
        competencia: board.competencia,
        total: pessoas.length,
        porContrato,
        pessoas,
      }
    },
  )
}
