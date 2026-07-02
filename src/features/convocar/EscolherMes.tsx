import { useState } from "react"
import { ArrowLeft, CalendarCheck, CalendarPlus, History, Loader2 } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useMesesConvocacao } from "./useConvocacao"
import type { EmpregadoRM } from "./types"

type Props = {
  empregado: EmpregadoRM
  onTrocarEmpregado: () => void
  onEscolher: (papel: "passado" | "atual" | "proximo", competencia: string) => void
}

function rotuloMes(competencia: string | null): string {
  if (!competencia) return "—"
  try {
    return format(parseISO(`${competencia}-01`), "MMMM 'de' yyyy", { locale: ptBR })
  } catch {
    return competencia
  }
}

type Opcao = { papel: "passado" | "atual" | "proximo"; competencia: string | null; titulo: string }

// Tilt 3D (mesmo padrão dos cards do hub/mensal): posição do mouse vira --mx/--my.
function tilt(e: React.MouseEvent<HTMLButtonElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", String(((e.clientX - r.left) / r.width) * 100))
  e.currentTarget.style.setProperty("--my", String(((e.clientY - r.top) / r.height) * 100))
}
function untilt(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.setProperty("--mx", "50")
  e.currentTarget.style.setProperty("--my", "50")
}

// Etapa ENTRE buscar empregado e formulário: escolhe o mês (board) da convocação.
// Mostra os meses VÁLIDOS vindos do registry — passado (retroativo) + atual +
// próximo (se o board existe). Na virada, o registry promove os papéis e isto
// reflete automático. Mês passado abre um modal de confirmação (liquid glass).
export function EscolherMes({ empregado, onTrocarEmpregado, onEscolher }: Props) {
  const { data: meses, isLoading } = useMesesConvocacao()
  const [confirmandoPassado, setConfirmandoPassado] = useState<Opcao | null>(null)

  const opcoes = [
    meses?.passado.existe
      ? { papel: "passado" as const, competencia: meses.passado.competencia, titulo: "Mês passado" }
      : null,
    meses?.atual.existe
      ? { papel: "atual" as const, competencia: meses.atual.competencia, titulo: "Mês atual" }
      : null,
    meses?.proximo.existe
      ? { papel: "proximo" as const, competencia: meses.proximo.competencia, titulo: "Próximo mês" }
      : null,
  ].filter((x): x is Opcao => !!x)

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
        <div className="grid gap-3 sm:grid-cols-2">
          {opcoes.map((o, i) => (
            <button
              key={o.papel}
              type="button"
              onMouseMove={tilt}
              onMouseLeave={untilt}
              onClick={() =>
                o.papel === "passado"
                  ? setConfirmandoPassado(o)
                  : onEscolher(o.papel, o.competencia ?? "")
              }
              style={{ animationDelay: `${i * 90}ms` }}
              className="fade-up glass-tile glass-tile-3d group relative flex items-center gap-4 overflow-hidden rounded-2xl px-5 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
            >
              <div
                className={`icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full ring-1 transition-transform duration-300 group-hover:scale-110 ${
                  o.papel === "passado"
                    ? "bg-amber-400/12 ring-amber-400/40"
                    : "bg-[rgb(var(--accent-rgb)/0.12)] ring-[rgb(var(--accent-rgb)/0.38)]"
                }`}
              >
                {o.papel === "passado" ? (
                  <History className="icon-3d-only size-5 text-amber-500 dark:text-amber-300 transition-transform duration-500 group-hover:-rotate-[25deg]" />
                ) : o.papel === "atual" ? (
                  <CalendarCheck className="icon-3d-only size-5 text-[rgb(var(--accent-rgb))]" />
                ) : (
                  <CalendarPlus className="icon-3d-only size-5 text-[rgb(var(--accent-rgb))]" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">
                  {o.titulo}
                </p>
                <p className="text-display mt-0.5 truncate text-xl capitalize text-foreground">
                  {rotuloMes(o.competencia)}
                </p>
                <p className="text-xs text-foreground/45">competência {o.competencia ?? "—"}</p>
              </div>
              {o.papel === "passado" && (
                <span className="absolute right-3 top-3 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-200">
                  Retroativo
                </span>
              )}
            </button>
          ))}
          {opcoes.length === 0 && (
            <p className="text-sm text-foreground/55">
              Nenhum mês disponível para convocação. Verifique o registro dos boards.
            </p>
          )}
        </div>
      )}

      {/* Modal de confirmação do retroativo — padrão glass-modal do registrar */}
      <Dialog open={!!confirmandoPassado} onOpenChange={(o) => !o && setConfirmandoPassado(null)}>
        <DialogContent
          className="glass-modal border-0 bg-transparent p-8 text-foreground sm:max-w-md"
          overlayClassName="bg-[rgb(var(--shadow)/0.55)] backdrop-blur-[3px]"
          style={{ backdropFilter: "blur(10px) saturate(130%)" }}
        >
          <DialogHeader>
            <p className="text-[10px] uppercase tracking-[0.3em] text-amber-700/80 dark:text-amber-200/80">
              Lançamento retroativo
            </p>
            <DialogTitle className="text-display text-2xl text-foreground">
              <span className="capitalize">{rotuloMes(confirmandoPassado?.competencia ?? null)}</span>{" "}
              já foi encerrado
            </DialogTitle>
            <DialogDescription className="text-foreground/65">
              Este mês só continua aberto para regularizar pendências que deveriam ter sido
              lançadas dentro do próprio mês. O ideal é que as convocações sejam feitas na
              competência certa — use esta opção apenas para corrigir o que ficou para trás.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmandoPassado(null)}
              className="text-foreground/85 hover:bg-[rgb(var(--ink)/0.1)] hover:text-foreground"
            >
              Voltar
            </Button>
            <Button
              onClick={() =>
                confirmandoPassado &&
                onEscolher(confirmandoPassado.papel, confirmandoPassado.competencia ?? "")
              }
              className="bg-amber-300 text-[#241a0a] hover:bg-amber-200"
            >
              Entendi, continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
