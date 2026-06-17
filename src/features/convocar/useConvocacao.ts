import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import {
  buscarEmpregado,
  buscarOpcoesConvocacao,
  criarConvocacao,
} from "./api"
import { OPCOES_CONVOCACAO_FALLBACK } from "./types"
import type { ConvocacaoPayload } from "./types"
import { registrarAtividade } from "@/lib/atividade"

const FALLBACK_OPCOES_MUTABLE = {
  solicitantes: [...OPCOES_CONVOCACAO_FALLBACK.solicitantes],
  contratos: [...OPCOES_CONVOCACAO_FALLBACK.contratos],
  sabados: [...OPCOES_CONVOCACAO_FALLBACK.sabados],
  insalubridades: [...OPCOES_CONVOCACAO_FALLBACK.insalubridades],
  interiores: [...OPCOES_CONVOCACAO_FALLBACK.interiores],
  justificativas: [...OPCOES_CONVOCACAO_FALLBACK.justificativas],
  unidadesPorContrato: Object.fromEntries(
    Object.entries(OPCOES_CONVOCACAO_FALLBACK.unidadesPorContrato).map(
      ([contrato, unidades]) => [contrato, [...unidades]],
    ),
  ),
  unidadeColumnId: OPCOES_CONVOCACAO_FALLBACK.unidadeColumnId,
}

function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function useBuscarEmpregado(query: string) {
  const debounced = useDebounce(query, 250)
  const ativo = debounced.trim().length >= 3
  const result = useQuery({
    queryKey: ["empregado-rm", debounced],
    queryFn: () => buscarEmpregado(debounced),
    enabled: ativo,
    staleTime: 30_000,
  })
  return { ...result, ativo, queryDebounced: debounced }
}

export function useOpcoesConvocacao() {
  return useQuery({
    queryKey: ["convocacao-opcoes"],
    queryFn: buscarOpcoesConvocacao,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: FALLBACK_OPCOES_MUTABLE,
    retry: 1,
  })
}

export function useCriarConvocacao() {
  return useMutation({
    mutationFn: (payload: ConvocacaoPayload) => criarConvocacao(payload),
    onSuccess: (resp, payload) => {
      registrarAtividade("convocacao", {
        alvo: resp?.itemId ? String(resp.itemId) : payload.empregado.chapa,
        pessoa: payload.empregado.nome,
        contrato: payload.contrato,
        resumo: { data_inicio: payload.dataInicio, data_fim: payload.dataFim },
      })
    },
  })
}
