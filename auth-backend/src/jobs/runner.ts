// Runner de jobs — avança 1 passo por tick (serverless-safe). Despacha por tipo.
// Handlers de RM/Caju (pontual/mensal/virada) são GATED: marcam erro explicativo até
// serem ligados com idempotência. expiracao + sync_monday são executáveis.
import { query } from "../db.js"
import { pegarDevidos, avancar, falhar, retomarPresos, type Job } from "./repo.js"
import { handlerConvocacaoRmPontual, TIPO_JOB_CONVOCACAO_RM } from "./convocacaoRmPontual.js"
import { handlerConvocacaoRmRemover, TIPO_JOB_CONVOCACAO_RM_REMOVER } from "./convocacaoRmRemover.js"

type Handler = (job: Job) => Promise<void>

// expiracao: marca convocações Aguardando vencidas como Expirado (job diário).
const expiracao: Handler = async (job) => {
  await query(
    `UPDATE convocacoes SET status='Expirado', atualizado_em=now()
      WHERE status ILIKE 'aguardando' AND data_fim < (now() - interval '10 days')::date`,
  )
  await avancar(job.id, { estado: "concluido" })
}

// sync_monday: placeholder do espelho PG->Monday (a implementar por board).
const syncMonday: Handler = async (job) => {
  // TODO: escrever colunas do board correspondente via clients/monday.
  await avancar(job.id, { estado: "concluido" })
}

const gated: Handler = async (job) => {
  await avancar(job.id, { estado: "falhou", erro: "handler gated (RM/Caju) — aguardando ativação com idempotência" })
}

const HANDLERS: Record<string, Handler> = {
  expiracao,
  // Tipo PRÓPRIO: reusar `pontual` cairia no handler `gated` abaixo e o job morreria calado.
  [TIPO_JOB_CONVOCACAO_RM]: handlerConvocacaoRmPontual,
  // Rede da REMOÇÃO (cancelamento total). Sem registrar aqui, o tipo cai em "tipo desconhecido"
  // e o job só acumula tentativa sem nunca rodar.
  [TIPO_JOB_CONVOCACAO_RM_REMOVER]: handlerConvocacaoRmRemover,
  sync_monday: syncMonday,
  pontual: gated,
  mensal: gated,
  virada: gated,
  caju_poll: gated,
  noop: async (job) => avancar(job.id, { estado: "concluido" }),
}

/**
 * Processa até `limite` jobs devidos. `tipo` restringe o despacho (jobs lentos em tick próprio).
 *
 * Começa devolvendo à fila o que ficou preso em `rodando`: um job que morreu no meio fica
 * invisível pro claim e nunca mais roda sozinho.
 */
export async function tick(
  limite = 5,
  tipo?: string,
): Promise<{ processados: number; ids: string[]; retomados: number }> {
  const retomados = await retomarPresos()
  const jobs = await pegarDevidos(limite, tipo)
  const ids: string[] = []
  for (const job of jobs) {
    const h = HANDLERS[job.tipo]
    try {
      if (!h) throw new Error(`tipo desconhecido: ${job.tipo}`)
      await h(job)
      ids.push(job.id)
    } catch (e) {
      await falhar(job.id, (e as Error).message)
    }
  }
  return { processados: ids.length, ids, retomados }
}
