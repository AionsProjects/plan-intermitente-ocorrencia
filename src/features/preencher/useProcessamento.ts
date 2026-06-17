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
  ProcessamentoDados,
} from "./types"
import { registrarAtividade } from "@/lib/atividade"

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
    onSuccess: (_resp, payload) => {
      const d = qc.getQueryData<ProcessamentoDados>(["processamento", uuid])
      registrarAtividade("registro", {
        alvo: uuid,
        pessoa: d?.nome ?? null,
        contrato: d?.contrato ?? null,
        resumo: { protocolo: payload.protocolo, eh_correcao: payload.ehCorrecao ?? false },
      })
      qc.invalidateQueries({ queryKey: ["processamento", uuid] })
    },
  })
}

export function useCancelarConvocacao(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadCancelarConvocacao) =>
      cancelarConvocacao(uuid, payload),
    onSuccess: (_resp, payload) => {
      const d = qc.getQueryData<ProcessamentoDados>(["processamento", uuid])
      registrarAtividade("cancelamento", {
        alvo: uuid,
        pessoa: d?.nome ?? null,
        contrato: d?.contrato ?? null,
        resumo: { tipo: payload.tipo, data: payload.dataInicioCancelamento },
      })
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
    onSuccess: async (_resp, payload) => {
      const d = qc.getQueryData<ProcessamentoDados>(["processamento", uuid])
      registrarAtividade("split", {
        alvo: uuid,
        pessoa: d?.nome ?? null,
        contrato: d?.contrato ?? null,
        resumo:
          payload.tipo === "aplicar"
            ? {
                tipo: "aplicar",
                contrato_p1: payload.contratoParte1,
                contrato_p2: payload.contratoParte2,
                data_p2: payload.dataInicioParte2,
              }
            : { tipo: "reverter" },
      })
      await qc.invalidateQueries({ queryKey: ["processamento", uuid] })
      await qc.refetchQueries({ queryKey: ["processamento", uuid] })
    },
  })
}
