// Rotas da Verificação de Alteração Intermitente.
//
// O DP abre a janela quando começa a calcular a folha e fecha quando termina. Enquanto
// ela está aberta, o monitor observa o board INTEIRO: todo item, todo evento. Tudo é
// gravado; só um recorte vira WhatsApp. O relatório lê a tabela toda — é onde aparece
// inclusive a edição do próprio DP, que não gera alerta (caso DETRAN).
//
// Gate: papel dp/admin, mesmo padrão de mensalRun.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { usuarioDaSessao } from "../session.js"
import {
  abrirBloqueio, fecharBloqueio, lerBloqueio, listarBloqueios, boardsDoBloqueio,
  alteracoesDoBloqueio, relatorio, boardsDaCompetencia, vigiarBoards,
} from "../repo/bloqueio.js"
import { varrerBloqueio, varrerTodos } from "../services/sweepBloqueio.js"
import { notificarAlteracoes } from "../services/notificarAlteracao.js"
import { config } from "../config.js"

const NIVEL: Record<string, number> = { operacional: 0, rh: 1, dp: 2, admin: 3 }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPETENCIA_RE = /^\d{4}-(0[1-9]|1[0-2])$/

async function exigirDP(req: FastifyRequest, reply: FastifyReply) {
  const u = await usuarioDaSessao(req)
  if (!u) { reply.code(401).send({ erro: "nao_autenticado" }); return null }
  if ((NIVEL[u.papel] ?? 0) < NIVEL.dp) { reply.code(403).send({ erro: "sem_permissao" }); return null }
  return u
}

async function exigirBloqueio(id: string, reply: FastifyReply) {
  if (!UUID_RE.test(id)) { reply.code(400).send({ erro: "id_invalido" }); return null }
  const b = await lerBloqueio(id)
  if (!b) { reply.code(404).send({ erro: "bloqueio_nao_encontrado" }); return null }
  return b
}

export async function rotasBloqueio(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Abrir a janela. Os boards saem do REGISTRY pela competência — nunca por
  // `papel=atual`, que fica defasado entre o dia 1 e a virada do dia 14.
  // -------------------------------------------------------------------------
  app.post(
    "/api/bloqueio",
    async (
      req: FastifyRequest<{
        Body: {
          competencia?: string
          boards?: number[]
          motivo?: string
          destino_whatsapp?: string
          modo_notificacao?: "imediato" | "digest"
          digest_min?: number
          teto_msgs_hora?: number
        }
      }>,
      reply: FastifyReply,
    ) => {
      const u = await exigirDP(req, reply)
      if (!u) return

      const competencia = String(req.body?.competencia ?? "").trim()
      if (!COMPETENCIA_RE.test(competencia)) {
        return reply.code(400).send({ erro: "competencia_invalida", esperado: "YYYY-MM" })
      }

      const boards = req.body?.boards?.length
        ? req.body.boards.map(Number).filter(Boolean)
        : await boardsDaCompetencia(competencia)
      if (!boards.length) {
        // Sem board no registry a janela nasceria cega — melhor recusar que fingir vigiar.
        return reply.code(422).send({ erro: "sem_board_para_competencia", competencia })
      }

      try {
        const b = await abrirBloqueio({
          competencia,
          boards,
          usuarioId: u.id,
          email: u.email,
          motivo: req.body?.motivo ?? null,
          destino: req.body?.destino_whatsapp ?? null,
          modo: req.body?.modo_notificacao,
          digestMin: req.body?.digest_min,
          tetoMsgsHora: req.body?.teto_msgs_hora,
        })
        req.log.info({ bloqueio: b.id, competencia, boards, por: u.email }, "bloqueio aberto")
        return { ok: true, bloqueio: b, boards }
      } catch (e) {
        // Índice único parcial: uma janela ABERTA por competência (fechadas repetem).
        if ((e as { code?: string }).code === "23505") {
          return reply.code(409).send({ erro: "ja_existe_bloqueio_aberto", competencia })
        }
        throw e
      }
    },
  )

  // Fechar. Idempotente por status: fechar de novo devolve 409, não quebra nada.
  app.post(
    "/api/bloqueio/:id/fechar",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const u = await exigirDP(req, reply)
      if (!u) return
      const b = await exigirBloqueio(req.params.id, reply)
      if (!b) return
      const fechado = await fecharBloqueio(b.id, u.id, u.email)
      if (!fechado) return reply.code(409).send({ erro: "bloqueio_ja_fechado" })
      req.log.info({ bloqueio: b.id, por: u.email }, "bloqueio fechado")
      return { ok: true, bloqueio: fechado, relatorio: await relatorio(b.id) }
    },
  )

  // Acrescentar board à janela aberta — usado quando a Virada de Board roda no meio
  // do fechamento e a competência migra pro board cópia.
  app.post(
    "/api/bloqueio/:id/boards",
    async (req: FastifyRequest<{ Params: { id: string }; Body: { boards?: number[] } }>, reply: FastifyReply) => {
      const u = await exigirDP(req, reply)
      if (!u) return
      const b = await exigirBloqueio(req.params.id, reply)
      if (!b) return
      if (b.status !== "aberto") return reply.code(409).send({ erro: "bloqueio_fechado" })
      const novos = (req.body?.boards ?? []).map(Number).filter(Boolean)
      if (!novos.length) return reply.code(400).send({ erro: "boards_obrigatorio" })
      await vigiarBoards(b.id, novos)
      return { ok: true, boards: await boardsDoBloqueio(b.id) }
    },
  )

  // Tick do sweep. No-op quando não há janela aberta.
  //
  // ⚠️ O Vercel Cron só faz **GET** — por isso existe o par GET/POST. O GET é o do cron
  // (auth por `CRON_SECRET`, mesmo padrão de `jobs.ts`); o POST é o do DP/n8n forçando
  // uma varredura (auth por sessão ou `X-Service-Token`).
  async function autorizadoCron(req: FastifyRequest): Promise<boolean> {
    const secret = process.env.CRON_SECRET
    if (!secret) return true // sem segredo configurado, não trava (mesma escolha de jobs.ts)
    const h = req.headers["authorization"] || req.headers["x-cron-secret"]
    return h === `Bearer ${secret}` || h === secret
  }

  app.get(
    "/api/bloqueio/varrer",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!(await autorizadoCron(req))) return reply.code(401).send({ erro: "nao_autorizado" })
      return varrerENotificar()
    },
  )

  app.post(
    "/api/bloqueio/varrer",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const porServico =
        !!config.serviceToken &&
        String(req.headers["x-service-token"] ?? "").trim() === config.serviceToken
      if (!porServico && !(await exigirDP(req, reply))) return
      return varrerENotificar()
    },
  )

  async function varrerENotificar() {
    const r = await varrerTodos()
    const envios = []
    for (const v of r) envios.push(await notificarAlteracoes(v.bloqueio, v.novasParaNotificar))
    return {
      ok: true,
      janelas: r.length,
      boards: r.flatMap((x) => x.boards),
      a_notificar: r.reduce((n, x) => n + x.novasParaNotificar.length, 0),
      mensagens: envios.reduce((n, e) => n + e.mensagens, 0),
      enviadas: envios.reduce((n, e) => n + e.enviadas, 0),
      falhas: envios.reduce((n, e) => n + e.falhas, 0),
      envio_ativo: envios[0]?.envioAtivo ?? false,
    }
  }

  app.post(
    "/api/bloqueio/:id/varrer",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!(await exigirDP(req, reply))) return
      const b = await exigirBloqueio(req.params.id, reply)
      if (!b) return
      if (b.status !== "aberto") return reply.code(409).send({ erro: "bloqueio_fechado" })
      const r = await varrerBloqueio(b)
      const n = await notificarAlteracoes(b, r.novasParaNotificar)
      return { ok: true, boards: r.boards, a_notificar: r.novasParaNotificar.length, notificacao: n }
    },
  )

  app.get(
    "/api/bloqueio",
    async (req: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      if (!(await exigirDP(req, reply))) return
      return { bloqueios: await listarBloqueios(req.query?.status) }
    },
  )

  app.get(
    "/api/bloqueio/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!(await exigirDP(req, reply))) return
      const b = await exigirBloqueio(req.params.id, reply)
      if (!b) return
      return { bloqueio: b, boards: await boardsDoBloqueio(b.id) }
    },
  )

  // Lista crua — TUDO que foi observado, inclusive informativa e motor.
  // Sem filtro, é o extrato completo do board na janela.
  app.get(
    "/api/bloqueio/:id/alteracoes",
    async (
      req: FastifyRequest<{
        Params: { id: string }
        Querystring: { origem?: string; severidade?: string; item_id?: string; limite?: string; offset?: string }
      }>,
      reply: FastifyReply,
    ) => {
      if (!(await exigirDP(req, reply))) return
      const b = await exigirBloqueio(req.params.id, reply)
      if (!b) return
      const q = req.query ?? {}
      const alteracoes = await alteracoesDoBloqueio(b.id, {
        origem: q.origem,
        severidade: q.severidade,
        itemId: q.item_id ? Number(q.item_id) : undefined,
        limite: q.limite ? Number(q.limite) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      })
      return { alteracoes, total: alteracoes.length }
    },
  )

  // Relatório agregado da janela — o que vai pro DP no fechamento.
  app.get(
    "/api/bloqueio/:id/relatorio",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!(await exigirDP(req, reply))) return
      const b = await exigirBloqueio(req.params.id, reply)
      if (!b) return
      return { bloqueio: b, boards: await boardsDoBloqueio(b.id), relatorio: await relatorio(b.id) }
    },
  )
}
