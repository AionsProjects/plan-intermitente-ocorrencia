import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import { History, Loader2 } from "lucide-react"

import { useAuth } from "@/components/AuthContext"
import { useRegistrarVoltar } from "@/components/NavContext"
import { normalizarBusca } from "@/lib/buscaUnidade"
import { useDebounce } from "@/lib/useDebounce"
import { listarAtividade, buscarDetalheExecucao } from "./api"
import { BarraFiltros, type Filtros, type Periodo } from "./BarraFiltros"
import { GerarRelatorio } from "./GerarRelatorio"
import { diaManaus, rotuloDia, rotuloEtapa } from "./etapas"
import { LinhaExecucao } from "./LinhaExecucao"
import { ehFalha, rotuloAcao, type Execucao } from "./types"

/**
 * Histórico de execuções.
 *
 * ⚠️ Filtros e linha aberta vivem na URL (query string), NÃO no pathname.
 * `PageTransition` usa `slideKey={location.pathname}`, então mudar o pathname
 * remontaria e deslizaria a tela inteira a cada expansão — a lista piscaria e o
 * scroll se perderia. Query param não dispara isso, e de brinde o estado sobrevive a
 * F5 e é compartilhável.
 *
 * O deep link do alerta de WhatsApp é `/atividade?exec=<id>`.
 */

const VAZIO: Filtros = { busca: "", tipos: [], quem: "", periodo: "tudo", soErro: false, todos: false }

function lerFiltros(p: URLSearchParams): Filtros {
  const per = p.get("per")
  return {
    busca: p.get("q") ?? "",
    tipos: (p.get("tipo") ?? "").split(",").filter(Boolean),
    quem: p.get("quem") ?? "",
    periodo: (["hoje", "7d", "30d", "tudo"].includes(per ?? "") ? per : "tudo") as Periodo,
    soErro: p.get("st") === "erro",
    todos: p.get("todos") === "1",
  }
}

function escreverFiltros(f: Filtros, execAberta: string | null): URLSearchParams {
  const p = new URLSearchParams()
  if (f.busca) p.set("q", f.busca)
  if (f.tipos.length) p.set("tipo", f.tipos.join(","))
  if (f.quem) p.set("quem", f.quem)
  if (f.periodo !== "tudo") p.set("per", f.periodo)
  if (f.soErro) p.set("st", "erro")
  if (f.todos) p.set("todos", "1")
  if (execAberta) p.set("exec", execAberta)
  return p
}

const DIAS_MS = 86_400_000
function dentroDoPeriodo(iso: string, periodo: Periodo): boolean {
  if (periodo === "tudo") return true
  if (periodo === "hoje") return diaManaus(iso) === diaManaus(new Date().toISOString())
  const limite = Date.now() - (periodo === "7d" ? 7 : 30) * DIAS_MS
  return new Date(iso).getTime() >= limite
}

/**
 * Texto normalizado no qual a busca procura. Junta tudo que o operador pode digitar:
 * rótulo da ação, pessoa, contrato, operador, fase que quebrou, mensagem de erro, id
 * e os escalares do resumo.
 */
function blobDeBusca(e: Execucao): string {
  const resumo = (e.payload_resumo ?? {}) as Record<string, unknown>
  const escalares = Object.values(resumo)
    .filter((v) => v != null && typeof v !== "object")
    .map(String)
  return normalizarBusca([
    rotuloAcao(e.acao), e.pessoa_nome, e.contrato, e.operador_nome, e.operador_email,
    rotuloEtapa(e.erro_etapa), e.erro_msg, e.etapa_atual, e.id, e.uuid_alvo,
    ...escalares,
  ].filter(Boolean).join(" "))
}

export function AtividadePage() {
  const { podeVer } = useAuth()
  const navigate = useNavigate()
  const podeVerTodos = podeVer("dp")
  const [params, setParams] = useSearchParams()

  const filtros = useMemo(() => lerFiltros(params), [params])
  const execAberta = params.get("exec")
  // A URL só é reescrita com o termo debounced: sem isso cada tecla vira uma entrada
  // no histórico e o botão voltar do celular fica preso.
  const buscaDebounced = useDebounce(filtros.busca, 250)

  useRegistrarVoltar(null, "/")

  const escopoTodos = filtros.todos && podeVerTodos
  const { data, isLoading, isError } = useQuery({
    queryKey: ["atividade", escopoTodos],
    queryFn: () => listarAtividade(escopoTodos),
    staleTime: 15_000,
    // Enquanto houver execução em andamento a lista se atualiza sozinha — o log passa
    // a servir DURANTE a execução, não só depois dela.
    refetchInterval: (q) =>
      q.state.data?.atividades.some((a) => a.estado === "aberta") ? 4000 : false,
    refetchIntervalInBackground: false,
  })

  // useMemo e não `?? []` solto: um array novo a cada render invalidaria todos os
  // memos abaixo, e a lista tem até 200 linhas pra refiltrar.
  const todas = useMemo(() => data?.atividades ?? [], [data])

  const mudar = useCallback((parcial: Partial<Filtros>) => {
    // replace: true — filtro não é passo de navegação.
    setParams(escreverFiltros({ ...filtros, ...parcial }, execAberta), { replace: true })
  }, [filtros, execAberta, setParams])

  const abrir = useCallback((id: string | null) => {
    setParams(escreverFiltros(filtros, id), { replace: true })
  }, [filtros, setParams])

  // Contagem por tipo ANTES do filtro de tipo (senão o chip não marcado zera e não dá
  // pra voltar), mas DEPOIS de período/escopo, que é o recorte do conjunto.
  const noPeriodo = useMemo(
    () => todas.filter((e) => dentroDoPeriodo(e.criado_em, filtros.periodo)),
    [todas, filtros.periodo],
  )
  const contagemPorTipo = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of noPeriodo) {
      const k = e.acao === "mensal_fechamento" ? "mensal" : e.acao
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [noPeriodo])

  const operadores = useMemo(
    () => [...new Set(noPeriodo.map((e) => e.operador_nome ?? e.operador_email).filter(Boolean) as string[])].sort(),
    [noPeriodo],
  )

  const filtradas = useMemo(() => {
    const termo = normalizarBusca(buscaDebounced)
    const partes = termo.split(" ").filter(Boolean)
    return noPeriodo.filter((e) => {
      if (filtros.soErro && !ehFalha(e.estado)) return false
      if (filtros.tipos.length) {
        const k = e.acao === "mensal_fechamento" ? "mensal" : e.acao
        if (!filtros.tipos.includes(k)) return false
      }
      if (filtros.quem && (e.operador_nome ?? e.operador_email) !== filtros.quem) return false
      if (partes.length) {
        const blob = blobDeBusca(e)
        if (!partes.every((p) => blob.includes(p))) return false
      }
      return true
    })
  }, [noPeriodo, buscaDebounced, filtros.soErro, filtros.tipos, filtros.quem])

  const qtdErros = useMemo(() => noPeriodo.filter((e) => ehFalha(e.estado)).length, [noPeriodo])

  // A execução do deep link pode ser mais antiga que as 200 carregadas, ou estar fora
  // dos filtros ativos. Busca o detalhe dela por fora pra o link NUNCA falhar.
  const naLista = !!execAberta && filtradas.some((e) => e.id === execAberta)
  const { data: fixada } = useQuery({
    queryKey: ["atividade-fixada", execAberta],
    queryFn: () => buscarDetalheExecucao(execAberta!),
    enabled: !!execAberta && !naLista,
    staleTime: 30_000,
  })

  const grupos = useMemo(() => {
    const m = new Map<string, Execucao[]>()
    for (const e of filtradas) {
      const d = diaManaus(e.criado_em)
      m.set(d, [...(m.get(d) ?? []), e])
    }
    return [...m.entries()]
  }, [filtradas])

  // Atalhos: "/" foca a busca, Esc limpa a busca ou fecha a linha aberta.
  const refBusca = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const alvo = ev.target as HTMLElement | null
      const digitando = alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA" || alvo?.tagName === "SELECT"
      if (ev.key === "/" && !digitando) {
        ev.preventDefault()
        refBusca.current?.querySelector("input")?.focus()
      }
      if (ev.key === "Escape") {
        if (filtros.busca) mudar({ busca: "" })
        else if (execAberta) abrir(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [filtros.busca, execAberta, mudar, abrir])

  const temFiltro = !!filtros.busca || filtros.tipos.length > 0 || !!filtros.quem || filtros.periodo !== "tudo" || filtros.soErro

  return (
    <div className="relative z-10 min-h-svh">
      <div className="flex justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="glass-panel relative w-full max-w-[980px] p-5 sm:p-8 lg:p-10">
          <p className="eyebrow flex items-center gap-2">
            <History className="size-3" aria-hidden /> Histórico de execuções
          </p>
          <h1 className="text-display mt-2 text-4xl leading-[1.05] text-foreground sm:text-5xl">
            Atividade
          </h1>
          <p className="mt-2 text-sm text-foreground/55">
            {escopoTodos ? "Tudo que o app executou." : "O que você lançou pelo app."} Abra uma linha
            pra ver fase a fase e o que foi gerado.
          </p>

          <div ref={refBusca} className="mt-6">
            <BarraFiltros
              filtros={filtros}
              contagemPorTipo={contagemPorTipo}
              operadores={operadores}
              qtdErros={qtdErros}
              podeVerTodos={podeVerTodos}
              onMudar={mudar}
              onLimpar={() => setParams(escreverFiltros({ ...VAZIO, todos: filtros.todos }, execAberta), { replace: true })}
            />
          </div>

          <GerarRelatorio todos={escopoTodos} />

          {/* Convocação pro erro: quem abre a página vê que tem coisa quebrada mesmo
              sem estar filtrando por isso. */}
          {!filtros.soErro && qtdErros > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-[rgb(var(--status-red-rgb)/0.08)] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(239_102_102/0.3)]">
              <span className="text-[13px] text-[var(--status-red)]">
                <span className="lamp lamp--red mr-2 align-middle" aria-hidden />
                {qtdErros} {qtdErros === 1 ? "execução" : "execuções"} com erro
              </span>
              <button type="button" onClick={() => mudar({ soErro: true })} className="pill-soft px-3 py-1.5 text-xs">
                ver só erros
              </button>
            </div>
          )}

          <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-[rgb(var(--ink)/0.07)] pt-4">
            {/* aria-live: é o único retorno de que um filtro fez efeito pra quem não
                enxerga a lista mudar. */}
            <p className="text-[12px] text-foreground/45" aria-live="polite">
              {isLoading ? "carregando…" : `${filtradas.length} ${filtradas.length === 1 ? "execução" : "execuções"}`}
              {qtdErros > 0 && !filtros.soErro ? ` · ${qtdErros} com erro` : ""}
            </p>
            {data?.truncado && (
              // Honestidade obrigatória: a busca é local, então só alcança o que veio.
              <p className="text-[11px] text-foreground/45">
                mostrando as {data.limite} mais recentes
              </p>
            )}
          </div>

          {isLoading && (
            <p className="mt-6 flex items-center gap-2 text-sm text-foreground/60">
              <Loader2 className="size-4 animate-spin" /> Carregando histórico…
            </p>
          )}
          {isError && (
            <p className="mt-6 rounded-[16px] px-4 py-3 text-sm text-[var(--status-red)] shadow-[inset_0_0_0_1px_rgb(239_102_102/0.3)]">
              Erro ao carregar o histórico.
            </p>
          )}

          {/* Cartão fixado: a execução do link existe mas está fora da lista/filtros.
              É o que faz o link do alerta nunca cair em "não encontrado". */}
          {fixada && !naLista && (
            <div className="mt-6">
              <p className="eyebrow mb-2">Aberta pelo link</p>
              <ul className="space-y-2">
                <LinhaExecucao
                  exec={fixada.execucao}
                  aberta
                  destacar
                  busca=""
                  mostrarOperador={escopoTodos}
                  onAlternar={() => abrir(null)}
                />
              </ul>
              {temFiltro && (
                <button
                  type="button"
                  onClick={() => setParams(escreverFiltros({ ...VAZIO, todos: filtros.todos }, execAberta), { replace: true })}
                  className="pill-soft mt-2 px-3 py-1.5 text-xs"
                >
                  Limpar filtros pra ver no histórico
                </button>
              )}
            </div>
          )}

          {!isLoading && !isError && filtradas.length === 0 && (
            <div className="mt-6 rounded-[16px] px-4 py-8 text-center">
              {/* Estado vazio por CAUSA: com cinco filtros, "nenhuma atividade" sem
                  explicação é lido como bug. */}
              {temFiltro ? (
                <>
                  <p className="text-sm text-foreground/55">Nenhuma execução com esses filtros.</p>
                  <button
                    type="button"
                    onClick={() => setParams(escreverFiltros({ ...VAZIO, todos: filtros.todos }, execAberta), { replace: true })}
                    className="glass-cta glass-cta--mini mt-4"
                  >
                    Limpar filtros
                  </button>
                </>
              ) : (
                <p className="text-sm text-foreground/50">
                  Nada registrado ainda. As execuções aparecem aqui conforme acontecem.
                </p>
              )}
            </div>
          )}

          {grupos.map(([dia, linhas]) => (
            <section key={dia} className="mt-6">
              <p className="eyebrow sticky top-0 z-10 -mx-1 rounded-md px-1 py-1.5 backdrop-blur-md [background:var(--panel)]">
                {rotuloDia(dia)}
              </p>
              <ul className="mt-1.5 space-y-2">
                {linhas.map((e) => (
                  <LinhaExecucao
                    key={e.id}
                    exec={e}
                    aberta={execAberta === e.id}
                    destacar={execAberta === e.id}
                    busca={buscaDebounced}
                    mostrarOperador={escopoTodos}
                    onAlternar={() => abrir(execAberta === e.id ? null : e.id)}
                  />
                ))}
              </ul>
            </section>
          ))}

          <div className="mt-8 border-t border-[rgb(var(--ink)/0.07)] pt-4 text-center">
            <button type="button" onClick={() => navigate("/")} className="pill-soft px-4 py-2 text-xs">
              Voltar ao início
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
