import { useState } from "react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface DialogFinsDeSemanaFolhaProps {
  open: boolean
  /** Sábado/domingo logo depois do fim da convocação (vazio = nada a oferecer). */
  disponiveis: string[]
  /** O que já está marcado nesta edição. */
  marcados: string[]
  /** Já gravado em envio anterior: a convocação no RM foi estendida, não sai pela tela. */
  fixos: string[]
  onClose: () => void
  onConfirmar: (dias: string[]) => void
}

/**
 * Fim de semana só pra folha: o operacional marca o sábado/domingo trabalhado logo depois do fim
 * da convocação. Não gera VR/VT — no envio, a convocação no RM é estendida até o último dia.
 */
export function DialogFinsDeSemanaFolha({
  open,
  disponiveis,
  marcados,
  fixos,
  onClose,
  onConfirmar,
}: DialogFinsDeSemanaFolhaProps) {
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set(marcados))
  const [prevOpen, setPrevOpen] = useState(open)

  // Reabrir parte do que está marcado agora — padrão setState-during-render (sem useEffect).
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setSelecionados(new Set(marcados))
  }

  const fixosSet = new Set(fixos)

  function toggle(iso: string) {
    if (fixosSet.has(iso)) return
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(iso)) next.delete(iso)
      else next.add(iso)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-8 text-foreground sm:max-w-md"
        style={{ backdropFilter: "blur(10px) saturate(140%) brightness(1.05)" }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/60">Só para a folha</p>
          <DialogTitle className="text-display text-3xl text-foreground">Fim de semana</DialogTitle>
          <DialogDescription className="text-foreground/65">
            Sábado e domingo logo depois do fim da convocação. Não geram VR nem VT: no envio, a
            convocação no RM é estendida até o último dia marcado.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-[rgb(var(--ink)/0.12)]" />

        {disponiveis.length === 0 ? (
          <p className="rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.05)] px-4 py-6 text-center text-sm text-foreground/70">
            Nenhum fim de semana disponível: a convocação termina no fim do mês ou foi cancelada.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="Dias do fim de semana">
            {disponiveis.map((iso) => {
              const fixo = fixosSet.has(iso)
              const marcado = fixo || selecionados.has(iso)
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={marcado}
                  disabled={fixo}
                  onClick={() => toggle(iso)}
                  className={`flex flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition ${
                    marcado
                      ? "border-[rgb(var(--ink)/0.45)] bg-[rgb(var(--ink)/0.1)]"
                      : "border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.03)] hover:border-[rgb(var(--ink)/0.3)]"
                  } ${fixo ? "cursor-not-allowed opacity-80" : ""}`}
                >
                  <span className="flex w-full items-center justify-between text-xs uppercase tracking-wider text-foreground/60">
                    {format(parseISO(iso), "EEEE", { locale: ptBR })}
                    {marcado && <Check className="size-4 text-foreground" aria-hidden />}
                  </span>
                  <span className="text-display text-2xl text-foreground">
                    {format(parseISO(iso), "dd/MM", { locale: ptBR })}
                  </span>
                  {fixo && <span className="text-[11px] text-foreground/55">Já enviado — estendido no RM</span>}
                </button>
              )
            })}
          </div>
        )}

        <DialogFooter className="mt-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-foreground/65 hover:bg-[rgb(var(--ink)/0.1)] hover:text-foreground"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => onConfirmar([...new Set([...fixos, ...selecionados])].sort())}
            disabled={disponiveis.length === 0}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
