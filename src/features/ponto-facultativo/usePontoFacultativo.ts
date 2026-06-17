import { useMutation, useQuery } from "@tanstack/react-query"

import {
  aplicarPontoFacultativo,
  buscarOpcoesPontoFacultativo,
  previewPontoFacultativo,
} from "./api"
import { registrarAtividade } from "@/lib/atividade"

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
    onSuccess: (resp, payload) => {
      registrarAtividade("ponto_facultativo", {
        alvo: `${payload.contrato}:${payload.unidade}:${payload.data}`,
        contrato: payload.contrato,
        resumo: {
          unidade: payload.unidade,
          data: payload.data,
          qtd: resp?.processados ?? null,
        },
      })
    },
  })
}
