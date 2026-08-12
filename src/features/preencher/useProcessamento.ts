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
import { comAtividade } from "@/lib/atividade"

/**
 * As mutations abrem a execução ANTES de chamar o processo (via `comAtividade`), não no
 * `onSuccess`.
 *
 * Era o buraco raiz do histórico: registrar no `onSuccess` significa que ação que FALHA
 * não deixa rastro nenhum — e falha é justamente o que alguém precisa ver. `comAtividade`
 * também passa o `execucao_id` adiante, pra a rota se anexar à execução em vez de abrir
 * outra (senão cada ação gerava duas linhas).
 */

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
    mutationFn: (payload: PayloadFinalizar) => {
      const d = qc.getQueryData<ProcessamentoDados>(["processamento", uuid])
      return comAtividade(
        "registro",
        {
          alvo: uuid,
          pessoa: d?.nome ?? null,
          contrato: d?.contrato ?? null,
          resumo: { protocolo: payload.protocolo, eh_correcao: payload.ehCorrecao ?? false },
        },
        (execucaoId) => finalizarProcessamento(uuid, payload, execucaoId),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["processamento", uuid] })
    },
  })
}

export function useCancelarConvocacao(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadCancelarConvocacao) => {
      const d = qc.getQueryData<ProcessamentoDados>(["processamento", uuid])
      return comAtividade(
        "cancelamento",
        {
          alvo: uuid,
          pessoa: d?.nome ?? null,
          contrato: d?.contrato ?? null,
          resumo: { tipo: payload.tipo, data: payload.dataInicioCancelamento },
        },
        (execucaoId) => cancelarConvocacao(uuid, payload, execucaoId),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["processamento", uuid] })
    },
  })
}

export function useAplicarSplit(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadAplicarSplit) => {
      const d = qc.getQueryData<ProcessamentoDados>(["processamento", uuid])
      return comAtividade(
        "split",
        {
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
        },
        (execucaoId) => aplicarSplit(uuid, payload, execucaoId),
      )
    },
    // Aguarda o refetch concluir antes de liberar o usuário, pra evitar
    // race condition: usuário clicava "Finalizar" antes do refetch do WF2
    // resolver, e o payload do finalize chegava sem o split.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["processamento", uuid] })
      await qc.refetchQueries({ queryKey: ["processamento", uuid] })
    },
  })
}
