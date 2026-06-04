import type { DescontoDados } from "./types"
import { formatarPeriodoCurto } from "./shared"

type Props = {
  dados: DescontoDados
}

/** Header read-only com info do empregado + período + contrato.
 *  Usado nas etapas VR/VT/Confirmar. Identidade sky (financeiro). */
export function HeaderEmpregado({ dados }: Props) {
  return (
    <div className="mb-6 rounded-2xl border border-sky-300/25 bg-sky-300/[0.04] px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-sky-700 dark:text-sky-100">
          Intermitente · Base Desconto
        </span>
        <span className="truncate text-sm font-medium text-foreground/95">
          {dados.empregadoNome}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/60">
        <span>
          Chapa <strong className="text-foreground/85">{dados.chapa || "—"}</strong>
        </span>
        {dados.contrato && <span className="text-foreground/45">·</span>}
        {dados.contrato && <span>{dados.contrato}</span>}
        <span className="text-foreground/45">·</span>
        <span className="font-mono text-foreground/75">
          {formatarPeriodoCurto(dados.periodoInicio, dados.periodoFim)}
        </span>
      </div>
    </div>
  )
}
