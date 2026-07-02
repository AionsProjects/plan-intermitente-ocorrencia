import { Check, Monitor, Moon, Sun } from "lucide-react"

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

const SCHEMES: Scheme[] = ["aurora", "seco", "verde", "rosa", "rubi", "roxo", "brasil"]

// Swatch: os tons do esquema como um "orbe" em gradiente (visual > texto).
function Orbe({ tones, ativo }: { tones: readonly string[]; ativo: boolean }) {
  const [a, b, c] = [tones[0], tones[1] ?? tones[0], tones[2] ?? tones[0]]
  return (
    <span
      className={`relative grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-300 ${
        ativo ? "scale-105" : "group-hover:scale-105"
      }`}
      style={{
        background: `conic-gradient(from 210deg, ${a}, ${b}, ${c}, ${a})`,
        boxShadow: ativo
          ? "0 0 0 2px rgb(var(--accent-rgb) / 0.65), 0 6px 16px -6px rgb(var(--shadow) / 0.7)"
          : "inset 0 0 0 1px rgb(var(--ink) / 0.15), 0 4px 12px -6px rgb(var(--shadow) / 0.55)",
      }}
    >
      {ativo && (
        <span className="grid size-4 place-items-center rounded-full bg-[rgb(var(--shadow)/0.55)] backdrop-blur-sm">
          <Check className="size-3 text-white" />
        </span>
      )}
    </span>
  )
}

export function ThemeControls() {
  const { mode, scheme } = useThemeState()

  return (
    <div className="space-y-6">
      {/* Modo — mini-cards com bolha (padrão do console) */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Modo
        </p>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const Icon = m.icon
            const ativo = mode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={ativo}
                className={`group flex flex-col items-center gap-2 rounded-2xl border px-3 py-3.5 text-xs font-medium transition-all duration-300 ${
                  ativo
                    ? "border-[rgb(var(--accent-rgb)/0.5)] bg-[rgb(var(--accent-rgb)/0.1)] text-foreground shadow-[0_10px_26px_-12px_rgb(var(--accent-rgb)/0.55)]"
                    : "border-border text-muted-foreground hover:border-[rgb(var(--accent-rgb)/0.35)] hover:text-foreground"
                }`}
              >
                <span
                  className={`grid size-9 place-items-center rounded-full ring-1 transition-transform duration-300 group-hover:scale-110 ${
                    ativo
                      ? "bg-[rgb(var(--accent-rgb)/0.16)] ring-[rgb(var(--accent-rgb)/0.45)]"
                      : "bg-[rgb(var(--ink)/0.05)] ring-[rgb(var(--ink)/0.14)]"
                  }`}
                >
                  <Icon
                    className={`size-4 ${ativo ? "text-[rgb(var(--accent-rgb))]" : "text-foreground/55"}`}
                  />
                </span>
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Esquema de cores — sempre visível (escolher cor é visual, não dropdown) */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Esquema de cores
        </p>
        <div className="grid grid-cols-3 gap-2">
          {SCHEMES.map((s) => {
            const meta = SCHEME_META[s]
            const ativo = scheme === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScheme(s)}
                aria-pressed={ativo}
                className={`group flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-xs font-medium transition-all duration-300 ${
                  ativo
                    ? "border-[rgb(var(--accent-rgb)/0.5)] bg-[rgb(var(--accent-rgb)/0.08)] text-foreground"
                    : "border-border text-muted-foreground hover:border-[rgb(var(--ink)/0.25)] hover:text-foreground"
                }`}
              >
                <Orbe tones={meta.tones} ativo={ativo} />
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
