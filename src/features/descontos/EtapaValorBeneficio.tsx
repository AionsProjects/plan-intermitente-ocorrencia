import { useEffect, useRef } from "react"
import { ArrowRight, ArrowLeft } from "lucide-react"

import { ChoiceButton } from "@/features/atestados/ChoiceButton"

import { HeaderEmpregado } from "./HeaderEmpregado"
import {
  digitosParaDisplay,
  digitosParaReal,
  formatarReal,
} from "./shared"
import type { DescontoDados } from "./types"

type Props = {
  dados: DescontoDados
  tipo: "VR" | "VT"
  /** Valor já registrado da etapa anterior — mostrado em chip no topo
   *  quando essa etapa for a 2ª (VT). */
  registradoAnterior?: { tipo: "VR"; valor: number } | null
  /** String de dígitos puros (sem formatação). State controlado pelo pai. */
  valor: string
  onChange: (digitos: string) => void
  onAvancar: () => void
  onVoltar: () => void
  podeVoltar: boolean
}

/** Etapa do wizard de retirada manual — input grande pra VR ou VT.
 *  Auto-focus no input. Validação: valor <= devido. */
export function EtapaValorBeneficio({
  dados,
  tipo,
  registradoAnterior,
  valor,
  onChange,
  onAvancar,
  onVoltar,
  podeVoltar,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const devido = tipo === "VR" ? dados.vrDevido : dados.vtDevido
  const beneficioNome =
    tipo === "VR" ? "Vale Refeição" : "Vale Transporte"
  const beneficioCurto = tipo === "VR" ? "VR" : "VT"

  const valorNum = digitosParaReal(valor)
  const restante = Math.max(0, devido - valorNum)
  const acimaDoDevido = valorNum > devido + 0.001

  useEffect(() => {
    inputRef.current?.focus()
  }, [tipo])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (valor === "" || acimaDoDevido) return
    onAvancar()
  }

  return (
    <form onSubmit={handleSubmit}>
      <HeaderEmpregado dados={dados} />

      {registradoAnterior && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/[0.06] px-3 py-1 text-[11px] text-emerald-700/85 dark:text-emerald-200/85">
          <span className="font-medium">
            {registradoAnterior.tipo} registrado:
          </span>
          <span className="font-mono">
            {formatarReal(registradoAnterior.valor)}
          </span>
        </div>
      )}

      <p className="text-[11px] uppercase tracking-[0.32em] text-sky-700/75 dark:text-sky-200/75">
        {beneficioNome}
      </p>
      <h1 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Quanto foi retirado de{" "}
        <em className="italic text-sky-700 dark:text-sky-200">{beneficioCurto}</em>?
      </h1>

      <div className="mt-6 flex items-baseline gap-2 text-sm text-foreground/55">
        <span>Devido:</span>
        <span className="font-mono text-foreground/85">{formatarReal(devido)}</span>
      </div>

      <label className="mt-5 block">
        <span className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
          Valor retirado
        </span>
        <div
          className={`mt-2 flex items-center gap-3 rounded-2xl border bg-[rgb(var(--ink)/0.04)] px-5 py-4 backdrop-blur transition ${
            acimaDoDevido
              ? "border-rose-300/50"
              : "border-[rgb(var(--ink)/0.15)] focus-within:border-sky-300/50"
          }`}
        >
          <span className="text-display text-3xl text-foreground/55">R$</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={digitosParaDisplay(valor)}
            placeholder="0,00"
            onChange={(e) => {
              // Aceita só dígitos. Vírgula/ponto são strip — máscara
              // calcula posição decimal automaticamente (últimos 2 são centavos).
              const digitos = e.target.value.replace(/\D/g, "")
              onChange(digitos)
            }}
            className="text-display flex-1 bg-transparent text-3xl font-medium tracking-wider text-foreground placeholder:text-foreground/25 focus:outline-none"
          />
        </div>
      </label>

      <div className="mt-3 flex items-baseline gap-2 text-sm">
        {acimaDoDevido ? (
          <span className="text-rose-700/85 dark:text-rose-200/85">
            Valor acima do devido ({formatarReal(devido)}).
          </span>
        ) : (
          <>
            <span className="text-foreground/55">Restante:</span>
            <span
              className={`font-mono ${
                restante === 0 ? "text-emerald-700/85 dark:text-emerald-200/85" : "text-foreground/85"
              }`}
            >
              {formatarReal(restante)}
            </span>
          </>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3">
        <ChoiceButton
          variant="ghost"
          type="button"
          onClick={onVoltar}
          disabled={!podeVoltar}
          className="inline-flex items-center justify-center gap-2"
        >
          <ArrowLeft className="size-4" />
          Voltar
        </ChoiceButton>
        <ChoiceButton
          variant="primary"
          type="submit"
          disabled={valor === "" || acimaDoDevido}
          className="inline-flex items-center justify-center gap-2"
        >
          Avançar
          <ArrowRight className="size-4" />
        </ChoiceButton>
      </div>
    </form>
  )
}
