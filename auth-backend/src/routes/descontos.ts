import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { acharItensPorColuna, changeColumnValues } from "../monday.js"
import { usuarioDaSessao } from "../session.js"

// Leitura do board Base Desconto (Monday ao vivo). Substitui WF n8n descontos-ler.
// Público (/descontos/:uuid é link). Registrar manual = escrita (F5, depois).
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
  status: "color_mm3kq8pk",
  vrRetirado: "numeric_mm3k1t0e",
  vtRetirado: "numeric_mm3kx1kw",
  registradoEm: "date_mm3k2rgd",
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

  // Registra retirada manual (VR/VT) no item Base Desconto. Puro Monday: grava os
  // valores que o operador digitou (não calcula). Valida <= devido. Exige sessão.
  app.post(
    "/api/descontos/registrar",
    async (
      req: FastifyRequest<{ Body: { uuid?: string; vr_retirado?: number; vt_retirado?: number } }>,
      reply: FastifyReply,
    ) => {
      if (!(await usuarioDaSessao(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
      const uuid = String(req.body?.uuid ?? "").trim()
      const vrRet = num(String(req.body?.vr_retirado ?? 0))
      const vtRet = num(String(req.body?.vt_retirado ?? 0))
      if (!uuid) return reply.code(400).send({ ok: false, erro: "uuid_obrigatorio" })
      try {
        const itens = await acharItensPorColuna(BOARD_DESCONTO, C.uuid, uuid, Object.values(C), 1)
        const it = itens[0]
        if (!it) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })
        const m = new Map(it.column_values.map((c) => [c.id, c.text]))
        const vrDevido = num(m.get(C.vrDevido) ?? "")
        const vtDevido = num(m.get(C.vtDevido) ?? "")
        if (vrRet > vrDevido + 0.001 || vtRet > vtDevido + 0.001) {
          return reply.code(400).send({ ok: false, erro: "excede_devido" })
        }
        const vrRestante = Math.max(0, vrDevido - vrRet)
        const vtRestante = Math.max(0, vtDevido - vtRet)
        const hoje = new Date().toISOString().slice(0, 10)
        await changeColumnValues(BOARD_DESCONTO, it.id, {
          [C.vrRetirado]: vrRet,
          [C.vtRetirado]: vtRet,
          [C.status]: { label: "Registrado" },
          [C.registradoEm]: { date: hoje },
        })
        return { ok: true, uuid, vr_retirado: vrRet, vt_retirado: vtRet, vr_restante: vrRestante, vt_restante: vtRestante }
      } catch (e) {
        req.log.error(e, "erro descontos-registrar")
        return reply.code(502).send({ ok: false, erro: "monday_falhou" })
      }
    },
  )
}
