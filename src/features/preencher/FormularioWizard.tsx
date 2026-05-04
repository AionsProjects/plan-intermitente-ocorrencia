import { useCallback, useEffect, useMemo, useState } from "react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  CalendarDays,
  ChevronRight,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { useFinalizarProcessamento } from "./useProcessamento"
import type { DiaInfo, ProcessamentoDados, RespostaDia } from "./types"
import {
  gerarProtocolo,
  salvarProtocolo,
} from "@/features/correcao/protocoloStorage"

type Props = {
  dados: ProcessamentoDados
  ehCorrecao?: boolean
  onFinalizado?: (protocolo: string) => void
}

function formatarDia(iso: string): string {
  return format(parseISO(iso), "EEEE, dd 'de' MMMM", { locale: ptBR })
}

function formatarDiaCurto(iso: string): string {
  return format(parseISO(iso), "dd/MM", { locale: ptBR })
}

function respostasIniciais(
  dias: string[],
  prev: RespostaDia[] | undefined,
): Record<string, RespostaDia> {
  const base: Record<string, RespostaDia> = {}
  const prevMap = new Map((prev ?? []).map((r) => [r.data, r]))
  for (const dia of dias) {
    base[dia] = prevMap.get(dia) ?? { data: dia, tipo: "sem_ocorrencia" }
  }
  for (const r of prev ?? []) {
    if (!base[r.data]) base[r.data] = r
  }
  return base
}

function diasInfoIniciais(dados: ProcessamentoDados): DiaInfo[] {
  const desativados = new Set(dados.diasDesativados ?? [])
  const todos = new Set<string>([...dados.dias, ...(dados.diasExtras ?? [])])
  // Loaded days (base + previously-saved extras) all start as 'padrao'.
  // Only days added in the CURRENT session get tipo: "extra" (dashed border).
  return [...todos]
    .sort()
    .map((d) => ({
      data: d,
      tipo: "padrao",
      ativo: !desativados.has(d),
    }))
}

export function FormularioWizard({ dados, ehCorrecao, onFinalizado }: Props) {
  const [respostas, setRespostas] = useState<Record<string, RespostaDia>>(() =>
    respostasIniciais(dados.dias, dados.respostasAnteriores),
  )
  const [diasInfo, setDiasInfo] = useState<DiaInfo[]>(() =>
    diasInfoIniciais(dados),
  )
  const [diaEditando, setDiaEditando] = useState<string | null>(null)
  const [modoApagar, setModoApagar] = useState(false)
  const [mostrarCalendario, setMostrarCalendario] = useState(false)
  const [estourando, setEstourando] = useState<Set<string>>(() => new Set())

  const finalizar = useFinalizarProcessamento(dados.uuid)

  function salvarResposta(resposta: RespostaDia) {
    setRespostas((prev) => ({ ...prev, [resposta.data]: resposta }))
    setDiaEditando(null)
  }

  // --- Add days ---
  const adicionarDias = useCallback(
    (novasDatas: Date[]) => {
      const datasExistentes = new Set(diasInfo.map((d) => d.data))
      const novos: DiaInfo[] = []
      for (const dt of novasDatas) {
        const iso = format(dt, "yyyy-MM-dd")
        if (!datasExistentes.has(iso)) {
          novos.push({ data: iso, tipo: "extra", ativo: true })
        }
      }

      if (novos.length === 0) return

      setDiasInfo((prev) => {
        const all = [...prev, ...novos]
        all.sort((a, b) => a.data.localeCompare(b.data))
        return all
      })

      // Add default respostas for new days
      setRespostas((prev) => {
        const next = { ...prev }
        for (const d of novos) {
          next[d.data] = { data: d.data, tipo: "sem_ocorrencia" }
        }
        return next
      })

      setMostrarCalendario(false)
    },
    [diasInfo],
  )

  // --- Delete / deactivate day ---
  const handleClickDiaApagar = useCallback(
    (diaInfo: DiaInfo) => {
      if (!modoApagar) return

      if (diaInfo.tipo === "extra") {
        // In-session extras: bubble-pop animation, then remove
        setEstourando((prev) => new Set(prev).add(diaInfo.data))
        setTimeout(() => {
          setDiasInfo((prev) => prev.filter((d) => d.data !== diaInfo.data))
          setRespostas((prev) => {
            const next = { ...prev }
            delete next[diaInfo.data]
            return next
          })
          setEstourando((prev) => {
            const next = new Set(prev)
            next.delete(diaInfo.data)
            return next
          })
        }, 480)
      } else {
        // Loaded days (base or previously-saved extras): toggle active
        setDiasInfo((prev) =>
          prev.map((d) =>
            d.data === diaInfo.data ? { ...d, ativo: false } : d,
          ),
        )
      }
    },
    [modoApagar],
  )

  // --- Reactivate a disabled standard day ---
  const reativarDia = useCallback((data: string) => {
    setDiasInfo((prev) =>
      prev.map((d) => (d.data === data ? { ...d, ativo: true } : d)),
    )
  }, [])

  const diasAtivos = useMemo(
    () => diasInfo.filter((d) => d.ativo),
    [diasInfo],
  )

  const comOcorrencia = useMemo(
    () =>
      diasAtivos.filter(
        (d) => respostas[d.data] && respostas[d.data].tipo !== "sem_ocorrencia",
      ).length,
    [diasAtivos, respostas],
  )

  async function enviar() {
    const protocolo = dados.protocolo ?? gerarProtocolo()
    const datasOriginais = new Set(dados.dias)
    // diasExtras = everything outside the original convocation window
    // (covers both previously-saved extras and new in-session adds).
    const todasExtras = diasInfo
      .filter((d) => !datasOriginais.has(d.data))
      .map((d) => d.data)
    const payload = {
      respostas: diasAtivos.map(
        (d) => respostas[d.data] ?? { data: d.data, tipo: "sem_ocorrencia" },
      ),
      protocolo,
      diasExtras: todasExtras,
      diasDesativados: diasInfo.filter((d) => !d.ativo).map((d) => d.data),
      ehCorrecao: !!ehCorrecao,
    }
    const resultado = await finalizar.mutateAsync(payload)
    salvarProtocolo({
      protocolo: resultado.protocolo,
      uuid: dados.uuid,
      nome: dados.nome,
      dataInicio: dados.dataInicio,
      dataFim: dados.dataFim,
      concluidoEm: dados.concluidoEm ?? new Date().toISOString(),
      editadoEm: resultado.editado ? new Date().toISOString() : null,
    })
    onFinalizado?.(resultado.protocolo)
  }

  return (
    <div className="relative z-10 min-h-svh">
      <Header dados={dados} />

      <main className="mx-auto max-w-2xl px-4 pb-16">
        <section className="glass-strong p-8 sm:p-10 fade-up" style={{ animationDelay: "120ms" }}>
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-9 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 backdrop-blur">
              <Sparkles className="size-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-display text-3xl text-white">
                    Marque os dias com{" "}
                    <em className="italic text-[#e8c275]">ocorrência</em>
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    Todos os dias começam como{" "}
                    <span className="text-white/90">sem ocorrências</span>. Toque em
                    um dia para registrar uma falta ou atraso.
                  </p>
                </div>
              </div>

              {/* Action buttons: Add + Delete */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className="btn-action-expand btn-add"
                  onClick={() => {
                    setModoApagar(false)
                    setMostrarCalendario(true)
                  }}
                  title="Adicionar dias"
                >
                  <Plus className="size-4 shrink-0 text-[#6ea0ff]" />
                  <span className="btn-label text-[#6ea0ff]">Adicionar dias</span>
                </button>

                <button
                  type="button"
                  className={`btn-action-expand btn-delete ${modoApagar ? "btn-delete-active" : ""}`}
                  onClick={() => setModoApagar((v) => !v)}
                  title="Apagar dias"
                >
                  {modoApagar ? (
                    <X className="size-4 shrink-0 text-red-300" />
                  ) : (
                    <Trash2 className="size-4 shrink-0 text-red-300/70" />
                  )}
                  <span className="btn-label text-red-300">
                    {modoApagar ? "Concluir" : "Apagar dias"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Day list */}
          <ul className="mt-7 space-y-2">
            {diasInfo.map((diaInfo, i) => (
              <DiaItem
                key={diaInfo.data}
                diaInfo={diaInfo}
                resposta={respostas[diaInfo.data]}
                index={i}
                modoApagar={modoApagar}
                estourando={estourando.has(diaInfo.data)}
                onEdit={() => {
                  if (!modoApagar && diaInfo.ativo) setDiaEditando(diaInfo.data)
                }}
                onApagar={() => handleClickDiaApagar(diaInfo)}
                onReativar={() => reativarDia(diaInfo.data)}
              />
            ))}
          </ul>

          {/* Delete mode banner */}
          {modoApagar && (
            <div className="glass-banner-danger mt-4 flex items-center justify-center gap-2 px-4 py-3 fade-up">
              <Trash2 className="size-4 text-red-300/80" />
              <p className="text-sm text-red-200/80">
                Toque em um dia para removê-lo. Clique em{" "}
                <strong className="text-red-200">Concluir</strong> quando terminar.
              </p>
            </div>
          )}

          {finalizar.isError ? (
            <p className="mt-6 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-center text-sm text-rose-100">
              Erro ao enviar. Tente novamente.
            </p>
          ) : null}

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={enviar}
              disabled={finalizar.isPending || modoApagar}
              className="glass-strong glow-gold group relative inline-flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-full px-8 text-base font-medium tracking-wide text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70"
              style={{
                background:
                  "linear-gradient(135deg, #e8c275 0%, #d4a64a 55%, #6ea0ff 130%)",
                border: "1px solid rgba(255,236,194,0.5)",
              }}
            >
              {finalizar.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                <>Finalizar e enviar</>
              )}
            </button>

            <p className="text-center text-xs text-white/55">
              {comOcorrencia === 0
                ? "Nenhuma ocorrência registrada. Você pode finalizar assim mesmo."
                : `${comOcorrencia} ${
                    comOcorrencia === 1 ? "dia marcado" : "dias marcados"
                  } com ocorrência.`}
            </p>
          </div>
        </section>
      </main>

      {/* Dialog: edit day occurrence */}
      <DialogDia
        dia={diaEditando}
        respostaAtual={diaEditando ? respostas[diaEditando] : undefined}
        onClose={() => setDiaEditando(null)}
        onSalvar={salvarResposta}
      />

      {/* Dialog: add days calendar */}
      <DialogAdicionarDias
        open={mostrarCalendario}
        onClose={() => setMostrarCalendario(false)}
        diasExistentes={diasInfo.map((d) => d.data)}
        onConfirmar={adicionarDias}
      />
    </div>
  )
}

/* ─── Day list item ─── */

type DiaItemProps = {
  diaInfo: DiaInfo
  resposta: RespostaDia | undefined
  index: number
  modoApagar: boolean
  estourando: boolean
  onEdit: () => void
  onApagar: () => void
  onReativar: () => void
}

function DiaItem({
  diaInfo,
  resposta,
  index,
  modoApagar,
  estourando,
  onEdit,
  onApagar,
  onReativar,
}: DiaItemProps) {
  const isExtra = diaInfo.tipo === "extra"
  const isDisabled = !diaInfo.ativo

  // Build tile class
  const tileBase = "group flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left"
  const tileStyle = isDisabled
    ? "glass-tile-disabled"
    : isExtra
      ? "glass-tile glass-tile-extra"
      : "glass-tile"

  const shakeClass = !estourando && modoApagar && diaInfo.ativo ? "shake-mode" : ""
  const slideClass = isExtra ? "slide-in-right" : "fade-up"
  const popClass = estourando ? "bubble-pop" : ""

  function handleClick() {
    if (estourando) return
    if (modoApagar && diaInfo.ativo) {
      onApagar()
    } else if (isDisabled) {
      // Disabled days are handled via the overlay
      return
    } else if (!modoApagar) {
      onEdit()
    }
  }

  return (
    <li
      className={`${popClass || slideClass} ${shakeClass}`.trim()}
      style={!isExtra && !estourando ? { animationDelay: `${200 + index * 60}ms` } : undefined}
    >
      <button
        type="button"
        className={`${tileBase} ${tileStyle}`}
        onClick={handleClick}
      >
        {isExtra && diaInfo.ativo && (
          <svg className="extra-dash-svg" aria-hidden="true">
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              rx="14"
              ry="14"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        <div className="min-w-0">
          <p className={`text-[15px] font-medium capitalize ${isDisabled ? "text-white/35 line-through" : "text-white/95"}`}>
            {formatarDia(diaInfo.data)}
          </p>
          <div className="mt-1 text-sm text-white/60">
            {isDisabled ? (
              <span className="inline-flex items-center gap-2 text-white/30">
                <span className="lamp lamp-off" />
                Dia desativado
              </span>
            ) : (
              <BadgeResposta resposta={resposta} />
            )}
          </div>
        </div>

        {!isDisabled && !modoApagar && (
          <ChevronRight className="size-4 shrink-0 text-white/45 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
        )}

        {modoApagar && diaInfo.ativo && (
          <div className="flex size-7 items-center justify-center rounded-full bg-red-400/15 ring-1 ring-red-400/30 transition-all group-hover:bg-red-400/25">
            <X className="size-3.5 text-red-300" />
          </div>
        )}

        {/* Overlay for reactivating disabled standard days */}
        {isDisabled && (
          <div
            className="disabled-overlay"
            onClick={(e) => {
              e.stopPropagation()
              onReativar()
            }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-white/90 backdrop-blur transition-all hover:bg-white/15">
              <RotateCcw className="size-3.5" />
              Reativar dia
            </span>
          </div>
        )}
      </button>
    </li>
  )
}

/* ─── Header ─── */

function Header({ dados }: { dados: ProcessamentoDados }) {
  return (
    <header className="mx-auto max-w-2xl px-4 pt-12 pb-8 fade-up">
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
        Registro de ocorrências
      </p>
      <h1 className="text-display mt-3 text-5xl leading-[1.05] text-white">
        {dados.nome}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dados.contrato ? (
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75 backdrop-blur">
            Contrato {dados.contrato}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75 backdrop-blur">
          <CalendarDays className="size-3.5" />
          {format(parseISO(dados.dataInicio), "dd/MM/yyyy")} —{" "}
          {format(parseISO(dados.dataFim), "dd/MM/yyyy")}
        </span>
      </div>
    </header>
  )
}

/* ─── Dialog: Add Days Calendar ─── */

type DialogAdicionarDiasProps = {
  open: boolean
  onClose: () => void
  diasExistentes: string[]
  onConfirmar: (dates: Date[]) => void
}

function DialogAdicionarDias({
  open,
  onClose,
  diasExistentes,
  onConfirmar,
}: DialogAdicionarDiasProps) {
  const [selecionadas, setSelecionadas] = useState<Date[]>([])

  useEffect(() => {
    if (open) setSelecionadas([])
  }, [open])

  const diasDesabilitados = useMemo(
    () => diasExistentes.map((d) => parseISO(d)),
    [diasExistentes],
  )

  function confirmar() {
    if (selecionadas.length === 0) return
    onConfirmar(selecionadas)
    setSelecionadas([])
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md">
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Adicionar dias
          </p>
          <DialogTitle className="text-display text-3xl text-white">
            Selecione os dias
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Escolha um ou mais dias extras para adicionar ao período.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-white/12" />

        <div className="flex justify-center">
          <DayPicker
            mode="multiple"
            selected={selecionadas}
            onSelect={(days) => setSelecionadas(days ?? [])}
            disabled={diasDesabilitados}
            locale={ptBR}
            showOutsideDays
            fixedWeeks
          />
        </div>

        {selecionadas.length > 0 && (
          <div className="mt-2 rounded-xl border border-[#6ea0ff]/20 bg-[#6ea0ff]/8 px-4 py-3">
            <p className="text-xs font-medium text-[#6ea0ff]/90">
              {selecionadas.length}{" "}
              {selecionadas.length === 1 ? "dia selecionado" : "dias selecionados"}
              :{" "}
              <span className="text-white/70">
                {selecionadas
                  .sort((a, b) => a.getTime() - b.getTime())
                  .map((d) => formatarDiaCurto(format(d, "yyyy-MM-dd")))
                  .join(", ")}
              </span>
            </p>
          </div>
        )}

        <DialogFooter className="mt-3 gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/65 hover:bg-white/10 hover:text-white"
          >
            Cancelar
          </Button>
          <button
            type="button"
            onClick={confirmar}
            disabled={selecionadas.length === 0}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium tracking-wide text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
            style={{
              background:
                "linear-gradient(135deg, #6ea0ff 0%, #4a7dff 60%, #e8c275 140%)",
              border: "1px solid rgba(110, 160, 255, 0.5)",
            }}
          >
            <Plus className="size-4" />
            Adicionar {selecionadas.length > 0 ? `(${selecionadas.length})` : ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Dialog: Edit day occurrence ─── */

type Passo = "faltou" | "atraso" | "minutos"

type DialogDiaProps = {
  dia: string | null
  respostaAtual: RespostaDia | undefined
  onClose: () => void
  onSalvar: (r: RespostaDia) => void
}

function DialogDia({ dia, respostaAtual, onClose, onSalvar }: DialogDiaProps) {
  const [passo, setPasso] = useState<Passo>("faltou")
  const [minutos, setMinutos] = useState<string>("")

  useEffect(() => {
    setPasso("faltou")
    setMinutos(
      respostaAtual?.tipo === "atraso" && respostaAtual.minutosAtraso
        ? String(respostaAtual.minutosAtraso)
        : "",
    )
  }, [dia, respostaAtual])

  if (!dia) return null

  // "Foi trabalhar?" — Sim avança, Não vira falta
  function handleFoiTrabalhar(v: boolean) {
    if (v) {
      setPasso("atraso")
    } else {
      onSalvar({ data: dia!, tipo: "falta" })
    }
  }

  // "Chegou no horário?" — Sim finaliza sem ocorrência, Não pede minutos
  function handleChegouNoHorario(v: boolean) {
    if (v) {
      onSalvar({ data: dia!, tipo: "sem_ocorrencia" })
    } else {
      setPasso("minutos")
    }
  }

  function confirmarMinutos(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(minutos)
    if (!Number.isFinite(n) || n <= 0) return
    onSalvar({ data: dia!, tipo: "atraso", minutosAtraso: Math.round(n) })
  }

  function marcarSemOcorrencia() {
    onSalvar({ data: dia!, tipo: "sem_ocorrencia" })
  }

  return (
    <Dialog open={!!dia} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md">
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Registrar dia
          </p>
          <DialogTitle className="text-display text-3xl capitalize text-white">
            {formatarDia(dia)}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Registre o que aconteceu neste dia.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-white/12" />

        {passo === "faltou" ? (
          <div className="space-y-4">
            <h3 className="text-[15px] font-medium text-white/90">
              O intermitente foi trabalhar neste dia?
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton
                onClick={() => handleFoiTrabalhar(false)}
                variant="ghost"
              >
                Não, faltou
              </ChoiceButton>
              <ChoiceButton
                onClick={() => handleFoiTrabalhar(true)}
                variant="primary"
              >
                Sim
              </ChoiceButton>
            </div>
          </div>
        ) : null}

        {passo === "atraso" ? (
          <div className="space-y-4">
            <h3 className="text-[15px] font-medium text-white/90">
              Chegou no horário e cumpriu o expediente?
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton
                onClick={() => handleChegouNoHorario(false)}
                variant="ghost"
              >
                Não
              </ChoiceButton>
              <ChoiceButton
                onClick={() => handleChegouNoHorario(true)}
                variant="primary"
              >
                Sim
              </ChoiceButton>
            </div>
          </div>
        ) : null}

        {passo === "minutos" ? (
          <form className="space-y-4" onSubmit={confirmarMinutos}>
            <div className="space-y-2">
              <Label htmlFor="minutos" className="text-white/85">
                Quantos minutos fora do expediente?
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="minutos"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="Ex: 30"
                  className="h-12 border-white/15 bg-white/5 text-white placeholder:text-white/35 backdrop-blur focus-visible:ring-white/40"
                  value={minutos}
                  onChange={(e) => setMinutos(e.target.value)}
                  autoFocus
                />
                <span className="text-sm text-white/60">minutos</span>
              </div>
            </div>
            <ChoiceButton
              type="submit"
              variant="primary"
              disabled={!(Number(minutos) > 0)}
              className="w-full"
            >
              Confirmar
            </ChoiceButton>
          </form>
        ) : null}

        <DialogFooter className="mt-2 sm:justify-between">
          {respostaAtual && respostaAtual.tipo !== "sem_ocorrencia" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={marcarSemOcorrencia}
              className="text-white/65 hover:bg-white/10 hover:text-white"
            >
              Marcar como sem ocorrências
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/65 hover:bg-white/10 hover:text-white"
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Shared components ─── */

function ChoiceButton({
  children,
  variant = "ghost",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "primary"
}) {
  const base =
    "inline-flex h-14 items-center justify-center rounded-2xl px-5 text-[15px] font-medium tracking-wide transition-all disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
  const styles =
    variant === "primary"
      ? "border border-amber-100/40 text-[#0a1224] shadow-[0_10px_30px_-8px_rgba(232,194,117,0.55)]"
      : "border border-white/15 bg-white/5 text-white/85 backdrop-blur hover:bg-white/10 hover:text-white"
  const primaryBg =
    variant === "primary"
      ? {
          background:
            "linear-gradient(135deg, #e8c275 0%, #d4a64a 60%, #6ea0ff 140%)",
        }
      : undefined
  return (
    <button {...props} className={`${base} ${styles} ${className}`} style={primaryBg}>
      {children}
    </button>
  )
}

function BadgeResposta({ resposta }: { resposta: RespostaDia | undefined }) {
  if (!resposta || resposta.tipo === "sem_ocorrencia") {
    return (
      <span className="inline-flex items-center gap-2 text-emerald-300">
        <span className="lamp lamp-on-green" />
        Sem ocorrências
      </span>
    )
  }
  if (resposta.tipo === "falta") {
    return (
      <span className="inline-flex items-center gap-2 text-red-300/85">
        <span className="lamp lamp-off" />
        Faltou
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 text-yellow-300">
      <span className="lamp lamp-flicker-yellow" />
      Atraso · {resposta.minutosAtraso} min
    </span>
  )
}
