import { useMutation, useQuery } from "@tanstack/react-query"

import {
  aplicarPontoFacultativo,
  buscarOpcoesPontoFacultativo,
  previewPontoFacultativo,
} from "./api"

export function useOpcoesPontoFacultativo() {
  return useQuery({
    queryKey: ["ponto-facultativo-opcoes"],
    queryFn: buscarOpcoesPontoFacultativo,
    staleTime: 60_000,
  })
}

export function usePreviewPontoFacultativo() {
  return useMutation({
    mutationFn: previewPontoFacultativo,
  })
}

export function useAplicarPontoFacultativo() {
  return useMutation({
    mutationFn: aplicarPontoFacultativo,
  })
}
