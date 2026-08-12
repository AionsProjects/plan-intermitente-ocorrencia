import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { ArrowUpRight } from "lucide-react"

import { useNav } from "@/components/NavContext"
import { listarAtividade } from "@/features/atividade/api"
import { horaManaus, rotuloEtapa } from "@/features/atividade/etapas"
import { COR_ACAO, ehFalha, lampDoEstado, rotuloAcao } from "@/features/atividade/types"

/**
 * Atalho pro histórico, dentro do overlay de configuração.
 *
 * O log completo mora em `/atividade`. Aqui ficam só as últimas linhas, somente
 * leitura: o Dialog é `sm:max-w-lg` (~32rem) e desmonta na troca de aba
 * (`{aba === "atividade" && <AtividadeTab />}`), então filtro e busca morreriam a
 * cada abertura — e a expansão dentro de `max-h-[70vh] overflow-y-auto` empurraria o
 * alvo pra fora da viewport interna. Esta aba existe pra manter o caminho de
 * descoberta que o operador já conhece.
 */

const QUANTAS = 5

export function AtividadeTab() {
  const navigate = useNavigate()
  const { fecharConfig } = useNav()

  const { data, isLoading, isError } = useQuery({
    queryKey: ["atividade", false],
    queryFn: () => listarAtividade(false),
    staleTime: 15_000,
  })

  const ultimas = (data?.atividades ?? []).slice(0, QUANTAS)
  const erros = (data?.atividades ?? []).filter((a) => ehFalha(a.estado)).length

  const irParaHistorico = (query = "") => {
    fecharConfig()
    navigate(`/atividade${query}`)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground/55">Suas últimas ações.</p>

      {isLoading && <p className="text-sm text-foreground/60">Carregando…</p>}
      {isError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Erro ao carregar atividade.
        </p>
      )}
      {data && ultimas.length === 0 && (
        <p className="rounded-lg border border-border bg-[rgb(var(--ink)/0.04)] px-3 py-6 text-center text-sm text-foreground/50">
          Nenhuma atividade ainda. As ações aparecem aqui conforme acontecem.
        </p>
      )}

      {erros > 0 && (
        <button
          type="button"
          onClick={() => irParaHistorico("?st=erro")}
          className="flex w-full items-center justify-between gap-2 rounded-xl bg-[rgb(var(--status-red-rgb)/0.08)] px-3 py-2 text-left text-[12px] text-[var(--status-red)] shadow-[inset_0_0_0_1px_rgb(239_102_102/0.3)]"
        >
          <span>
            <span className="lamp lamp--red mr-2 align-middle" aria-hidden />
            {erros} {erros === 1 ? "execução" : "execuções"} com erro
          </span>
          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
        </button>
      )}

      <div className="space-y-2">
        {ultimas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => irParaHistorico(`?exec=${a.id}`)}
            className="flex w-full flex-col gap-0.5 rounded-xl border border-border bg-[rgb(var(--ink)/0.04)] p-3 text-left transition hover:bg-[rgb(var(--ink)/0.07)]"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className={`truncate text-sm font-medium ${COR_ACAO[a.acao] ?? "text-foreground"}`}>
                <span className={`lamp ${lampDoEstado(a.estado)} mr-2 align-middle`} aria-hidden />
                {rotuloAcao(a.acao)}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/40">
                {horaManaus(a.criado_em)}
              </span>
            </span>
            <span
              className={`truncate text-[12px] ${
                ehFalha(a.estado) ? "text-[var(--status-red)]" : "text-foreground/65"
              }`}
            >
              {ehFalha(a.estado)
                ? `${rotuloEtapa(a.erro_etapa)}${a.erro_msg ? ` — ${a.erro_msg}` : ""}`
                : [a.pessoa_nome, a.contrato].filter(Boolean).join(" · ") || "—"}
            </span>
          </button>
        ))}
      </div>

      <button type="button" onClick={() => irParaHistorico()} className="glass-cta glass-cta--mini w-full">
        Abrir histórico completo ↗
      </button>
    </div>
  )
}
