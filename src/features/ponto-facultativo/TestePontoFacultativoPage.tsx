import { Link } from "react-router-dom"
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  FlaskConical,
  UserX,
  Users,
  WalletCards,
} from "lucide-react"

import { NavCluster } from "@/components/NavCluster"

/**
 * Área de testes do fluxo Ponto Facultativo.
 *
 * Cada tile aponta para `/ponto-facultativo?seed=<id>` e a página principal
 * lê o seed via `useSearchParams` (ver `aplicarSeed` em PontoFacultativoPage)
 * pra pré-popular o estado interno e renderizar a etapa correspondente.
 */

const seeds = [
  {
    id: "",
    titulo: "Início (escolha contrato)",
    desc: "Estado padrão — grid de contratos com SEDUC agrupado.",
    icone: CalendarDays,
    tone: "emerald",
  },
  {
    id: "data",
    titulo: "Selecionar dia",
    desc: "Contrato SEMSA pré-selecionado, calendário do mês atual.",
    icone: CalendarDays,
    tone: "emerald",
  },
  {
    id: "beneficios",
    titulo: "Benefícios VR/VT",
    desc: "SEDUC SEDE · dia 05 com VR já selecionado.",
    icone: WalletCards,
    tone: "amber",
  },
  {
    id: "confirmar-cheio",
    titulo: "Prévia com 3 intermitentes",
    desc: "Lista cheia, totais > 0, badges VR/VT aplicados.",
    icone: Users,
    tone: "sky",
  },
  {
    id: "confirmar-vazio",
    titulo: "Prévia vazia",
    desc: "Nenhum intermitente ativo — estado vazio centralizado.",
    icone: UserX,
    tone: "rose",
  },
  {
    id: "sucesso",
    titulo: "Aplicado com sucesso",
    desc: "Tela final com totais consolidados + CTA voltar.",
    icone: CheckCircle2,
    tone: "emerald",
  },
] as const

type Tone = (typeof seeds)[number]["tone"]

function ringClasses(tone: Tone): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-300/10 ring-emerald-300/35"
    case "amber":
      return "bg-amber-300/10 ring-amber-300/35"
    case "sky":
      return "bg-sky-300/10 ring-sky-300/35"
    case "rose":
      return "bg-rose-300/10 ring-rose-300/35"
  }
}

function iconColor(tone: Tone): string {
  switch (tone) {
    case "emerald":
      return "text-emerald-200"
    case "amber":
      return "text-amber-200"
    case "sky":
      return "text-sky-200"
    case "rose":
      return "text-rose-200"
  }
}

export function TestePontoFacultativoPage() {
  const usandoMock = !import.meta.env.VITE_N8N_BASE_URL

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong card-shimmer relative w-full max-w-xl p-10">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-emerald-200">
            <FlaskConical className="size-3" />
            Mocks · ponto facultativo
          </div>
          <NavCluster homeTo="/teste" voltarLabel="Voltar pra área de teste" />
        </div>

        <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
          Aionscorp · plano de intermitentes
        </p>
        <h1 className="text-display mt-3 text-5xl leading-[1.05] text-white">
          Estados do{" "}
          <em className="italic text-emerald-200">ponto facultativo</em>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/65">
          Cada tile abre a tela com o seed correspondente já aplicado.
          Nenhum item é enviado ao backend — preview e aplicar usam mock.
        </p>

        <div className="mt-6 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur">
          <span
            className={`size-1.5 rounded-full ${
              usandoMock
                ? "bg-emerald-300 shadow-[0_0_10px_2px_rgba(127,231,196,0.6)]"
                : "bg-amber-300 shadow-[0_0_10px_2px_rgba(232,194,117,0.55)]"
            }`}
          />
          {usandoMock ? (
            <>modo mock ativo</>
          ) : (
            <>n8n real conectado · seeds continuam usando mockPreview local</>
          )}
        </div>

        <div className="mt-8 grid gap-2.5">
          {seeds.map((s, i) => {
            const Icon = s.icone
            const to = s.id ? `/ponto-facultativo?seed=${s.id}` : "/ponto-facultativo"
            return (
              <Link
                key={s.id || "inicio"}
                to={to}
                className="glass-tile group flex items-center justify-between gap-4 rounded-2xl px-5 py-4 fade-up"
                style={{ animationDelay: `${100 + i * 60}ms` }}
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ${ringClasses(s.tone)}`}
                  >
                    <Icon className={`size-4 ${iconColor(s.tone)}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-white/95">
                      {s.titulo}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/55">
                      {s.desc}
                    </p>
                  </div>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
