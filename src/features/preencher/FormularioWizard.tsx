import { useCallback, useEffect, useMemo, useState } from "react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

function formatarDiaCompleto(iso: string): string {
  return format(parseISO(iso), "EEEE, dd 'de' MMMM", { locale: ptBR })
}

function formatarDiaSemana(iso: string): string {
  return format(parseISO(iso), "EEEE", { locale: ptBR })
}

function formatarDiaCurto(iso: string): string {
  return format(parseISO(iso), "dd 'de' MMM", { locale: ptBR })
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

  const finalizar = useFinalizarProcessamento(dados.uuid)

  function salvarResposta(resposta: RespostaDia) {
    setRespostas((prev) => ({ ...prev, [resposta.data]: resposta }))
    setDiaEditando(null)
  }

  // --- Desconsiderar dia (toggle ativo) ---
  const handleClickDiaApagar = useCallback(
    (diaInfo: DiaInfo) => {
      if (!modoApagar) return
      setDiasInfo((prev) =>
        prev.map((d) =>
          d.data === diaInfo.data ? { ...d, ativo: false } : d,
        ),
      )
    },
    [modoApagar],
  )

  // --- Reactivate a desconsiderado day ---
  const reativarDia = useCallback((data: string) => {
    setDiasInfo((prev) =>
      prev.map((d) => (d.data === data ? { ...d, ativo: true } : d)),
    )
  }, [])

  const diasAtivos = useMemo(
    () => diasInfo.filter((d) => d.ativo),
    [diasInfo],
  )

  // Conta TUDO que foge de "sem ocorrência":
  // faltas + atrasos + dias desconsiderados.
  const totalOcorrencias = useMemo(() => {
    const desconsiderados = diasInfo.filter((d) => !d.ativo).length
    const comOcorrencia = diasAtivos.filter(
      (d) => respostas[d.data] && respostas[d.data].tipo !== "sem_ocorrencia",
    ).length
    return desconsiderados + comOcorrencia
  }, [diasInfo, diasAtivos, respostas])

  async function enviar() {
    // Usa `||` (não `??`) porque o backend pode devolver "" em vez de null
    // quando a coluna Protocolo do monday está vazia.
    const protocolo = dados.protocolo || gerarProtocolo()
    const datasOriginais = new Set(dados.dias)
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

              {/* Action button: Desconsiderar */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className={`btn-action-expand btn-delete ${modoApagar ? "btn-delete-active" : ""}`}
                  onClick={() => setModoApagar((v) => !v)}
                  title="Desconsiderar dia"
                >
                  {modoApagar ? (
                    <X className="size-4 shrink-0 text-red-300" />
                  ) : (
                    <Trash2 className="size-4 shrink-0 text-red-300/70" />
                  )}
                  <span className="btn-label text-red-300">
                    {modoApagar ? "Concluir" : "Desconsiderar dia"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Day grid: 2 per row, last odd item spans both columns */}
          <ul className="mt-7 grid grid-cols-2 gap-2.5 dia-grid">
            {diasInfo.map((diaInfo, i) => (
              <DiaItem
                key={diaInfo.data}
                diaInfo={diaInfo}
                resposta={respostas[diaInfo.data]}
                index={i}
                modoApagar={modoApagar}
                onEdit={() => {
                  if (!modoApagar && diaInfo.ativo) setDiaEditando(diaInfo.data)
                }}
                onApagar={() => handleClickDiaApagar(diaInfo)}
                onReativar={() => reativarDia(diaInfo.data)}
              />
            ))}
          </ul>

          {/* Desconsiderar mode banner */}
          {modoApagar && (
            <div className="glass-banner-danger mt-4 flex items-center justify-center gap-2 px-4 py-3 fade-up">
              <Trash2 className="size-4 text-red-300/80" />
              <p className="text-sm text-red-200/80">
                Toque em um dia para desconsiderá-lo. Clique em{" "}
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
              {totalOcorrencias === 0
                ? "Nenhuma ocorrência registrada. Você pode finalizar assim mesmo."
                : `${totalOcorrencias} ${
                    totalOcorrencias === 1 ? "dia com ocorrência" : "dias com ocorrência"
                  }.`}
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
    </div>
  )
}

/* ─── Day grid item ─── */

type DiaItemProps = {
  diaInfo: DiaInfo
  resposta: RespostaDia | undefined
  index: number
  modoApagar: boolean
  onEdit: () => void
  onApagar: () => void
  onReativar: () => void
}

function DiaItem({
  diaInfo,
  resposta,
  index,
  modoApagar,
  onEdit,
  onApagar,
  onReativar,
}: DiaItemProps) {
  const isDisabled = !diaInfo.ativo

  const tileBase =
    "group relative flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-4 text-left"
  const tileStyle = isDisabled ? "glass-tile-disabled" : "glass-tile glass-tile-3d"

  const shakeClass = modoApagar && diaInfo.ativo ? "shake-mode" : ""

  function handleClick() {
    if (modoApagar && diaInfo.ativo) {
      onApagar()
    } else if (isDisabled) {
      // Reativar via overlay
      return
    } else if (!modoApagar) {
      onEdit()
    }
  }

  // 3D tilt: cursor sets --mx/--my, CSS does perspective rotateX/Y
  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    if (isDisabled) return
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  return (
    <li
      className={`fade-up ${shakeClass}`.trim()}
      style={{ animationDelay: `${200 + index * 60}ms` }}
    >
      <button
        type="button"
        className={`${tileBase} ${tileStyle}`}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <p
          className={`text-[10px] uppercase tracking-[0.18em] ${
            isDisabled ? "text-white/30" : "text-white/55"
          }`}
        >
          {formatarDiaSemana(diaInfo.data)}
        </p>
        <p
          className={`text-display text-2xl leading-none ${
            isDisabled ? "text-white/35 line-through" : "text-white/95"
          }`}
        >
          {formatarDiaCurto(diaInfo.data)}
        </p>
        <div className="mt-1 text-xs">
          {isDisabled ? (
            <span className="inline-flex items-center gap-1.5 text-violet-300/75">
              <LampBroken />
              Desconsiderado
            </span>
          ) : (
            <BadgeResposta resposta={resposta} />
          )}
        </div>

        {modoApagar && diaInfo.ativo && (
          <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-red-400/15 ring-1 ring-red-400/30 transition-all group-hover:bg-red-400/25">
            <X className="size-3 text-red-300" />
          </div>
        )}

        {/* Overlay for reactivating desconsiderados */}
        {isDisabled && (
          <div
            className="disabled-overlay"
            onClick={(e) => {
              e.stopPropagation()
              onReativar()
            }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/90 backdrop-blur transition-all hover:bg-white/15">
              <RotateCcw className="size-3" />
              Reativar
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

  function handleFoiTrabalhar(v: boolean) {
    if (v) {
      setPasso("atraso")
    } else {
      onSalvar({ data: dia!, tipo: "falta" })
    }
  }

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
      <DialogContent className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md" style={{ backdropFilter: 'blur(10px) saturate(140%) brightness(1.05)' }}>
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Registrar dia
          </p>
          <DialogTitle className="text-display text-3xl capitalize text-white">
            {formatarDiaCompleto(dia)}
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
                variant="danger"
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
                variant="danger"
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
                <NumStepper
                  id="minutos"
                  value={minutos}
                  onChange={setMinutos}
                  min={1}
                  step={1}
                  placeholder="Ex: 30"
                  autoFocus
                  className="flex-1"
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

type NumStepperProps = {
  id?: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

function NumStepper({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  autoFocus,
  className = "",
}: NumStepperProps) {
  const num = Number(value)
  const safeNum = Number.isFinite(num) ? num : 0
  const canDec = min === undefined || safeNum > min
  const canInc = max === undefined || safeNum < max

  function bump(delta: number) {
    const base = Number.isFinite(num) ? num : (min ?? 0)
    let next = base + delta
    if (min !== undefined && next < min) next = min
    if (max !== undefined && next > max) next = max
    onChange(String(next))
  }

  // Aceita só dígitos no input — evita validação chata do HTML5 number
  // ("valor mais próximo é X") quando o usuário digita um valor que não
  // bate com o `step`. Usamos type="text" + inputMode="numeric" pra
  // mostrar teclado numérico no mobile sem o validation nativo.
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/[^\d]/g, "")
    onChange(v)
  }

  return (
    <div className={`num-stepper ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        autoFocus={autoFocus}
      />
      <div className="num-stepper-controls" aria-hidden>
        <button
          type="button"
          className="num-stepper-btn"
          onClick={() => bump(step)}
          disabled={!canInc}
          tabIndex={-1}
          aria-label="Aumentar"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          className="num-stepper-btn"
          onClick={() => bump(-step)}
          disabled={!canDec}
          tabIndex={-1}
          aria-label="Diminuir"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
    </div>
  )
}

function ChoiceButton({
  children,
  variant = "ghost",
  className = "",
  onMouseMove,
  onMouseLeave,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "primary" | "danger"
}) {
  // Tilt 3D segue o cursor: --mx, --my (0..100%) consumidos pelo CSS .choice-btn
  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
    onMouseMove?.(e)
  }
  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
    onMouseLeave?.(e)
  }
  const variantClass =
    variant === "primary"
      ? "choice-btn--primary"
      : variant === "danger"
        ? "choice-btn--danger"
        : ""
  return (
    <button
      {...props}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`choice-btn ${variantClass} ${className}`}
    >
      {children}
    </button>
  )
}

function BadgeResposta({ resposta }: { resposta: RespostaDia | undefined }) {
  if (!resposta || resposta.tipo === "sem_ocorrencia") {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <span className="lamp lamp-on-green" />
        Sem ocorrências
      </span>
    )
  }
  if (resposta.tipo === "falta") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-300/85">
        <span className="lamp lamp-off" />
        Faltou
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-yellow-300">
      <span className="lamp lamp-flicker-yellow" />
      {resposta.minutosAtraso} min
    </span>
  )
}

/* Lâmpada quebrada — bulbo escurecido roxo + rachadura SVG.
   Usada no estado "Desconsiderado" pra distinguir visualmente das
   outras 3 lâmpadas (verde/sem-oco, cinza/falta, amarela/atraso). */
function LampBroken() {
  return (
    <span className="lamp-broken-wrap" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12" className="block">
        <defs>
          <radialGradient id="lb-bg" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#4a2852" />
            <stop offset="100%" stopColor="#0e0518" />
          </radialGradient>
        </defs>
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="url(#lb-bg)"
          stroke="rgba(168,85,247,0.45)"
          strokeWidth="0.4"
        />
        {/* Rachadura principal em zigue-zague */}
        <path
          d="M3.4 2.6 L4.9 4.4 L3.9 5.2 L5.4 6.9 L4.4 8.7"
          stroke="rgba(240,210,255,0.9)"
          strokeWidth="0.7"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Trinca secundária menor */}
        <path
          d="M7.6 4 L7 5.6"
          stroke="rgba(240,210,255,0.55)"
          strokeWidth="0.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
