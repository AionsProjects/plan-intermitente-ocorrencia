import { Palette, RotateCcw, SlidersHorizontal } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useNav } from "@/components/NavContext"
import {
  resetPrefs,
  setFonte,
  setReduzirAnim,
  useThemeState,
  type Fonte,
} from "@/lib/theme"
import { ThemeControls } from "./ThemeControls"

const FONTES: { id: Fonte; label: string }[] = [
  { id: "sm", label: "A−" },
  { id: "md", label: "A" },
  { id: "lg", label: "A+" },
]

function PreferenceControls() {
  const { reduzirAnim, fonte } = useThemeState()
  return (
    <div className="space-y-6">
      {/* Reduzir animações */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            Reduzir animações
          </p>
          <p className="text-xs text-foreground/55">
            Desliga efeitos e transições.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={reduzirAnim}
          onClick={() => setReduzirAnim(!reduzirAnim)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            reduzirAnim
              ? "bg-[rgb(var(--accent-rgb)/0.7)]"
              : "bg-[rgb(var(--ink)/0.15)]"
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
              reduzirAnim ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {/* Tamanho da fonte */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Tamanho da fonte
        </p>
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border bg-secondary/40 p-1.5">
          {FONTES.map((f) => {
            const ativo = fonte === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFonte(f.id)}
                aria-pressed={ativo}
                className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  ativo
                    ? "bg-[rgb(var(--accent-rgb)/0.16)] text-foreground ring-1 ring-[rgb(var(--accent-rgb)/0.5)]"
                    : "text-muted-foreground hover:bg-[rgb(var(--ink)/0.05)] hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Resetar */}
      <button
        type="button"
        onClick={resetPrefs}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-[rgb(var(--accent-rgb)/0.4)] hover:text-foreground"
      >
        <RotateCcw className="size-4" />
        Resetar preferências
      </button>
    </div>
  )
}

/**
 * Configurações como OVERLAY liquid-glass (abre por cima de qualquer tela).
 * Fundo continua visível (.glass-modal). Controlado pelo NavContext.
 */
export function ConfigOverlay() {
  const { configAberto, fecharConfig } = useNav()
  return (
    <Dialog open={configAberto} onOpenChange={(o) => !o && fecharConfig()}>
      <DialogContent className="glass-modal border-0 bg-transparent p-6 text-foreground sm:max-w-lg sm:p-7">
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
            Configurações
          </p>
          <DialogTitle className="text-display text-3xl text-foreground">
            Aparência
          </DialogTitle>
          <DialogDescription className="text-foreground/60">
            Personalize tema e cor. Fica salvo neste navegador.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <section className="rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-4 sm:p-5">
            <header className="mb-4 flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.35)]">
                <Palette className="size-4 text-[rgb(var(--accent-rgb))]" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">Tema e cor</h3>
                <p className="text-xs text-foreground/55">
                  Modo claro/escuro + esquema.
                </p>
              </div>
            </header>
            <ThemeControls />
          </section>

          <section className="rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-4 sm:p-5">
            <header className="mb-4 flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.35)]">
                <SlidersHorizontal className="size-4 text-[rgb(var(--accent-rgb))]" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Preferências
                </h3>
                <p className="text-xs text-foreground/55">
                  Animações, fonte e reset.
                </p>
              </div>
            </header>
            <PreferenceControls />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
