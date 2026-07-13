import { Check, Loader2, TriangleAlert } from "lucide-react"

import { ChoiceButton } from "@/features/atestados/ChoiceButton"
import type { EventoMensal, RunStatus } from "./api"

/**
 * Acompanhamento ao vivo do pagamento mensal — reskin Liquid Glass v2.
 * Assinatura: anel de progresso central (serif) + contrato atual em vidro
 * com o trilho das 12 etapas + lamps de status nas linhas concluídas.
 */

// Ordem e rótulos amigáveis das etapas emitidas pelo workflow (12 passos).
export const ETAPAS_ORDEM = [
  "validacao", "caju_pessoas", "caju_credito", "caju_pix",
  "rm_gerar", "rm_aguardar", "rm_integrar",
  "monday_plano", "monday_controle_caju", "monday_solicitacao", "drive", "monday_status_ok",
] as const
const ETAPA_LABEL: Record<string, string> = {
  validacao: "Validando dados",
  caju_pessoas: "Buscando pessoas no Caju",
  caju_credito: "Pedido de crédito Caju",
  caju_pix: "Pedido PIX Caju",
  caju_polling_boleto: "Gerando boleto / QR",
  rm_gerar: "Gerando lançamento RM",
  rm_aguardar: "Aguardando RM processar",
  rm_integrar: "Integrando no RM",
  monday_plano: "Atualizando Plano",
  monday_controle_caju: "Registrando Controle Caju",
  monday_solicitacao: "Criando Solicitação de Pagamento",
  drive: "Arquivando no Drive",
  monday_status_ok: "Marcando AUTOMAÇÃO - OK",
  contrato: "Contrato",
  finalizado: "Finalizado",
}
export const rotuloEtapa = (e: string | null | undefined): string =>
  (e && ETAPA_LABEL[e]) || (e ?? "").replaceAll("_", " ")
export const passoDaEtapa = (e: string | null | undefined): number => {
  const i = ETAPAS_ORDEM.indexOf((e ?? "") as (typeof ETAPAS_ORDEM)[number])
  return i < 0 ? 0 : i + 1
}
export function haQuanto(iso: string | null | undefined, agora: number): string {
  if (!iso) return "—"
  const s = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000))
  if (s < 60) return `há ${s}s`
  const m = Math.floor(s / 60)
  return `há ${m}min ${s % 60}s`
}

function hora(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return ""
  }
}

/** Anel de progresso — assinatura visual do carregamento. */
function AnelProgresso({ pct, erro, done }: { pct: number; erro: boolean; done: boolean }) {
  const R = 56
  const C = 2 * Math.PI * R
  const cor = done ? (erro ? "var(--status-red)" : "var(--status-green)") : "rgb(var(--accent-rgb))"
  return (
    <div className="relative mx-auto size-[148px]">
      <svg viewBox="0 0 148 148" className="size-full -rotate-90">
        <circle cx="74" cy="74" r={R} fill="none" stroke="rgb(var(--ink) / 0.08)" strokeWidth="7" />
        <circle
          cx="74"
          cy="74"
          r={R}
          fill="none"
          stroke={cor}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          style={{
            transition: "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1), stroke 400ms ease",
            filter: `drop-shadow(0 0 10px ${done ? cor : "rgb(var(--accent-rgb) / 0.55)"})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {done ? (
          erro ? (
            <TriangleAlert className="size-8 text-[var(--status-red)]" />
          ) : (
            <Check className="size-8 text-[var(--status-green)]" />
          )
        ) : (
          <>
            <span className="text-display text-4xl leading-none text-foreground">{pct}</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-[0.24em] text-foreground/40">%</span>
          </>
        )}
      </div>
    </div>
  )
}

export function Acompanhamento({
  run,
  fallbackContratos,
  competencia,
  finalizado,
  travado,
  eventos,
  agora,
  demo = false,
  onRetomar,
  onCancelar,
  onConcluir,
  rotuloMes,
}: {
  run: RunStatus | null
  fallbackContratos: { contrato: string; qtd: number }[]
  competencia: string | null
  finalizado: boolean
  travado: boolean
  eventos: EventoMensal[]
  agora: number
  demo?: boolean
  onRetomar: () => Promise<void>
  onCancelar: () => Promise<void>
  onConcluir: () => void
  rotuloMes: (c: string | null | undefined) => string
}) {
  const header = run?.run ?? null
  const itens =
    run && run.itens.length
      ? run.itens
      : fallbackContratos.map((c, i) => ({
          ordem: i + 1,
          contrato: c.contrato,
          qtd: c.qtd,
          status: "pendente" as const,
          etapa_atual: "",
          erro_msg: null as string | null,
          atualizado_em: null as string | null,
        }))
  const total = header?.total_contratos ?? itens.length
  const erroN = itens.filter((i) => i.status === "erro").length
  const feitos = itens.filter((i) => ["ok", "erro", "bloqueado", "cancelado"].includes(i.status)).length
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0

  const atual = itens.find((i) => i.status === "rodando") ?? null
  const concluidos = itens.filter((i) => ["ok", "erro", "bloqueado", "cancelado"].includes(i.status))
  const pendentes = itens.filter((i) => i.status === "pendente")
  const comErro = itens.filter((i) => i.status === "erro")
  const totalPessoas = itens.reduce((n, i) => n + i.qtd, 0)

  return (
    <section className="fade-up mx-auto mt-4 max-w-2xl">
      <div className="glass-panel px-6 py-8 sm:px-9">
        {demo && (
          <div className="mb-5 flex items-center justify-center gap-2 rounded-full bg-[rgb(var(--ink)/0.06)] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-foreground/55 shadow-[inset_0_1px_0_0_rgb(var(--ink)/0.14)]">
            <span className="lamp lamp--yellow" />
            Demonstração visual — nada é enviado
          </div>
        )}

        {/* Cabeçalho + anel */}
        <div className="text-center">
          <p className="eyebrow">
            {finalizado ? "Pagamento mensal" : "Processando pagamento"}
          </p>
          <h2 className="text-display mt-2 text-[32px] leading-tight text-foreground">
            {finalizado ? (
              erroN > 0 ? (
                <>Concluído com <em className="text-[var(--status-red)]">{erroN} erro{erroN > 1 ? "s" : ""}</em></>
              ) : (
                <>Pagamento <em className="text-[var(--status-green)]">concluído</em></>
              )
            ) : (
              <>
                Pagando <em className="capitalize text-[rgb(var(--accent-rgb))]">{rotuloMes(competencia)}</em>
              </>
            )}
          </h2>
          <p className="mt-1.5 text-[13px] text-foreground/50">
            {feitos} de {total} contratos · {totalPessoas} pessoas
            {erroN > 0 && <span className="text-[var(--status-red)]"> · {erroN} com erro</span>}
          </p>
        </div>

        <div className="mt-6">
          <AnelProgresso pct={pct} erro={erroN > 0} done={finalizado} />
        </div>

        {/* Contrato atual — vidro com trilho das 12 etapas */}
        {atual && !finalizado && (
          <div className="glass-tile-v2 mt-7 overflow-hidden rounded-[18px] px-5 py-4">
            <div className="flex items-center gap-3.5">
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.14)] shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.35)]">
                <Loader2 className="size-4.5 animate-spin text-[rgb(var(--accent-rgb))]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="eyebrow !tracking-[0.22em] text-[rgb(var(--accent-rgb))]">Pagando agora</p>
                <p className="text-display mt-0.5 truncate text-xl text-foreground">{atual.contrato}</p>
              </div>
              <span className="shrink-0 text-right font-mono text-sm tabular-nums text-foreground/55">
                {atual.qtd}
                <span className="block text-[9px] uppercase tracking-[0.14em] text-foreground/35">pessoas</span>
              </span>
            </div>

            <div className="mt-3.5 flex gap-1">
              {ETAPAS_ORDEM.map((et, i) => {
                const passo = passoDaEtapa(atual.etapa_atual)
                const estado = i < passo - 1 ? "ok" : i === passo - 1 ? "atual" : "pendente"
                return (
                  <span
                    key={et}
                    className={`h-[5px] flex-1 rounded-full transition-colors duration-300 ${
                      estado === "ok"
                        ? "bg-[rgb(var(--accent-rgb))]"
                        : estado === "atual"
                          ? "animate-pulse bg-[rgb(var(--accent-rgb)/0.75)]"
                          : "bg-[rgb(var(--ink)/0.1)]"
                    }`}
                  />
                )
              })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="truncate text-foreground/70">{rotuloEtapa(atual.etapa_atual)}</span>
              <span className="shrink-0 font-mono text-[10px] text-foreground/35">
                {passoDaEtapa(atual.etapa_atual)}/{ETAPAS_ORDEM.length}
                {"atualizado_em" in atual && atual.atualizado_em
                  ? ` · ${haQuanto(atual.atualizado_em, agora)}`
                  : ""}
              </span>
            </div>
          </div>
        )}

        {/* Concluídos — lamps de status */}
        {concluidos.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {concluidos.map((it) => (
              <div
                key={it.contrato}
                className="fade-up flex items-center gap-3 rounded-[14px] bg-[rgb(var(--ink)/0.035)] px-4 py-2.5 shadow-[inset_0_1px_0_0_rgb(var(--ink)/0.1)]"
              >
                <span className={`lamp ${it.status === "ok" ? "lamp--green" : "lamp--red"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground/90">{it.contrato}</p>
                  {it.status !== "ok" && it.erro_msg && (
                    <p className="truncate text-[11px] text-[var(--status-red)]">{it.erro_msg}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-foreground/40">{it.qtd}</span>
              </div>
            ))}
          </div>
        )}

        {/* Fila — chips fantasma com os nomes */}
        {!finalizado && pendentes.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {pendentes.map((p) => (
              <span
                key={p.contrato}
                className="rounded-full px-3 py-1 text-[11px] text-foreground/35 shadow-[inset_0_0_0_1px_rgb(var(--ink)/0.1)]"
              >
                {p.contrato}
              </span>
            ))}
          </div>
        )}

        {/* Timeline — poço de vidro estilo console */}
        {eventos.length > 0 && (
          <div className="mt-6">
            <p className="eyebrow mb-2.5">Timeline</p>
            <div
              className="max-h-52 space-y-1 overflow-y-auto rounded-[16px] px-4 py-3"
              style={{
                background: "var(--glass-inset)",
                boxShadow: "inset 0 1px 3px rgb(var(--shadow) / 0.3)",
              }}
            >
              {eventos.slice(-30).reverse().map((ev) => (
                <div key={ev.id} className="flex items-baseline gap-2.5 font-mono text-[11px] leading-relaxed">
                  <span className="shrink-0 tabular-nums text-foreground/30">{hora(ev.criado_em)}</span>
                  <span
                    className={`min-w-0 truncate ${
                      ev.estado === "erro" ? "text-[var(--status-red)]" : "text-foreground/65"
                    }`}
                  >
                    {ev.contrato ? `${ev.contrato} · ` : ""}
                    {rotuloEtapa(ev.etapa)}
                    {ev.mensagem ? ` — ${ev.mensagem}` : ""}
                    {ev.tentativa > 1 ? ` (tentativa ${ev.tentativa})` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Guarda: run sem atualização recente */}
        {!finalizado && travado && (
          <div className="mt-5 rounded-[16px] bg-[rgb(var(--status-yellow)/0.08)] px-4 py-3 text-center text-xs text-[var(--status-yellow)] shadow-[inset_0_0_0_1px_rgb(228_189_67/0.3)]">
            <span className="lamp lamp--yellow mr-2 align-middle" />
            Sem atualização há quatro minutos. Consulte a timeline e retome somente os contratos
            interrompidos; o ledger é verificado antes de qualquer efeito.
          </div>
        )}
        {!finalizado && travado && (
          <div className="mt-4 flex justify-center gap-3">
            <ChoiceButton onClick={onCancelar}>Encerrar</ChoiceButton>
            <ChoiceButton variant="primary" onClick={onRetomar}>Retomar</ChoiceButton>
          </div>
        )}

        {/* Interromper — discreto, embaixo */}
        {!finalizado && !travado && (
          <div className="mt-6 text-center">
            <button
              onClick={onCancelar}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-[var(--status-red)] shadow-[inset_0_0_0_1px_rgb(239_102_102/0.35)] transition hover:bg-[rgb(239_102_102/0.1)]"
            >
              Interromper execução
            </button>
            <p className="mt-1.5 text-[10px] text-foreground/35">
              O contrato em andamento termina; os seguintes não iniciam.
            </p>
          </div>
        )}

        {finalizado && comErro.length > 0 && (
          <p className="mt-5 rounded-[16px] bg-[rgb(var(--status-red)/0.08)] px-4 py-3 text-xs text-[var(--status-red)] shadow-[inset_0_0_0_1px_rgb(239_102_102/0.3)]">
            {comErro.length} contrato(s) com erro. A retomada reconsulta o ledger e processa apenas
            contratos falhos ou interrompidos.
          </p>
        )}

        {finalizado && (
          <div className="mt-7 flex justify-center gap-3">
            {comErro.length > 0 && (
              <button
                onClick={onRetomar}
                className="pill-soft px-6 py-3 text-sm font-medium"
              >
                Retomar falhos
              </button>
            )}
            <button onClick={onConcluir} className="glass-cta px-8">
              Concluir
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
