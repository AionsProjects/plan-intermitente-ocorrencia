// Runner de jobs — avança 1 passo por tick (serverless-safe). Despacha por tipo.
// Handlers de RM/Caju (pontual/mensal/virada) são GATED: marcam erro explicativo até
// serem ligados com idempotência. expiracao + sync_monday são executáveis.
import { query } from "../db.js"
import { pegarDevidos, avancar, falhar, type Job } from "./repo.js"

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
  sync_monday: syncMonday,
  pontual: gated,
  mensal: gated,
  virada: gated,
  caju_poll: gated,
  noop: async (job) => avancar(job.id, { estado: "concluido" }),
}

/** Processa até `limite` jobs devidos. Retorna resumo. */
export async function tick(limite = 5): Promise<{ processados: number; ids: string[] }> {
  const jobs = await pegarDevidos(limite)
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
  return { processados: ids.length, ids }
}
