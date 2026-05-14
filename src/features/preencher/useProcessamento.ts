import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  buscarProcessamento,
  cancelarConvocacao,
  finalizarProcessamento,
} from "./api"
import type { PayloadCancelarConvocacao, PayloadFinalizar } from "./types"

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
