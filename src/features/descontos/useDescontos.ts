import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { buscarDesconto, registrarRetiradaManual } from "./api"
import type { PayloadRegistrarRetirada } from "./types"

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["desconto", uuid] })
    },
  })
}
