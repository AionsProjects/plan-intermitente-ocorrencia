import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import {
  buscarCeletista,
  buscarConvocacoesEmpregado,
  lancarDocumentos,
} from "./api"
import type {
  BuscarConvocacoesEmpregadoQuery,
  DocumentoLancamento,
} from "./types"

function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function useBuscarCeletista(query: string) {
  const debounced = useDebounce(query, 250)
  const ativo = debounced.trim().length >= 3
  const result = useQuery({
    queryKey: ["celetista-rm", debounced],
    queryFn: () => buscarCeletista(debounced),
    enabled: ativo,
    staleTime: 30_000,
  })
  return { ...result, ativo, queryDebounced: debounced }
}

export function useConvocacoesEmpregado(chapa: string, mes?: string) {
  const ativo = chapa.trim().length > 0
  return useQuery({
    queryKey: ["convocacoes-empregado", chapa, mes ?? ""],
    queryFn: () =>
      buscarConvocacoesEmpregado({
        chapa,
        mes,
      } satisfies BuscarConvocacoesEmpregadoQuery),
    enabled: ativo,
    staleTime: 30_000,
  })
}

export function useLancarDocumentos() {
  return useMutation({
    mutationFn: (documentos: DocumentoLancamento[]) =>
      lancarDocumentos(documentos),
  })
}
