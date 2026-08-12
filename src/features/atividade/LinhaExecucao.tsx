import { useEffect, useRef } from "react"
import { ChevronDown } from "lucide-react"

import { HighlightedText } from "@/components/HighlightedText"
import { reduzirMotion } from "@/lib/motion"
import { nomeLimpo } from "@/lib/texto"
import { DetalheExecucao } from "./DetalheExecucao"
import { horaManaus, rotuloEtapa } from "./etapas"
import { COR_ACAO, ehFalha, lampDoEstado, rotuloAcao, type Execucao } from "./types"

/**
 * Uma execução na lista.
 *
 * FECHADA são duas linhas e o status se lê de relance. A 2ª linha segue esta
 * prioridade: erro > em andamento > pessoa/contrato > nada. Erro tem que ganhar de
 * tudo — é o motivo de a página existir.
 *
 * O header é `<button>`, nunca `div` com onClick: Enter/Espaço, foco e ordem de tab
 * vêm de graça, e o alvo de toque de ~46px importa porque o link do alerta é aberto
 * no celular.
 */
export function LinhaExecucao({
  exec,
  aberta,
  destacar,
  busca,
  mostrarOperador,
  onAlternar,
}: {
  exec: Execucao
  aberta: boolean
  /** Veio pelo link do alerta: rola até aqui, foca e pulsa. */
  destacar: boolean
  busca: string
  mostrarOperador: boolean
  onAlternar: () => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const falhou = ehFalha(exec.estado)
  const rodando = exec.estado === "aberta"

  useEffect(() => {
    if (!destacar || !ref.current) return
    ref.current.scrollIntoView({ block: "center", behavior: reduzirMotion() ? "auto" : "smooth" })
    // preventScroll: o scrollIntoView acima já posicionou; focar de novo brigaria com ele.
    ref.current.focus({ preventScroll: true })
  }, [destacar])

  // Segunda linha: uma só, nesta ordem de prioridade.
  const subtitulo = falhou
    ? `${rotuloEtapa(exec.erro_etapa)}${exec.erro_msg ? ` — ${exec.erro_msg}` : ""}`
    : rodando
      ? exec.etapa_atual
        ? rotuloEtapa(exec.etapa_atual)
        : "em andamento"
      : [exec.pessoa_nome, exec.contrato].filter(Boolean).join(" · ")

  return (
    <li className={destacar ? "log-flash rounded-[16px]" : undefined}>
      <button
        type="button"
        ref={ref}
        id={`lin-${exec.id}`}
        onClick={onAlternar}
        aria-expanded={aberta}
        aria-controls={`det-${exec.id}`}
        // data-tone="accent" só quando deu certo: o hover âmbar do tile
        // contradiria o vermelho de uma linha com erro.
        data-tone={falhou ? undefined : "accent"}
        className={`glass-tile-v2 flex w-full flex-col gap-1 rounded-[16px] px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-rgb)/0.6)] ${
          falhou ? "shadow-[inset_0_0_0_1px_rgb(239_102_102/0.35)]" : ""
        }`}
      >
        <span className="flex items-baseline gap-2">
          {/* Cor nunca sozinha: a lâmpada sempre vem com o texto do estado ao lado. */}
          <span className={`lamp ${lampDoEstado(exec.estado)} shrink-0 translate-y-[-1px]`} aria-hidden />
          <span className={`min-w-0 flex-1 truncate text-sm font-medium ${COR_ACAO[exec.acao] ?? "text-foreground"}`}>
            <HighlightedText text={rotuloAcao(exec.acao)} query={busca} />
          </span>
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/55"
            title={new Date(exec.criado_em).toLocaleString("pt-BR", { timeZone: "America/Manaus" })}
          >
            {horaManaus(exec.criado_em)}
          </span>
          <ChevronDown
            aria-hidden
            className={`size-3.5 shrink-0 text-foreground/35 transition-transform duration-300 ${aberta ? "rotate-180" : ""}`}
          />
        </span>

        <span className="flex items-baseline gap-2 pl-[18px]">
          <span
            className={`min-w-0 flex-1 truncate text-[12px] ${
              falhou ? "text-[var(--status-red)]" : rodando ? "text-[var(--status-yellow)]" : "text-foreground/70"
            }`}
          >
            {busca && !falhou && !rodando
              ? <HighlightedText text={subtitulo || "—"} query={busca} />
              : subtitulo || "—"}
          </span>
          {mostrarOperador && (
            <span className="shrink-0 text-[11px] text-foreground/55">
              <HighlightedText
                text={nomeLimpo(exec.operador_nome) ?? exec.operador_email ?? "—"}
                query={busca}
              />
            </span>
          )}
        </span>
      </button>

      {/* Montado só quando aberta — ver nota no DetalheExecucao. */}
      {aberta && <DetalheExecucao exec={exec} aoVivo={rodando} />}
    </li>
  )
}
