// Webhook da automação Monday → validação de atestado na Nexti.
// Alias com o MESMO path do webhook n8n (nexti-validar-atestado) — repontar a
// automação do board Controle de Atestados pra cá quando fizer o flip.
// Monday manda um handshake {challenge} na criação do webhook — ecoamos.
import type { FastifyInstance, FastifyRequest } from "fastify"
import { validarAtestado } from "../services/validarAtestado.js"

export async function rotasNextiAtestado(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/nexti-validar-atestado",
    async (
      req: FastifyRequest<{
        Body: {
          challenge?: string
          pulseId?: number | string
          itemId?: number | string
          boardId?: number | string
          event?: { pulseId?: number | string; itemId?: number | string; boardId?: number | string }
        }
      }>,
      reply,
    ) => {
      const b = req.body ?? {}
      if (b.challenge) return { challenge: b.challenge } // handshake Monday
      const pulseId = Number(b.event?.pulseId ?? b.event?.itemId ?? b.pulseId ?? b.itemId ?? 0)
      if (!pulseId) return reply.code(400).send({ ok: false, erro: "payload_sem_pulseId" })
      try {
        const r = await validarAtestado(pulseId, req.log)
        if (!r.ok && r.motivo === "item_monday_nao_encontrado")
          return reply.code(404).send({ ok: false, erro: r.motivo })
        return { ok: r.ok, motivo: r.motivo ?? null, decisoes: r.decisoes }
      } catch (e) {
        req.log.error(e, "nexti-validar-atestado falhou")
        return reply.code(502).send({ ok: false, erro: "validacao_falhou", mensagem: (e as Error).message })
      }
    },
  )
}
