import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { buscarDesconto, registrarRetiradaManual } from "./api"
import type { DescontoDados, PayloadRegistrarRetirada } from "./types"
import { registrarAtividade } from "@/lib/atividade"

export function useDesconto(uuid: string | undefined) {
  return useQuery({
    queryKey: ["desconto", uuid],
    queryFn: () => buscarDesconto(uuid!),
    enabled: !!uuid,
    staleTime: 0,
  })
}

export function useRegistrarRetirada(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PayloadRegistrarRetirada) =>
      registrarRetiradaManual(uuid, payload),
    onSuccess: (_resp, payload) => {
      const d = qc.getQueryData<DescontoDados>(["desconto", uuid])
      registrarAtividade("desconto", {
        alvo: uuid,
        pessoa: d?.empregadoNome ?? null,
        contrato: d?.contrato ?? null,
        resumo: { vr: payload.vrRetirado, vt: payload.vtRetirado },
      })
      qc.invalidateQueries({ queryKey: ["desconto", uuid] })
    },
  })
}
