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
  dispararPagamentoMensal,
  type Papel,
  type PessoasResp,
} from "./api"

type Etapa = "mes" | "tabela" | "confirma" | "processando" | "ok"

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

  const meses = useQuery({ queryKey: ["mensal-meses"], queryFn: buscarMeses })
  const pessoas = useQuery<PessoasResp>({
    queryKey: ["mensal-pessoas", papel],
    queryFn: () => buscarPessoas(papel),
    enabled: etapa === "tabela" || etapa === "confirma",
  })

  function escolher(p: Papel) {
    setPapel(p)
    setEtapa("tabela")
  }

  async function pagar() {
    setEtapa("processando")
    setErroDisparo(null)
    try {
      await dispararPagamentoMensal(papel, pessoas.data?.competencia ?? null)
      setEtapa("ok")
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
      {(etapa === "confirma" || etapa === "processando") && pessoas.data && (
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
              <ChoiceButton disabled={etapa === "processando"} onClick={() => setEtapa("tabela")}>
                ← Revisar
              </ChoiceButton>
              <ChoiceButton variant="primary" disabled={etapa === "processando"} onClick={pagar}>
                {etapa === "processando" ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Disparando…
                  </span>
                ) : (
                  "Confirmar e pagar"
                )}
              </ChoiceButton>
            </div>
          </div>
        </section>
      )}

      {/* ETAPA: OK */}
      {etapa === "ok" && pessoas.data && (
        <section className="fade-up mx-auto mt-10 max-w-md text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-[rgb(var(--status-green)/0.5)] bg-[rgb(var(--status-green)/0.14)] text-[rgb(var(--status-green))]">
            <Check className="size-7" />
          </div>
          <h2 className="text-display mt-5 text-3xl text-foreground">Pagamento iniciado</h2>
          <p className="mt-2 text-sm text-foreground/55">
            A automação mensal foi disparada para <b>{pessoas.data.total} pessoas</b> da competência{" "}
            <span className="capitalize">{rotuloMes(pessoas.data.competencia)}</span>. Acompanhe no
            board.
          </p>
          <div className="mt-7">
            <ChoiceButton variant="primary" onClick={() => nav("/")}>
              Concluir
            </ChoiceButton>
          </div>
        </section>
      )}
    </main>
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
  tone?: "gold" | "blue" | "green"
  box?: boolean
}) {
  const color =
    tone === "gold"
      ? "text-[rgb(var(--accent-rgb))]"
      : tone === "blue"
        ? "text-[rgb(var(--surface-rgb))]"
        : tone === "green"
          ? "text-[rgb(var(--status-green))]"
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
