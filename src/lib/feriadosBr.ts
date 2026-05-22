/**
 * Feriados nacionais brasileiros — implementação hardcoded leve.
 *
 * Alternativa pesada `date-holidays` adicionava ~1.9MB ao bundle (carrega
 * data de 280 países). Bundle volta ao normal com lista manual abaixo.
 *
 * Inclui:
 * - 8 feriados fixos (Ano Novo, Tiradentes, Trabalho, Independência,
 *   N. Sra. Aparecida, Finados, Proclamação, Consciência Negra, Natal)
 * - 1 feriado móvel (Sexta-feira Santa = Páscoa - 2 dias)
 *
 * Páscoa calculada via algoritmo de Gauss (Meeus/Jones/Butcher). Cache
 * por ano memoizado em Map<year, Map<iso, nome>>.
 *
 * NÃO inclui (não são nacionais oficiais):
 * - Carnaval (ponto facultativo)
 * - Corpus Christi (facultativo nacional)
 * - Feriados estaduais / municipais
 */

const cache = new Map<number, Map<string, string>>()

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

/** Calcula domingo de Páscoa via algoritmo Meeus/Jones/Butcher.
 *  Retorna Date em UTC. Válido pra calendário gregoriano (year >= 1583). */
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

function feriadosDoAno(year: number): Map<string, string> {
  const existente = cache.get(year)
  if (existente) return existente
  const m = new Map<string, string>()
  for (const f of FIXOS) {
    const d = new Date(Date.UTC(year, f.mm - 1, f.dd))
    m.set(toIso(d), f.nome)
  }
  // Sexta-feira Santa = Páscoa - 2 dias
  const pascoa = calcularPascoa(year)
  const sextaSanta = new Date(pascoa)
  sextaSanta.setUTCDate(sextaSanta.getUTCDate() - 2)
  m.set(toIso(sextaSanta), "Sexta-feira Santa")
  cache.set(year, m)
  return m
}

export function isFeriadoNacional(iso: string): boolean {
  if (!iso || iso.length < 10) return false
  const year = Number(iso.slice(0, 4))
  if (!Number.isFinite(year)) return false
  return feriadosDoAno(year).has(iso)
}

export function nomeFeriadoNacional(iso: string): string | null {
  if (!iso || iso.length < 10) return null
  const year = Number(iso.slice(0, 4))
  if (!Number.isFinite(year)) return null
  return feriadosDoAno(year).get(iso) ?? null
}
