// Job da REMOÇÃO no RM. Rede do cancelamento, igual o job do pontual é rede da gravação.
//
// O caminho normal é inline, no próprio request de cancelar. Este job existe pro que ficou:
// `indeterminado` (o RM não respondeu e PODE ter apagado) e `erro` retryável.
//
// A diferença crucial em relação à gravação: aqui NÃO existe o perigo de "fazer duas vezes".
// Apagar o que já não está lá é inofensivo — `removerLancamentoRm` prova a existência antes e
// devolve `ja_ausente`. Por isso o retry é direto, sem passo de conciliação separado: a própria
// releitura já é a conciliação.
//
// Cancelamento PARCIAL tem caminho próprio: refaz o ENCURTAMENTO até a véspera do corte. Até
// 25/09/2026 este job removia todo lançamento vivo do item qualquer que fosse o motivo — um
// parcial com o RM mudo no request virava, no tick seguinte, a exclusão da convocação inteira,
// com os dias trabalhados antes do corte junto.
import { config } from "../config.js"
import { query } from "../db.js"
import { somarDias } from "../domain/convocacaoRm.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import {
  encurtarConvocacoesDoItem,
  removerLancamentoRm,
  TIMEOUT_REMOCAO_MS,
} from "../services/convocacaoRemover.js"
import { avancar, type Job } from "./repo.js"

export const TIPO_JOB_CONVOCACAO_RM_REMOVER = "convocacao_rm_remover"

export interface PayloadRemocaoRm {
  item_id: string
  motivo?: string
  removido_por?: string | null
  /** Só no cancelamento parcial: véspera do corte, até onde a convocação continua no RM. */
  novo_fim?: string | null
}

export interface CancelamentoDoItem {
  /** `data_inicio_cancelamento` do espelho (YYYY-MM-DD). */
  corte: string | null
  status: string | null
}

export interface DepsRemocaoRm {
  listar: typeof lancamentosDoItem
  remover: typeof removerLancamentoRm
  encurtar: typeof encurtarConvocacoesDoItem
  /** Corte vigente no espelho — job enfileirado antes de 25/09/2026 não traz `novo_fim`. */
  cancelamentoDoItem: (itemId: string) => Promise<CancelamentoDoItem | null>
  avancar: typeof avancar
  habilitado: () => boolean
}

async function cancelamentoDoItemPg(itemId: string): Promise<CancelamentoDoItem | null> {
  const { rows } = await query<CancelamentoDoItem>(
    `SELECT to_char(data_inicio_cancelamento, 'YYYY-MM-DD') AS corte, status_cancelamento AS status
       FROM convocacoes WHERE item_origem_id = $1::bigint
      ORDER BY (data_inicio_cancelamento IS NOT NULL) DESC, atualizado_em DESC NULLS LAST
      LIMIT 1`,
    [itemId],
  )
  return rows[0] ?? null
}

const DEPS_PADRAO: DepsRemocaoRm = {
  listar: lancamentosDoItem,
  remover: removerLancamentoRm,
  encurtar: encurtarConvocacoesDoItem,
  cancelamentoDoItem: cancelamentoDoItemPg,
  avancar,
  habilitado: () => config.convocacaoRmHabilitada,
}

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()

/**
 * `throw` = retryável (o tick conta tentativa e reagenda). `avancar` = terminal.
 *
 * Um lançamento que continua vivo no RM é o pior desfecho possível — board cancelado e S-2260 de
 * pé —, então enquanto sobrar pendência o job insiste.
 */
export async function handlerConvocacaoRmRemover(
  job: Job,
  deps: Partial<DepsRemocaoRm> = {},
): Promise<void> {
  const d = { ...DEPS_PADRAO, ...deps }
  const p = job.payload as unknown as PayloadRemocaoRm

  if (!d.habilitado()) {
    await d.avancar(job.id, { estado: "concluido", cursor: { nota: "desligado" } })
    return
  }

  if (p.motivo === "cancelamento_parcial") {
    await reconciliarParcial(job, p, d)
    return
  }

  // Relê o rastro: entre o request e o job, outra passada pode ter resolvido parte.
  const vivos = await d.listar(p.item_id, { apenasVivos: true })
  if (!vivos.length) {
    await d.avancar(job.id, { estado: "concluido", cursor: { nota: "nada_vivo" } })
    return
  }

  const resultados: { pk?: string; estado: string; erro?: string }[] = []
  for (const l of vivos) {
    const r = await d.remover(l, {
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
  await d.avancar(job.id, { estado: "concluido", cursor: { resultados } })
}

/**
 * Parcial: a convocação CONTINUA no RM até a véspera do corte. O job só refaz o que o request
 * não conseguiu — editar o fim dos pedaços que atravessam o corte e remover os que começam
 * depois dele —, pelo mesmo `encurtarConvocacoesDoItem` do request.
 */
async function reconciliarParcial(job: Job, p: PayloadRemocaoRm, d: DepsRemocaoRm): Promise<void> {
  let novoFim = p.novo_fim ? String(p.novo_fim).slice(0, 10) : null
  if (!novoFim) {
    const c = await d.cancelamentoDoItem(String(p.item_id))
    if (c?.corte) {
      novoFim = somarDias(c.corte, -1)
    } else if (c && norm(c.status) === "CANCELADA") {
      // Virou cancelamento TOTAL depois: o job dele remove tudo, aqui não há o que encurtar.
      await d.avancar(job.id, { estado: "concluido", cursor: { nota: "cancelamento_total_posterior" } })
      return
    }
  }
  if (!novoFim) {
    // Sem o corte não há como saber o que manter, e remover tudo apagaria os dias trabalhados.
    // Não toca no RM; o esgotamento das tentativas alerta o DP.
    throw new Error("convocacao_rm_remover: cancelamento parcial sem data de corte — nada tocado no RM")
  }

  const r = await d.encurtar(p.item_id, {
    novoFim,
    removidoPor: p.removido_por ?? null,
    timeoutMs: TIMEOUT_REMOCAO_MS,
  })
  const resultados = [
    ...r.edicoes.map((e) => ({ acao: "editar", pk: e.pk, estado: e.estado, erro: e.erro })),
    ...r.remocoes.map((x) => ({ acao: "remover", pk: x.pk, estado: x.estado, erro: x.erro })),
  ]
  if (r.temPendencia) {
    const pendentes = resultados.filter((x) => x.estado === "erro" || x.estado === "indeterminado")
    throw new Error(
      `convocacao_rm_remover: parcial até ${novoFim} com ${pendentes.length} pendente(s) — ` +
        pendentes.map((x) => `${x.pk ?? "?"}: ${x.acao} ${x.estado}`).join(", "),
    )
  }
  await d.avancar(job.id, { estado: "concluido", cursor: { novo_fim: novoFim, resultados } })
}
