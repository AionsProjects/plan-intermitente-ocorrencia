import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { acharItensPorColuna } from "../monday.js"

// Leituras do board Histórico (Monday ao vivo) — substituem WFs n8n. Público
// (correção/preencher usam link). Board Histórico é FIXO (não duplica na virada).
const BOARD_HISTORICO = "18411141462"
const COL_UUID = "text_mm2xjend"
const COL_PROTOCOLO = "text_mm2xsvg6"

export async function rotasIntermitente(app: FastifyInstance): Promise<void> {
  // Resolve protocolo PROT-XXXX-XXXX -> {uuid, nome}. Mesma forma do n8n WF4.
  app.get(
    "/api/intermitente/buscar-protocolo",
    async (
      req: FastifyRequest<{ Querystring: { protocolo?: string } }>,
      reply: FastifyReply,
    ) => {
      const protocolo = String(req.query.protocolo ?? "").trim().toUpperCase()
      if (!protocolo) return reply.code(400).send({ erro: "protocolo_obrigatorio" })
      try {
        const itens = await acharItensPorColuna(
          BOARD_HISTORICO,
          COL_PROTOCOLO,
          protocolo,
          [COL_UUID],
          1,
        )
        const it = itens[0]
        if (!it) return reply.code(404).send({ erro: "protocolo_nao_encontrado" })
        const uuid = it.column_values.find((c) => c.id === COL_UUID)?.text ?? ""
        return { uuid, nome: it.name }
      } catch (e) {
        req.log.error(e, "erro buscar-protocolo")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )
}
