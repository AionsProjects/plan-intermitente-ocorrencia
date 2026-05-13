import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { buscarEmpregado, criarConvocacao } from "./api"
import type { ConvocacaoPayload } from "./types"

function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function useBuscarEmpregado(query: string) {
  const debounced = useDebounce(query, 250)
  const ativo = debounced.trim().length >= 3
  const result = useQuery({
    queryKey: ["empregado-rm", debounced],
    queryFn: () => buscarEmpregado(debounced),
    enabled: ativo,
    staleTime: 30_000,
  })
  return { ...result, ativo, queryDebounced: debounced }
}

export function useCriarConvocacao() {
  return useMutation({
    mutationFn: (payload: ConvocacaoPayload) => criarConvocacao(payload),
  })
}
