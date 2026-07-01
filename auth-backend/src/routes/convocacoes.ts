import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { usuarioDaAutorizacao } from "../session.js"

// Convocações (Postgres) — substitui o board Monday de Histórico (18411141462).
// Auth: cookie (frontend) OU Bearer token de serviço (n8n). Ver session.usuarioDaAutorizacao.
// Transição: os WFs n8n fazem dual-write (board + estes endpoints) até o cutover.

interface LinhaConvocacao {
  uuid: string
  monday_item_id: string | null
  item_origem_id: string | null
  chapa: string
  contrato: string | null
  data_inicio: string | null
  data_fim: string | null
  protocolo: string | null
  status: string | null
  status_cancelamento: string | null
  data_inicio_cancelamento: string | null
  optante_vt: boolean | null
  trabalha_sabado: boolean | null
  ledger_beneficios: unknown
  dias_descontados: unknown
  respostas: unknown
  dias_desativados: unknown
  atestados: unknown
  split: unknown
  sabados_extras: string[] | null
  qtd_faltas: number | null
  qtd_atrasos: number | null
  total_minutos: number | null
  dias_perde_vr: string | null
  dias_perde_vt: string | null
  concluido_em: string | null
  editado: boolean | null
  editado_em: string | null
  criado_em: string
  atualizado_em: string | null
}

// jsonb: node-pg serializa objeto -> string só se passarmos JSON.stringify. Null preserva null.
function j(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v)
}

export async function rotasConvocacoes(app: FastifyInstance): Promise<void> {
  async function exigirAuth(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const u = await usuarioDaAutorizacao(req)
    if (!u) {
      reply.code(401).send({ erro: "nao_autenticado" })
      return false
    }
    return true
  }

  // Busca por protocolo (precede a rota /:uuid pra não colidir).
  app.get(
    "/api/convocacoes/protocolo/:protocolo",
    async (req: FastifyRequest<{ Params: { protocolo: string } }>, reply) => {
      if (!(await exigirAuth(req, reply))) return
      const { rows } = await query<LinhaConvocacao>(
        `SELECT * FROM convocacoes WHERE protocolo = $1 LIMIT 1`,
        [req.params.protocolo],
      )
      if (!rows[0]) return reply.code(404).send({ erro: "nao_encontrado" })
      return rows[0]
    },
  )

  // Lê 1 convocação por uuid.
  app.get(
    "/api/convocacoes/:uuid",
    async (req: FastifyRequest<{ Params: { uuid: string } }>, reply) => {
      if (!(await exigirAuth(req, reply))) return
      const { rows } = await query<LinhaConvocacao>(
        `SELECT * FROM convocacoes WHERE uuid = $1`,
        [req.params.uuid],
      )
      if (!rows[0]) return reply.code(404).send({ erro: "nao_encontrado" })
      return rows[0]
    },
  )

  // Busca por chapa + período (mês YYYY-MM intersectando [data_inicio, data_fim]).
  app.get(
    "/api/convocacoes",
    async (
      req: FastifyRequest<{ Querystring: { chapa?: string; mes?: string } }>,
      reply,
    ) => {
      if (!(await exigirAuth(req, reply))) return
      const chapa = (req.query.chapa ?? "").trim()
      if (!chapa) return reply.code(400).send({ erro: "chapa_obrigatoria" })
      const mes = (req.query.mes ?? "").trim() // "YYYY-MM" opcional
      const params: unknown[] = [chapa]
      let filtroMes = ""
      if (/^\d{4}-\d{2}$/.test(mes)) {
        // intersecção: data_inicio <= fim-do-mês AND data_fim >= início-do-mês
        params.push(mes + "-01")
        filtroMes = ` AND data_inicio <= (($${params.length}::date) + interval '1 month' - interval '1 day')
                      AND data_fim >= ($${params.length}::date)`
      }
      const { rows } = await query<LinhaConvocacao>(
        `SELECT * FROM convocacoes WHERE chapa = $1${filtroMes} ORDER BY data_inicio DESC LIMIT 200`,
        params,
      )
      return { convocacoes: rows }
    },
  )

  // Upsert (cria/atualiza por uuid). Recebe o registro completo. Usado pelo import + dual-write.
  app.post(
    "/api/convocacoes",
    async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
      if (!(await exigirAuth(req, reply))) return
      const b = req.body ?? {}
      const uuid = String(b.uuid ?? "").trim()
      const chapa = String(b.chapa ?? "").trim()
      if (!uuid) return reply.code(400).send({ erro: "uuid_obrigatorio" })
      if (!chapa) return reply.code(400).send({ erro: "chapa_obrigatoria" })
      await query(
        `INSERT INTO convocacoes (
           uuid, monday_item_id, item_origem_id, chapa, contrato, data_inicio, data_fim,
           protocolo, status, status_cancelamento, data_inicio_cancelamento,
           optante_vt, trabalha_sabado, ledger_beneficios, respostas, dias_desativados,
           atestados, split, sabados_extras, qtd_faltas, qtd_atrasos, total_minutos,
           dias_perde_vr, dias_perde_vt, concluido_em, editado, editado_em, dias_descontados, nome, atualizado_em
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
           COALESCE($28::jsonb,'{}'::jsonb), $29, now()
         )
         ON CONFLICT (uuid) DO UPDATE SET
           monday_item_id = EXCLUDED.monday_item_id,
           item_origem_id = EXCLUDED.item_origem_id,
           chapa = EXCLUDED.chapa, contrato = EXCLUDED.contrato,
           data_inicio = EXCLUDED.data_inicio, data_fim = EXCLUDED.data_fim,
           protocolo = EXCLUDED.protocolo, status = EXCLUDED.status,
           status_cancelamento = EXCLUDED.status_cancelamento,
           data_inicio_cancelamento = EXCLUDED.data_inicio_cancelamento,
           optante_vt = EXCLUDED.optante_vt, trabalha_sabado = EXCLUDED.trabalha_sabado,
           ledger_beneficios = EXCLUDED.ledger_beneficios, respostas = EXCLUDED.respostas,
           dias_desativados = EXCLUDED.dias_desativados, atestados = EXCLUDED.atestados,
           split = EXCLUDED.split, sabados_extras = EXCLUDED.sabados_extras,
           qtd_faltas = EXCLUDED.qtd_faltas, qtd_atrasos = EXCLUDED.qtd_atrasos,
           total_minutos = EXCLUDED.total_minutos, dias_perde_vr = EXCLUDED.dias_perde_vr,
           dias_perde_vt = EXCLUDED.dias_perde_vt, concluido_em = EXCLUDED.concluido_em,
           editado = EXCLUDED.editado, editado_em = EXCLUDED.editado_em,
           dias_descontados = COALESCE(EXCLUDED.dias_descontados, convocacoes.dias_descontados),
           nome = COALESCE(EXCLUDED.nome, convocacoes.nome),
           atualizado_em = now()`,
        [
          uuid, b.monday_item_id ?? null, b.item_origem_id ?? null, chapa,
          b.contrato ?? null, b.data_inicio ?? null, b.data_fim ?? null, b.protocolo ?? null,
          b.status ?? null, b.status_cancelamento ?? null, b.data_inicio_cancelamento ?? null,
          b.optante_vt ?? null, b.trabalha_sabado ?? null,
          j(b.ledger_beneficios), j(b.respostas), j(b.dias_desativados), j(b.atestados), j(b.split),
          (b.sabados_extras as string[]) ?? null,
          b.qtd_faltas ?? null, b.qtd_atrasos ?? null, b.total_minutos ?? null,
          b.dias_perde_vr ?? null, b.dias_perde_vt ?? null,
          b.concluido_em ?? null, b.editado ?? null, b.editado_em ?? null,
          j(b.dias_descontados), b.nome ?? null,
        ],
      )
      return { ok: true, uuid }
    },
  )

  // Atualiza campos parciais por uuid. Escalares: só sobrescreve se vier no body.
  // ledger: merge raso (|| jsonb) — acumula dias/origens sem apagar o histórico.
  app.patch(
    "/api/convocacoes/:uuid",
    async (
      req: FastifyRequest<{ Params: { uuid: string }; Body: Record<string, unknown> }>,
      reply,
    ) => {
      if (!(await exigirAuth(req, reply))) return
      const uuid = req.params.uuid
      const b = req.body ?? {}
      const sets: string[] = []
      const params: unknown[] = [uuid]
      const add = (col: string, val: unknown) => {
        params.push(val)
        sets.push(`${col} = $${params.length}`)
      }
      if ("status" in b) add("status", b.status)
      if ("status_cancelamento" in b) add("status_cancelamento", b.status_cancelamento)
      if ("data_inicio_cancelamento" in b) add("data_inicio_cancelamento", b.data_inicio_cancelamento)
      if ("protocolo" in b) add("protocolo", b.protocolo)
      if ("concluido_em" in b) add("concluido_em", b.concluido_em)
      if ("editado" in b) add("editado", b.editado)
      if ("editado_em" in b) add("editado_em", b.editado_em)
      if ("split" in b) { params.push(j(b.split)); sets.push(`split = $${params.length}::jsonb`) }
      if ("respostas" in b) { params.push(j(b.respostas)); sets.push(`respostas = $${params.length}::jsonb`) }
      // ledger: substitui ou faz merge raso conforme a chave.
      if ("ledger_beneficios" in b) { params.push(j(b.ledger_beneficios)); sets.push(`ledger_beneficios = $${params.length}::jsonb`) }
      else if ("ledger_merge" in b) { params.push(j(b.ledger_merge)); sets.push(`ledger_beneficios = COALESCE(ledger_beneficios,'{}'::jsonb) || $${params.length}::jsonb`) }
      // dias_descontados: substitui OU merge raso (acumula dias já lançados sem apagar — base do incremento).
      if ("dias_descontados" in b) { params.push(j(b.dias_descontados)); sets.push(`dias_descontados = $${params.length}::jsonb`) }
      else if ("dias_descontados_merge" in b) { params.push(j(b.dias_descontados_merge)); sets.push(`dias_descontados = COALESCE(dias_descontados,'{}'::jsonb) || $${params.length}::jsonb`) }
      if (!sets.length) return reply.code(400).send({ erro: "nada_para_atualizar" })
      sets.push("atualizado_em = now()")
      const { rows } = await query<{ uuid: string }>(
        `UPDATE convocacoes SET ${sets.join(", ")} WHERE uuid = $1 RETURNING uuid`,
        params,
      )
      if (!rows.length) return reply.code(404).send({ erro: "nao_encontrado" })
      return { ok: true, uuid }
    },
  )
}
