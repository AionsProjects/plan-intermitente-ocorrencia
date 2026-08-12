import { useMutation, useQuery } from "@tanstack/react-query"

import { useDebounce } from "@/lib/useDebounce"
import {
  buscarEmpregado,
  buscarOpcoesConvocacao,
  criarConvocacao,
} from "./api"
import { OPCOES_CONVOCACAO_FALLBACK } from "./types"
import type { ConvocacaoPayload } from "./types"
import { comAtividade } from "@/lib/atividade"

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

// Meses de convocação (atual/próximo) com a competência (YYYY-MM) de cada board,
// resolvida pelo registry. Controla o seletor de mês + o range do calendário.
export type MesConvocacao = { existe: boolean; competencia: string | null }
async function resolverMes(papel: "passado" | "atual" | "proximo"): Promise<MesConvocacao> {
  const res = await fetch(`/api/boards/resolver?papel=${papel}`, {
    credentials: "same-origin",
  })
  if (!res.ok) return { existe: false, competencia: null }
  const j = (await res.json()) as { competencia?: string | null }
  return { existe: true, competencia: j.competencia ?? null }
}

export function useMesesConvocacao() {
  return useQuery({
    queryKey: ["boards-meses-convocacao"],
    queryFn: async () => ({
      // "passado" = lançamento retroativo (SÓ o mês anterior; nada antes disso).
      passado: await resolverMes("passado"),
      atual: await resolverMes("atual"),
      proximo: await resolverMes("proximo"),
    }),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useCriarConvocacao() {
  return useMutation({
    // Abre a execução ANTES de criar: convocação que falha (409 de conflito, RM fora do
    // ar) precisa deixar rastro, e antes disso o log só existia no `onSuccess`.
    //
    // ⚠️ `alvo` fica NULO aqui de propósito: `uuid_alvo` de `acao='convocacao'` é o
    // item_id do Monday, que só existe depois do create. A rota preenche (COALESCE) —
    // mandar a chapa no lugar quebraria a cascata resolverItemDoPlano do monitor de board.
    mutationFn: (payload: ConvocacaoPayload) =>
      comAtividade(
        "convocacao",
        {
          pessoa: payload.empregado.nome,
          contrato: payload.contrato,
          resumo: {
            chapa: payload.empregado.chapa,
            data_inicio: payload.dataInicio,
            data_fim: payload.dataFim,
            unidade: payload.localUnidade,
          },
        },
        (execucaoId) => criarConvocacao(payload, execucaoId),
      ),
  })
}
