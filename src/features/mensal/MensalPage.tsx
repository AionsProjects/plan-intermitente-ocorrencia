import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import { ArrowLeft, Banknote, CalendarDays, Loader2, TriangleAlert } from "lucide-react"

import { ChoiceButton } from "@/features/atestados/ChoiceButton"
import { Acompanhamento } from "./Acompanhamento"
import { useDemoRun } from "./demoRun"
import {
  aprovarRunMensal,
  buscarAoVivo,
  buscarConfigMensal,
  buscarMeses,
  buscarPessoas,
  buscarRunAtivo,
  buscarRunStatus,
  cancelarRunMensal,
  criarPreviaMensal,
  MensalApiError,
  retomarRunMensal,
  type AoVivoResp,
  type Papel,
  type EventoMensal,
  type PessoasResp,
  type PreviaResp,
} from "./api"

type Etapa = "mes" | "tabela" | "confirma" | "acompanhando" | "ok"

const STATUS_FINAIS = ["concluido", "concluido_com_erro", "falhou", "cancelado", "cancelado_com_pendencia"]

/** Meses de caixa oferecidos: 3 anteriores → atual → próximo (cobre fechamento retroativo). */
const OPCOES_CAIXA: { valor: string; rotulo: string }[] = (() => {
  const hoje = new Date()
  const itens = []
  for (let delta = -3; delta <= 1; delta++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + delta, 1)
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const nome = format(d, "MMMM 'de' yyyy", { locale: ptBR })
    itens.push({
      valor,
      rotulo: delta === 0 ? `${nome} (mês atual)` : nome,
    })
  }
  return itens
})()

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
  // Modo demo (?demo=1): simula a execução localmente — nada é enviado.
  const demo = new URLSearchParams(useLocation().search).has("demo")
  const [etapa, setEtapa] = useState<Etapa>(demo ? "acompanhando" : "mes")
  const [papel, setPapel] = useState<Papel>("atual")
  const [erroDisparo, setErroDisparo] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [previa, setPrevia] = useState<PreviaResp | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [eventosAcumulados, setEventosAcumulados] = useState<EventoMensal[]>([])
  const cursorEventos = useRef(0)
  // Mês de CAIXA = gaveta dos boards Solicitação/Controle Caju (quando o pagamento sai).
  // Default: mês atual. Editável porque pagamento retroativo tem que cair no fechamento certo
  // (ex.: rodar dia 01/08 um pagamento que pertence ao caixa de julho).
  const [caixa, setCaixa] = useState<string>(() => {
    const h = new Date()
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`
  })
  // Controles de teste (só homologação): desligar antifraude + escolher contratos.
  const [bypassAntifraude, setBypassAntifraude] = useState(false)
  const [contratosSelecionados, setContratosSelecionados] = useState<string[]>([])

  const demoRun = useDemoRun(demo)

  const config = useQuery({ queryKey: ["mensal-config"], queryFn: buscarConfigMensal, enabled: !demo })
  const ehHomologacao = config.data?.controlesTeste ?? (config.data?.modo === "homologacao")
  const meses = useQuery({ queryKey: ["mensal-meses"], queryFn: buscarMeses })
  const pessoas = useQuery<PessoasResp>({
    queryKey: ["mensal-pessoas", papel],
    queryFn: () => buscarPessoas(papel),
    enabled: etapa === "tabela" || etapa === "confirma",
  })

  // Reatar acompanhamento após reload: hint local + run global em andamento (fonte de verdade).
  useEffect(() => {
    if (demo) return
    const salvo = localStorage.getItem("mensal-run-ativo")
    if (salvo && !runId) {
      setRunId(salvo)
      setEtapa("acompanhando")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const ativo = useQuery({
    queryKey: ["mensal-ativo"],
    queryFn: buscarRunAtivo,
    enabled: etapa === "mes",
    refetchInterval: 5000,
  })
  useEffect(() => {
    if (etapa === "mes" && ativo.data?.run) {
      setRunId(ativo.data.run.run_id)
      setEtapa("acompanhando")
    }
  }, [ativo.data, etapa])

  // Polling consolidado (run + itens + eventos delta) numa só chamada atômica.
  const aoVivo = useQuery<AoVivoResp>({
    queryKey: ["mensal-aovivo", runId],
    queryFn: () => buscarAoVivo(runId!, cursorEventos.current),
    enabled: etapa === "acompanhando" && !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.run?.status
      return s && STATUS_FINAIS.includes(s) ? false : 2000
    },
    // tela de monitoramento: continua atualizando mesmo com a aba em segundo plano
    refetchIntervalInBackground: true,
  })
  const runData = demo ? (demoRun?.run.run ?? null) : (aoVivo.data?.run ?? null)
  const itensAoVivo = demo ? (demoRun?.run.itens ?? []) : (aoVivo.data?.itens ?? [])
  const finalizado = demo
    ? !!demoRun?.finalizado
    : !!runData && STATUS_FINAIS.includes(runData.status)

  useEffect(() => {
    if (!aoVivo.data?.eventos.length) return
    cursorEventos.current = aoVivo.data.proximo_after
    setEventosAcumulados((atuais) => {
      const ids = new Set(atuais.map((evento) => evento.id))
      return [...atuais, ...aoVivo.data!.eventos.filter((evento) => !ids.has(evento.id))]
    })
  }, [aoVivo.data])
  useEffect(() => {
    cursorEventos.current = 0
    setEventosAcumulados([])
  }, [runId])

  // Persiste/limpa o runId ativo pra reatar depois do reload.
  useEffect(() => {
    if (demo) return
    if (etapa === "acompanhando" && runId && !finalizado) localStorage.setItem("mensal-run-ativo", runId)
    if (finalizado) localStorage.removeItem("mensal-run-ativo")
  }, [etapa, runId, finalizado, demo])
  // Run inexistente (404) -> descarta hint local.
  useEffect(() => {
    if (aoVivo.isError) localStorage.removeItem("mensal-run-ativo")
  }, [aoVivo.isError])

  // Relógio p/ "atualizado há Xs".
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (etapa !== "acompanhando" || finalizado) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [etapa, finalizado])

  // Guarda contra run travado: rodando mas sem atualizar há >4min.
  const travado =
    !!runData &&
    (runData.status === "rodando" || runData.status === "fila" || runData.status === "recuperando") &&
    aoVivo.dataUpdatedAt - new Date(runData.atualizado_em).getTime() > 4 * 60 * 1000

  function escolher(p: Papel) {
    setPapel(p)
    setEtapa("tabela")
  }

  // Alternar antifraude: se já existe prévia, cancela pra poder recalcular sem colidir (1 run global).
  async function alternarBypass(v: boolean) {
    setBypassAntifraude(v)
    if (previa && runId) {
      try {
        await cancelarRunMensal(runId, "Recalcular prévia (toggle antifraude de teste)")
      } catch {
        // ignora — o importante é liberar o estado local pra recalcular
      }
      setPrevia(null)
      setRunId(null)
    }
  }

  function aplicarPrevia(p: PreviaResp) {
    setPrevia(p)
    setRunId(p.run_id)
    // Seleção padrão: todos os contratos rodáveis (não bloqueados).
    setContratosSelecionados(p.snapshot.contratos.filter((c) => !c.bloqueado).map((c) => c.contrato))
    setEtapa("confirma")
  }

  async function prepararPrevia(jaRetentou = false): Promise<void> {
    setOcupado(true)
    setErroDisparo(null)
    try {
      const p = await criarPreviaMensal(papel, ehHomologacao && bypassAntifraude, caixa)
      aplicarPrevia(p)
    } catch (e) {
      // 409: já existe um run global. Resolve automaticamente:
      // - rodando/fila → reatar a tela de acompanhamento;
      // - prévia parada aguardando aprovação → cancelar e recalcular 1x.
      if (e instanceof MensalApiError && e.codigo === "mensal_run_ativo" && !jaRetentou) {
        const outroId = e.corpo.run_id as string | undefined
        if (outroId) {
          try {
            const st = await buscarRunStatus(outroId)
            if (["fila", "rodando", "recuperando"].includes(st.run.status)) {
              setRunId(outroId)
              setEtapa("acompanhando")
              return
            }
            // aguardando_aprovacao (prévia velha) → limpa e recalcula
            await cancelarRunMensal(outroId, "Prévia anterior substituída por novo cálculo")
            await prepararPrevia(true)
            return
          } catch {
            setErroDisparo(
              "Já existe um cálculo mensal em andamento e não consegui liberá-lo automaticamente. Recarregue a página e tente de novo.",
            )
            return
          }
        }
      }
      setErroDisparo(
        e instanceof MensalApiError && e.codigo === "mensal_run_ativo"
          ? "Já existe um cálculo mensal em andamento. Aguarde ou recarregue a página."
          : e instanceof Error
            ? e.message
            : "Falha ao calcular prévia",
      )
    } finally {
      setOcupado(false)
    }
  }

  async function aprovar() {
    if (!runId) return
    setOcupado(true)
    setErroDisparo(null)
    try {
      // Vale em QUALQUER modo (inclui produção): backend e workflow filtram por contrato sem olhar
      // o modo, e a antifraude da próxima prévia marca como bloqueado o que já foi processado na
      // competência — então dá pra pagar em rodadas.
      const somente = contratosSelecionados.length ? contratosSelecionados : undefined
      await aprovarRunMensal(runId, somente)
      setEtapa("acompanhando")
    } catch (e) {
      setErroDisparo(e instanceof Error ? e.message : "Falha ao iniciar workflow")
    } finally {
      setOcupado(false)
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
            {ehHomologacao && meses.data?.teste?.existe && (
              <MesCard
                titulo="Board de teste"
                competencia={meses.data.teste.competencia}
                onClick={() => escolher("teste")}
                teste
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

              {/* Gaveta de caixa — escolhida ANTES da prévia, porque é ela que resolve o grupo
                  dos boards Solicitação e Controle Caju. A competência não muda: é a do board. */}
              <div className="mt-4 rounded-2xl border border-border bg-[rgb(var(--ink)/0.04)] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                      Mês de caixa (gaveta do pagamento)
                    </p>
                    <p className="mt-1 text-[11px] text-foreground/45">
                      Onde a Solicitação e o Controle Caju vão ser arquivados — o mês em que o
                      dinheiro sai. Não confunda com a competência ({rotuloMes(meses.data?.[papel === "teste" ? "teste" : papel]?.competencia)}).
                    </p>
                  </div>
                  <select
                    value={caixa}
                    onChange={(e) => setCaixa(e.target.value)}
                    className="glass-field shrink-0 rounded-xl px-3 py-2 text-sm"
                  >
                    {OPCOES_CAIXA.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {ehHomologacao && (
                <div
                  className={`mt-4 rounded-2xl border border-dashed px-5 py-4 ${
                    papel === "teste"
                      ? "border-[rgb(var(--status-red)/0.55)] bg-[rgb(var(--status-red)/0.08)]"
                      : "border-[rgb(var(--accent-rgb)/0.5)] bg-[rgb(var(--accent-rgb)/0.06)]"
                  }`}
                >
                  <p
                    className={`text-[10px] uppercase tracking-[0.18em] ${
                      papel === "teste" ? "text-[var(--status-red)]" : "text-[rgb(var(--accent-rgb))]"
                    }`}
                  >
                    {papel === "teste" ? "Board de teste · efeitos REAIS" : "Modo teste · homologação"}
                  </p>
                  <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-sm text-foreground/85">
                    <input
                      type="checkbox"
                      checked={bypassAntifraude}
                      onChange={(e) => alternarBypass(e.target.checked)}
                      className="size-4 accent-[rgb(var(--accent-rgb))]"
                    />
                    Desligar antifraude (processa contratos já pagos)
                  </label>
                  {/* O board de teste NAO simula: papel=teste sobrepoe a homologacao no workflow
                      (modoExec = "teste") e executa Caju/RM/Monday de verdade, so marcando TESTE. */}
                  {papel === "teste" ? (
                    <p className="mt-1 text-[11px] text-[var(--status-red)]">
                      Atenção: o board de teste <strong>não simula</strong>. Ao aprovar, cria pedido real
                      na Caju, lança no RM e grava no Monday (marcados “TESTE”). Para simular sem enviar
                      nada, use Mês atual ou Próximo mês.
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-foreground/45">
                      Efeitos simulados nesta homologação. Os contratos você escolhe na próxima etapa.
                    </p>
                  )}
                </div>
              )}

              {erroDisparo && (
                <p className="mt-5 rounded-2xl bg-[rgb(var(--status-red)/0.08)] px-4 py-3 text-sm text-[var(--status-red)] shadow-[inset_0_0_0_1px_rgb(239_102_102/0.3)]">
                  {erroDisparo}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <ChoiceButton onClick={() => setEtapa("mes")}>
                  Cancelar
                </ChoiceButton>
                <ChoiceButton
                  variant="primary"
                  disabled={pessoas.data.total === 0 || ocupado}
                  onClick={previa ? () => setEtapa("confirma") : () => prepararPrevia()}
                >
                  {ocupado ? "Calculando prévia…" : previa ? "Reabrir prévia →" : "Calcular prévia →"}
                </ChoiceButton>
              </div>
            </>
          )}
        </section>
      )}

      {/* ETAPA: CONFIRMAÇÃO */}
      {etapa === "confirma" && previa && (
        <section className="fade-up mx-auto mt-6 max-w-xl">
          <div className="glass-panel px-8 py-9 text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">Aprovar snapshot imutável</p>
            <h2 className="text-display mt-2 text-3xl text-foreground">
              Processar{" "}
              <span className="text-[rgb(var(--accent-rgb))]">
                {previa.snapshot.contratos.reduce((n, c) => n + c.pessoas.length, 0)} pessoas
              </span>
              <br />
              do mês <span className="capitalize">{rotuloMes(previa.snapshot.competencia)}</span>?
            </h2>
            {/* O aviso segue o EXECUTOR real, nao so o modo: papel=teste sobrepoe a homologacao
                (modoExec = "teste" em workflows/mensal.ts) e executa Caju/RM/Monday de verdade. */}
            <div
              className={`mt-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-left text-[13px] ${
                previa.snapshot.papel === "teste"
                  ? "border-[rgb(var(--status-red)/0.45)] bg-[rgb(var(--status-red)/0.1)] text-[var(--status-red)]"
                  : "border-[rgb(var(--accent-rgb)/0.34)] bg-[rgb(var(--accent-rgb)/0.1)] text-[rgb(var(--accent-rgb))]"
              }`}
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {previa.snapshot.papel === "teste"
                ? "Board de teste — NÃO é simulação: aprovar cria pedido real na Caju, lança no RM e grava no Monday (marcados “TESTE”). Efeitos confirmados não são desfeitos automaticamente."
                : previa.modo === "homologacao"
                  ? "Homologação isolada: os efeitos externos serão simulados e registrados no ledger."
                  : "Produção: a aprovação inicia o workflow durável. Efeitos confirmados não são desfeitos automaticamente."}
            </div>
            <p className="mt-3 text-[12px] text-foreground/55">
              Competência <span className="text-foreground/80">{rotuloMes(previa.snapshot.competencia)}</span>
              {" · "}arquiva no caixa de{" "}
              <span className="text-foreground/80">{rotuloMes(previa.snapshot.apoio.caixa)}</span>
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat box k="Pessoas" v={String(previa.snapshot.contratos.reduce((n, c) => n + c.pessoas.length, 0))} />
              <Stat box k="Contratos" v={String(previa.snapshot.contratos.length)} />
              <Stat box k="Bloqueados" v={String(previa.snapshot.contratos.filter((c) => c.bloqueado).length)} />
              <Stat box k="Descontos" v={String(previa.snapshot.apoio.descontosPendentes)} />
            </div>
            {previa.snapshot.alertas.length > 0 && (
              <div className="mt-4 rounded-xl border border-border bg-card/40 px-4 py-3 text-left text-xs text-foreground/60">
                {previa.snapshot.alertas.map((alerta) => <p key={alerta}>• {alerta.replaceAll("_", " ")}</p>)}
              </div>
            )}
            {erroDisparo && (
              <p className="mt-4 text-sm text-[rgb(var(--status-red))]">{erroDisparo}</p>
            )}
            {/* Seleção de contratos vale em produção também — permite pagar em rodadas (ex.: fechar
                SEMSA hoje e o resto amanhã). O que já foi pago na competência volta como
                `bloqueado` na próxima prévia (antifraude) e o ledger por contrato é a 2ª trava. */}
            <div className="mt-4 rounded-xl border border-dashed border-[rgb(var(--accent-rgb)/0.4)] bg-[rgb(var(--accent-rgb)/0.05)] px-4 py-3 text-left">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--accent-rgb))]">
                  Contratos a processar
                </p>
                <p className="text-[10px] text-foreground/45">
                  {contratosSelecionados.length} de{" "}
                  {previa.snapshot.contratos.filter((c) => !c.bloqueado).length}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {previa.snapshot.contratos.map((c) => (
                  <label
                    key={c.contrato}
                    className={`flex items-center gap-2 text-[13px] ${c.bloqueado ? "opacity-40" : "cursor-pointer text-foreground/85"}`}
                  >
                    <input
                      type="checkbox"
                      disabled={c.bloqueado}
                      checked={contratosSelecionados.includes(c.contrato)}
                      onChange={(e) =>
                        setContratosSelecionados((s) =>
                          e.target.checked ? [...s, c.contrato] : s.filter((x) => x !== c.contrato),
                        )
                      }
                      className="size-3.5 accent-[rgb(var(--accent-rgb))]"
                    />
                    <span className="truncate">{c.contrato}</span>
                    <span className="text-foreground/40">({c.pessoas.length})</span>
                    {c.bloqueado && (
                      <span
                        className="text-[10px] text-foreground/40"
                        title={c.motivoBloqueio ?? undefined}
                      >
                        {c.motivoBloqueio === "contrato_ja_processado_na_competencia"
                          ? "já pago"
                          : "bloq."}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {contratosSelecionados.length > 0 &&
                contratosSelecionados.length <
                  previa.snapshot.contratos.filter((c) => !c.bloqueado).length && (
                  <p className="mt-2 text-[11px] text-[rgb(var(--accent-rgb))]">
                    Rodada parcial: os contratos desmarcados ficam de fora e podem ser processados
                    depois, numa nova prévia.
                  </p>
                )}
            </div>
            <div className="mt-7 flex justify-center gap-3">
              <ChoiceButton onClick={() => setEtapa("tabela")}>← Revisar</ChoiceButton>
              <ChoiceButton
                variant="primary"
                disabled={ocupado || contratosSelecionados.length === 0}
                onClick={aprovar}
              >
                {ocupado ? "Iniciando…" : "Aprovar e iniciar"}
              </ChoiceButton>
            </div>
          </div>
        </section>
      )}

      {/* ETAPA: ACOMPANHAMENTO AO VIVO */}
      {etapa === "acompanhando" && (
        <Acompanhamento
          run={runData ? { run: runData, itens: itensAoVivo } : null}
          fallbackContratos={pessoas.data?.porContrato ?? []}
          competencia={pessoas.data?.competencia ?? runData?.competencia ?? null}
          finalizado={finalizado}
          travado={travado}
          eventos={demo ? (demoRun?.eventos ?? []) : eventosAcumulados}
          agora={agora}
          demo={demo}
          onRetomar={async () => {
            if (demo || !runId) return
            await retomarRunMensal(runId)
            await aoVivo.refetch()
          }}
          onCancelar={async () => {
            if (demo || !runId) return
            await cancelarRunMensal(runId, "Encerrado pelo operador na tela de acompanhamento")
            await aoVivo.refetch()
          }}
          onConcluir={() => {
            if (!demo) localStorage.removeItem("mensal-run-ativo")
            nav("/")
          }}
          rotuloMes={rotuloMes}
        />
      )}
    </main>
  )
}

function MesCard({
  titulo,
  competencia,
  onClick,
  teste,
}: {
  titulo: string
  competencia: string | null | undefined
  onClick: () => void
  teste?: boolean
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
      className={`glass-tile glass-tile-3d group relative flex items-center gap-4 rounded-2xl px-5 py-5 text-left ${teste ? "border border-dashed border-amber-400/45" : ""}`}
    >
      {teste && (
        <span className="absolute right-3 top-3 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300 ring-1 ring-amber-400/40">
          Teste
        </span>
      )}
      <div className={`icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full ${teste ? "bg-amber-400/12 ring-1 ring-amber-400/40" : "bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.38)]"}`}>
        <CalendarDays className={`icon-3d-only size-5 ${teste ? "text-amber-300" : "text-[rgb(var(--accent-rgb))]"}`} />
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
