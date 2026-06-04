import { useState } from "react"
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react"

import {
  SCHEME_META,
  setMode,
  setScheme,
  useThemeState,
  type Mode,
  type Scheme,
} from "@/lib/theme"

const MODES: { id: Mode; label: string; icon: typeof Monitor }[] = [
  { id: "system", label: "Sistema", icon: Monitor },
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
]

const SCHEMES: Scheme[] = ["aurora", "seco", "verde", "rosa", "rubi", "roxo"]

function Tons({ tones }: { tones: readonly string[] }) {
  return (
    <span className="flex items-center gap-1">
      {tones.map((t, i) => (
        <span
          key={i}
          className="size-3.5 rounded-full ring-1 ring-[rgb(var(--ink)/0.18)]"
          style={{ background: t }}
        />
      ))}
    </span>
  )
}

export function ThemeControls() {
  const { mode, scheme } = useThemeState()
  const [aberto, setAberto] = useState(false)
  const atual = SCHEME_META[scheme]

  return (
    <div className="space-y-6">
      {/* Modo */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Modo
        </p>
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border bg-secondary/40 p-1.5">
          {MODES.map((m) => {
            const Icon = m.icon
            const ativo = mode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={ativo}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  ativo
                    ? "bg-[rgb(var(--accent-rgb)/0.16)] text-foreground ring-1 ring-[rgb(var(--accent-rgb)/0.5)]"
                    : "text-muted-foreground hover:bg-[rgb(var(--ink)/0.05)] hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Esquema de cores — expansível */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Esquema de cores
        </p>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] px-3.5 py-3 text-sm font-medium text-foreground transition hover:border-[rgb(var(--accent-rgb)/0.4)]"
        >
          <span className="flex items-center gap-2.5">
            <Tons tones={atual.tones} />
            {atual.label}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${
              aberto ? "rotate-180" : ""
            }`}
          />
        </button>

        <div className={`esquema-opcoes ${aberto ? "aberto" : ""}`}>
          <div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SCHEMES.map((s) => {
                const meta = SCHEME_META[s]
                const ativo = scheme === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScheme(s)
                      setAberto(false)
                    }}
                    aria-pressed={ativo}
                    title={meta.label}
                    className={`flex flex-col items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      ativo
                        ? "border-[rgb(var(--accent-rgb)/0.55)] bg-[rgb(var(--accent-rgb)/0.1)] text-foreground"
                        : "border-border text-muted-foreground hover:border-[rgb(var(--accent-rgb)/0.4)] hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Tons tones={meta.tones} />
                      {ativo && (
                        <Check className="size-3.5 text-[rgb(var(--accent-rgb))]" />
                      )}
                    </span>
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
