import { useMemo, useState } from "react"
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isFeriado, nomeFeriado, useFeriados } from "@/lib/feriadosBoard"

type Props = {
  label: string
  value: string // YYYY-MM-DD ou ""
  onChange: (v: string) => void
  min?: string
  max?: string
  /** Contrato p/ feriado por board (estadual/municipal). null = só NACIONAL. */
  contrato?: string | null
  /** Quando retorna true, dia fica disabled. Default: feriado efetivo do board. */
  isDateDisabled?: (iso: string) => boolean
  /** Texto pra tooltip nativo. Default: nome do feriado. */
  getDateLabel?: (iso: string) => string | null
}

export function GlassDatePicker({
  label,
  value,
  onChange,
  min,
  max,
  contrato = null,
  isDateDisabled = (iso) => isFeriado(iso, contrato),
  getDateLabel = (iso) => {
    const nome = nomeFeriado(iso, contrato)
    return nome ? `Feriado: ${nome}` : null
  },
}: Props) {
  useFeriados()
  const [aberto, setAberto] = useState(false)
  const [mesVisivel, setMesVisivel] = useState<Date>(() =>
    value ? parseISO(value) : min ? parseISO(min) : new Date(),
  )

  function abrir() {
    if (value) setMesVisivel(parseISO(value))
    else if (min) setMesVisivel(parseISO(min))
    else setMesVisivel(new Date())
    setAberto(true)
  }

  const selecionado = value ? parseISO(value) : null
  const minDate = min ? parseISO(min) : null
  const maxDate = max ? parseISO(max) : null

  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesVisivel), { weekStartsOn: 0 })
    const fim = endOfWeek(endOfMonth(mesVisivel), { weekStartsOn: 0 })
    const out: Date[] = []
    const d = new Date(inicio)
    while (d <= fim) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [mesVisivel])

  const labelMesAno = format(mesVisivel, "MMMM 'de' yyyy", { locale: ptBR })
  const exibido = selecionado
    ? format(selecionado, "dd/MM/yyyy", { locale: ptBR })
    : ""

  function selecionar(d: Date) {
    if (minDate && d < minDate) return
    if (maxDate && d > maxDate) return
    const iso = format(d, "yyyy-MM-dd")
    if (isDateDisabled(iso)) return
    onChange(iso)
    setAberto(false)
  }

  function hoje() {
    selecionar(new Date())
  }

  function limpar() {
    onChange("")
    setAberto(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className={`flex w-full items-center gap-2 rounded-xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-left text-sm backdrop-blur transition hover:border-[rgb(var(--ink)/0.2)] hover:bg-[rgb(var(--ink)/0.06)] ${
          aberto ? "border-[rgb(var(--accent-rgb)/0.55)] bg-[rgb(var(--ink)/0.08)]" : ""
        }`}
      >
        <CalendarDays className="size-4 shrink-0 text-foreground/50" />
        <span className={exibido ? "text-foreground" : "text-foreground/40"}>
          {exibido || "dd/mm/aaaa"}
        </span>
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          className="glass-modal border-0 bg-transparent p-8 text-foreground sm:max-w-md"
          style={{
            backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
          }}
        >
          <DialogHeader>
            <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
              Escolher data
            </p>
            <DialogTitle className="text-display text-3xl text-foreground">
              {label}
            </DialogTitle>
            <DialogDescription className="text-foreground/60">
              Selecione o dia desejado no calendário.
            </DialogDescription>
          </DialogHeader>

          <div className="my-2 h-px bg-[rgb(var(--ink)/0.12)]" />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMesVisivel((m) => subMonths(m, 1))}
              className="inline-flex size-9 items-center justify-center rounded-xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/75 transition hover:border-[rgb(var(--ink)/0.25)] hover:bg-[rgb(var(--ink)/0.08)] hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <p className="text-display text-lg capitalize text-foreground/95">
              {labelMesAno}
            </p>
            <button
              type="button"
              onClick={() => setMesVisivel((m) => addMonths(m, 1))}
              className="inline-flex size-9 items-center justify-center rounded-xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/75 transition hover:border-[rgb(var(--ink)/0.25)] hover:bg-[rgb(var(--ink)/0.08)] hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
              <div
                key={i}
                className="py-1 text-center text-[10px] uppercase tracking-wider text-foreground/40"
              >
                {d}
              </div>
            ))}
            {dias.map((d) => {
              const iso = format(d, "yyyy-MM-dd")
              const noMes = isSameMonth(d, mesVisivel)
              const sel = selecionado && isSameDay(d, selecionado)
              const ehHoje = isSameDay(d, new Date())
              const desabilitado =
                (minDate && d < minDate) || (maxDate && d > maxDate)
              const feriadoLabel = getDateLabel(iso)
              const eFeriado = isDateDisabled(iso)
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={!!desabilitado || eFeriado}
                  onClick={() => selecionar(d)}
                  title={feriadoLabel ?? undefined}
                  className={`flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition ${
                    sel
                      ? "bg-[rgb(var(--accent-rgb))] text-[#0a1224] shadow-[0_0_18px_rgb(var(--accent-rgb)/0.5)]"
                      : eFeriado && noMes
                        ? "calendario-dia-feriado"
                        : noMes
                          ? "text-foreground/90 hover:bg-[rgb(var(--ink)/0.1)]"
                          : "text-foreground/30 hover:bg-[rgb(var(--ink)/0.05)]"
                  } ${ehHoje && !sel ? "ring-1 ring-[rgb(var(--accent-rgb)/0.45)]" : ""} ${
                    desabilitado ? "cursor-not-allowed opacity-40" : ""
                  }`}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="my-2 h-px bg-[rgb(var(--ink)/0.12)]" />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={limpar}
              className="text-sm text-foreground/55 transition hover:text-foreground/85"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={hoje}
              className="text-sm font-medium text-[rgb(var(--accent-rgb))] transition hover:text-[rgb(var(--accent-rgb))]"
            >
              Hoje
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
