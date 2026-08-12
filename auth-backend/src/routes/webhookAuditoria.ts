// Receptor do webhook do Monday para a Verificação de Alteração Intermitente.
//
// ⚠️ O webhook é GATILHO, não fonte de dados. O payload do Monday NÃO traz o
// `activity_log_id`, que é a chave de idempotência entre as duas camadas de captura.
// Gravar direto dele produziria uma chave diferente da do sweep e a MESMA alteração
// entraria duas vezes. Então o webhook só dispara uma varredura curta do board — a
// fonte única continua sendo o `activity_logs`.
//
// Efeito prático: o webhook dá a latência (segundos) e o cron dá a garantia.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { bloqueioAbertoDoBoard } from "../repo/bloqueio.js"
import { varrerBloqueio } from "../services/sweepBloqueio.js"
import { notificarAlteracoes } from "../services/notificarAlteracao.js"
import { config } from "../config.js"

/**
 * Debounce por board. O Monday dispara um POST POR COLUNA: uma convocação vira ~12
 * webhooks em segundos, e sem isso seriam 12 varreduras do mesmo intervalo.
 * Em memória de propósito — se a instância reciclar, o pior caso é uma varredura a
 * mais, que é idempotente.
 */
const ultimaVarredura = new Map<number, number>()

function podeVarrer(boardId: number, agora: number): boolean {
  const anterior = ultimaVarredura.get(boardId) ?? 0
  if (agora - anterior < config.monitor.debounceWebhookSeg * 1000) return false
  ultimaVarredura.set(boardId, agora)
  return true
}

export async function rotasWebhookAuditoria(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/webhooks/monday/auditoria",
    async (
      req: FastifyRequest<{
        Body: { challenge?: string; event?: { boardId?: number | string; pulseId?: number | string } }
      }>,
      reply: FastifyReply,
    ) => {
      // 1) Handshake de criação do webhook — precisa devolver o challenge cru.
      if (req.body?.challenge) return { challenge: req.body.challenge }

      const boardId = Number(req.body?.event?.boardId ?? 0)
      if (!boardId) return reply.code(400).send({ erro: "evento_sem_board" })

      const b = await bloqueioAbertoDoBoard(boardId)
      // Sem janela aberta o webhook é ruído esperado (fica registrado no board o ano
      // todo). Responder 200 evita o Monday desativar o webhook por erro repetido.
      if (!b) return { ok: true, ignorado: "sem_janela_aberta", boardId }

      if (!podeVarrer(boardId, Date.now())) {
        return { ok: true, ignorado: "debounce", boardId }
      }

      try {
        const r = await varrerBloqueio(b)
        const n = await notificarAlteracoes(b, r.novasParaNotificar)
        return {
          ok: true,
          bloqueio: b.id,
          gravadas: r.boards.reduce((s, x) => s + x.gravadas, 0),
          mensagens: n.mensagens,
          enviadas: n.enviadas,
          envio_ativo: n.envioAtivo,
        }
      } catch (e) {
        // 200 mesmo em falha: o Monday desativa webhook que erra demais, e o cron
        // reconcilia de qualquer jeito. O erro fica no log, não na saúde do webhook.
        req.log.error(e, "webhook auditoria falhou")
        return { ok: false, erro: (e as Error).message }
      }
    },
  )
}
