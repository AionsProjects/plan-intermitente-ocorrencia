// Antifraude de período (convocação conflitante) — PURO. Porta fiel do node
// "Checar conflito" do WF7 Convocar. Respeita cancelamento:
//  - CANCELADA / BLOQUEADA - CONFLITO -> período nulo (não bloqueia).
//  - CANCELADA PARCIALMENTE -> período truncado em [start, cancelStart - 1].
//  - senão -> [start, end].
// overlap: aStart <= bEnd && bStart <= aEnd.

function normName(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
}

/** soma `n` dias a uma data YYYY-MM-DD (UTC) e devolve YYYY-MM-DD. */
export function addDays(iso: string, n: number): string | null {
  if (!iso) return null
  const d = new Date(iso + "T00:00:00Z")
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface Periodo {
  start: string
  end: string
}

/** Período efetivo que ainda bloqueia (ou null se cancelado/sem período válido). */
export function effectivePeriod(
  start: string | null,
  end: string | null,
  statusLabel: string | null,
  cancelStart: string | null,
): Periodo | null {
  if (!start || !end) return null
  const status = normName(statusLabel)
  if (status === "CANCELADA" || status === "CANCELADO" || status === "BLOQUEADA - CONFLITO") {
    return null
  }
  if (status === "CANCELADA PARCIALMENTE" || status === "CANCELADO PARCIALMENTE") {
    if (!cancelStart) return { start, end }
    const effectiveEnd = addDays(cancelStart, -1)
    if (!effectiveEnd || effectiveEnd < start) return null
    return { start, end: effectiveEnd }
  }
  return { start, end }
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false
  return aStart <= bEnd && bStart <= aEnd
}

export interface ConvocacaoExistente {
  itemId?: string
  nome?: string
  chapa?: string
  dataInicio: string | null
  dataFim: string | null
  statusConvocacao: string | null
  cancelamentoInicio: string | null
}

export interface Conflito {
  itemId?: string
  nome?: string
  data_inicio: string
  data_fim: string
  data_inicio_original: string
  data_fim_original: string
  status_convocacao: string
  data_inicio_cancelamento: string
}

/**
 * Acha a 1ª convocação existente cujo período efetivo sobrepõe o novo período.
 * Retorna o conflito (com período efetivo) ou null.
 */
export function acharConflito(
  nova: { dataInicio: string; dataFim: string },
  existentes: ConvocacaoExistente[],
): Conflito | null {
  for (const e of existentes) {
    const periodo = effectivePeriod(e.dataInicio, e.dataFim, e.statusConvocacao, e.cancelamentoInicio)
    if (!periodo) continue
    if (!overlaps(periodo.start, periodo.end, nova.dataInicio, nova.dataFim)) continue
    return {
      itemId: e.itemId,
      nome: e.nome,
      data_inicio: periodo.start,
      data_fim: periodo.end,
      data_inicio_original: e.dataInicio || "",
      data_fim_original: e.dataFim || "",
      status_convocacao: e.statusConvocacao || "",
      data_inicio_cancelamento: e.cancelamentoInicio || "",
    }
  }
  return null
}
