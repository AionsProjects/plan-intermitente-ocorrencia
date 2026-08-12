import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { tick } from "../jobs/runner.js"
import { varrerTodos } from "../services/sweepBloqueio.js"
import { varrerAbandonadas } from "../services/alertaFalha.js"

/**
 * Piso da varredura de abandonadas: nada antes da migration 018 é considerado.
 *
 * As 413 linhas anteriores foram marcadas 'ok' pelo backfill, mas isto é a segunda
 * trava: qualquer defeito futuro que deixe linha antiga em 'aberta' faria a varredura
 * alertar sobre o passado inteiro de uma vez.
 */
const PISO_ABANDONADAS = "2026-08-12T00:00:00Z"

// Tick da fila de jobs. Avança jobs devidos 1 passo cada (serverless-safe).
//
// ⚠️ Existe o par GET/POST pelo mesmo motivo de routes/bloqueio.ts: o **Vercel Cron só faz GET**,
// então um cron apontando pro POST responderia 404 e pareceria configurado enquanto nada roda.
// O GET é o do cron; o POST é o disparo manual (dev/n8n).
//
// ⚠️ Cadência: a conta é HOBBY e só aceita cron DIÁRIO (o `*/15` foi recusado no deploy — ver
// commit c64eeac). O cron da Vercel aqui é só REDE DE SEGURANÇA pra job que ficou pra trás; o
// caminho normal da convocação pontual é o próprio request do /convocar, que grava inline.
//
// ⚠️ E não tente documentar isso no vercel.json: propriedade extra ali NÃO é ignorada, o deploy
// falha — sem log de build, o que faz parecer problema de infra. Aconteceu duas vezes (commits
// 85f8f895 e o `_comment_crons` deste trabalho, que derrubou 6 deploys seguidos).
//
// ⚠️ Este tick também roda a varredura do monitor de alteração de board. Não é acoplamento
// gratuito: Hobby só dá DOIS crons, e ao juntar as branches a união pedia três
// (retenção + este + /api/bloqueio/varrer). O sweep é o que tinha o cron mais dispensável, porque
// a cadência real dele vem do n8n a cada 15 min (WF `Uue6DferTufop3rs`, 374 execuções, ativo) —
// mas cadência de terceiro não é rede de segurança, então ele pega carona aqui em vez de sumir.
export async function rotasJobs(app: FastifyInstance): Promise<void> {
  const autorizado = (req: FastifyRequest): boolean => {
    const secret = process.env.CRON_SECRET
    if (!secret) return true // sem segredo configurado, não trava (mesma escolha de bloqueio.ts)
    const h = req.headers["authorization"] || req.headers["x-cron-secret"]
    return h === `Bearer ${secret}` || h === secret
  }

  const executar = async (
    req: FastifyRequest<{ Querystring: { limite?: string; tipo?: string } }>,
    reply: FastifyReply,
  ) => {
    if (!autorizado(req)) return reply.code(401).send({ erro: "nao_autorizado" })
    const limite = Math.min(20, Math.max(1, Number(req.query.limite) || 5))
    const tipo = (req.query.tipo || "").trim() || undefined
    const resultado = await tick(limite, tipo)
    // Carona do sweep (ver nota no topo). Isolado: janela de bloqueio que explode não pode
    // derrubar a fila de jobs, que é a rede de retry da convocação no RM.
    let bloqueio: { janelas: number } | { erro: string }
    try {
      bloqueio = { janelas: (await varrerTodos()).length }
    } catch (e) {
      req.log.warn(e, "varredura de bloqueio falhou no tick de jobs")
      bloqueio = { erro: (e as Error).message.slice(0, 160) }
    }
    // Execuções que abriram e nunca fecharam (aba fechada no meio, função encerrada
    // antes do fim). Também de carona: Hobby só dá dois crons.
    let abandonadas: { marcadas: number; alertadas: number } | { erro: string }
    try {
      abandonadas = await varrerAbandonadas(PISO_ABANDONADAS)
    } catch (e) {
      req.log.warn(e, "varredura de abandonadas falhou")
      abandonadas = { erro: (e as Error).message.slice(0, 160) }
    }
    return { ok: true, ...resultado, bloqueio, abandonadas }
  }

  app.get("/api/jobs/tick", executar)
  app.post("/api/jobs/tick", executar)
}
