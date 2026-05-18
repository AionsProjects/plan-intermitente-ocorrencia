import { useMutation, useQuery } from "@tanstack/react-query"

import {
  buscarConvocacoesEmpregado,
  lancarDocumentos,
} from "./api"
import type {
  BuscarConvocacoesEmpregadoQuery,
  DocumentoLancamento,
} from "./types"

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
