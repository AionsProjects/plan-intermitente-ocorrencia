import { useEffect, useState } from "react"
import type { MouseEvent } from "react"
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
import { useZoom } from "@/components/ZoomTransition"
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

function tiltMove(e: MouseEvent<HTMLButtonElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", String(((e.clientX - r.left) / r.width) * 100))
  e.currentTarget.style.setProperty("--my", String(((e.clientY - r.top) / r.height) * 100))
}
function tiltLeave(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.setProperty("--mx", "50")
  e.currentTarget.style.setProperty("--my", "50")
}

export function HubPage() {
  const { usuario, podeVer } = useAuth()
  const { zoomTo } = useZoom()
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

      <section className="glass-panel w-full max-w-[780px] px-5 py-6 sm:px-8 sm:py-8 lg:p-10">
        <header className="fade-up flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Aionscorp · Plano de intermitentes</p>
            <h1 className="text-display mt-3 text-4xl leading-[1.03] text-foreground sm:text-[42px]">
              {saudacao()}
              {primeiroNome ? (
                <>
                  ,{" "}
                  <em className="capitalize text-[rgb(var(--accent-rgb))]">
                    {primeiroNome.toLowerCase()}
                  </em>
                </>
              ) : null}
              .
            </h1>
            <p className="mt-2 text-[13px] text-foreground/48">
              <span className="capitalize">{hoje}</span>
              <span className="mx-1.5 text-foreground/24">·</span>
              <span className="font-mono tabular-nums text-[rgb(var(--accent-rgb)/0.9)]">{agora}</span>
            </p>
          </div>
          {usuario && (
            <span className="mt-1 shrink-0 whitespace-nowrap rounded-full bg-[rgb(var(--ink)/0.09)] px-3.5 py-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-foreground/82 shadow-[inset_0_1px_0_0_rgb(var(--ink)/0.22)]">
              {PAPEL_LABEL[usuario.papel] ?? usuario.papel}
            </span>
          )}
        </header>

        <div className="mt-7 grid gap-3 sm:grid-cols-5 sm:gap-[13px]">
          {/* HERO — ação principal com halo do acento */}
          {hero && (
            <div className="fade-up sm:col-span-2" style={{ animationDelay: "120ms" }}>
              <button
                type="button"
                onClick={(e) => zoomTo(e, hero.title, hero.to)}
                onMouseMove={tiltMove}
                onMouseLeave={tiltLeave}
                className="glass-hero tilt-3d group relative flex h-full min-h-[13.2rem] w-full cursor-pointer flex-col justify-between overflow-hidden p-6 text-left transition-transform duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
              >
                {/* halo interno do acento */}
                <div className="pointer-events-none absolute -right-10 -top-10 size-[170px] rounded-full bg-[rgb(var(--accent-rgb)/0.16)] blur-[44px]" />
                <div className="icon-orb size-[52px]">
                  <HeroIcon className="size-[21px]" />
                </div>
                <div className="relative">
                  <p className="text-display text-[23px] leading-tight text-foreground">
                    {hero.title}
                  </p>
                  <p className="mt-1.5 text-xs leading-[1.45] text-foreground/58">
                    {hero.description}
                  </p>
                  <span className="glass-cta glass-cta--mini mt-3.5">
                    Começar
                    <ArrowUpRight className="size-3 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            </div>
          )}

          {/* Demais ações — tiles compactos, 2 por linha */}
          <div className="grid gap-3 sm:col-span-3 sm:grid-cols-2 sm:gap-[13px]">
            {resto.map((action, index) => {
              const Icon = action.icon
              return (
                <div
                  key={action.to}
                  className="fade-up"
                  style={{ animationDelay: `${200 + index * 80}ms` }}
                >
                  <button
                    type="button"
                    onClick={(e) => zoomTo(e, action.title, action.to)}
                    onMouseMove={tiltMove}
                    onMouseLeave={tiltLeave}
                    className="glass-tile-v2 tilt-3d group relative flex h-full min-h-[6.4rem] w-full cursor-pointer flex-col gap-2.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink)/0.7)]"
                  >
                    <div className="flex w-full items-center justify-between">
                      <div className="icon-orb icon-orb--neutral size-[34px]">
                        <Icon className="size-[15px] text-[rgb(var(--accent-rgb))]" />
                      </div>
                      <ArrowUpRight className="size-3.5 text-foreground/30 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground/80" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium leading-tight text-foreground/93">
                        {action.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.4] text-foreground/48">
                        {action.description}
                      </p>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <footer
          className="fade-up mt-[26px] flex items-center gap-3 text-[9px] uppercase tracking-[0.24em] text-foreground/30"
          style={{ animationDelay: "520ms" }}
        >
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[rgb(var(--ink)/0.18)] to-transparent" />
          Console de operação
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[rgb(var(--ink)/0.18)] to-transparent" />
        </footer>
      </section>
    </main>
  )
}
