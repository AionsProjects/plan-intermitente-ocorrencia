// Cliente Nexti (ponto eletrônico) — porta dos nodes HTTP do WF VALIDAR
// ATESTADO (6efSZ). OAuth client_credentials com Basic em NEXTI_BASIC_AUTH.
// Token cacheado em memória até ~60s antes de expirar.
import { config } from "../config.js"

const BASE = "https://api.nexti.com"

export class ErroNexti extends Error {
  constructor(message: string, public status?: number, public detalhe?: unknown) {
    super(message)
    this.name = "ErroNexti"
  }
}

let tokenCache: { token: string; expiraEm: number } | null = null

async function token(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiraEm) return tokenCache.token
  if (!config.nextiBasicAuth) throw new ErroNexti("NEXTI_BASIC_AUTH ausente no .env")
  const r = await fetch(`${BASE}/security/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${config.nextiBasicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=openid",
  })
  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  if (!r.ok || !j?.access_token) throw new ErroNexti("Nexti OAuth falhou", r.status, j)
  tokenCache = {
    token: j.access_token,
    expiraEm: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 60) * 1000,
  }
  return tokenCache.token
}

async function get<T>(path: string): Promise<T> {
  const t = await token()
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t}` } })
  const j = (await r.json().catch(() => null)) as T
  if (!r.ok) throw new ErroNexti(`Nexti GET ${path} HTTP ${r.status}`, r.status, j)
  return j
}

export interface NextiPerson {
  id: number | string
  name?: string
  personName?: string
  [k: string]: unknown
}

/** Busca pessoa por CPF. Retorna a primeira ou null. */
export async function pessoaPorCpf(cpf: string): Promise<NextiPerson | null> {
  const r = await get<unknown>(`/persons/cpf/${cpf}`)
  const arr = Array.isArray(r) ? r : Array.isArray((r as { content?: unknown[] })?.content) ? (r as { content: unknown[] }).content : [r]
  const p = arr[0] as NextiPerson | undefined
  return p && p.id ? p : null
}

export interface NextiAbsence {
  id?: number | string
  absenceId?: number | string
  start?: string
  startDateTime?: string
  finish?: string
  finishDateTime?: string
  end?: string
  absenceSituationId?: number | string | null
  situationId?: number | string | null
  situationName?: string
  absenceTypeId?: number | string | null
  [k: string]: unknown
}

/** Absences da pessoa no intervalo (paginado — o WF varre até 100 páginas de 50). */
export async function absencesPessoa(
  personId: number | string,
  start: string, // ddMMyyyy000000
  finish: string,
  maxPages = 100,
  size = 50,
): Promise<NextiAbsence[]> {
  const out: NextiAbsence[] = []
  for (let page = 0; page < maxPages; page++) {
    const r = await get<unknown>(
      `/absences/person/${personId}/start/${start}/finish/${finish}?page=${page}&size=${size}`,
    )
    const content = Array.isArray(r)
      ? (r as NextiAbsence[])
      : Array.isArray((r as { content?: NextiAbsence[] })?.content)
        ? (r as { content: NextiAbsence[] }).content
        : []
    out.push(...content)
    if (content.length < size) break
  }
  return out
}

export interface NextiSituation {
  id?: number | string
  name?: string
  situationName?: string
  [k: string]: unknown
}

export async function situacaoAbsence(situationId: number | string): Promise<NextiSituation | null> {
  const r = await get<unknown>(`/absencesituations/${situationId}`)
  const raw = Array.isArray(r)
    ? r[0]
    : Array.isArray((r as { content?: unknown[] })?.content)
      ? (r as { content: unknown[] }).content[0]
      : r
  const s = ((raw as { value?: NextiSituation })?.value ?? raw) as NextiSituation | null
  return s ?? null
}
