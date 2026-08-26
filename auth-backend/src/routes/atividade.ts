import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { query, type Papel } from "../db.js"
import { usuarioDaSessao } from "../session.js"
import { abrirExecucao, type EstadoEtapa, type EstadoFinal, type MotorExecucao, type TipoArtefato } from "../services/execucao.js"
import { nomeLimpo } from "../domain/mensagemAlteracao.js"
import { gerarRelatorioPdf } from "../services/relatorioAtividade.js"

// Histórico de execuções (Postgres). Uma linha por ação em audit_lancamentos
// (o CABEÇALHO), as fases em atividade_evento e o que foi gerado em
// atividade_artefato.
//
// Quem fez = usuário da sessão, carimbado aqui — nunca vem do corpo do request.
//
// ⚠️ Fechada, a linha é um RESUMO: `GET /api/atividade` não traz filho nenhum, só
// contadores. O detalhe sai em `GET /api/atividade/:id`, buscado apenas da linha que
// o operador expandiu. 200 painéis abertos = 200 requests = auto-DDoS.

/**
 * Forma do id que o front pode cunhar. Estrito de propósito: o valor entra num `::uuid`
 * e depois num ON CONFLICT, então recusar aqui é mais barato que confiar no cast.
 */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  erro_reconhecido_em: string | null
  erro_reconhecido_por: string | null
  erro_reconhecido_nota: string | null
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
const ESTADOS_FINAIS = new Set<EstadoFinal>(["ok", "erro", "parcial", "recusado"])
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
          /**
           * Id cunhado pelo FRONT. É o que mata a linha fantasma: o front não depende mais
           * da resposta desta rota pra saber o id, então abertura lenta ou abortada não
           * gera segunda linha — quem chegar primeiro cria, o outro se anexa pelo
           * ON CONFLICT de `abrirExecucao`. Ver o comentário em src/lib/atividade.ts.
           */
          id?: string | null
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
      // Id de FORA: aceita só UUID, e só se a linha ainda não existir ou já for desta
      // pessoa. O ON CONFLICT desta abertura mexe em motor, correlacao e payload_resumo —
      // deixar id arbitrario passar daria a um usuario autenticado o poder de mexer na
      // execucao de outro. Id recusado nao e erro: o servidor cunha o dele e a linha nasce
      // normal (o front e que perde o reatache).
      const idPedido = typeof req.body?.id === "string" && RE_UUID.test(req.body.id.trim())
        ? req.body.id.trim()
        : null
      let idAceito: string | null = null
      if (idPedido) {
        const { rows } = await query<{ user_id: string | null }>(
          `SELECT user_id FROM audit_lancamentos WHERE id = $1::uuid`, [idPedido],
        )
        if (rows.length === 0) {
          idAceito = idPedido
        } else if (rows[0]!.user_id === u.id) {
          // A linha JÁ existe e é desta pessoa: é a abertura chegando atrasada, depois de a
          // rota do processo ter criado a linha com o mesmo id. Não há o que abrir — e
          // reabrir custaria caro, porque o ON CONFLICT de `abrirExecucao` sobrescreve o
          // `motor` (relabelaria um run de `backend` como `app`) e mescla resumo pobre em
          // cima do rico. Devolve o id e sai.
          return { ok: true, id: idPedido, jaExistia: true }
        }
        // Linha de outra pessoa: ignora o id e deixa o servidor cunhar o dele.
      }
      const ex = await abrirExecucao({
        id: idAceito,
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
      const { rows } = await query<{ user_id: string | null; estado: string }>(
        `SELECT user_id, estado FROM audit_lancamentos WHERE id = $1`, [req.params.id],
      )
      if (!rows[0]) return reply.code(404).send({ erro: "execucao_nao_encontrada" })
      if (rows[0].user_id !== u.id && !podeVerTodos(u.papel)) {
        return reply.code(403).send({ erro: "sem_permissao" })
      }
      // QUEM EXECUTOU TEM A ÚLTIMA PALAVRA. O front usa `comAtividade`, que fecha 'ok' ao
      // ver a resposta HTTP chegar — mas a rota que fez o trabalho pode ter fechado
      // 'parcial' ou 'erro' ANTES de responder 200. Sem esta guarda o fecho do browser
      // sobrescreve o do servidor e a linha mente: o duplo-clique de convocação
      // (convocar.ts, fecha 'parcial') aparecia como 'ok', e o mesmo aconteceria com o
      // ponto facultativo que grava parte dos itens.
      //
      // 'aberta' e 'abandonada' seguem fecháveis: a primeira é o caso normal, e a segunda
      // é a varredura chutando um desfecho que o dono da execução pode corrigir.
      if (
        rows[0].estado === "ok" || rows[0].estado === "erro" ||
        rows[0].estado === "parcial" || rows[0].estado === "recusado"
      ) {
        return { ok: true, ignorado: "ja_fechada", estado: rows[0].estado }
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
                a.erro_reconhecido_em, a.erro_reconhecido_por, a.erro_reconhecido_nota,
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

  /**
   * Reconhecer (ou desfazer) um erro: "eu vi, está tratado".
   *
   * NÃO muda `estado` — o erro continua erro no log, no filtro e no relatório. Sai só da
   * contagem que pede atenção, pra falha antiga já resolvida não empatar com quebra nova.
   * Quem reconheceu e por quê ficam gravados: sem isso, o "ok" perde a memória e ninguém
   * sabe se foi resolvido, se era falso alarme ou se ficou pendente.
   *
   * DP/admin apenas: reconhecer é decisão sobre o que o time deixa de vigiar.
   */
  app.post(
    "/api/atividade/:id/reconhecer",
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { nota?: string; desfazer?: boolean } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (!podeVerTodos(u.papel)) return reply.code(403).send({ erro: "sem_permissao" })
      const desfazer = req.body?.desfazer === true
      const nota = (req.body?.nota ?? "").trim().slice(0, 300) || null
      const { rows } = await query<{ id: string; erro_reconhecido_em: Date | null }>(
        desfazer
          ? `UPDATE audit_lancamentos
                SET erro_reconhecido_em = NULL, erro_reconhecido_por = NULL, erro_reconhecido_nota = NULL
              WHERE id = $1 RETURNING id, erro_reconhecido_em`
          : `UPDATE audit_lancamentos
                SET erro_reconhecido_em = now(), erro_reconhecido_por = $2, erro_reconhecido_nota = $3
              WHERE id = $1 AND estado IN ('erro', 'abandonada')
              RETURNING id, erro_reconhecido_em`,
        desfazer ? [req.params.id] : [req.params.id, u.email, nota],
      )
      if (!rows.length) {
        // Sem linha: id inexistente OU execução que não falhou. Reconhecer algo que deu
        // certo não é erro do usuário, mas também não é operação com sentido.
        return reply.code(404).send({ erro: "execucao_sem_erro_para_reconhecer" })
      }
      return { ok: true, reconhecido_em: rows[0]!.erro_reconhecido_em, por: desfazer ? null : u.email }
    },
  )

  // Relatório PDF do histórico por período.
  //
  // `periodo`: diario (hoje em Manaus) | semanal (7 dias) | mensal (30 dias) |
  // personalizado (`de`/`ate`, ambos YYYY-MM-DD, inclusive nas duas pontas).
  //
  // Escopo espelha a lista: OP sai sempre com as PRÓPRIAS execuções; `todos=1` só é
  // honrado pra DP/admin — o gate é aqui no servidor, nunca só na tela.
  //
  // Rota estática convive com GET /api/atividade/:id porque o roteador do Fastify
  // (find-my-way) prefere estática sobre paramétrica — "relatorio" nunca cai no :id.
  app.get(
    "/api/atividade/relatorio",
    async (
      req: FastifyRequest<{
        Querystring: { periodo?: string; de?: string; ate?: string; todos?: string }
      }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const todos = req.query.todos === "1" && podeVerTodos(u.papel)

      // Bordas do período no fuso de MANAUS (UTC-4 fixo, sem horário de verão). O
      // servidor roda em UTC na Vercel: "diário" calculado em UTC incluiria a noite
      // anterior e o relatório não bateria com o que o operador viu na tela.
      const hojeManaus = new Date().toLocaleDateString("en-CA", { timeZone: "America/Manaus" })
      const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/
      const periodo = String(req.query.periodo ?? "diario")
      let deIso: string
      let ateIso: string
      let deDia: string
      let ateDia: string = hojeManaus
      if (periodo === "diario") {
        deDia = hojeManaus
        deIso = `${hojeManaus}T00:00:00-04:00`
        ateIso = new Date().toISOString()
      } else if (periodo === "semanal" || periodo === "mensal") {
        const dias = periodo === "semanal" ? 7 : 30
        const de = new Date(Date.now() - dias * 86_400_000)
        deDia = de.toLocaleDateString("en-CA", { timeZone: "America/Manaus" })
        deIso = de.toISOString()
        ateIso = new Date().toISOString()
      } else if (periodo === "personalizado") {
        const de = String(req.query.de ?? "")
        const ate = String(req.query.ate ?? "")
        if (!ISO_DIA.test(de) || !ISO_DIA.test(ate))
          return reply.code(400).send({ erro: "datas_invalidas" })
        if (de > ate) return reply.code(400).send({ erro: "de_maior_que_ate" })
        // Teto de 1 ano: range aberto viraria um SELECT do histórico inteiro.
        const dias = (Date.parse(ate) - Date.parse(de)) / 86_400_000
        if (dias > 366) return reply.code(400).send({ erro: "periodo_maior_que_um_ano" })
        deDia = de
        ateDia = ate
        deIso = `${de}T00:00:00-04:00`
        // Fim INCLUSIVE: "até dia tal" no pedido do usuário inclui o dia tal inteiro.
        ateIso = `${ate}T23:59:59.999-04:00`
      } else {
        return reply.code(400).send({ erro: "periodo_invalido" })
      }

      // Teto de linhas: relatório é serverless e o PDF é montado em memória. Acima
      // disso o corte é AVISADO no rodapé da tabela — truncar calado leria como "isso é tudo".
      const TETO = 5000
      const { rows } = await query<{
        id: string
        acao: string
        estado: string
        pessoa_nome: string | null
        contrato: string | null
        operador_nome: string | null
        operador_email: string | null
        erro_etapa: string | null
        erro_msg: string | null
        criado_em: Date
      }>(
        `SELECT a.id, a.acao, a.estado, a.pessoa_nome, a.contrato,
                a.operador_nome, a.operador_email, a.erro_etapa, a.erro_msg, a.criado_em
           FROM audit_lancamentos a
          WHERE a.criado_em >= $1::timestamptz AND a.criado_em <= $2::timestamptz
            ${todos ? "" : "AND a.user_id = $4"}
          ORDER BY a.criado_em DESC
          LIMIT $3`,
        todos ? [deIso, ateIso, TETO] : [deIso, ateIso, TETO, u.id],
      )

      const br = (dia: string): string => dia.split("-").reverse().join("/")
      const buf = gerarRelatorioPdf({
        escopo: todos
          ? "todas as pessoas"
          : (nomeLimpo([u.nome, u.sobrenome].filter(Boolean).join(" ")) ?? u.email),
        periodoLabel: deDia === ateDia ? br(deDia) : `${br(deDia)} a ${br(ateDia)}`,
        geradoPor: u.email,
        linhas: rows,
        truncadoEm: rows.length >= TETO ? TETO : null,
      })
      const arquivo = `relatorio-atividade-${deDia}-a-${ateDia}.pdf`
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${arquivo}"`)
        .send(buf)
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
