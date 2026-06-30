// Feriado por contrato — lógica PURA (sem rede). Porta fiel do front
// (src/lib/feriadosBr.ts + feriadosBoard.ts) pro backend, pra cálculo de VR/VT
// e cancelamento baterem com o que o front mostra (match bilateral — pendência antiga).
//
// Regra "feriado efetivo" = aplicaAoContrato(dia) && !recebeFeriado(contrato):
//   - NACIONAL aplica a todos; ESTADUAL/MUNICIPAL só se o contrato está na lista.
//   - SEDUC* e DETRAN RECEBEM no feriado -> não bloqueiam (efetivo = false).
// Os feriados do board (pi.feriados) entram via `lista`. Sem board, cai no NACIONAL fixo.

export interface Feriado {
  data: string // YYYY-MM-DD
  nome: string
  tipo: string // NACIONAL | ESTADUAL | MUNICIPAL
  contratos: string[]
}

// ---- Feriados nacionais fixos + Sexta-feira Santa (Meeus/Jones/Butcher) ----

const FIXOS: Array<{ mm: number; dd: number; nome: string }> = [
  { mm: 1, dd: 1, nome: "Confraternização Universal" },
  { mm: 4, dd: 21, nome: "Tiradentes" },
  { mm: 5, dd: 1, nome: "Dia do Trabalho" },
  { mm: 9, dd: 7, nome: "Independência do Brasil" },
  { mm: 10, dd: 12, nome: "N. Sra. Aparecida" },
  { mm: 11, dd: 2, nome: "Finados" },
  { mm: 11, dd: 15, nome: "Proclamação da República" },
  { mm: 11, dd: 20, nome: "Consciência Negra" },
  { mm: 12, dd: 25, nome: "Natal" },
]

const cacheAno = new Map<number, Map<string, string>>()

/** Domingo de Páscoa (UTC) via algoritmo Meeus/Jones/Butcher. */
function calcularPascoa(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  const mes = Math.floor(n / 31) // 3 = março, 4 = abril
  const dia = (n % 31) + 1
  return new Date(Date.UTC(year, mes - 1, dia))
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function feriadosNacionaisDoAno(year: number): Map<string, string> {
  const existente = cacheAno.get(year)
  if (existente) return existente
  const m = new Map<string, string>()
  for (const f of FIXOS) m.set(toIso(new Date(Date.UTC(year, f.mm - 1, f.dd))), f.nome)
  const pascoa = calcularPascoa(year)
  const sexta = new Date(pascoa)
  sexta.setUTCDate(sexta.getUTCDate() - 2)
  m.set(toIso(sexta), "Sexta-feira Santa")
  cacheAno.set(year, m)
  return m
}

export function isFeriadoNacional(iso: string): boolean {
  if (!iso || iso.length < 10) return false
  const year = Number(iso.slice(0, 4))
  if (!Number.isFinite(year)) return false
  return feriadosNacionaisDoAno(year).has(iso)
}

export function nomeFeriadoNacional(iso: string): string | null {
  if (!iso || iso.length < 10) return null
  const year = Number(iso.slice(0, 4))
  if (!Number.isFinite(year)) return null
  return feriadosNacionaisDoAno(year).get(iso) ?? null
}

// ---- Feriado por contrato (board) ----

/** Normaliza contrato: sem acento, maiúsculo, espaço único. */
export function norm(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Contrato que RECEBE no feriado (não bloqueia): SEDUC* e DETRAN. */
export function recebeFeriado(contrato: string | null | undefined): boolean {
  const c = norm(contrato)
  return c.startsWith("SEDUC") || c === "DETRAN"
}

function feriadoBoardAplica(
  iso: string,
  contrato: string | null | undefined,
  lista: Feriado[],
): Feriado | null {
  const cN = norm(contrato)
  for (const f of lista) {
    if (f.data !== iso) continue
    if (norm(f.tipo) === "NACIONAL") return f
    if (cN && f.contratos.some((x) => norm(x) === cN)) return f
  }
  return null
}

/**
 * Feriado efetivo (perde benefício / bloqueia no form) pro contrato no dia.
 * `lista` = feriados do board (pi.feriados); vazio -> fallback NACIONAL fixo.
 */
export function isFeriado(
  iso: string,
  contrato?: string | null,
  lista: Feriado[] = [],
): boolean {
  if (!iso || iso.length < 10) return false
  if (recebeFeriado(contrato)) return false
  if (lista.length) return !!feriadoBoardAplica(iso, contrato, lista)
  return isFeriadoNacional(iso)
}

/** Nome do feriado efetivo p/ exibir, ou null. */
export function nomeFeriado(
  iso: string,
  contrato?: string | null,
  lista: Feriado[] = [],
): string | null {
  if (!iso || iso.length < 10) return null
  if (recebeFeriado(contrato)) return null
  if (lista.length) {
    const f = feriadoBoardAplica(iso, contrato, lista)
    return f ? f.nome : null
  }
  return nomeFeriadoNacional(iso)
}
