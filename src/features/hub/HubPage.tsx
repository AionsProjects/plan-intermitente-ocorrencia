import { useEffect, useState } from "react"
import type { MouseEvent } from "react"
import { Link } from "react-router-dom"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
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
  nivelMinimo?: Papel
}[] = [
  {
    to: "/convocar",
    title: "Nova convocação",
    description: "Cadastrar uma nova convocação pontual de intermitente.",
    icon: UserPlus,
  },
  {
    to: "/atestados",
    title: "Atestados",
    description: "Atestado médico ou declaração de comparecimento.",
    icon: FileText,
  },
  {
    to: "/corrigir",
    title: "Atualizar ocorrência",
    description: "Reabrir um registro pelo protocolo.",
    icon: KeyRound,
  },
  {
    to: "/ponto-facultativo",
    title: "Ponto facultativo",
    description: "VR/VT para um contrato em um dia específico.",
    icon: CalendarDays,
    nivelMinimo: "dp",
  },
  {
    to: "/mensal",
    title: "Pagamento mensal",
    description: "Fechamento do grupo MENSAL (Caju + RM).",
    icon: Banknote,
    nivelMinimo: "dp",
  },
]

const PAPEL_LABEL: Record<string, string> = {
  admin: "Administração",
  dp: "Departamento pessoal",
  rh: "Recursos humanos",
  operacional: "Operacional",
}

function saudacao(): string {
  const h = new Date().getHours()
  if (h < 5) return "Boa madrugada"
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

function tiltMove(e: MouseEvent<HTMLAnchorElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", String(((e.clientX - r.left) / r.width) * 100))
  e.currentTarget.style.setProperty("--my", String(((e.clientY - r.top) / r.height) * 100))
}
function tiltLeave(e: MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.setProperty("--mx", "50")
  e.currentTarget.style.setProperty("--my", "50")
}

export function HubPage() {
  const { usuario, podeVer } = useAuth()
  const acoesVisiveis = actions.filter((a) => !a.nivelMinimo || podeVer(a.nivelMinimo))
  const [hero, ...resto] = acoesVisiveis
  const HeroIcon = hero?.icon ?? UserPlus

  const primeiroNome = (usuario?.nome ?? "").split(" ")[0]
  const hoje = format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })
  // Relógio vivo — console, não página estática.
  const [agora, setAgora] = useState(() => format(new Date(), "HH:mm"))
  useEffect(() => {
    const t = setInterval(() => setAgora(format(new Date(), "HH:mm")), 15_000)
    return () => clearInterval(t)
  }, [])

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">

      <section className="glass-strong relative w-full max-w-3xl overflow-hidden rounded-3xl px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--ink)/0.3)] to-transparent" />
        {/* reflexo diagonal sutil */}
        <div className="pointer-events-none absolute -left-24 -top-40 h-80 w-[36rem] rotate-[18deg] bg-gradient-to-b from-[rgb(var(--ink)/0.05)] to-transparent" />

        <header className="fade-up flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.32em] text-foreground/40">
              Aionscorp · Plano de intermitentes
            </p>
            <h1 className="text-display mt-3 text-4xl leading-[1.04] text-foreground sm:text-5xl">
              {saudacao()}
              {primeiroNome ? (
                <>
                  ,{" "}
                  <span className="capitalize text-[rgb(var(--accent-rgb))]">
                    {primeiroNome.toLowerCase()}
                  </span>
                </>
              ) : null}
              .
            </h1>
            <p className="mt-2 text-sm text-foreground/50">
              <span className="capitalize">{hoje}</span>
              <span className="mx-2 text-foreground/25">·</span>
              <span className="font-mono tabular-nums text-[rgb(var(--accent-rgb)/0.85)]">{agora}</span>
            </p>
          </div>
          {usuario && (
            <span className="mt-1 shrink-0 rounded-full border border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.08)] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--accent-rgb))]">
              {PAPEL_LABEL[usuario.papel] ?? usuario.papel}
            </span>
          )}
        </header>

        <div className="mt-8 grid gap-3 sm:grid-cols-5 sm:gap-3.5">
          {/* HERO — ação principal, dobro de presença */}
          {hero && (
            <div className="fade-up sm:col-span-2" style={{ animationDelay: "120ms" }}>
              <Link
                to={hero.to}
                onMouseMove={tiltMove}
                onMouseLeave={tiltLeave}
                className="glass-tile glass-tile-3d group relative flex h-full min-h-[13rem] flex-col justify-between overflow-hidden rounded-2xl border-[rgb(var(--accent-rgb)/0.28)] px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
              >
                <span aria-hidden className="hub-shine pointer-events-none absolute inset-0" />
                {/* brilho accent interno do hero */}
                <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[rgb(var(--accent-rgb)/0.14)] blur-3xl" />
                <span
                  aria-hidden
                  className="text-display pointer-events-none absolute -bottom-5 right-2 text-[6.5rem] leading-none text-[rgb(var(--ink)/0.05)]"
                >
                  01
                </span>
                <div className="icon-3d-host flex size-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent-rgb)/0.14)] ring-1 ring-[rgb(var(--accent-rgb)/0.42)]">
                  <HeroIcon className="icon-3d-only size-6 text-[rgb(var(--accent-rgb))]" />
                </div>
                <div className="relative">
                  <p className="text-display text-2xl leading-tight text-foreground">
                    {hero.title}
                  </p>
                  <p className="mt-1.5 text-sm leading-snug text-foreground/55">
                    {hero.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.16em] text-[rgb(var(--accent-rgb))]">
                    Começar
                    <ArrowUpRight className="size-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </div>
          )}

          {/* Demais ações — compactas, 2 por linha */}
          <div className="grid gap-3 sm:col-span-3 sm:grid-cols-2 sm:gap-3.5">
            {resto.map((action, index) => {
              const Icon = action.icon
              return (
                <div
                  key={action.to}
                  className="fade-up"
                  style={{ animationDelay: `${200 + index * 80}ms` }}
                >
                  <Link
                    to={action.to}
                    onMouseMove={tiltMove}
                    onMouseLeave={tiltLeave}
                    className="glass-tile glass-tile-3d group relative flex h-full min-h-[6.1rem] flex-col justify-between overflow-hidden rounded-2xl px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
                  >
                    <span
                      aria-hidden
                      className="text-display pointer-events-none absolute -bottom-3.5 right-1.5 text-[3.4rem] leading-none text-[rgb(var(--ink)/0.045)]"
                    >
                      {String(index + 2).padStart(2, "0")}
                    </span>
                    <div className="flex items-center justify-between">
                      <div className="icon-3d-host flex size-9 items-center justify-center rounded-xl bg-[rgb(var(--accent-rgb)/0.1)] ring-1 ring-[rgb(var(--accent-rgb)/0.32)]">
                        <Icon className="icon-3d-only size-4 text-[rgb(var(--accent-rgb))]" />
                      </div>
                      <ArrowUpRight className="size-3.5 text-foreground/30 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground/80" />
                    </div>
                    <div className="relative mt-2 min-w-0">
                      <p className="truncate text-[15px] font-medium leading-tight text-foreground/95">
                        {action.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground/48">
                        {action.description}
                      </p>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>

        <footer
          className="fade-up mt-7 flex items-center gap-3 text-[10px] uppercase tracking-[0.24em] text-foreground/30"
          style={{ animationDelay: "520ms" }}
        >
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[rgb(var(--ink)/0.14)] to-transparent" />
          Console de operação
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[rgb(var(--ink)/0.14)] to-transparent" />
        </footer>
      </section>
    </main>
  )
}
