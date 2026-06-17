/**
 * Feriados vindos do board monday (FERIADOS 18415442661), por contrato.
 *
 * Substitui o feriadosBr.ts (só NACIONAL hardcoded) pela lógica do mensal:
 * data + tipo (NACIONAL/ESTADUAL/MUNICIPAL) + contratos.
 *
 * Regra "feriado efetivo" (mesma do WF mensal/pontual):
 *   feriadoEfetivo = aplicaAoContrato(dia) && !recebeFeriado(contrato)
 *   - NACIONAL aplica a todos; ESTADUAL/MUNICIPAL só se o contrato está na lista.
 *   - SEDUC* e DETRAN RECEBEM no feriado → não bloqueiam (efetivo = false).
 *
 * Frontend nunca fala com monday direto: os dados vêm do NOSSO backend
 * (`/api/feriados`, lê o board Monday ao vivo). Cache de módulo + react-query.
 * Enquanto não carrega (ou se falhar), cai no fallback NACIONAL (feriadosBr).
 */
import { useQuery } from "@tanstack/react-query"
import { isFeriadoNacional, nomeFeriadoNacional } from "./feriadosBr"

export interface Feriado {
  data: string
  nome: string
  tipo: string
  contratos: string[]
}

// Lê do NOSSO backend (rota relativa, mesma origem no Vercel/nginx).

// Cache de módulo: permite helpers síncronos (isFeriado/nomeFeriado) sem
// threading por props/useMemo. Populado pelo useFeriados ao carregar.
let _cache: Feriado[] | null = null

function norm(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

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

/** Feriado efetivo (perde benefício / bloqueia no form) para o contrato. */
export function isFeriado(iso: string, contrato?: string | null): boolean {
  if (!iso || iso.length < 10) return false
  if (recebeFeriado(contrato)) return false
  if (_cache) return !!feriadoBoardAplica(iso, contrato, _cache)
  return isFeriadoNacional(iso) // fallback offline (NACIONAL)
}

/** Nome do feriado efetivo p/ exibir, ou null. */
export function nomeFeriado(iso: string, contrato?: string | null): string | null {
  if (!iso || iso.length < 10) return null
  if (recebeFeriado(contrato)) return null
  if (_cache) {
    const f = feriadoBoardAplica(iso, contrato, _cache)
    return f ? f.nome : null
  }
  return nomeFeriadoNacional(iso) // fallback offline
}

async function fetchFeriados(): Promise<Feriado[]> {
  const res = await fetch("/api/feriados", { credentials: "same-origin" })
  if (!res.ok) throw new Error("feriados http " + res.status)
  const j = await res.json()
  return Array.isArray(j?.feriados) ? (j.feriados as Feriado[]) : []
}

/**
 * Carrega os feriados do board (1x/hora). Popula o cache de módulo p/ os
 * helpers síncronos. Componentes que marcam feriado devem chamar este hook
 * (dispara o load + re-render quando chega).
 */
export function useFeriados() {
  return useQuery({
    queryKey: ["feriados"],
    queryFn: async () => {
      const f = await fetchFeriados()
      _cache = f
      return f
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })
}
