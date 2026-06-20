import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { query } from "../db.js"
import { usuarioDaSessao } from "../session.js"
import {
  criarWebhook,
  lerColunas,
  lerGrupos,
  listarWebhooks,
} from "../monday.js"

// Registry de boards Monday (virada de mês). Resolve column_id por TÍTULO (estável).
// `ativar` = coluna que dispara o webhook do WF1 (gera link de registro).
const COLUNA_ATIVAR = "ativar"

interface BoardRow {
  monday_board_id: string
  competencia: string | null
  papel: string
  ativo: boolean
}

async function exigirAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const u = await usuarioDaSessao(req)
  if (!u) {
    reply.code(401).send({ erro: "nao_autenticado" })
    return false
  }
  if (u.papel !== "admin") {
    reply.code(403).send({ erro: "sem_permissao" })
    return false
  }
  return true
}

// Header de serviço (X-Service-Token) — usado pelo WF de virada (n8n, sem sessão).
function temServiceToken(req: FastifyRequest): boolean {
  const t = String((req.headers["x-service-token"] ?? "")).trim()
  return !!config.serviceToken && t === config.serviceToken
}

// Lê colunas+grupos do board no Monday e grava no registry (boards/board_colunas/board_grupos).
// Idempotente. Reusado por /registrar e /virada.
async function registrarBoard(
  boardId: string,
  competencia: string | null,
  papel: string,
): Promise<{ colunas: number; grupos: number }> {
  const colunas = await lerColunas(boardId)
  if (colunas.length === 0) throw new Error("board_sem_colunas")
  await query(
    `INSERT INTO boards (monday_board_id, competencia, papel)
       VALUES ($1, $2, $3)
     ON CONFLICT (monday_board_id) DO UPDATE
       SET competencia = EXCLUDED.competencia, papel = EXCLUDED.papel,
           ativo = true, atualizado_em = now()`,
    [boardId, competencia, papel],
  )
  await query(`DELETE FROM board_colunas WHERE monday_board_id = $1`, [boardId])
  for (const c of colunas) {
    await query(
      `INSERT INTO board_colunas (monday_board_id, nome, column_id, tipo)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (monday_board_id, nome) DO UPDATE
         SET column_id = EXCLUDED.column_id, tipo = EXCLUDED.tipo`,
      [boardId, c.title, c.id, c.type],
    )
  }
  let grupos: { id: string; title: string }[] = []
  try { grupos = await lerGrupos(boardId) } catch { /* grupos best-effort */ }
  await query(`DELETE FROM board_grupos WHERE monday_board_id = $1`, [boardId])
  for (const g of grupos) {
    await query(
      `INSERT INTO board_grupos (monday_board_id, titulo, group_id)
         VALUES ($1, $2, $3)
       ON CONFLICT (monday_board_id, titulo) DO UPDATE SET group_id = EXCLUDED.group_id`,
      [boardId, g.title, g.id],
    )
  }
  return { colunas: colunas.length, grupos: grupos.length }
}

export async function rotasBoards(app: FastifyInstance): Promise<void> {
  // Registra/atualiza um board: lê colunas do Monday, grava title->id. Idempotente.
  // Admin-only (operação sensível). A virada (n8n) usa o mesmo via token de serviço — por
  // ora deixamos admin; quando o WF chamar, criar um header de serviço.
  app.post(
    "/api/boards/registrar",
    async (
      req: FastifyRequest<{
        Body: { monday_board_id?: string; competencia?: string; papel?: string }
      }>,
      reply: FastifyReply,
    ) => {
      // Admin (sessão) OU service token (WF n8n).
      if (!temServiceToken(req) && !(await exigirAdmin(req, reply))) return
      const boardId = String(req.body?.monday_board_id ?? "").trim()
      const papel = req.body?.papel ?? "atual"
      if (!boardId) return reply.code(400).send({ erro: "board_id_obrigatorio" })
      try {
        const r = await registrarBoard(boardId, req.body?.competencia ?? null, papel)
        return { ok: true, board_id: boardId, ...r }
      } catch (e) {
        req.log.error(e, "erro registrar")
        const msg = e instanceof Error ? e.message : ""
        if (msg === "board_sem_colunas") return reply.code(404).send({ erro: "board_sem_colunas" })
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )

  // Virada de mês (chamado pelo WF n8n via X-Service-Token). Promove papéis +
  // registra a cópia (mês corrente = atual) e o central (mês seguinte = proximo).
  // Modelo: dia 15 duplica; cópia=atual (convocações vivas), central=proximo (futuro);
  // o atual anterior vira passado.
  app.post(
    "/api/boards/virada",
    async (
      req: FastifyRequest<{
        Body: {
          copia_board_id?: string
          copia_competencia?: string
          central_board_id?: string
          central_competencia?: string
          dry_run?: boolean
        }
      }>,
      reply: FastifyReply,
    ) => {
      if (!temServiceToken(req)) return reply.code(401).send({ erro: "service_token_invalido" })
      const copiaId = String(req.body?.copia_board_id ?? "").trim()
      const centralId = String(req.body?.central_board_id ?? "").trim()
      if (!copiaId || !centralId) return reply.code(400).send({ erro: "board_ids_obrigatorios" })
      const dryRun = req.body?.dry_run === true
      try {
        if (dryRun) {
          // Valida acesso aos boards no Monday (lê colunas+grupos) SEM gravar nada.
          const c = await lerColunas(copiaId)
          const k = await lerColunas(centralId)
          return {
            ok: true,
            dry_run: true,
            copia: { board_id: copiaId, colunas: c.length },
            central: { board_id: centralId, colunas: k.length },
            faria: "atual->passado; copia=atual; central=proximo",
          }
        }
        // 1) atual vigente -> passado (exceto os 2 boards desta virada).
        await query(
          `UPDATE boards SET papel = 'passado', atualizado_em = now()
            WHERE papel = 'atual' AND monday_board_id <> ALL($1)`,
          [[copiaId, centralId]],
        )
        // 2) cópia = atual (mês corrente); central = proximo (mês seguinte).
        const c = await registrarBoard(copiaId, req.body?.copia_competencia ?? null, "atual")
        const k = await registrarBoard(centralId, req.body?.central_competencia ?? null, "proximo")
        return { ok: true, copia: { board_id: copiaId, ...c }, central: { board_id: centralId, ...k } }
      } catch (e) {
        req.log.error(e, "erro virada")
        return reply.code(502).send({ erro: "virada_falhou" })
      }
    },
  )

  // Resolve um board (por board_id, papel OU competência) -> board_id + mapa nome->column_id.
  // Consumido pelos WFs (Code node "preparar") e front. Sem sessão (lookup, dado não sensível).
  // board_id: usado pelo WF1 (event.boardId) — resolve as colunas do board que disparou.
  app.get(
    "/api/boards/resolver",
    async (
      req: FastifyRequest<{ Querystring: { papel?: string; competencia?: string; board_id?: string } }>,
      reply: FastifyReply,
    ) => {
      const { papel, competencia, board_id } = req.query
      const cond = board_id ? "monday_board_id = $1" : competencia ? "competencia = $1" : "papel = $1"
      const val = board_id ?? competencia ?? papel ?? "atual"
      const { rows } = await query<BoardRow>(
        `SELECT monday_board_id, competencia, papel, ativo FROM boards
          WHERE ${cond} AND ativo = true ORDER BY atualizado_em DESC LIMIT 1`,
        [val],
      )
      const b = rows[0]
      if (!b) return reply.code(404).send({ erro: "board_nao_encontrado" })
      const { rows: cols } = await query<{ nome: string; column_id: string }>(
        `SELECT nome, column_id FROM board_colunas WHERE monday_board_id = $1`,
        [b.monday_board_id],
      )
      const colunas: Record<string, string> = {}
      for (const c of cols) colunas[c.nome] = c.column_id
      const { rows: grps } = await query<{ titulo: string; group_id: string }>(
        `SELECT titulo, group_id FROM board_grupos WHERE monday_board_id = $1`,
        [b.monday_board_id],
      )
      const grupos: Record<string, string> = {}
      for (const g of grps) grupos[g.titulo] = g.group_id
      return {
        board_id: b.monday_board_id,
        competencia: b.competencia,
        papel: b.papel,
        colunas,
        grupos,
      }
    },
  )

  // Garante o webhook "ativar" no board (cria se não existe). Idempotente.
  app.post(
    "/api/boards/garantir-webhook",
    async (
      req: FastifyRequest<{ Body: { monday_board_id?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!(await exigirAdmin(req, reply))) return
      const boardId = String(req.body?.monday_board_id ?? "").trim()
      if (!boardId) return reply.code(400).send({ erro: "board_id_obrigatorio" })

      // Descobre o column_id da coluna "ativar" no registry (resolvida por nome).
      const { rows } = await query<{ column_id: string }>(
        `SELECT column_id FROM board_colunas WHERE monday_board_id = $1 AND nome = $2`,
        [boardId, COLUNA_ATIVAR],
      )
      const columnId = rows[0]?.column_id
      if (!columnId) {
        return reply.code(409).send({ erro: "coluna_ativar_nao_registrada" })
      }

      try {
        // Evita duplicar: se já há webhook pra essa URL/coluna, não recria.
        const existentes = await listarWebhooks(boardId)
        const jaTem = existentes.some((w) => (w.config ?? "").includes(columnId))
        if (jaTem) return { ok: true, criado: false }
        const wh = await criarWebhook(boardId, config.n8nWebhookAtivar, columnId)
        return { ok: true, criado: true, webhook_id: wh.id }
      } catch (e) {
        req.log.error(e, "erro garantir-webhook")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )
}
