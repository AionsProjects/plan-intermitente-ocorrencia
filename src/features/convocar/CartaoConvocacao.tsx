import { ArrowRight, Building2, CalendarDays, User } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import type { ConvocacaoPayload } from "./types"

// "Ticket" da convocação — a visualização do que está sendo/foi convocado.
// Usado na REVISÃO (antes de criar) e no SUCESSO (depois de criado).

function dataCurta(iso: string): { dia: string; mes: string; semana: string } {
  try {
    const d = parseISO(iso)
    return {
      dia: format(d, "dd"),
      mes: format(d, "MMM", { locale: ptBR }),
      semana: format(d, "EEEE", { locale: ptBR }),
    }
  } catch {
    return { dia: "—", mes: "", semana: "" }
  }
}

function Badge({ children, ativo }: { children: React.ReactNode; ativo?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
        ativo
          ? "border-[rgb(var(--accent-rgb)/0.4)] bg-[rgb(var(--accent-rgb)/0.1)] text-[rgb(var(--accent-rgb))]"
          : "border-border text-foreground/45"
      }`}
    >
      {children}
    </span>
  )
}

export function CartaoConvocacao({
  payload,
  competencia,
}: {
  payload: ConvocacaoPayload
  competencia?: string | null
}) {
  const ini = dataCurta(payload.dataInicio)
  const fim = dataCurta(payload.dataFim)
  const umDia = payload.dataInicio === payload.dataFim
  const retroativo = payload.papel === "passado"

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--accent-rgb)/0.25)] bg-[rgb(var(--ink)/0.04)] backdrop-blur">
      {/* linha de luz no topo */}
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--accent-rgb)/0.5)] to-transparent" />

      {/* Pessoa */}
      <div className="flex items-center gap-3 px-5 pt-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.38)]">
          <User className="size-4.5 text-[rgb(var(--accent-rgb))]" />
        </div>
        <div className="min-w-0">
          <p className="text-display truncate text-xl leading-tight text-foreground">
            {payload.empregado.nome}
          </p>
          <p className="text-xs text-foreground/50">
            Chapa {payload.empregado.chapa || "—"} · {payload.empregado.funcao || "—"}
          </p>
        </div>
      </div>

      {/* Período — datas grandes, coração do ticket */}
      <div className="mx-5 mt-4 flex items-center justify-center gap-4 rounded-xl border border-border bg-[rgb(var(--ink)/0.03)] px-4 py-3.5">
        <div className="text-center">
          <p className="text-display text-3xl leading-none text-foreground">{ini.dia}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-foreground/50">
            {ini.mes}
          </p>
          <p className="text-[10px] capitalize text-foreground/35">{ini.semana}</p>
        </div>
        {!umDia && (
          <>
            <ArrowRight className="size-4 shrink-0 text-[rgb(var(--accent-rgb)/0.6)]" />
            <div className="text-center">
              <p className="text-display text-3xl leading-none text-foreground">{fim.dia}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-foreground/50">
                {fim.mes}
              </p>
              <p className="text-[10px] capitalize text-foreground/35">{fim.semana}</p>
            </div>
          </>
        )}
        {umDia && (
          <p className="max-w-[9rem] text-xs leading-snug text-foreground/45">
            Convocação de um único dia
          </p>
        )}
      </div>

      {/* Contrato / unidade / escala */}
      <div className="grid gap-x-4 gap-y-2.5 px-5 py-4 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-sm">
          <Building2 className="size-3.5 shrink-0 text-foreground/40" />
          <span className="truncate text-foreground/80">
            {payload.contrato}
            {payload.localUnidade ? ` · ${payload.localUnidade}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <CalendarDays className="size-3.5 shrink-0 text-foreground/40" />
          <span className="truncate text-foreground/80">
            Escala {payload.escala || "—"}
            {competencia ? ` · competência ${competencia}` : ""}
          </span>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-5 py-3.5">
        {retroativo && <Badge ativo>Retroativo</Badge>}
        <Badge ativo={payload.optanteVT === "SIM"}>VT {payload.optanteVT}</Badge>
        <Badge ativo={payload.sabado === "SIM"}>Sábado {payload.sabado}</Badge>
        {payload.insalubridade === "SIM" && <Badge ativo>Insalubridade</Badge>}
        {payload.interior === "SIM" && <Badge ativo>Interior</Badge>}
        <Badge>{payload.justificativa}</Badge>
      </div>
    </div>
  )
}
