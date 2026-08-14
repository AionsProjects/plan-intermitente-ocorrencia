import { useMutation, useQuery } from "@tanstack/react-query"

import {
  aplicarPontoFacultativo,
  buscarOpcoesPontoFacultativo,
  previewPontoFacultativo,
} from "./api"
import { comAtividade } from "@/lib/atividade"
import type { PontoFacultativoPayload } from "./types"

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
    // `comAtividade` no lugar do antigo `registrarAtividade` do onSuccess: abre a execução
    // ANTES da chamada, então aplicação que FALHA passa a deixar rastro — que é justamente
    // quando alguém precisa do log. O id vai no payload e a rota se anexa a ele, em vez de
    // abrir uma segunda linha pra mesma ação.
    mutationFn: (payload: PontoFacultativoPayload) =>
      comAtividade(
        "ponto_facultativo",
        {
          alvo: `${payload.contrato}:${payload.unidades.join("+")}:${payload.data}`,
          contrato: payload.contrato,
          resumo: { unidades: payload.unidades, data: payload.data },
        },
        (execucaoId) => aplicarPontoFacultativo(payload, execucaoId),
      ),
  })
}
