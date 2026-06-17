import type { MouseEvent } from "react"
import { Link } from "react-router-dom"

import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  KeyRound,
  UserPlus,
} from "lucide-react"

import { useAuth } from "@/components/AuthContext"
import type { Papel } from "@/features/auth/types"

const actions: {
  to: string
  title: string
  description: string
  icon: typeof UserPlus
  tone: string
  nivelMinimo?: Papel
}[] = [
  {
    to: "/convocar",
    title: "Nova convocação",
    description: "Cadastrar uma nova convocação pontual.",
    icon: UserPlus,
    tone: "blue",
  },
  {
    to: "/atestados",
    title: "Atestados e declarações",
    description: "Lançar atestado médico ou declaração de comparecimento.",
    icon: FileText,
    tone: "amber",
  },
  {
    to: "/ponto-facultativo",
    title: "Ponto facultativo",
    description: "Aplicar vale-refeição e vale-transporte para um contrato em um dia específico.",
    icon: CalendarDays,
    tone: "emerald",
    nivelMinimo: "dp", // só DP + Admin
  },
  {
    to: "/corrigir",
    title: "Atualizar ocorrência",
    description: "Reabrir um registro pelo código de protocolo.",
    icon: KeyRound,
    tone: "gold",
  },
]

export function HubPage() {
  const { podeVer } = useAuth()
  const acoesVisiveis = actions.filter(
    (a) => !a.nivelMinimo || podeVer(a.nivelMinimo),
  )

  function handleTiltMove(e: MouseEvent<HTMLAnchorElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }

  function handleTiltLeave(e: MouseEvent<HTMLAnchorElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <section className="glass-strong relative w-full max-w-2xl overflow-hidden px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <header>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-foreground/55">
              <ClipboardCheck className="size-3 text-[rgb(var(--accent-rgb))]" />
              Plano de intermitentes
            </div>
            <p className="mt-5 text-[11px] uppercase tracking-[0.28em] text-foreground/40">
              Aionscorp
            </p>
            <h1 className="text-display mt-2 text-4xl leading-[1.02] text-foreground sm:text-5xl">
              Escolha o próximo passo
            </h1>
          </div>
        </header>

        <p className="mt-4 max-w-lg text-sm leading-relaxed text-foreground/58 sm:text-[15px]">
          Acesse o fluxo de convocação ou ajuste uma ocorrência já registrada.
        </p>

        <div className="mt-8 grid gap-3 sm:gap-3.5">
          {acoesVisiveis.map((action, index) => {
            const Icon = action.icon
            // Ícones seguem o esquema de cores (accent).
            const ringClass =
              "bg-[rgb(var(--accent-rgb)/0.12)] ring-[rgb(var(--accent-rgb)/0.38)]"
            const iconClass = "text-[rgb(var(--accent-rgb))]"

            return (
              <div
                key={action.to}
                className="fade-up"
                style={{ animationDelay: `${120 + index * 80}ms` }}
              >
                <Link
                  to={action.to}
                  onMouseMove={handleTiltMove}
                  onMouseLeave={handleTiltLeave}
                  className="glass-tile glass-tile-3d group flex min-h-[5.25rem] items-center justify-between gap-4 rounded-2xl px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div
                      className={`icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ${ringClass}`}
                    >
                      <Icon className={`icon-3d-only size-4.5 ${iconClass}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-medium leading-tight text-foreground/95">
                        {action.title}
                      </p>
                      <p className="mt-1 text-sm leading-snug text-foreground/50">
                        {action.description}
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-foreground/38 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
