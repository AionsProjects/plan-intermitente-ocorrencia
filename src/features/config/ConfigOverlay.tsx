import { useState } from "react"
import { History, Palette, RotateCcw, ShieldCheck, SlidersHorizontal, User } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useNav } from "@/components/NavContext"
import { useAuth } from "@/components/AuthContext"
import {
  resetPrefs,
  setFonte,
  setReduzirAnim,
  useThemeState,
  type Fonte,
} from "@/lib/theme"
import { ThemeControls } from "./ThemeControls"
import { ContaTab } from "./ContaTab"
import { AdminUsuariosTab } from "./AdminUsuariosTab"
import { AtividadeTab } from "./AtividadeTab"

type Aba = "aparencia" | "conta" | "atividade" | "admin"

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
          className={`relative h-6 w-11 shrink-0 rounded-full ring-1 transition-all duration-300 ${
            reduzirAnim
              ? "bg-[rgb(var(--accent-rgb)/0.65)] ring-[rgb(var(--accent-rgb)/0.6)] shadow-[0_4px_14px_-4px_rgb(var(--accent-rgb)/0.7)]"
              : "bg-[rgb(var(--ink)/0.12)] ring-[rgb(var(--ink)/0.15)]"
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow-md transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
        <div className="grid grid-cols-3 gap-2">
          {FONTES.map((f) => {
            const ativo = fonte === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFonte(f.id)}
                aria-pressed={ativo}
                className={`text-display rounded-2xl border px-3 py-2.5 transition-all duration-300 ${
                  f.id === "sm" ? "text-sm" : f.id === "md" ? "text-lg" : "text-2xl"
                } ${
                  ativo
                    ? "border-[rgb(var(--accent-rgb)/0.5)] bg-[rgb(var(--accent-rgb)/0.1)] text-foreground shadow-[0_10px_26px_-12px_rgb(var(--accent-rgb)/0.55)]"
                    : "border-border text-muted-foreground hover:border-[rgb(var(--accent-rgb)/0.35)] hover:text-foreground"
                }`}
              >
                Aa
              </button>
            )
          })}
        </div>
      </div>

      {/* Resetar */}
      <button
        type="button"
        onClick={resetPrefs}
        className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-300 hover:border-[rgb(var(--accent-rgb)/0.4)] hover:text-foreground"
      >
        <RotateCcw className="size-4 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-rotate-[300deg]" />
        Resetar preferências
      </button>
    </div>
  )
}

/**
 * Configurações como OVERLAY liquid-glass (abre por cima de qualquer tela).
 * Fundo continua visível (.glass-modal). Controlado pelo NavContext.
 */
const SUBTITULO: Record<Aba, string> = {
  aparencia: "Personalize tema e cor. Fica salvo neste navegador.",
  conta: "Seus dados, senha e sessão.",
  atividade: "Histórico das ações registradas.",
  admin: "Gerencie funções e acesso dos usuários.",
}

export function ConfigOverlay() {
  const { configAberto, fecharConfig } = useNav()
  const { usuario, podeVer } = useAuth()
  const [aba, setAba] = useState<Aba>("aparencia")

  const ehAdmin = podeVer("admin")
  const abas: { id: Aba; label: string; icone: typeof Palette }[] = [
    { id: "aparencia", label: "Aparência", icone: Palette },
    ...(usuario ? [{ id: "conta" as Aba, label: "Conta", icone: User }] : []),
    ...(usuario ? [{ id: "atividade" as Aba, label: "Atividade", icone: History }] : []),
    ...(ehAdmin ? [{ id: "admin" as Aba, label: "Admin", icone: ShieldCheck }] : []),
  ]

  return (
    <Dialog open={configAberto} onOpenChange={(o) => !o && fecharConfig()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-6 text-foreground sm:max-w-lg sm:p-7"
        overlayClassName="bg-[rgb(var(--shadow)/0.5)] backdrop-blur-[3px]"
        style={{
          backdropFilter: "blur(10px) saturate(130%)",
          WebkitBackdropFilter: "blur(10px) saturate(130%)",
        }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
            Configurações
          </p>
          <DialogTitle className="text-display text-3xl text-foreground">
            Ajustes
          </DialogTitle>
          <DialogDescription className="text-foreground/60">
            {SUBTITULO[aba]}
          </DialogDescription>
        </DialogHeader>

        {/* Abas */}
        <div
          className="mt-1 grid gap-1.5 rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-1.5"
          style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}
        >
          {abas.map((a) => {
            const Icone = a.icone
            const ativo = aba === a.id
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                className={`group flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium transition-all duration-300 ${
                  ativo
                    ? "bg-[rgb(var(--accent-rgb)/0.14)] text-foreground ring-1 ring-[rgb(var(--accent-rgb)/0.5)] shadow-[0_8px_22px_-10px_rgb(var(--accent-rgb)/0.6)]"
                    : "text-muted-foreground hover:bg-[rgb(var(--ink)/0.05)] hover:text-foreground"
                }`}
              >
                <Icone
                  className={`size-4 transition-transform duration-300 group-hover:scale-110 ${
                    ativo ? "text-[rgb(var(--accent-rgb))]" : ""
                  }`}
                />
                {a.label}
              </button>
            )
          })}
        </div>

        <div className="mt-3 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {aba === "aparencia" && (
            <>
              <section className="rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] p-4 sm:p-5">
                <header className="mb-4 flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.35)]">
                    <Palette className="size-4 text-[rgb(var(--accent-rgb))]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Tema e cor</h3>
                    <p className="text-xs text-foreground/55">Modo claro/escuro + esquema.</p>
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
                    <h3 className="text-sm font-medium text-foreground">Preferências</h3>
                    <p className="text-xs text-foreground/55">Animações, fonte e reset.</p>
                  </div>
                </header>
                <PreferenceControls />
              </section>
            </>
          )}

          {aba === "conta" && <ContaTab />}
          {aba === "atividade" && <AtividadeTab />}
          {aba === "admin" && ehAdmin && <AdminUsuariosTab />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
