import { ArrowLeft, Loader2, Send } from "lucide-react"

import { ChoiceButton } from "@/features/atestados/ChoiceButton"

import { HeaderEmpregado } from "./HeaderEmpregado"
import { digitosParaReal, formatarReal } from "./shared"
import type { DescontoDados } from "./types"

type Props = {
  dados: DescontoDados
  /** String de dígitos puros. */
  vrDigitos: string
  vtDigitos: string
  carregando: boolean
  erro: string | null
  onVoltar: () => void
  onConfirmar: () => void
}

/** Etapa final do wizard — resumo VR+VT, botão confirmar dispara
 *  POST `/descontos-registrar-manual`. */
export function EtapaConfirmar({
  dados,
  vrDigitos,
  vtDigitos,
  carregando,
  erro,
  onVoltar,
  onConfirmar,
}: Props) {
  const vr = digitosParaReal(vrDigitos)
  const vt = digitosParaReal(vtDigitos)
  const vrRestante = Math.max(0, dados.vrDevido - vr)
  const vtRestante = Math.max(0, dados.vtDevido - vt)

  return (
    <div>
      <HeaderEmpregado dados={dados} />

      <p className="text-[11px] uppercase tracking-[0.32em] text-sky-200/75">
        Resumo
      </p>
      <h1 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Confirmar <em className="italic text-sky-200">retirada</em>
      </h1>
      <p className="mt-3 text-sm text-white/65">
        Ao confirmar, o item no board Desconto é atualizado com os valores
        retirados manualmente da conta Caju.
      </p>

      <div className="mt-6 space-y-3">
        <LinhaResumo
          rotulo="Vale Refeição"
          valor={vr}
          restante={vrRestante}
        />
        <LinhaResumo
          rotulo="Vale Transporte"
          valor={vt}
          restante={vtRestante}
        />
      </div>

      {erro && (
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-center text-sm text-rose-100">
          {erro}
        </p>
      )}

      <div className="mt-8 grid grid-cols-2 gap-3">
        <ChoiceButton
          variant="ghost"
          type="button"
          onClick={onVoltar}
          disabled={carregando}
          className="inline-flex items-center justify-center gap-2"
        >
          <ArrowLeft className="size-4" />
          Voltar
        </ChoiceButton>
        <ChoiceButton
          variant="primary"
          type="button"
          onClick={onConfirmar}
          disabled={carregando}
          className="inline-flex items-center justify-center gap-2"
        >
          {carregando ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Registrando…
            </>
          ) : (
            <>
              <Send className="size-4" />
              Confirmar retirada
            </>
          )}
        </ChoiceButton>
      </div>
    </div>
  )
}

function LinhaResumo({
  rotulo,
  valor,
  restante,
}: {
  rotulo: string
  valor: number
  restante: number
}) {
  return (
    <div className="rounded-2xl border border-sky-300/20 bg-sky-300/[0.04] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.28em] text-sky-200/75">
        {rotulo}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-display text-2xl text-white">
          {formatarReal(valor)}
        </span>
        <span className="text-xs text-white/55">
          Resta{" "}
          <span
            className={`font-mono ${
              restante === 0 ? "text-emerald-200/85" : "text-white/85"
            }`}
          >
            {formatarReal(restante)}
          </span>
        </span>
      </div>
    </div>
  )
}
