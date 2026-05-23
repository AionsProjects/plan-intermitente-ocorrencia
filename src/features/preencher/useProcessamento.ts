import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  aplicarSplit,
  buscarProcessamento,
  cancelarConvocacao,
  finalizarProcessamento,
} from "./api"
import type {
  PayloadAplicarSplit,
  PayloadCancelarConvocacao,
  PayloadFinalizar,
} from "./types"

export function useProcessamento(uuid: string | undefined) {
  return useQuery({
    queryKey: ["processamento", uuid],
    queryFn: () => buscarProcessamento(uuid!),
    enabled: !!uuid,
    staleTime: 0,
  })
}

export function useFinalizarProcessamento(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadFinalizar) =>
      finalizarProcessamento(uuid, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["processamento", uuid] })
    },
  })
}

export function useCancelarConvocacao(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadCancelarConvocacao) =>
      cancelarConvocacao(uuid, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["processamento", uuid] })
    },
  })
}

export function useAplicarSplit(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadAplicarSplit) => aplicarSplit(uuid, payload),
    // Aguarda o refetch concluir antes de liberar o usuário, pra evitar
    // race condition: usuário clicava "Finalizar" antes do refetch do WF2
    // resolver, e o payload do finalize chegava sem o split.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["processamento", uuid] })
      await qc.refetchQueries({ queryKey: ["processamento", uuid] })
    },
  })
}
