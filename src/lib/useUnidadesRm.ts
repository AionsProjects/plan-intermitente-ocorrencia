import { useCallback } from "react"
import { useQuery } from "@tanstack/react-query"

import { unidadesParaContrato } from "./unidadesContrato"

/**
 * Unidades oficiais do RM por contrato (SQL 231375, via auth-backend).
 * Mesma fonte usada pelo /convocar (`/api/convocar/opcoes`) e pelo ponto
 * facultativo. Fallback: lista local `UNIDADES_POR_CONTRATO` quando o RM
 * está fora ou em modo mock (fetch falha → helper cai no hardcoded).
 */

export type UnidadesPorContrato = Record<string, string[]>

async function buscarUnidadesRm(): Promise<UnidadesPorContrato> {
  const res = await fetch("/api/intermitente-unidades-rm", {
    credentials: "same-origin",
  })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  const data = (await res.json()) as {
    unidades_por_contrato?: Record<string, unknown>
  }
  const raw = data?.unidades_por_contrato ?? {}
  const out: UnidadesPorContrato = {}
  for (const [contrato, unidades] of Object.entries(raw)) {
    if (!Array.isArray(unidades)) continue
    const limpas = unidades.map((u) => String(u ?? "").trim()).filter(Boolean)
    if (limpas.length > 0) out[contrato] = limpas
  }
  return out
}

export function useUnidadesRm() {
  const query = useQuery({
    queryKey: ["unidades-rm"],
    queryFn: buscarUnidadesRm,
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const rm = query.data

  /** Unidades exatas do RM pro contrato; fallback hardcoded se RM indisponível. */
  const unidadesDoContrato = useCallback(
    (contrato: string | null | undefined): readonly string[] => {
      const alvo = String(contrato ?? "").trim().toUpperCase()
      if (!alvo) return []
      const remotas = rm?.[alvo] ?? rm?.[String(contrato ?? "").trim()] ?? []
      return remotas.length > 0 ? remotas : unidadesParaContrato(contrato)
    },
    [rm],
  )

  return {
    unidadesPorContrato: rm ?? null,
    unidadesDoContrato,
    carregando: query.isLoading,
    erro: query.isError,
  }
}
