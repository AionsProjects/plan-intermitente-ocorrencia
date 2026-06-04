import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { format, parseISO } from "date-fns"
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  KeyRound,
  Loader2,
  Pencil,
} from "lucide-react"

import { buscarUuidPorProtocolo } from "@/features/preencher/api"

import { listarProtocolos, type ProtocoloEntry } from "./protocoloStorage"

const RECENTES_VISIVEIS = 3

export function CorrecaoPage() {
  const navigate = useNavigate()
  const [valor, setValor] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [recentes] = useState<ProtocoloEntry[]>(() => listarProtocolos())
  const [expandido, setExpandido] = useState(false)

  const recentesVisiveis = expandido
    ? recentes
    : recentes.slice(0, RECENTES_VISIVEIS)
  const ocultos = recentes.length - RECENTES_VISIVEIS

  // 3D tilt: cursor sets --mx/--my, CSS faz perspective rotateX/Y
  function handleTiltMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleTiltLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  async function abrir(protocolo: string) {
    const limpo = protocolo.trim().toUpperCase()
    if (!limpo) {
      setErro("Digite um código de protocolo.")
      return
    }
    setErro(null)
    setCarregando(true)
    try {
      const { uuid } = await buscarUuidPorProtocolo(limpo)
      navigate(`/preencher/${uuid}?modo=correcao`)
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      setErro(
        status === 404
          ? "Protocolo não encontrado."
          : "Erro ao buscar protocolo. Tente novamente.",
      )
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong card-shimmer relative w-full max-w-xl p-10">
        {/* Header: flask de teste + nav cluster top-right */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => void abrir("PROT-DEMO-1234")}
            title="Abrir protocolo de teste"
            className="inline-flex size-8 items-center justify-center rounded-full border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.03)] text-foreground/35 backdrop-blur transition-all hover:border-[rgb(var(--accent-rgb)/0.4)] hover:bg-[rgb(var(--accent-rgb)/0.1)] hover:text-[rgb(var(--accent-rgb))]"
          >
            <FlaskConical className="size-3.5" />
            <span className="sr-only">Abrir protocolo de teste PROT-DEMO-1234</span>
          </button>
        </div>

        <p className="text-[11px] uppercase tracking-[0.32em] text-foreground/55">
          Aionscorp · Plano de intermitentes
        </p>
        <h1 className="text-display mt-3 text-5xl leading-[1.05] text-foreground">
          Corrigir <em className="italic text-[rgb(var(--accent-rgb))]">registro</em>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-foreground/65">
          Use o código de protocolo emitido na finalização para reabrir o
          registro e ajustar dias ou ocorrências.
        </p>

        <form
          className="mt-8 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void abrir(valor)
          }}
        >
          <label className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
            Código do protocolo
          </label>
          <div className="flex items-stretch gap-2">
            <div className="glass-tile flex flex-1 items-center gap-3 rounded-2xl px-4">
              <KeyRound className="size-4 shrink-0 text-[rgb(var(--accent-rgb))]" />
              <input
                type="text"
                value={valor}
                onChange={(e) => setValor(e.target.value.toUpperCase())}
                placeholder="PROT-XXXX-XXXX"
                className="text-display flex-1 bg-transparent py-3 text-xl tracking-wider text-foreground placeholder:text-foreground/30 focus:outline-none"
                autoFocus
                spellCheck={false}
                autoCapitalize="characters"
              />
            </div>
            <button
              type="submit"
              disabled={carregando || valor.trim().length === 0}
              className="glow-gold inline-flex items-center justify-center gap-2 rounded-2xl px-6 text-sm font-medium text-[#0a1224] transition-all hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60"
              style={{
                background:
                  "linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-rgb)) 55%, rgb(var(--surface-rgb)) 130%)",
                border: "1px solid rgba(255,236,194,0.5)",
              }}
            >
              {carregando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              Abrir
            </button>
          </div>

          {erro && (
            <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-xs text-rose-700 dark:text-rose-200">
              {erro}
            </p>
          )}
        </form>

        {recentes.length > 0 && (
          <div className="mt-10">
            <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
              Recentes deste navegador
            </p>
            <ul className="mt-3 space-y-2">
              {recentesVisiveis.map((p, i) => (
                <li
                  key={p.protocolo}
                  className="fade-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => void abrir(p.protocolo)}
                    onMouseMove={handleTiltMove}
                    onMouseLeave={handleTiltLeave}
                    className="glass-tile glass-tile-3d group relative flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-display text-lg tracking-wide text-foreground/95">
                          {p.protocolo}
                        </p>
                        {p.editadoEm && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.1)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[rgb(var(--accent-rgb))]">
                            <Pencil className="size-2.5" />
                            Editado
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-foreground/55">
                        {p.nome} ·{" "}
                        {format(parseISO(p.dataInicio), "dd/MM/yyyy")} —{" "}
                        {format(parseISO(p.dataFim), "dd/MM/yyyy")}
                      </p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-foreground/45 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </button>
                </li>
              ))}
            </ul>

            {ocultos > 0 && (
              <button
                type="button"
                onClick={() => setExpandido((v) => !v)}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.03)] px-4 py-2.5 text-xs font-medium text-foreground/60 backdrop-blur transition-all hover:border-[rgb(var(--ink)/0.2)] hover:bg-[rgb(var(--ink)/0.06)] hover:text-foreground/90"
              >
                {expandido ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    Recolher
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
                    Expandir ({ocultos} {ocultos === 1 ? "outro" : "outros"})
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
