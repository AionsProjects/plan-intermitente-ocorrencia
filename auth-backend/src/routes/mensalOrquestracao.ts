import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { start } from "workflow/api"
import { config } from "../config.js"
import { query, type Usuario } from "../db.js"
import { calcularPreviaMensal } from "../mensal/previa.js"
import {
  aprovarRun,
  cancelarRun,
  criarRunPrevia,
  limparHistoricoMensal,
  obterSnapshotRun,
  prepararRetomada,
  vincularWorkflowRun,
} from "../mensal/repo.js"
import type { PapelMensal } from "../mensal/types.js"
import { executarMensalWorkflowClient } from "../mensal/workflowClient.js"
import { usuarioDaSessao } from "../session.js"

const NIVEL: Record<string, number> = { operacional: 0, rh: 1, dp: 2, admin: 3 }

async function exigirDP(req: FastifyRequest, reply: FastifyReply): Promise<Usuario | null> {
  const u = await usuarioDaSessao(req)
  if (!u) { reply.code(401).send({ erro: "nao_autenticado" }); return null }
  if ((NIVEL[u.papel] ?? 0) < NIVEL.dp) { reply.code(403).send({ erro: "sem_permissao" }); return null }
  return u
}

function responderErro(reply: FastifyReply, e: unknown) {
  const msg = e instanceof Error ? e.message : "erro_interno"
  if (msg.startsWith("mensal_run_ativo:")) {
    return reply.code(409).send({ erro: "mensal_run_ativo", run_id: msg.split(":")[1] })
  }
  if (msg === "run_nao_encontrado") return reply.code(404).send({ erro: msg })
  if (msg.startsWith("run_nao_")) return reply.code(409).send({ erro: msg })
  throw e
}

async function iniciarWorkflow(runId: string, somenteContratos?: string[]): Promise<string> {
  if (!config.mensalWorkflowEnabled) throw new Error("workflow_mensal_desabilitado")
  const run = await obterSnapshotRun(runId)
  if (run.modo === "producao" && !config.mensalProductionEnabled) {
    throw new Error("workflow_mensal_producao_desabilitado")
  }
  const workflow = await start(executarMensalWorkflowClient, [{
    runId,
    modo: run.modo,
    snapshot: run.snapshot,
    somenteContratos,
  }])
  await vincularWorkflowRun(runId, workflow.runId)
  return workflow.runId
}

export async function rotasMensalOrquestracao(app: FastifyInstance): Promise<void> {
  app.get("/api/mensal/manutencao/retencao", async (req, reply) => {
    const authorization = req.headers.authorization ?? ""
    if (!config.cronSecret || authorization !== `Bearer ${config.cronSecret}`) {
      return reply.code(401).send({ erro: "nao_autorizado" })
    }
    const removidos = await limparHistoricoMensal()
    return { ok: true, retencao_meses: 24, removidos }
  })

  app.post(
    "/api/mensal/runs/previa",
    async (req: FastifyRequest<{ Body: { papel?: string; bypassAntifraude?: boolean } }>, reply) => {
      const u = await exigirDP(req, reply)
      if (!u) return
      const papel: PapelMensal = req.body?.papel === "proximo" ? "proximo" : "atual"
      // Bypass da antifraude é TESTE — só honrado em homologação (que simula tudo). Nunca em produção.
      const bypassAntifraude = req.body?.bypassAntifraude === true && config.mensalModo === "homologacao"
      try {
        const snapshot = await calcularPreviaMensal(papel, { bypassAntifraude })
        const runId = await criarRunPrevia(snapshot, u.email, config.mensalModo)
        return reply.code(201).send({ run_id: runId, snapshot, status: "aguardando_aprovacao", modo: config.mensalModo })
      } catch (e) {
        req.log.error(e, "mensal previa")
        return responderErro(reply, e)
      }
    },
  )

  app.post(
    "/api/mensal/runs/:runId/aprovar",
    async (req: FastifyRequest<{ Params: { runId: string }; Body: { somenteContratos?: string[] } }>, reply) => {
      const u = await exigirDP(req, reply)
      if (!u) return
      if (!config.mensalWorkflowEnabled) {
        return reply.code(503).send({ erro: "workflow_mensal_desabilitado" })
      }
      // Filtro opcional de contratos (teste): roda só os informados. Vazio/ausente = todos.
      const somenteContratos = Array.isArray(req.body?.somenteContratos) && req.body.somenteContratos.length
        ? req.body.somenteContratos
        : undefined
      try {
        await aprovarRun(req.params.runId, u.email)
        try {
          const workflowRunId = await iniciarWorkflow(req.params.runId, somenteContratos)
          return { ok: true, run_id: req.params.runId, workflow_run_id: workflowRunId }
        } catch (e) {
          await query(
            `UPDATE mensal_run SET status='falhou',etapa_atual='inicializacao',erro_contratos=erro_contratos+1,
             finalizado_em=now(),atualizado_em=now() WHERE run_id=$1`, [req.params.runId],
          )
          throw e
        }
      } catch (e) {
        req.log.error(e, "mensal aprovar")
        if ((e as Error).message.includes("desabilitado")) {
          return reply.code(503).send({ erro: (e as Error).message })
        }
        return responderErro(reply, e)
      }
    },
  )

  app.post(
    "/api/mensal/runs/:runId/cancelar",
    async (req: FastifyRequest<{ Params: { runId: string }; Body: { motivo?: string } }>, reply) => {
      const u = await exigirDP(req, reply)
      if (!u) return
      try {
        const status = await cancelarRun(req.params.runId, u.email, req.body?.motivo ?? "Cancelado pelo operador")
        return { ok: true, status }
      } catch (e) {
        return responderErro(reply, e)
      }
    },
  )

  app.post(
    "/api/mensal/runs/:runId/retomar",
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply) => {
      const u = await exigirDP(req, reply)
      if (!u) return
      try {
        await prepararRetomada(req.params.runId, u.email)
        const { rows } = await query<{ contrato: string }>(
          `SELECT contrato FROM mensal_run_item WHERE run_id=$1 AND status='pendente' ORDER BY ordem`,
          [req.params.runId],
        )
        const workflowRunId = await iniciarWorkflow(req.params.runId, rows.map((r) => r.contrato))
        return { ok: true, workflow_run_id: workflowRunId }
      } catch (e) {
        if ((e as Error).message.includes("desabilitado")) {
          return reply.code(503).send({ erro: (e as Error).message })
        }
        return responderErro(reply, e)
      }
    },
  )

  const SELECT_RUN =
    `SELECT run_id,papel,competencia,status,modo,etapa_atual,total_contratos,ok_contratos,erro_contratos,
            alertas,workflow_run_id,efeito_irreversivel,criado_em,atualizado_em,finalizado_em
       FROM mensal_run`
  const SELECT_ITENS =
    `SELECT ordem,contrato,qtd,status,etapa_atual,tentativas,erro_msg,motivo_bloqueio,
            referencias_externas,iniciado_em,atualizado_em,finalizado_em
       FROM mensal_run_item WHERE run_id=$1 ORDER BY ordem`

  // Run global em andamento (fila/rodando/recuperando) — permite reatar o acompanhamento após reload.
  app.get("/api/mensal/runs/ativo", async (req, reply) => {
    if (!(await exigirDP(req, reply))) return
    const { rows } = await query(
      `${SELECT_RUN} WHERE status = ANY($1::text[]) ORDER BY criado_em DESC LIMIT 1`,
      [["fila", "rodando", "recuperando"]],
    )
    return { run: rows[0] ?? null }
  })

  app.get(
    "/api/mensal/runs/:runId",
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply) => {
      if (!(await exigirDP(req, reply))) return
      const { rows: runs } = await query(`${SELECT_RUN} WHERE run_id=$1`, [req.params.runId])
      if (!runs.length) return reply.code(404).send({ erro: "run_nao_encontrado" })
      const { rows: itens } = await query(SELECT_ITENS, [req.params.runId])
      return { run: runs[0], itens }
    },
  )

  // Consolidado: run + itens + eventos (delta por ?after=) numa só chamada atômica.
  app.get(
    "/api/mensal/runs/:runId/ao-vivo",
    async (req: FastifyRequest<{ Params: { runId: string }; Querystring: { after?: string } }>, reply) => {
      if (!(await exigirDP(req, reply))) return
      const after = Math.max(0, Number(req.query.after) || 0)
      const { rows: runs } = await query(`${SELECT_RUN} WHERE run_id=$1`, [req.params.runId])
      if (!runs.length) return reply.code(404).send({ erro: "run_nao_encontrado" })
      const [{ rows: itens }, { rows: eventos }] = await Promise.all([
        query(SELECT_ITENS, [req.params.runId]),
        query(
          `SELECT id,contrato,etapa,estado,tentativa,mensagem,metadados,criado_em
             FROM mensal_run_event WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 500`,
          [req.params.runId, after],
        ),
      ])
      return {
        run: runs[0],
        itens,
        eventos,
        proximo_after: eventos.length ? Number((eventos.at(-1) as { id: string }).id) : after,
      }
    },
  )

  app.get(
    "/api/mensal/runs/:runId/eventos",
    async (req: FastifyRequest<{ Params: { runId: string }; Querystring: { after?: string } }>, reply) => {
      if (!(await exigirDP(req, reply))) return
      const after = Math.max(0, Number(req.query.after) || 0)
      const { rows } = await query(
        `SELECT id,contrato,etapa,estado,tentativa,mensagem,metadados,criado_em
           FROM mensal_run_event WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 500`,
        [req.params.runId, after],
      )
      return { eventos: rows, proximo_after: rows.length ? Number((rows.at(-1) as { id: string }).id) : after }
    },
  )
}
