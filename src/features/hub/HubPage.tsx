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

const actions = [
  {
    to: "/convocar",
    title: "Nova convocação",
    description: "Cadastrar uma convocação pontual no monday.",
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
    description: "Aplicar VR/VT por contrato em um dia do mês atual.",
    icon: CalendarDays,
    tone: "emerald",
  },
  {
    to: "/corrigir",
    title: "Atualizar ocorrência",
    description: "Reabrir um registro pelo código de protocolo.",
    icon: KeyRound,
    tone: "gold",
  },
] as const

export function HubPage() {
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
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/35 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-white/55">
              <ClipboardCheck className="size-3 text-[#d8aa53]" />
              Plano de intermitentes
            </div>
            <p className="mt-5 text-[11px] uppercase tracking-[0.28em] text-white/40">
              Aionscorp
            </p>
            <h1 className="text-display mt-2 text-4xl leading-[1.02] text-white sm:text-5xl">
              Escolha o próximo passo
            </h1>
          </div>
        </header>

        <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/58 sm:text-[15px]">
          Acesse o fluxo de convocação ou ajuste uma ocorrência já registrada.
          Os testes ficam separados para validação sem atrapalhar a operação.
        </p>

        <div className="mt-8 grid gap-3 sm:gap-3.5">
          {actions.map((action, index) => {
            const Icon = action.icon
            const tone = action.tone
            const ringClass =
              tone === "gold"
                ? "bg-[#d8aa53]/10 ring-[#d8aa53]/35"
                : tone === "amber"
                  ? "bg-[#e8c275]/10 ring-[#e8c275]/40"
                  : tone === "emerald"
                    ? "bg-emerald-300/10 ring-emerald-300/35"
                    : "bg-[#6f9cff]/10 ring-[#6f9cff]/35"
            const iconClass =
              tone === "gold"
                ? "text-[#d8aa53]"
                : tone === "amber"
                  ? "text-[#e8c275]"
                  : tone === "emerald"
                    ? "text-emerald-200"
                    : "text-[#7fb3ff]"

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
                  className="glass-tile glass-tile-3d group flex min-h-[5.25rem] items-center justify-between gap-4 rounded-2xl px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div
                      className={`icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ${ringClass}`}
                    >
                      <Icon className={`icon-3d-only size-4.5 ${iconClass}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-medium leading-tight text-white/95">
                        {action.title}
                      </p>
                      <p className="mt-1 text-sm leading-snug text-white/50">
                        {action.description}
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-white/38 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
                </Link>
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-5 text-xs leading-relaxed text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>Use a área de teste apenas para validar cenários mockados.</span>
          <Link
            to="/teste"
            className="inline-flex w-fit items-center gap-1.5 text-white/52 transition hover:text-[#d8aa53] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d8aa53]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            Abrir testes
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </section>
    </main>
  )
}
