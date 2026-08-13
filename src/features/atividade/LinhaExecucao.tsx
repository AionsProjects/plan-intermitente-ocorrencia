import { useEffect, useRef } from "react"
import { ChevronDown, Circle } from "lucide-react"

import { HighlightedText } from "@/components/HighlightedText"
import { reduzirMotion } from "@/lib/motion"
import { nomeLimpo } from "@/lib/texto"
import { DetalheExecucao } from "./DetalheExecucao"
import { horaManaus, rotuloEtapa } from "./etapas"
import { resumoLinha } from "./resumoHumano"
import { COR_ACAO, ehFalha, ICONE_ACAO, lampDoEstado, type Execucao } from "./types"

/**
 * Uma execução na lista.
 *
 * FECHADA são duas linhas. A 1ª lidera com QUEM e QUANTO, porque a pergunta que se chega
 * fazendo é "saiu o pagamento da Márcia?" — o nome é a chave da busca, não o tipo da ação.
 * (Antes a 1ª linha era o tipo e a pessoa vinha na 2ª, onde desaparecia sempre que havia
 * erro ou execução em andamento: justo quando mais importa saber de quem é.)
 *
 * A 2ª linha segue esta prioridade: erro > em andamento > o que aconteceu. Erro ganha de
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

  const resumo = resumoLinha(exec)
  const Icone = ICONE_ACAO[exec.acao] ?? Circle
  // Erro já tratado perde o vermelho: continua na lista (história), mas para de chamar
  // atenção — é o que separa "quebrou agora" de "quebrou e já resolvi".
  const tratado = falhou && !!exec.erro_reconhecido_em
  // Segunda linha: uma só, nesta ordem de prioridade.
  const subtitulo = falhou
    ? `${tratado ? "tratado · " : ""}${rotuloEtapa(exec.erro_etapa)}${exec.erro_msg ? ` — ${exec.erro_msg}` : ""}`
    : rodando
      ? exec.etapa_atual
        ? rotuloEtapa(exec.etapa_atual)
        : "em andamento"
      : resumo.detalhe

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
          falhou && !tratado ? "shadow-[inset_0_0_0_1px_rgb(239_102_102/0.35)]" : ""
        }`}
      >
        <span className="flex items-baseline gap-2">
          {/* Cor nunca sozinha: a lâmpada sempre vem com texto ao lado. */}
          <span className={`lamp ${tratado ? "lamp--off" : lampDoEstado(exec.estado)} shrink-0 translate-y-[-1px]`} aria-hidden />
          {/* TIPO, como glifo. A cor de categoria vive AQUI — em 14px ela identifica sem
              disputar com o nome; aplicada ao texto, pintava a linha toda de verde-limão e
              a informação secundária gritava mais que a pessoa. */}
          <Icone
            aria-hidden
            className={`size-3.5 shrink-0 translate-y-[1px] ${falhou && !tratado ? "text-[var(--status-red)]" : COR_ACAO[exec.acao] ?? "text-foreground/45"}`}
          />
          {/* QUEM — o alvo do olho e da busca. */}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            <HighlightedText text={nomeLimpo(resumo.titulo) ?? resumo.titulo} query={busca} />
          </span>
          {/* QUANTO. Tabular pra alinhar entre linhas: dá pra somar com o olho na vertical. */}
          {resumo.destaque && (
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
              {resumo.destaque}
            </span>
          )}
          <span
            className="shrink-0 text-[11px] tabular-nums text-foreground/40"
            title={new Date(exec.criado_em).toLocaleString("pt-BR", { timeZone: "America/Manaus" })}
          >
            {horaManaus(exec.criado_em)}
          </span>
          <ChevronDown
            aria-hidden
            className={`size-3.5 shrink-0 text-foreground/30 transition-transform duration-300 ${aberta ? "rotate-180" : ""}`}
          />
        </span>

        {/* Segunda linha: só quando há algo a dizer. Antes trazia sempre o tipo da ação (já
            no ícone) e um "—" no lugar do operador ausente — duas linhas de nada. */}
        {(subtitulo || (mostrarOperador && (exec.operador_nome || exec.operador_email))) && (
          <span className="flex items-baseline gap-2 pl-[34px]">
            <span
              className={`min-w-0 flex-1 truncate text-[12px] ${
                falhou && !tratado ? "text-[var(--status-red)]"
                : rodando ? "text-[var(--status-yellow)]"
                : "text-foreground/55"
              }`}
            >
              {busca && !falhou && !rodando
                ? <HighlightedText text={subtitulo} query={busca} />
                : subtitulo}
            </span>
            {mostrarOperador && (exec.operador_nome || exec.operador_email) && (
              <span className="shrink-0 text-[11px] text-foreground/40">
                <HighlightedText
                  text={nomeLimpo(exec.operador_nome) ?? exec.operador_email ?? ""}
                  query={busca}
                />
              </span>
            )}
          </span>
        )}
      </button>

      {/* Montado só quando aberta — ver nota no DetalheExecucao. */}
      {aberta && <DetalheExecucao exec={exec} aoVivo={rodando} />}
    </li>
  )
}
