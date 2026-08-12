import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { query, type Papel } from "../db.js"
import { usuarioDaSessao } from "../session.js"
import { abrirExecucao, type EstadoEtapa, type EstadoFinal, type MotorExecucao, type TipoArtefato } from "../services/execucao.js"

// Histórico de execuções (Postgres). Uma linha por ação em audit_lancamentos
// (o CABEÇALHO), as fases em atividade_evento e o que foi gerado em
// atividade_artefato.
//
// Quem fez = usuário da sessão, carimbado aqui — nunca vem do corpo do request.
//
// ⚠️ Fechada, a linha é um RESUMO: `GET /api/atividade` não traz filho nenhum, só
// contadores. O detalhe sai em `GET /api/atividade/:id`, buscado apenas da linha que
// o operador expandiu. 200 painéis abertos = 200 requests = auto-DDoS.

const NIVEL: Record<Papel, number> = { operacional: 0, rh: 1, dp: 2, admin: 3 }
const podeVerTodos = (papel: Papel): boolean => (NIVEL[papel] ?? 0) >= NIVEL.dp

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
  estado: string
  motor: string
  etapa_atual: string | null
  erro_etapa: string | null
  erro_msg: string | null
  duracao_ms: number | null
  finalizado_em: string | null
  qtd_etapas: number
  qtd_artefatos: number
}

/**
 * Registra atividade DIRETO no servidor. Usado pelas ações de dinheiro — o log tem
 * que existir mesmo se o browser fechar no meio.
 *
 * Mantida por compatibilidade: abre e fecha 'ok' em seguida, que é o comportamento
 * que os chamadores existentes esperam. Fluxo novo deve usar `comExecucao`, que
 * também registra a FALHA.
 */
export async function registrarAtividadeServidor(inp: {
  userId: string
  email: string
  nome: string
  acao: string
  alvo?: string | null
  pessoa?: string | null
  contrato?: string | null
  resumo?: unknown
}): Promise<string> {
  const ex = await abrirExecucao({
    acao: inp.acao,
    motor: "backend",
    operador: { userId: inp.userId, email: inp.email, nome: inp.nome },
    alvo: inp.alvo,
    pessoa: inp.pessoa,
    contrato: inp.contrato,
    resumo: inp.resumo,
  })
  await ex.fechar("ok")
  return ex.id
}

const ESTADOS_ETAPA = new Set<EstadoEtapa>(["rodando", "ok", "erro", "pulado", "aviso"])
const ESTADOS_FINAIS = new Set<EstadoFinal>(["ok", "erro", "parcial"])
const MOTORES = new Set<MotorExecucao>(["app", "backend", "n8n", "workflow", "job"])

export async function rotasAtividade(app: FastifyInstance): Promise<void> {
  // Abre a execução da ação do usuário logado e DEVOLVE O ID.
  //
  // O id é cunhado aqui, uma vez. O front injeta ele no payload do processo (mesmo
  // truque do `operador` em src/lib/http.ts — o n8n ignora chave desconhecida), e a
  // rota/workflow/job que executar se ANEXA a esse id em vez de abrir outra
  // execução. É isso que impede cabeçalho duplicado quando dois motores reportam a
  // mesma ação.
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
          /** Deixa o front fechar na mesma chamada (compat com o fire-and-forget antigo). */
          estado?: EstadoFinal
        }
      }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const acao = (req.body?.acao ?? "").trim()
      if (!acao) return reply.code(400).send({ erro: "acao_obrigatoria" })
      const nomeOperador = [u.nome, u.sobrenome].filter(Boolean).join(" ").trim() || u.email
      const ex = await abrirExecucao({
        acao,
        motor: "app",
        operador: { userId: u.id, email: u.email, nome: nomeOperador },
        alvo: req.body?.alvo ?? null,
        pessoa: req.body?.pessoa ?? null,
        contrato: req.body?.contrato ?? null,
        resumo: req.body?.resumo ?? null,
      })
      // Sem `estado` a execução fica ABERTA de propósito: quem abriu tem que fechar
      // (PATCH abaixo). É o que transforma "aba fechada no meio" numa linha
      // 'abandonada' explícita em vez de ausência de log.
      if (req.body?.estado && ESTADOS_FINAIS.has(req.body.estado)) {
        await ex.fechar(req.body.estado)
      }
      return { ok: true, id: ex.id }
    },
  )

  // Fecha a execução com desfecho. É esta chamada — e não a tabela — que faz falha
  // aparecer no histórico.
  app.patch(
    "/api/atividade/:id/fechar",
    async (
      req: FastifyRequest<{
        Params: { id: string }
        Body: { estado?: EstadoFinal; erro?: unknown; etapa_erro?: string; resumo?: unknown }
      }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const estado = req.body?.estado
      if (!estado || !ESTADOS_FINAIS.has(estado)) return reply.code(400).send({ erro: "estado_invalido" })
      // Só quem abriu (ou DP/admin) fecha — senão um operador fecharia a execução de
      // outro como 'ok' e escondería a falha.
      const { rows } = await query<{ user_id: string | null }>(
        `SELECT user_id FROM audit_lancamentos WHERE id = $1`, [req.params.id],
      )
      if (!rows[0]) return reply.code(404).send({ erro: "execucao_nao_encontrada" })
      if (rows[0].user_id !== u.id && !podeVerTodos(u.papel)) {
        return reply.code(403).send({ erro: "sem_permissao" })
      }
      const ex = await abrirExecucao({ id: req.params.id, acao: "", motor: "app" })
      await ex.fechar(estado, { erro: req.body?.erro, etapaErro: req.body?.etapa_erro, resumo: req.body?.resumo })
      return { ok: true }
    },
  )

  // Ingestão de fase por motor externo (WF do n8n). Sem isto, ação executada no n8n
  // tem cabeçalho e desfecho mas nenhum passo a passo.
  //
  // Auth por X-Service-Token (mesmo padrão de boards.ts/mensalRun.ts): o n8n não tem
  // sessão de usuário.
  app.post(
    "/api/atividade/:id/etapa",
    async (
      req: FastifyRequest<{
        Params: { id: string }
        Body: {
          etapa?: string
          estado?: EstadoEtapa
          mensagem?: unknown
          metadados?: Record<string, unknown>
          tentativa?: number
          duracao_ms?: number
          motor?: MotorExecucao
          artefatos?: Array<{ tipo: TipoArtefato; chave: string; rotulo?: string; url?: string }>
        }
      }>,
      reply: FastifyReply,
    ) => {
      const tokenOk =
        !!config.serviceToken &&
        String(req.headers["x-service-token"] ?? "").trim() === config.serviceToken
      if (!tokenOk && !(await usuarioDaSessao(req))) return reply.code(401).send({ erro: "nao_autenticado" })
      const etapa = (req.body?.etapa ?? "").trim()
      const estado = req.body?.estado
      if (!etapa) return reply.code(400).send({ erro: "etapa_obrigatoria" })
      if (!estado || !ESTADOS_ETAPA.has(estado)) return reply.code(400).send({ erro: "estado_invalido" })
      const motor = req.body?.motor && MOTORES.has(req.body.motor) ? req.body.motor : "n8n"
      // Reatache: se o id não existir ainda, nasce aqui (o WF pode reportar antes de
      // o front ter aberto). ON CONFLICT torna isso idempotente.
      const ex = await abrirExecucao({ id: req.params.id, acao: "", motor })
      if (!ex.id) return reply.code(502).send({ erro: "execucao_indisponivel" })
      const eventoId = await ex.etapa(etapa, estado, {
        mensagem: req.body?.mensagem,
        metadados: req.body?.metadados,
        tentativa: req.body?.tentativa,
        duracaoMs: req.body?.duracao_ms,
      })
      for (const a of req.body?.artefatos ?? []) {
        await ex.artefato({ ...a, eventoId })
      }
      return { ok: true, evento_id: eventoId }
    },
  )

  // Lista. Padrão: só a própria. DP/Admin com ?todos=1: de todos.
  //
  // Traz CONTADORES de etapa/artefato, não os filhos — a linha fechada é resumo, e
  // isto mantém o LIMIT 200 leve.
  app.get(
    "/api/atividade",
    async (
      req: FastifyRequest<{ Querystring: { todos?: string; limite?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const todos = req.query.todos === "1" && podeVerTodos(u.papel)
      const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 200))
      const { rows } = await query<LinhaAtividade>(
        `SELECT a.id, a.acao, a.uuid_alvo, a.pessoa_nome, a.contrato, a.payload_resumo,
                a.criado_em, a.operador_email, a.operador_nome,
                a.estado, a.motor, a.etapa_atual, a.erro_etapa, a.erro_msg,
                a.duracao_ms, a.finalizado_em,
                (SELECT count(*)::int FROM atividade_evento e WHERE e.execucao_id = a.id)   AS qtd_etapas,
                (SELECT count(*)::int FROM atividade_artefato f WHERE f.execucao_id = a.id) AS qtd_artefatos
           FROM audit_lancamentos a
          ${todos ? "" : "WHERE a.user_id = $2"}
          ORDER BY a.criado_em DESC
          LIMIT $1`,
        todos ? [limite] : [limite, u.id],
      )
      return {
        atividades: rows,
        escopo: todos ? "todos" : "proprio",
        limite,
        // A busca client-side só alcança o que veio. Sem isto a UI mentiria.
        truncado: rows.length >= limite,
      }
    },
  )

  // Detalhe de UMA execução: fases + artefatos. É o que a linha expandida consome, e
  // o destino do deep link do alerta de WhatsApp.
  app.get(
    "/api/atividade/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const { rows } = await query<LinhaAtividade & { user_id: string | null }>(
        `SELECT a.*,
                (SELECT count(*)::int FROM atividade_evento e WHERE e.execucao_id = a.id)   AS qtd_etapas,
                (SELECT count(*)::int FROM atividade_artefato f WHERE f.execucao_id = a.id) AS qtd_artefatos
           FROM audit_lancamentos a WHERE a.id = $1`,
        [req.params.id],
      )
      const exec = rows[0]
      if (!exec) return reply.code(404).send({ erro: "execucao_nao_encontrada" })
      // O 403 vem do SERVIDOR, único lugar que não se contorna: operacional/RH vê a
      // própria execução, DP/admin vê qualquer uma.
      if (exec.user_id !== u.id && !podeVerTodos(u.papel)) {
        return reply.code(403).send({ erro: "sem_permissao" })
      }
      const [etapas, artefatos] = await Promise.all([
        query(
          `SELECT id, etapa, estado, tentativa, duracao_ms, mensagem, metadados, criado_em
             FROM atividade_evento WHERE execucao_id = $1 ORDER BY id`,
          [req.params.id],
        ),
        query(
          `SELECT id, evento_id, tipo, chave, rotulo, url, efeito_chave, criado_em
             FROM atividade_artefato WHERE execucao_id = $1 ORDER BY id`,
          [req.params.id],
        ),
      ])
      return { execucao: exec, etapas: etapas.rows, artefatos: artefatos.rows }
    },
  )

  // Delta de fases por cursor. Mesmo shape de /api/mensal/runs/:id/eventos
  // (`{eventos, proximo_after}`) para o front pollar execução em andamento com o
  // código que já existe.
  app.get(
    "/api/atividade/:id/eventos",
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { after?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const dono = await query<{ user_id: string | null }>(
        `SELECT user_id FROM audit_lancamentos WHERE id = $1`, [req.params.id],
      )
      if (!dono.rows[0]) return reply.code(404).send({ erro: "execucao_nao_encontrada" })
      if (dono.rows[0].user_id !== u.id && !podeVerTodos(u.papel)) {
        return reply.code(403).send({ erro: "sem_permissao" })
      }
      const after = Number(req.query.after) || 0
      const { rows } = await query<{ id: number }>(
        `SELECT id, etapa, estado, tentativa, duracao_ms, mensagem, metadados, criado_em
           FROM atividade_evento
          WHERE execucao_id = $1 AND id > $2
          ORDER BY id LIMIT 500`,
        [req.params.id, after],
      )
      return { eventos: rows, proximo_after: rows.length ? rows[rows.length - 1]!.id : after }
    },
  )
}
