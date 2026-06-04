import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import { CheckCircle2 } from "lucide-react"

import { HeaderEmpregado } from "./HeaderEmpregado"
import { formatarReal } from "./shared"
import type { DescontoDados } from "./types"

type Props = {
  dados: DescontoDados
}

/** Read-only — abre quando link já foi usado (status === "registrado"). */
export function TelaRegistrado({ dados }: Props) {
  const r = dados.retiradaAnterior
  if (!r) return null

  let dataFormatada = "—"
  try {
    dataFormatada = format(parseISO(r.registradoEm), "dd/MM/yyyy 'às' HH:mm", {
      locale: ptBR,
    })
  } catch {
    dataFormatada = r.registradoEm
  }

  return (
    <div>
      <HeaderEmpregado dados={dados} />

      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/[0.08] px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-100">
        <CheckCircle2 className="size-4" />
        Retirada já registrada
      </div>

      <p className="text-[11px] uppercase tracking-[0.32em] text-sky-700/75 dark:text-sky-200/75">
        Histórico
      </p>
      <h1 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Já foi <em className="italic text-sky-700 dark:text-sky-200">registrado</em>
      </h1>
      <p className="mt-3 text-sm text-foreground/65">
        Este link já foi usado em{" "}
        <span className="text-foreground/85">{dataFormatada}</span>. Os valores
        abaixo refletem o que foi retirado manualmente da conta Caju.
      </p>

      <div className="mt-6 space-y-3">
        <LinhaHistorico
          rotulo="Vale Refeição"
          retirado={r.vrRetirado}
          devido={dados.vrDevido}
        />
        <LinhaHistorico
          rotulo="Vale Transporte"
          retirado={r.vtRetirado}
          devido={dados.vtDevido}
        />
      </div>

      <p className="mt-6 text-xs text-foreground/45">
        Pra abrir um novo registro, gere outro link no item do board Desconto.
      </p>
    </div>
  )
}

function LinhaHistorico({
  rotulo,
  retirado,
  devido,
}: {
  rotulo: string
  retirado: number
  devido: number
}) {
  const restante = Math.max(0, devido - retirado)
  return (
    <div className="rounded-2xl border border-sky-300/20 bg-sky-300/[0.04] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.28em] text-sky-700/75 dark:text-sky-200/75">
        {rotulo}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-display text-2xl text-foreground">
          {formatarReal(retirado)}
        </span>
        <span className="text-xs text-foreground/55">
          De{" "}
          <span className="font-mono text-foreground/75">
            {formatarReal(devido)}
          </span>
          {" · Resta "}
          <span
            className={`font-mono ${
              restante === 0 ? "text-emerald-700/85 dark:text-emerald-200/85" : "text-foreground/85"
            }`}
          >
            {formatarReal(restante)}
          </span>
        </span>
      </div>
    </div>
  )
}
