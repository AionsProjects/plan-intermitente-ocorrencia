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
    // Sem `registrarAtividade` aqui: quem abre a execução é a ROTA, uma por documento
    // (`auth-backend/src/routes/atestados.ts`). O lote é uma requisição só, então o front
    // não teria como carimbar N ids — e logar dos dois lados renderia duas linhas por
    // documento. Ganho da troca: documento que falha no meio do lote passa a aparecer no
    // /atividade com o motivo, coisa que o antigo `onSuccess` nunca registrava.
  })
}
