import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { usuarioDaSessao } from "../session.js"

// Consulta de contingência de PAGAMENTOS (Fase E do Plano de Fuga).
// Se o n8n cair, o DP não fica cego: aqui responde "o que está devido / o que já rodou",
// direto do Postgres (sem n8n, sem Monday). A EXECUÇÃO manual segue o runbook
// docs/contingencia/pagamentos.md — nunca automática.

const NIVEL: Record<string, number> = { operacional: 0, rh: 1, dp: 2, admin: 3 }

async function exigirDP(req: FastifyRequest, reply: FastifyReply) {
  const u = await usuarioDaSessao(req)
  if (!u) { reply.code(401).send({ erro: "nao_autenticado" }); return null }
  if ((NIVEL[u.papel] ?? 0) < NIVEL.dp) { reply.code(403).send({ erro: "sem_permissao" }); return null }
  return u
}

export async function rotasContingencia(app: FastifyInstance): Promise<void> {
  // Panorama: runs mensais recentes + descontos com residual + convocações concluídas no mês.
  app.get(
    "/api/contingencia/pagamentos",
    async (req: FastifyRequest<{ Querystring: { mes?: string } }>, reply) => {
      if (!(await exigirDP(req, reply))) return
      const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes ?? "")) ? String(req.query.mes) : null

      const { rows: runs } = await query(
        `SELECT run_id, papel, competencia, status, total_contratos, ok_contratos, erro_contratos,
                criado_em, finalizado_em
           FROM mensal_run ORDER BY criado_em DESC LIMIT 5`,
      )
      const { rows: itens } = runs.length
        ? await query(
            `SELECT run_id, ordem, contrato, qtd, status, erro_msg
               FROM mensal_run_item WHERE run_id = $1 ORDER BY ordem`,
            [(runs[0] as { run_id: string }).run_id],
          )
        : { rows: [] }

      // Descontos ainda devidos (o que o FIFO abateria no próximo pagamento).
      const { rows: residuais } = await query(
        `SELECT contrato, count(*)::int AS itens,
                round(sum(residual_vr)::numeric, 2) AS residual_vr,
                round(sum(residual_vt)::numeric, 2) AS residual_vt
           FROM descontos
          WHERE (residual_vr > 0 OR residual_vt > 0)
          GROUP BY contrato ORDER BY contrato`,
      )

      // Convocações concluídas no mês (candidatas a pagamento pontual).
      const params: unknown[] = []
      let filtro = ""
      if (mes) {
        params.push(mes + "-01")
        filtro = ` AND data_inicio <= (($1::date) + interval '1 month' - interval '1 day')
                   AND data_fim >= ($1::date)`
      }
      const { rows: concluidas } = await query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE COALESCE(status_cancelamento,'') ILIKE '%cancelad%')::int AS canceladas
           FROM convocacoes
          WHERE status ILIKE '%conclu%'${filtro}`,
        params,
      )

      return {
        ultimo_run: runs[0] ?? null,
        itens_ultimo_run: itens,
        runs_recentes: runs,
        descontos_residuais_por_contrato: residuais,
        convocacoes_concluidas: concluidas[0] ?? { total: 0, canceladas: 0 },
        runbook: "docs/contingencia/pagamentos.md",
      }
    },
  )
}
