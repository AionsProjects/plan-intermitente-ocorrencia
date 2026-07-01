import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import { ArrowLeft, Banknote, CalendarDays, Check, Loader2, TriangleAlert } from "lucide-react"

import { ChoiceButton } from "@/features/atestados/ChoiceButton"
import {
  buscarMeses,
  buscarPessoas,
  buscarRunStatus,
  dispararPagamentoMensal,
  type Papel,
  type PessoasResp,
  type RunStatus,
} from "./api"

type Etapa = "mes" | "tabela" | "confirma" | "acompanhando" | "ok"

function rotuloMes(comp: string | null | undefined): string {
  if (!comp) return "—"
  try {
    return format(parseISO(`${comp}-01`), "MMMM 'de' yyyy", { locale: ptBR })
  } catch {
    return comp
  }
}

export function MensalPage() {
  const nav = useNavigate()
  const [etapa, setEtapa] = useState<Etapa>("mes")
  const [papel, setPapel] = useState<Papel>("atual")
  const [erroDisparo, setErroDisparo] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  const meses = useQuery({ queryKey: ["mensal-meses"], queryFn: buscarMeses })
  const pessoas = useQuery<PessoasResp>({
    queryKey: ["mensal-pessoas", papel],
    queryFn: () => buscarPessoas(papel),
    enabled: etapa === "tabela" || etapa === "confirma",
  })

  // Polling do progresso ao vivo enquanto acompanha. Para quando o run finaliza.
  const run = useQuery<RunStatus>({
    queryKey: ["mensal-run", runId],
    queryFn: () => buscarRunStatus(runId!),
    enabled: etapa === "acompanhando" && !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.run?.status
      return s === "concluido" || s === "concluido_com_erro" || s === "falhou" ? false : 2000
    },
  })
  const runData = run.data?.run ?? null
  const finalizado =
    runData?.status === "concluido" ||
    runData?.status === "concluido_com_erro" ||
    runData?.status === "falhou"
  // Guarda contra run travado: rodando mas sem atualizar há >4min (n8n pode ter caído).
  const travado =
    !!runData &&
    (runData.status === "rodando" || runData.status === "preparando") &&
    Date.now() - new Date(runData.atualizado_em).getTime() > 4 * 60 * 1000

  function escolher(p: Papel) {
    setPapel(p)
    setEtapa("tabela")
  }

  async function pagar() {
    const id = crypto.randomUUID()
    setRunId(id)
    setEtapa("acompanhando")
    setErroDisparo(null)
    try {
      await dispararPagamentoMensal(papel, pessoas.data?.competencia ?? null, id)
    } catch (e) {
      setErroDisparo(e instanceof Error ? e.message : "Falha ao disparar")
      setEtapa("confirma")
    }
  }

  return (
    <main className="relative z-10 mx-auto min-h-svh w-full max-w-[1600px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-foreground/45">
        <Banknote className="size-3.5 text-[rgb(var(--accent-rgb))]" />
        Pagamento mensal intermitente
      </div>

      {/* ETAPA: ESCOLHER MÊS */}
      {etapa === "mes" && (
        <section className="fade-up">
          <button
            onClick={() => nav("/")}
            className="mb-5 inline-flex items-center gap-1.5 text-xs text-foreground/55 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Voltar ao início
          </button>
          <h1 className="text-display text-3xl text-foreground sm:text-4xl">Qual mês pagar?</h1>
          <p className="mt-2 text-sm text-foreground/55">
            Escolha a competência. Só aparecem os meses disponíveis no sistema.
          </p>

          {meses.isLoading && (
            <div className="mt-8 flex items-center gap-2 text-sm text-foreground/55">
              <Loader2 className="size-4 animate-spin" /> Carregando meses…
            </div>
          )}
          {meses.isError && (
            <p className="mt-8 text-sm text-[rgb(var(--status-red))]">Erro ao carregar meses.</p>
          )}

          <div className="mt-7 grid max-w-3xl gap-3 sm:grid-cols-2">
            {meses.data?.atual.existe && (
              <MesCard
                titulo="Mês atual"
                competencia={meses.data.atual.competencia}
                onClick={() => escolher("atual")}
              />
            )}
            {meses.data?.proximo.existe && (
              <MesCard
                titulo="Próximo mês"
                competencia={meses.data.proximo.competencia}
                onClick={() => escolher("proximo")}
              />
            )}
            {meses.data && !meses.data.atual.existe && !meses.data.proximo.existe && (
              <p className="text-sm text-foreground/55">
                Nenhum mês disponível. Verifique o registro de boards.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ETAPA: TABELA (conferência) */}
      {etapa === "tabela" && (
        <section className="fade-up">
          <button
            onClick={() => setEtapa("mes")}
            className="mb-4 inline-flex items-center gap-1.5 text-xs text-foreground/55 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Trocar mês
          </button>
          <h1 className="text-display text-3xl text-foreground">Conferir pessoas do grupo MENSAL</h1>
          <p className="mt-2 text-sm text-foreground/55">
            Réplica do board · grupo <b>MENSAL</b> · competência{" "}
            <b className="capitalize">{rotuloMes(pessoas.data?.competencia)}</b>. Confira antes de pagar.
          </p>

          {pessoas.isLoading && (
            <div className="mt-8 flex items-center gap-2 text-sm text-foreground/55">
              <Loader2 className="size-4 animate-spin" /> Carregando pessoas do board…
            </div>
          )}
          {pessoas.isError && (
            <p className="mt-8 text-sm text-[rgb(var(--status-red))]">
              Erro ao carregar pessoas: {(pessoas.error as Error)?.message}
            </p>
          )}

          {pessoas.data && (
            <>
              <div className="mt-5 rounded-2xl border border-border bg-card/40 px-5 py-4">
                <div className="flex flex-wrap items-center gap-5">
                  <Stat k="Pessoas" v={String(pessoas.data.total)} />
                  <Stat k="Contratos" v={String(pessoas.data.porContrato.length)} />
                  <p className="text-[11px] text-foreground/45">
                    Os valores (VR/VT, crédito, PIX) são calculados pela automação no momento do
                    pagamento.
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {pessoas.data.porContrato.map((c) => (
                    <span
                      key={c.contrato}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-[#13131b] px-3 py-1 text-[12px]"
                    >
                      <span className="text-foreground/85">{c.contrato}</span>
                      <span className="rounded-full bg-[rgb(var(--accent-rgb)/0.15)] px-1.5 font-mono text-[11px] text-[rgb(var(--accent-rgb))]">
                        {c.qtd}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <div className="max-h-[60vh] overflow-auto overscroll-contain rounded-2xl border border-border">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-[#13131b] text-foreground [&_th]:bg-[#13131b] [&_th]:shadow-[0_8px_14px_-6px_rgba(0,0,0,0.9)]">
                        <Th>#</Th>
                        <Th>Nome</Th>
                        <Th>Chapa</Th>
                        <Th>Contrato</Th>
                        <Th>Unidade</Th>
                        <Th center>Benefício</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {pessoas.data.pessoas.map((p, i) => (
                        <tr key={p.chapa + i} className="border-t border-border/70 hover:bg-white/[0.025]">
                          <Td className="text-center text-foreground/40">{i + 1}</Td>
                          <Td className="font-medium text-foreground/95 whitespace-nowrap">{p.nome}</Td>
                          <Td className="font-mono">{p.chapa}</Td>
                          <Td>{p.contrato}</Td>
                          <Td className="max-w-[180px] truncate text-foreground/50">{p.unidade}</Td>
                          <Td className="text-center">
                            {p.interior === "SIM" ? (
                              <span className="rounded-full border border-[rgb(var(--accent-rgb)/0.4)] bg-[rgb(var(--accent-rgb)/0.1)] px-2 py-0.5 text-[10px] text-[rgb(var(--accent-rgb))]">
                                Mobilidade
                              </span>
                            ) : (
                              <span className="rounded-full border border-[rgb(var(--surface-rgb)/0.4)] bg-[rgb(var(--surface-rgb)/0.1)] px-2 py-0.5 text-[10px] text-[rgb(var(--surface-rgb))]">
                                VT
                              </span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <ChoiceButton onClick={() => setEtapa("mes")}>
                  Cancelar
                </ChoiceButton>
                <ChoiceButton variant="primary" disabled={pessoas.data.total === 0} onClick={() => setEtapa("confirma")}>
                  Tudo certo, prosseguir →
                </ChoiceButton>
              </div>
            </>
          )}
        </section>
      )}

      {/* ETAPA: CONFIRMAÇÃO */}
      {etapa === "confirma" && pessoas.data && (
        <section className="fade-up mx-auto mt-6 max-w-xl">
          <div className="glass-strong rounded-3xl px-8 py-9 text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">Confirmar pagamento</p>
            <h2 className="text-display mt-2 text-3xl text-foreground">
              Pagar{" "}
              <span className="text-[rgb(var(--accent-rgb))]">{pessoas.data.total} pessoas</span>
              <br />
              do mês <span className="capitalize">{rotuloMes(pessoas.data.competencia)}</span>?
            </h2>
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-[rgb(var(--accent-rgb)/0.34)] bg-[rgb(var(--accent-rgb)/0.1)] px-4 py-3 text-left text-[13px] text-[rgb(var(--accent-rgb))]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              Inicia o pagamento real (Caju + lançamento no RM) das {pessoas.data.total} pessoas do grupo
              MENSAL. Não dá pra desfazer pelo app.
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat box k="Pessoas" v={String(pessoas.data.total)} />
              <Stat box k="Contratos" v={String(pessoas.data.porContrato.length)} />
            </div>
            {erroDisparo && (
              <p className="mt-4 text-sm text-[rgb(var(--status-red))]">{erroDisparo}</p>
            )}
            <div className="mt-7 flex justify-center gap-3">
              <ChoiceButton onClick={() => setEtapa("tabela")}>← Revisar</ChoiceButton>
              <ChoiceButton variant="primary" onClick={pagar}>
                Confirmar e pagar
              </ChoiceButton>
            </div>
          </div>
        </section>
      )}

      {/* ETAPA: ACOMPANHAMENTO AO VIVO */}
      {etapa === "acompanhando" && (
        <Acompanhamento
          run={run.data ?? null}
          fallbackContratos={pessoas.data?.porContrato ?? []}
          competencia={pessoas.data?.competencia ?? runData?.competencia ?? null}
          finalizado={finalizado}
          travado={travado}
          onConcluir={() => nav("/")}
          rotuloMes={rotuloMes}
        />
      )}
    </main>
  )
}

function Acompanhamento({
  run,
  fallbackContratos,
  competencia,
  finalizado,
  travado,
  onConcluir,
  rotuloMes,
}: {
  run: RunStatus | null
  fallbackContratos: { contrato: string; qtd: number }[]
  competencia: string | null
  finalizado: boolean
  travado: boolean
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
          erro_msg: null,
        }))
  const total = header?.total_contratos ?? itens.length
  const okN = header?.ok_contratos ?? 0
  const erroN = header?.erro_contratos ?? 0
  const feitos = okN + erroN
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0

  // Revela contrato-a-contrato: só o atual (rodando) e os já concluídos aparecem; o resto vira contador.
  const atual = itens.find((i) => i.status === "rodando") ?? null
  const concluidos = itens.filter((i) => i.status === "ok" || i.status === "erro")
  const pendentesN = itens.filter((i) => i.status === "pendente").length
  const comErro = itens.filter((i) => i.status === "erro")

  return (
    <section className="fade-up mx-auto mt-6 max-w-xl">
      <div className="glass-strong rounded-3xl px-7 py-8">
        {/* Cabeçalho */}
        {!finalizado ? (
          <div className="text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">
              Processando pagamento
            </p>
            <h2 className="text-display mt-2 text-2xl text-foreground">
              Mês <span className="capitalize">{rotuloMes(competencia)}</span>
            </h2>
          </div>
        ) : (
          <div className="text-center">
            <div
              className={`mx-auto flex size-14 items-center justify-center rounded-full border ${
                erroN > 0
                  ? "border-[rgb(var(--status-red)/0.5)] bg-[rgb(var(--status-red)/0.14)] text-[rgb(var(--status-red))]"
                  : "border-[rgb(var(--status-green)/0.5)] bg-[rgb(var(--status-green)/0.14)] text-[rgb(var(--status-green))]"
              }`}
            >
              {erroN > 0 ? <TriangleAlert className="size-6" /> : <Check className="size-6" />}
            </div>
            <h2 className="text-display mt-4 text-2xl text-foreground">
              {erroN > 0 ? `Concluído com ${erroN} erro(s)` : "Pagamento concluído"}
            </h2>
            <p className="mt-1 text-sm text-foreground/55">
              {okN} de {total} contrato(s) pago(s) —{" "}
              <span className="capitalize">{rotuloMes(competencia)}</span>.
            </p>
          </div>
        )}

        {/* Barra de progresso */}
        <div className="mt-6">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-foreground/55">
            <span>
              {feitos} de {total} contratos
              {erroN > 0 && (
                <span className="text-[rgb(var(--status-red))]"> · {erroN} com erro</span>
              )}
            </span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                finalizado && erroN > 0
                  ? "bg-[rgb(var(--status-red))]"
                  : finalizado
                    ? "bg-[rgb(var(--status-green))]"
                    : "bg-[rgb(var(--accent-rgb))]"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Contrato atual em destaque */}
        {atual && !finalizado && (
          <div className="fade-up mt-5 flex items-center gap-3 rounded-2xl border border-[rgb(var(--accent-rgb)/0.4)] bg-[rgb(var(--accent-rgb)/0.08)] px-5 py-4">
            <Loader2 className="size-5 shrink-0 animate-spin text-[rgb(var(--accent-rgb))]" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--accent-rgb))]">
                Pagando agora
              </p>
              <p className="truncate text-lg font-semibold text-foreground">{atual.contrato}</p>
            </div>
            <span className="shrink-0 font-mono text-sm text-foreground/55">
              {atual.qtd} <span className="text-[10px]">pessoas</span>
            </span>
          </div>
        )}

        {/* Concluídos — aparecem conforme terminam */}
        {concluidos.length > 0 && (
          <div className="mt-4 space-y-2">
            {concluidos.map((it) => (
              <div
                key={it.contrato}
                className="fade-up flex items-center gap-3 rounded-xl border border-border bg-card/40 px-4 py-2.5"
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {it.status === "ok" ? (
                    <Check className="size-4 text-[rgb(var(--status-green))]" />
                  ) : (
                    <TriangleAlert className="size-4 text-[rgb(var(--status-red))]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground/90">{it.contrato}</p>
                  {it.status === "erro" && it.erro_msg && (
                    <p className="truncate text-xs text-[rgb(var(--status-red))]">{it.erro_msg}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-xs text-foreground/40">{it.qtd}</span>
              </div>
            ))}
          </div>
        )}

        {/* Pendentes — contador discreto */}
        {!finalizado && !travado && pendentesN > 0 && (
          <p className="mt-4 text-center text-xs text-foreground/40">
            {pendentesN} contrato(s) aguardando…
          </p>
        )}

        {/* Guarda: run travado (n8n pode ter caído) */}
        {!finalizado && travado && (
          <div className="mt-5 rounded-xl border border-[rgb(var(--accent-rgb)/0.34)] bg-[rgb(var(--accent-rgb)/0.08)] px-4 py-3 text-center text-xs text-[rgb(var(--accent-rgb))]">
            <TriangleAlert className="mx-auto mb-1 size-4" />
            Sem atualização há alguns minutos — o processo pode ter travado. Verifique o board/n8n
            antes de re-disparar.
          </div>
        )}
        {!finalizado && travado && (
          <div className="mt-4 flex justify-center">
            <ChoiceButton onClick={onConcluir}>Sair</ChoiceButton>
          </div>
        )}

        {finalizado && comErro.length > 0 && (
          <p className="mt-5 rounded-xl border border-[rgb(var(--status-red)/0.3)] bg-[rgb(var(--status-red)/0.08)] px-4 py-3 text-xs text-[rgb(var(--status-red))]">
            {comErro.length} contrato(s) com erro. Verifique no board/Caju e re-dispare esses
            contratos manualmente.
          </p>
        )}

        {finalizado && (
          <div className="mt-6 flex justify-center">
            <ChoiceButton variant="primary" onClick={onConcluir}>
              Concluir
            </ChoiceButton>
          </div>
        )}
      </div>
    </section>
  )
}

function MesCard({
  titulo,
  competencia,
  onClick,
}: {
  titulo: string
  competencia: string | null | undefined
  onClick: () => void
}) {
  function tilt(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty("--mx", String(((e.clientX - r.left) / r.width) * 100))
    e.currentTarget.style.setProperty("--my", String(((e.clientY - r.top) / r.height) * 100))
  }
  function untilt(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }
  return (
    <button
      onClick={onClick}
      onMouseMove={tilt}
      onMouseLeave={untilt}
      className="glass-tile glass-tile-3d group flex items-center gap-4 rounded-2xl px-5 py-5 text-left"
    >
      <div className="icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.38)]">
        <CalendarDays className="icon-3d-only size-5 text-[rgb(var(--accent-rgb))]" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">{titulo}</p>
        <p className="text-display mt-0.5 text-xl capitalize text-foreground">{rotuloMes(competencia)}</p>
        <p className="text-xs text-foreground/45">competência {competencia ?? "—"}</p>
      </div>
    </button>
  )
}

function Stat({
  k,
  v,
  tone,
  box,
}: {
  k: string
  v: string
  tone?: "gold" | "blue" | "green" | "red"
  box?: boolean
}) {
  const color =
    tone === "gold"
      ? "text-[rgb(var(--accent-rgb))]"
      : tone === "blue"
        ? "text-[rgb(var(--surface-rgb))]"
        : tone === "green"
          ? "text-[rgb(var(--status-green))]"
          : tone === "red"
            ? "text-[rgb(var(--status-red))]"
            : "text-foreground"
  return (
    <div className={box ? "rounded-xl border border-border bg-card/30 px-3 py-3" : ""}>
      <div className="text-[10px] uppercase tracking-[0.1em] text-foreground/45">{k}</div>
      <div className={`mt-0.5 text-lg font-semibold ${color}`}>{v}</div>
    </div>
  )
}

function Th({ children, right, center }: { children: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-border px-3 py-2.5 font-semibold ${right ? "text-right" : center ? "text-center" : "text-left"}`}
    >
      {children}
    </th>
  )
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-foreground/70 ${className}`}>{children}</td>
}
