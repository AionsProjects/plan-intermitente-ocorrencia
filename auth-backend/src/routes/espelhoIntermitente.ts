import type { FastifyInstance, FastifyRequest } from "fastify"
import { query } from "../db.js"
import { diasUteis } from "../domain/diasUteis.js"
import { calcularDesconto, jaConsumido, type DiaDesconto } from "../domain/desconto.js"
import { resolverValores } from "../domain/desconto.js"
import { derivarDescontosPorDia, agregados, type RespostaDia } from "../domain/descontoDia.js"
import { lerValores } from "../repo/valores.js"
import { lerFeriados } from "../repo/feriados.js"
import { upsertDesconto, removerDescontoConvocacao, descontoExistente } from "../repo/descontos.js"

// Rotas de leitura do fluxo intermitente — substituem os webhooks n8n
// (WF2 Ler, WF4 Buscar Protocolo, Buscar Convocações). Servidas sob /api/*
// (nginx já proxia /api) com os MESMOS nomes de path dos webhooks, pra o
// cutover do front ser só trocar VITE_N8N_BASE_URL -> backend /api.
//
// PÚBLICAS (sem auth): seguras pelo UUID longo, igual aos webhooks atuais.

interface LinhaConvocacao {
  uuid: string
  nome?: string | null
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
  respostas: unknown
  dias_desativados: unknown
  atestados: unknown
  split: unknown
  sabados_extras: string[] | null
  concluido_em: string | null
  editado: boolean | null
  editado_em: string | null
}

// Status do board (texto) -> enum do front.
function statusFront(s: string | null): "aguardando" | "concluido" | "expirado" {
  const n = String(s ?? "").toLowerCase()
  if (n.includes("conclu")) return "concluido"
  if (n.includes("expir")) return "expirado"
  return "aguardando"
}

function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function soData(s: string | null): string | null {
  return s ? String(s).slice(0, 10) : null
}

// --- Readers do espelho Postgres (exportados: usados pelas rotas espelho E como
// fallback das rotas Monday-backed em intermitente.ts quando o Monday cai) ---

export async function lerConvocacaoPg(uuid: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query<LinhaConvocacao>(`SELECT * FROM convocacoes WHERE uuid = $1`, [uuid])
  const c = rows[0]
  if (!c) return null
  const di = soData(c.data_inicio)
  const df = soData(c.data_fim)
  const sabExtras = c.sabados_extras ?? []
  const dias = di && df ? diasUteis(di, df, c.trabalha_sabado === true, sabExtras) : []
  return {
    uuid: c.uuid,
    nome: c.nome ?? null,
    contrato: c.contrato ?? null,
    data_inicio: di,
    data_fim: df,
    dias,
    status: statusFront(c.status),
    concluido_em: c.concluido_em ?? null,
    protocolo: c.protocolo || null,
    editado: !!c.editado,
    editado_em: c.editado_em ?? null,
    respostas: arr(c.respostas),
    dias_extras: [], // não há coluna dedicada hoje (board legacy long_text_mm2x73w6)
    dias_desativados: arr(c.dias_desativados),
    trabalha_sabado: c.trabalha_sabado === true ? "SIM" : "NAO",
    sabados_extras: sabExtras,
    atestados: arr(c.atestados),
    pontos_facultativos: [],
    data_inicio_cancelamento: soData(c.data_inicio_cancelamento),
    status_cancelamento: c.status_cancelamento ?? null,
    split: c.split ?? null,
  }
}

export async function protocoloPg(protocolo: string): Promise<{ uuid: string; nome: string } | null> {
  const { rows } = await query<{ uuid: string; nome: string | null }>(
    `SELECT uuid, nome FROM convocacoes WHERE protocolo = $1 LIMIT 1`,
    [protocolo],
  )
  if (!rows[0]) return null
  return { uuid: rows[0].uuid, nome: rows[0].nome ?? "" }
}

export async function convocacoesEmpregadoPg(
  chapa: string,
  mes: string,
): Promise<Record<string, unknown>[]> {
  const params: unknown[] = [chapa]
  let filtroMes = ""
  if (/^\d{4}-\d{2}$/.test(mes)) {
    params.push(mes + "-01")
    filtroMes = ` AND data_inicio <= (($${params.length}::date) + interval '1 month' - interval '1 day')
                  AND data_fim >= ($${params.length}::date)`
  }
  const { rows } = await query<LinhaConvocacao>(
    `SELECT * FROM convocacoes
      WHERE chapa = $1${filtroMes}
        AND COALESCE(status_cancelamento,'') NOT ILIKE '%cancelad%'
      ORDER BY data_inicio DESC LIMIT 200`,
    params,
  )
  return rows.map((c) => ({
    uuid: c.uuid,
    nome: c.nome ?? null,
    contrato: c.contrato ?? null,
    data_inicio: soData(c.data_inicio),
    data_fim: soData(c.data_fim),
    status: statusFront(c.status),
    trabalha_sabado: c.trabalha_sabado === true,
    optante_vt: c.optante_vt === true,
    documentos_existentes: arr(c.atestados),
  }))
}

export async function rotasEspelhoIntermitente(app: FastifyInstance): Promise<void> {
  // WF2 Ler — GET /api/intermitente-ler?uuid=
  app.get(
    "/api/intermitente-ler",
    async (req: FastifyRequest<{ Querystring: { uuid?: string } }>, reply) => {
      const uuid = (req.query.uuid ?? "").trim()
      if (!uuid) return reply.code(400).send({ erro: "uuid_obrigatorio" })
      const payload = await lerConvocacaoPg(uuid)
      if (!payload) return reply.code(404).send({ erro: "nao_encontrado", mensagem: "Link inválido ou expirado." })
      return payload
    },
  )

  // WF4 Buscar Protocolo — GET /api/intermitente-buscar-protocolo?protocolo=
  app.get(
    "/api/intermitente-buscar-protocolo",
    async (req: FastifyRequest<{ Querystring: { protocolo?: string } }>, reply) => {
      const protocolo = (req.query.protocolo ?? "").trim().toUpperCase()
      if (!protocolo) return reply.code(400).send({ erro: "protocolo_obrigatorio" })
      const r = await protocoloPg(protocolo)
      if (!r) return reply.code(404).send({ erro: "nao_encontrado" })
      return r
    },
  )

  // Buscar Convocações Empregado — GET /api/intermitente-convocacoes-empregado?chapa=&mes=
  app.get(
    "/api/intermitente-convocacoes-empregado",
    async (req: FastifyRequest<{ Querystring: { chapa?: string; mes?: string } }>, reply) => {
      const chapa = (req.query.chapa ?? "").trim()
      if (!chapa) return reply.code(400).send({ erro: "chapa_obrigatoria" })
      const mes = (req.query.mes ?? "").trim()
      const convocacoes = await convocacoesEmpregadoPg(chapa, mes)
      return { convocacoes }
    },
  )

  // Feriados — GET /api/intermitente-feriados (lê board Feriados, híbrido).
  app.get("/api/intermitente-feriados", async (_req, reply) => {
    try {
      const feriados = await lerFeriados()
      return { feriados }
    } catch (e) {
      return reply.code(502).send({ erro: "feriados_indisponivel", mensagem: (e as Error).message, feriados: [] })
    }
  })

  // Finalizar — POST /api/intermitente-finalizar?uuid= (WF3). Calcula desconto falta/
  // atraso, grava convocação (status/respostas/agregados/ledger/dias_descontados) + ledger PG.
  app.post(
    "/api/intermitente-finalizar",
    async (
      req: FastifyRequest<{
        Querystring: { uuid?: string }
        Body: {
          uuid?: string
          respostas?: RespostaDia[]
          protocolo?: string
          dias_extras?: string[]
          dias_desativados?: string[]
          sabados_extras?: string[]
          eh_correcao?: boolean
        }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      const uuid = (req.query.uuid || b.uuid || "").trim()
      const respostas = Array.isArray(b.respostas) ? b.respostas : []
      const protocolo = (b.protocolo || "").trim()
      const ehCorrecao = !!b.eh_correcao
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_ausente" })
      if (!protocolo || !/^PROT-[A-Z0-9-]+$/i.test(protocolo))
        return reply.code(400).send({ ok: false, erro: "protocolo_invalido" })

      const { rows } = await query<LinhaConvocacao>(`SELECT * FROM convocacoes WHERE uuid = $1`, [uuid])
      const c = rows[0]
      if (!c) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })
      if (String(c.status_cancelamento ?? "").toLowerCase().includes("cancelad"))
        return reply.code(409).send({ ok: false, erro: "convocacao_cancelada" })
      const jaConcluido = statusFront(c.status) === "concluido"
      if (jaConcluido && !ehCorrecao)
        return reply.code(409).send({ ok: false, erro: "ja_concluido" })

      // bloqueio desconto_em_consumo (correção sobre desconto já abatido)
      const exist = await descontoExistente(uuid)
      if (exist && jaConsumido(exist) && !ehCorrecao)
        return reply.code(409).send({ ok: false, erro: "desconto_em_consumo" })

      const di = soData(c.data_inicio)!
      const df = soData(c.data_fim)!
      const ledger = derivarDescontosPorDia({
        dataInicio: di, dataFim: df, trabalhaSabado: c.trabalha_sabado === true,
        sabadosExtras: c.sabados_extras ?? [], diasExtras: b.dias_extras ?? [],
        diasDesativados: b.dias_desativados ?? [], respostas,
      })
      const ag = agregados(respostas, ledger)

      const linhas = await lerValores()
      const v = resolverValores(linhas, { contrato: c.contrato ?? "", funcao: "" })
      const vrDia = "vrDia" in v ? v.vrDia : 0
      const vtDia = "vtDia" in v ? v.vtDia : 0
      const porDia: DiaDesconto[] = ledger.map((e) => ({
        vr: e.vr, vt: e.vt, vr_tipo: e.vr_tipo ?? undefined,
        vr_percentual: e.vr_percentual, minutos_atraso: e.minutos_atraso,
      }))
      const desc = calcularDesconto({
        vrDia, vtDia, optanteVT: c.optante_vt === true, contrato: c.contrato ?? "",
        descontosPorDia: porDia,
      })

      // ledger_beneficios (por data) + dias_descontados (incremento idempotente)
      const ledgerObj: Record<string, unknown> = {}
      const diasDesc: Record<string, { vr: boolean; vt: boolean }> = {}
      for (const e of ledger) {
        ledgerObj[e.data] = {
          vr: e.vr, vt: e.vt, vr_percentual: e.vr_percentual, vt_percentual: e.vt_percentual,
          vr_tipo: e.vr_tipo, minutos_atraso: e.minutos_atraso, origens: e.origens,
        }
        if (e.vr || e.vt) diasDesc[e.data] = { vr: e.vr, vt: e.vt }
      }
      const agoraIso = new Date().toISOString()
      const editado = jaConcluido || ehCorrecao
      await query(
        `UPDATE convocacoes SET
           status='Concluido', protocolo=$2, respostas=$3::jsonb,
           ledger_beneficios=$4::jsonb,
           dias_descontados = COALESCE(dias_descontados,'{}'::jsonb) || $5::jsonb,
           qtd_faltas=$6, qtd_atrasos=$7, total_minutos=$8, dias_perde_vr=$9, dias_perde_vt=$10,
           concluido_em = COALESCE(concluido_em, $11), editado=$12,
           editado_em = CASE WHEN $12 THEN $11 ELSE editado_em END,
           atualizado_em=now()
         WHERE uuid=$1`,
        [
          uuid, protocolo, JSON.stringify(respostas), JSON.stringify(ledgerObj),
          JSON.stringify(diasDesc), ag.qtd_faltas, ag.qtd_atrasos, ag.total_minutos,
          ag.dias_perde_vr, ag.dias_perde_vt, agoraIso, editado,
        ],
      )
      if (desc.descontoVR > 0 || desc.descontoVT > 0) {
        await upsertDesconto({
          uuid_convocacao: uuid, protocolo, nome: c.nome, chapa: c.chapa, contrato: c.contrato,
          data_inicio: di, data_fim: df, dias_perde_vr: ag.dias_perde_vr, dias_perde_vt: ag.dias_perde_vt,
          qtd_atrasos: ag.total_minutos, desconto_vr: desc.descontoVR, desconto_vt: desc.descontoVT,
          status: "PENDENTE",
        })
      }
      return {
        ok: true, uuid, protocolo, editado, concluido_em: c.concluido_em ?? agoraIso,
        descontoVR: desc.descontoVR, descontoVT: desc.descontoVT, dias_perde_vr: ag.dias_perde_vr,
      }
    },
  )

  // Aplicar Split — POST /api/intermitente-aplicar-split?uuid= (WF ZagUa).
  // tipo: aplicar | reverter. Grava split JSON na convocação (Histórico).
  app.post(
    "/api/intermitente-aplicar-split",
    async (
      req: FastifyRequest<{
        Querystring: { uuid?: string }
        Body: { uuid?: string; tipo?: string; data_inicio_parte2?: string; contrato_parte1?: string; contrato_parte2?: string }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      const uuid = (req.query.uuid || b.uuid || "").trim()
      const tipo = String(b.tipo || "aplicar")
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_ausente" })
      const { rows } = await query<{ uuid: string }>(`SELECT uuid FROM convocacoes WHERE uuid=$1`, [uuid])
      if (!rows[0]) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })

      if (tipo === "reverter") {
        await query(`UPDATE convocacoes SET split=NULL, atualizado_em=now() WHERE uuid=$1`, [uuid])
        return { ok: true, split: null }
      }
      const data = String(b.data_inicio_parte2 || "").trim()
      const c1 = String(b.contrato_parte1 || "").trim()
      const c2 = String(b.contrato_parte2 || "").trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !c1 || !c2)
        return reply.code(400).send({ ok: false, erro: "split_invalido" })
      const split = { dataInicioParte2: data, contratoParte1: c1, contratoParte2: c2 }
      await query(`UPDATE convocacoes SET split=$2::jsonb, atualizado_em=now() WHERE uuid=$1`, [uuid, JSON.stringify(split)])
      return { ok: true, split }
    },
  )

  // Cancelar Convocação — POST /api/intermitente-cancelar-convocacao?uuid=
  // tipo: total | parcial | reverter. Cancelamento DESCONTA SEMPRE (inclusive DETRAN/TRE).
  // Escreve PG (convocacoes + ledger). Sync Monday (mover grupo/board) fica gated/deferred.
  app.post(
    "/api/intermitente-cancelar-convocacao",
    async (
      req: FastifyRequest<{
        Querystring: { uuid?: string }
        Body: { uuid?: string; tipo?: string; data_inicio_cancelamento?: string | null }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      const uuid = (req.query.uuid || b.uuid || "").trim()
      const tipo = String(b.tipo || "").trim()
      const dataCancel = b.data_inicio_cancelamento || null
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_ausente" })
      if (!["total", "parcial", "reverter"].includes(tipo))
        return reply.code(400).send({ ok: false, erro: "tipo_invalido" })

      const { rows } = await query<LinhaConvocacao>(`SELECT * FROM convocacoes WHERE uuid = $1`, [uuid])
      const c = rows[0]
      if (!c) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })

      // Reverter: limpa cancelamento + remove desconto.
      if (tipo === "reverter") {
        await query(
          `UPDATE convocacoes SET status_cancelamento = NULL, data_inicio_cancelamento = NULL, atualizado_em = now() WHERE uuid = $1`,
          [uuid],
        )
        await removerDescontoConvocacao(uuid)
        return { ok: true, tipo, data_inicio_cancelamento: null, desconto: { acao: "reverter", descontoVR: 0, descontoVT: 0 } }
      }

      const di = soData(c.data_inicio)
      const df = soData(c.data_fim)
      if (!di || !df) return reply.code(400).send({ ok: false, erro: "periodo_invalido" })
      if (tipo === "parcial") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataCancel || "")))
          return reply.code(400).send({ ok: false, erro: "data_cancelamento_invalida" })
        if (dataCancel! < di || dataCancel! > df)
          return reply.code(400).send({ ok: false, erro: "data_fora_periodo" })
      }
      // Paridade com o WF (fix parcial→total de 30/06): só CANCELADA TOTAL bloqueia.
      // Parcial sobre parcial bloqueia; TOTAL sobre parcial PERMITE e cancela só os
      // dias FALTANTES [di .. dataCancelAnterior-1] (não re-desconta o já cancelado).
      const jaCancel = String(c.status_cancelamento ?? "").toLowerCase()
      const eraParcial = jaCancel.includes("parcial")
      if (jaCancel.includes("cancelad") && !eraParcial)
        return reply.code(409).send({ ok: false, erro: "convocacao_ja_cancelada" })
      if (eraParcial && tipo === "parcial")
        return reply.code(409).send({ ok: false, erro: "convocacao_ja_cancelada" })

      let inicioDesc = tipo === "total" ? di : dataCancel!
      let fimDesc = df
      if (eraParcial && tipo === "total") {
        // total sobre parcial: só o trecho que faltava (antes do início do parcial anterior).
        const anterior = soData(c.data_inicio_cancelamento)
        if (anterior) {
          const d = new Date(anterior + "T00:00:00Z")
          d.setUTCDate(d.getUTCDate() - 1)
          fimDesc = d.toISOString().slice(0, 10)
          if (fimDesc < di) {
            // parcial já cobria desde o início — nada a descontar; só promove o status.
            await query(
              `UPDATE convocacoes SET status_cancelamento = 'Cancelada', data_inicio_cancelamento = NULL, atualizado_em = now() WHERE uuid = $1`,
              [uuid],
            )
            return { ok: true, tipo, promovido: true, desconto: { descontoVR: 0, descontoVT: 0 } }
          }
        }
      }
      const dias = diasUteis(inicioDesc, fimDesc, c.trabalha_sabado === true, c.sabados_extras ?? [])

      // Valores -> desconto (cancelamento desconta sempre).
      const linhas = await lerValores()
      const v = resolverValores(linhas, { contrato: c.contrato ?? "", funcao: "" })
      const vrDia = "vrDia" in v ? v.vrDia : 0
      const vtDia = "vtDia" in v ? v.vtDia : 0
      const porDia: DiaDesconto[] = dias.map(() => ({ vr: true, vt: true, vr_percentual: 100 }))
      const desc = calcularDesconto({
        vrDia, vtDia, optanteVT: c.optante_vt === true, contrato: c.contrato ?? "",
        descontosPorDia: porDia, aplicarRegraNaoDesconta: false,
      })

      const label = tipo === "total" ? "Cancelada" : "Cancelada parcialmente"
      await query(
        `UPDATE convocacoes SET status_cancelamento = $2, data_inicio_cancelamento = $3, atualizado_em = now() WHERE uuid = $1`,
        [uuid, label, tipo === "parcial" ? dataCancel : null],
      )
      // Período do desconto = o trecho efetivamente cancelado AGORA (paridade com o WF:
      // total-sobre-parcial usa range diferente do parcial → não sobrescreve nem duplica).
      await upsertDesconto({
        uuid_convocacao: uuid, protocolo: c.protocolo, nome: c.nome, chapa: c.chapa,
        contrato: c.contrato, data_inicio: inicioDesc, data_fim: fimDesc,
        dias_perde_vr: dias.length, dias_perde_vt: dias.length,
        desconto_vr: desc.descontoVR, desconto_vt: desc.descontoVT, status: "PENDENTE",
      })

      return {
        ok: true,
        tipo,
        data_inicio_cancelamento: tipo === "parcial" ? dataCancel : null,
        dias_cancelados: dias,
        desconto: { acao: "create", descontoVR: desc.descontoVR, descontoVT: desc.descontoVT, vrDia, vtDia },
        _sync_monday: "pendente", // mover grupo CANCELADOS + atualizar board = deferido (job sync)
      }
    },
  )
}
