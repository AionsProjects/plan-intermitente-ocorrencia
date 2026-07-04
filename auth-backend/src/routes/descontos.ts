import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { acharItensPorColuna, changeColumnValues } from "../monday.js"
import { lerItem, gql } from "../clients/monday.js"
import { usuarioDaSessao } from "../session.js"
import { config } from "../config.js"

// Board Base Desconto (Monday ao vivo) — CÓDIGO-PRINCIPAL (03/07). Cobre os
// 3 WFs de retirada manual: descontos-ler, descontos-registrar-manual e
// descontos-gerar-link (porta fiel; n8n vira reserva).
const BOARD_DESCONTO = "18400981023"
const C = {
  uuid: "text_mm3k782s",
  empregado: "dropdown_mm0rgfrx",
  chapa: "text_mm0rpqxs",
  periodoIni: "date_mm0r6tyr",
  periodoFim: "date_mm0rzpyv",
  vrDevido: "numeric_mm0rgsaw",
  vtDevido: "numeric_mm0r5tca",
  contrato: "text_mm2x1ktb",
  status: "color_mm3kq8pk", // status da retirada MANUAL (Pendente/Registrado)
  vrRetirado: "numeric_mm3k1t0e",
  vtRetirado: "numeric_mm3kx1kw",
  registradoEm: "date_mm3k2rgd",
  linkRetirada: "link_mm3kep0m",
  // financeiro (compartilhadas com o cancelamento/atestado)
  statusFinanceiro: "color_mm0r8mjr",
  descontadoVR: "numeric_mm0rqy6z",
  descontadoVT: "numeric_mm0r6cn0",
  residualVR: "numeric_mm0r1691",
  residualVT: "numeric_mm0rtwwg",
} as const

const num = (v: string | null | undefined) => {
  const n = Number(String(v ?? "").replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

export async function rotasDescontos(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/descontos/ler",
    async (req: FastifyRequest<{ Querystring: { uuid?: string } }>, reply: FastifyReply) => {
      const uuid = String(req.query.uuid ?? "").trim()
      if (!uuid) return reply.code(400).send({ erro: "uuid_obrigatorio" })
      try {
        const itens = await acharItensPorColuna(BOARD_DESCONTO, C.uuid, uuid, Object.values(C), 1)
        const it = itens[0]
        if (!it) return reply.code(404).send({ erro: "nao_encontrado" })
        const m = new Map(it.column_values.map((c) => [c.id, c.text]))
        const g = (k: string) => m.get(k) ?? ""
        const vrRet = num(g(C.vrRetirado))
        const vtRet = num(g(C.vtRetirado))
        const registrado =
          g(C.status).trim().toLowerCase().startsWith("registr") || vrRet > 0 || vtRet > 0
        return {
          uuid,
          item_id: it.id,
          empregado_nome: g(C.empregado) || it.name,
          chapa: g(C.chapa),
          contrato: g(C.contrato) || null,
          periodo_inicio: g(C.periodoIni),
          periodo_fim: g(C.periodoFim),
          vr_devido: num(g(C.vrDevido)),
          vt_devido: num(g(C.vtDevido)),
          retirada_anterior: registrado
            ? { vr_retirado: vrRet, vt_retirado: vtRet, registrado_em: g(C.registradoEm) }
            : null,
          status: registrado ? "registrado" : "pendente",
        }
      } catch (e) {
        req.log.error(e, "erro descontos-ler")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )

  // Registra retirada manual (VR/VT) — porta fiel do WF sr4xxXLx:
  //  - 409 se retirada manual já registrada;
  //  - valida contra o RESIDUAL (não o devido) — dedupe com abates automáticos;
  //  - atualiza descontado/residual + status financeiro (PARCIAL/FINALIZADO).
  async function registrarRetiradaHandler(
    req: FastifyRequest<{
      Querystring: { uuid?: string }
      Body: { uuid?: string; vr_retirado?: number; vt_retirado?: number }
    }>,
    reply: FastifyReply,
  ) {
    const uuid = String(req.query?.uuid || req.body?.uuid || "").trim()
    const vrRet = Math.round(num(String(req.body?.vr_retirado ?? 0)) * 100) / 100
    const vtRet = Math.round(num(String(req.body?.vt_retirado ?? 0)) * 100) / 100
    if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_obrigatorio" })
    if (vrRet < 0 || vtRet < 0) return reply.code(400).send({ ok: false, erro: "valores_invalidos" })
    try {
      const itens = await acharItensPorColuna(BOARD_DESCONTO, C.uuid, uuid, Object.values(C), 1)
      const it = itens[0]
      if (!it) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })
      const m = new Map(it.column_values.map((c) => [c.id, c.text]))
      const g = (k: string) => m.get(k) ?? ""
      if (g(C.status).trim().toUpperCase().startsWith("REGISTR"))
        return reply.code(409).send({ ok: false, erro: "ja_registrado", mensagem: "Retirada manual ja registrada." })

      const descontoVR = num(g(C.vrDevido))
      const descontoVT = num(g(C.vtDevido))
      const descontadoVR = num(g(C.descontadoVR))
      const descontadoVT = num(g(C.descontadoVT))
      const residualVR = num(g(C.residualVR)) || Math.max(0, descontoVR - descontadoVR)
      const residualVT = num(g(C.residualVT)) || Math.max(0, descontoVT - descontadoVT)
      if (vrRet > residualVR + 0.009 || vtRet > residualVT + 0.009)
        return reply.code(400).send({
          ok: false, erro: "valor_maior_que_residual",
          mensagem: "Valor informado maior que o residual atual.",
          residual_vr: residualVR, residual_vt: residualVT,
        })

      const novoDescVR = Math.round((descontadoVR + vrRet) * 100) / 100
      const novoDescVT = Math.round((descontadoVT + vtRet) * 100) / 100
      const novoResVR = Math.max(0, Math.round((residualVR - vrRet) * 100) / 100)
      const novoResVT = Math.max(0, Math.round((residualVT - vtRet) * 100) / 100)
      const houveRetirada = vrRet > 0 || vtRet > 0
      const statusFin = houveRetirada
        ? novoResVR === 0 && novoResVT === 0 ? "FINALIZADO" : "PARCIAL"
        : g(C.statusFinanceiro) || "PENDENTE"
      const agora = new Date()
      await changeColumnValues(BOARD_DESCONTO, it.id, {
        [C.vrRetirado]: String(vrRet),
        [C.vtRetirado]: String(vtRet),
        [C.status]: { label: "Registrado" },
        [C.registradoEm]: { date: agora.toISOString().slice(0, 10), time: agora.toISOString().slice(11, 19) },
        [C.descontadoVR]: String(novoDescVR),
        [C.descontadoVT]: String(novoDescVT),
        [C.residualVR]: String(novoResVR),
        [C.residualVT]: String(novoResVT),
        [C.statusFinanceiro]: { label: statusFin },
      })
      return { ok: true, uuid, vr_retirado: vrRet, vt_retirado: vtRet, vr_restante: novoResVR, vt_restante: novoResVT }
    } catch (e) {
      req.log.error(e, "erro descontos-registrar")
      return reply.code(502).send({ ok: false, erro: "monday_falhou" })
    }
  }
  app.post("/api/descontos/registrar", async (req, reply) => {
    if (!(await usuarioDaSessao(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
    return registrarRetiradaHandler(req as Parameters<typeof registrarRetiradaHandler>[0], reply)
  })
  // Alias com o nome do webhook n8n — alvo do chamarProcesso("descontos").
  // Público como o webhook (protegido pelo uuid longo do link).
  app.post("/api/descontos-registrar-manual", registrarRetiradaHandler)

  // Alias de leitura com nome do webhook (mesmo handler do /api/descontos/ler).
  app.get(
    "/api/descontos-ler",
    async (req: FastifyRequest<{ Querystring: { uuid?: string } }>, reply: FastifyReply) => {
      const r = await app.inject({ method: "GET", url: `/api/descontos/ler?uuid=${encodeURIComponent(String(req.query.uuid ?? ""))}` })
      return reply.code(r.statusCode).send(r.json())
    },
  )

  // Gerar link de retirada manual — porta fiel do WF BCgD9f1b. Chamado pela
  // automação do Monday (body.event.pulseId) ou manualmente. Idempotente:
  // reaproveita o uuid existente do item.
  app.post(
    "/api/descontos-gerar-link",
    async (
      req: FastifyRequest<{
        Body: {
          item_id?: string | number
          itemId?: string | number
          pulseId?: string | number
          pulse_id?: string | number
          event?: { pulseId?: string | number; pulse_id?: string | number; itemId?: string | number }
        }
      }>,
      reply: FastifyReply,
    ) => {
      const b = req.body ?? {}
      const itemId = String(
        b.item_id ?? b.itemId ?? b.pulseId ?? b.pulse_id ?? b.event?.pulseId ?? b.event?.pulse_id ?? b.event?.itemId ?? "",
      ).trim()
      if (!itemId) return reply.code(400).send({ ok: false, erro: "item_id_obrigatorio" })
      if (!/^\d+$/.test(itemId)) return reply.code(400).send({ ok: false, erro: "item_id_invalido" })
      try {
        const item = await lerItem(Number(itemId))
        if (!item) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })
        const atual = (item.cv[C.uuid]?.text || "").trim()
        const uuid = atual || crypto.randomUUID()
        const base = /^https?:\/\//.test(config.appBaseUrl)
          ? config.appBaseUrl
          : "https://plan-intermitente-ocorrencia.vercel.app"
        const link = `${base.replace(/\/$/, "")}/descontos/${uuid}`
        const values: Record<string, unknown> = {
          [C.linkRetirada]: { url: link, text: "Registrar retirada" },
          [C.status]: { label: "Pendente" },
        }
        if (!atual) values[C.uuid] = uuid
        await gql(
          `mutation($b:ID!,$i:ID!,$v:JSON!){
             change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true){ id }
           }`,
          { b: BOARD_DESCONTO, i: itemId, v: JSON.stringify(values) },
        )
        return { ok: true, uuid, link, item_id: itemId }
      } catch (e) {
        req.log.error(e, "erro descontos-gerar-link")
        return reply.code(502).send({ ok: false, erro: "monday_falhou" })
      }
    },
  )
}
