import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import { useMesesConvocacao } from "./useConvocacao"
import type { EmpregadoRM } from "./types"

type Props = {
  empregado: EmpregadoRM
  onTrocarEmpregado: () => void
  onEscolher: (papel: "atual" | "proximo", competencia: string) => void
}

function rotuloMes(competencia: string | null): string {
  if (!competencia) return "—"
  try {
    return format(parseISO(`${competencia}-01`), "MMMM 'de' yyyy", { locale: ptBR })
  } catch {
    return competencia
  }
}

// Etapa ENTRE buscar empregado e formulário: escolhe o mês (board) da convocação.
// Mostra os meses VÁLIDOS vindos do registry — mês atual + próximo (se o board já
// existe). Na virada, o registry promove os papéis e isto reflete automático.
export function EscolherMes({ empregado, onTrocarEmpregado, onEscolher }: Props) {
  const { data: meses, isLoading } = useMesesConvocacao()

  const opcoes = [
    meses?.atual.existe
      ? { papel: "atual" as const, competencia: meses.atual.competencia, titulo: "Mês atual" }
      : null,
    meses?.proximo.existe
      ? { papel: "proximo" as const, competencia: meses.proximo.competencia, titulo: "Próximo mês" }
      : null,
  ].filter((x): x is { papel: "atual" | "proximo"; competencia: string | null; titulo: string } => !!x)

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onTrocarEmpregado}
        className="inline-flex items-center gap-1.5 text-xs text-foreground/55 transition hover:text-foreground/85"
      >
        <ArrowLeft className="size-3.5" />
        Trocar empregado
      </button>

      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">Convocar</p>
        <h2 className="text-display mt-1 text-2xl text-foreground">
          {empregado.nome}
        </h2>
        <p className="mt-1 text-sm text-foreground/55">
          Escolha o mês da convocação.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground/55">
          <Loader2 className="size-4 animate-spin" /> Carregando meses…
        </div>
      ) : (
        <div className="grid gap-3">
          {opcoes.map((o) => (
            <button
              key={o.papel}
              type="button"
              onClick={() => onEscolher(o.papel, o.competencia ?? "")}
              className="glass-tile glass-tile-3d group flex items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.38)]">
                  <CalendarDays className="size-5 text-[rgb(var(--accent-rgb))]" />
                </div>
                <div>
                  <p className="text-base font-medium text-foreground/95">{o.titulo}</p>
                  <p className="mt-0.5 text-sm capitalize text-foreground/55">
                    {rotuloMes(o.competencia)}
                  </p>
                </div>
              </div>
            </button>
          ))}
          {opcoes.length === 0 && (
            <p className="text-sm text-foreground/55">
              Nenhum mês disponível para convocação. Verifique o registro dos boards.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
