// Helpers PUROS de parsing de colunas Monday — SEM rede, SEM config (testáveis offline).
// O client (monday.ts) re-exporta tudo daqui + adiciona as funções de rede.

export interface ColumnValue {
  id: string
  text: string | null
  value: string | null // JSON string (formato interno do Monday) ou null
}

export interface MondayItem {
  id: string
  name: string
  cv: Record<string, ColumnValue> // indexado por column_id
}

/** Indexa column_values[] (como vem do GraphQL) por column_id. */
export function indexarColunas(
  colunas: Array<{ id: string; text: string | null; value: string | null }>,
): Record<string, ColumnValue> {
  const cv: Record<string, ColumnValue> = {}
  for (const c of colunas) cv[c.id] = c
  return cv
}

/** Texto cru de uma coluna (ou null). */
export function texto(cv: Record<string, ColumnValue>, id: string): string | null {
  return cv[id]?.text ?? null
}

/** "YYYY-MM-DD..." -> "YYYY-MM-DD" (date-only). */
export function dataApenas(s: string | null): string | null {
  return s ? s.slice(0, 10) : null
}

/** "YYYY-MM-DD HH:mm:ss" -> ISO "YYYY-MM-DDTHH:mm:ss". */
export function timestamp(s: string | null): string | null {
  return s ? s.replace(" ", "T") : null
}

/** Status que começa com "SIM" -> true; "NÃO"/outros -> false; vazio -> null. */
export function boolSim(s: string | null): boolean | null {
  return s == null ? null : /^SIM/i.test(s.trim())
}

/** Número com vírgula decimal ("12,5") ou ponto ("1234.56"); vazio/inválido -> null. */
export function numero(s: string | null): number | null {
  if (s == null || s === "") return null
  const n = Number(String(s).replace(",", "."))
  return Number.isFinite(n) ? n : null
}

/** Parse seguro de JSON em long_text (retorna null em erro). */
export function jsonParse(s: string | null): unknown {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Extrai o id do pulse de uma coluna link do Monday (várias formas de URL). */
export function idDeLink(cv: Record<string, ColumnValue>, id: string): number | null {
  const raw = cv[id]?.value || cv[id]?.text || ""
  const m = String(raw).match(/pulses\/(\d+)|boards\/\d+\/pulses\/(\d+)|\/(\d{8,})/)
  const found = m && (m[1] || m[2] || m[3])
  return found ? Number(found) : null
}
