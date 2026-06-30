// Dias úteis de um período — PURO. Porta fiel do dateRange dos WFs
// (_prep_cancel.js / finalizar). Exclui domingo sempre; sábado só se trabalhaSabado
// ou se for sábado extra; exclui feriado NACIONAL (mesmo Meeus do domain/feriado).
import { isFeriadoNacional } from "./feriado.js"

/** Lista YYYY-MM-DD de dias úteis em [inicio, fim] (UTC). */
export function diasUteis(
  inicio: string,
  fim: string,
  trabalhaSabado: boolean,
  sabadosExtras: Iterable<string> = [],
): string[] {
  const sabEx = new Set(sabadosExtras)
  const out: string[] = []
  const cur = new Date(inicio + "T00:00:00Z")
  const ate = new Date(fim + "T00:00:00Z")
  while (cur <= ate) {
    const dow = cur.getUTCDay() // 0=dom, 6=sáb
    const iso = cur.toISOString().slice(0, 10)
    const incluiSabado = trabalhaSabado || sabEx.has(iso)
    if (dow !== 0 && !isFeriadoNacional(iso) && (dow !== 6 || incluiSabado)) out.push(iso)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/**
 * Dias CORRIDOS (inclui sáb+dom) em [inicio, fim], excluindo feriado nacional.
 * Regra VR pra DETRAN/TRE PB ("VR conta dias corridos"). Mantido separado de diasUteis.
 */
export function diasCorridos(inicio: string, fim: string): string[] {
  const out: string[] = []
  const cur = new Date(inicio + "T00:00:00Z")
  const ate = new Date(fim + "T00:00:00Z")
  while (cur <= ate) {
    const iso = cur.toISOString().slice(0, 10)
    if (!isFeriadoNacional(iso)) out.push(iso)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}
