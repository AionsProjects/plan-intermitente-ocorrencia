// Job da REMOÇÃO no RM. Rede do cancelamento total, igual o job do pontual é rede da gravação.
//
// O caminho normal é inline, no próprio request de cancelar. Este job existe pro que ficou:
// `indeterminado` (o RM não respondeu e PODE ter apagado) e `erro` retryável.
//
// A diferença crucial em relação à gravação: aqui NÃO existe o perigo de "fazer duas vezes".
// Apagar o que já não está lá é inofensivo — `removerLancamentoRm` prova a existência antes e
// devolve `ja_ausente`. Por isso o retry é direto, sem passo de conciliação separado: a própria
// releitura já é a conciliação.
import { config } from "../config.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import { removerLancamentoRm, TIMEOUT_REMOCAO_MS } from "../services/convocacaoRemover.js"
import { avancar, type Job } from "./repo.js"

export const TIPO_JOB_CONVOCACAO_RM_REMOVER = "convocacao_rm_remover"

export interface PayloadRemocaoRm {
  item_id: string
  motivo?: string
  removido_por?: string | null
}

export interface DepsRemocaoRm {
  listar: typeof lancamentosDoItem
  remover: typeof removerLancamentoRm
  habilitado: () => boolean
}

const DEPS_PADRAO: DepsRemocaoRm = {
  listar: lancamentosDoItem,
  remover: removerLancamentoRm,
  habilitado: () => config.convocacaoRmHabilitada,
}

/**
 * `throw` = retryável (o tick conta tentativa e reagenda). `avancar` = terminal.
 *
 * Um lançamento que continua vivo no RM é o pior desfecho possível — board cancelado e S-2260 de
 * pé —, então enquanto sobrar pendência o job insiste.
 */
export async function handlerConvocacaoRmRemover(
  job: Job,
  deps: DepsRemocaoRm = DEPS_PADRAO,
): Promise<void> {
  const p = job.payload as unknown as PayloadRemocaoRm

  if (!deps.habilitado()) {
    await avancar(job.id, { estado: "concluido", cursor: { nota: "desligado" } })
    return
  }

  // Relê o rastro: entre o request e o job, outra passada pode ter resolvido parte.
  const vivos = await deps.listar(p.item_id, { apenasVivos: true })
  if (!vivos.length) {
    await avancar(job.id, { estado: "concluido", cursor: { nota: "nada_vivo" } })
    return
  }

  const resultados: { pk?: string; estado: string; erro?: string }[] = []
  for (const l of vivos) {
    const r = await deps.remover(l, {
      motivo: (p.motivo as never) ?? "cancelamento_total",
      removidoPor: p.removido_por ?? null,
      timeoutMs: TIMEOUT_REMOCAO_MS,
    })
    resultados.push({ pk: r.pk, estado: r.estado, erro: r.erro })
  }

  const pendentes = resultados.filter((r) => r.estado === "erro" || r.estado === "indeterminado")
  if (pendentes.length) {
    throw new Error(
      `convocacao_rm_remover: ${pendentes.length} pendente(s) — ` +
        pendentes.map((r) => `${r.pk ?? "?"}: ${r.estado}`).join(", "),
    )
  }
  await avancar(job.id, { estado: "concluido", cursor: { resultados } })
}
