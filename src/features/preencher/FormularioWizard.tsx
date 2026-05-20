import { useCallback, useEffect, useMemo, useState } from "react"
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  FlaskConical,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

import {
  useCancelarConvocacao,
  useFinalizarProcessamento,
} from "./useProcessamento"
import type { Atestado, DiaInfo, ProcessamentoDados, RespostaDia } from "./types"
import {
  gerarProtocolo,
  salvarProtocolo,
} from "@/features/correcao/protocoloStorage"

type Props = {
  dados: ProcessamentoDados
  ehCorrecao?: boolean
  ehTeste?: boolean
  onFinalizado?: (protocolo: string) => void
}

type EtapaCancelamento =
  | "fechado"
  | "escolha"
  | "calendario"
  | "confirmar_total"
  | "confirmar_parcial"
  | "sucesso_total"
  | "sucesso_parcial"

type EtapaSabados = "fechado" | "calendario" | "confirmar_remover"

function formatarDiaCompleto(iso: string): string {
  return format(parseISO(iso), "EEEE, dd 'de' MMMM", { locale: ptBR })
}

function formatarDiaSemana(iso: string): string {
  return format(parseISO(iso), "EEEE", { locale: ptBR })
}

function formatarDiaCurto(iso: string): string {
  return format(parseISO(iso), "dd 'de' MMM", { locale: ptBR })
}

function formatarDataNumerica(iso: string): string {
  return format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR })
}

function listarDiasPeriodo(inicio: string, fim: string): string[] {
  const out: string[] = []
  const atual = new Date(inicio + "T00:00:00Z")
  const fimData = new Date(fim + "T00:00:00Z")
  while (atual <= fimData) {
    out.push(atual.toISOString().slice(0, 10))
    atual.setUTCDate(atual.getUTCDate() + 1)
  }
  return out
}

function atestadoCobreDia(atestado: Pick<Atestado, "dataInicio" | "dataFim">, data: string): boolean {
  return data >= atestado.dataInicio && data <= atestado.dataFim
}

function rotularDocumentoTile(docs: Atestado[]): string {
  if (docs.length === 0) return "Documento"
  if (docs.length > 1) return `${docs.length} documentos`
  const d = docs[0]
  if (d.tipoDocumento === "atestado") return "Atestado"
  if (d.periodos.length === 2) return "Declaração integral"
  if (d.periodos[0] === "manha") return "Declaração · manhã"
  if (d.periodos[0] === "tarde") return "Declaração · tarde"
  return "Declaração"
}

function normalizarTipoBaseDia(
  data: string,
  dados: ProcessamentoDados,
  atual?: DiaInfo,
): DiaInfo["tipo"] {
  const datasOriginais = new Set(dados.dias)
  const extrasPersistidos = new Set([
    ...(dados.diasExtras ?? []),
    ...(dados.sabadosExtras ?? []),
  ])
  if (atual?.tipo === "extra") return "extra"
  if (!datasOriginais.has(data) || extrasPersistidos.has(data)) return "extra"
  return "padrao"
}

function aplicarAtestadosNosDias(
  dias: DiaInfo[],
  atestados: Atestado[],
  dados: ProcessamentoDados,
): DiaInfo[] {
  return dias.map((dia) => {
    const coberto = atestados.some((a) => atestadoCobreDia(a, dia.data))
    return {
      ...dia,
      tipo: coberto ? "atestado" : normalizarTipoBaseDia(dia.data, dados, dia),
    }
  })
}

function respostasIniciais(
  dias: string[],
  prev: RespostaDia[] | undefined,
): Record<string, RespostaDia> {
  const base: Record<string, RespostaDia> = {}
  const prevMap = new Map((prev ?? []).map((r) => [r.data, r]))
  for (const dia of dias) {
    base[dia] = prevMap.get(dia) ?? { data: dia, tipo: "sem_ocorrencia" }
  }
  for (const r of prev ?? []) {
    if (!base[r.data]) base[r.data] = r
  }
  return base
}

function diasInfoIniciais(dados: ProcessamentoDados): DiaInfo[] {
  const desativados = new Set(dados.diasDesativados ?? [])
  const sabadosExtras = new Set(dados.sabadosExtras ?? [])
  const todos = new Set<string>([
    ...dados.dias,
    ...(dados.diasExtras ?? []),
    ...(dados.sabadosExtras ?? []),
  ])
  const base = [...todos]
    .sort()
    .map<DiaInfo>((d) => ({
      data: d,
      tipo: sabadosExtras.has(d) ? "extra" : "padrao",
      ativo: !desativados.has(d),
    }))
  return aplicarAtestadosNosDias(base, dados.atestados ?? [], dados)
}

export function FormularioWizard({ dados, ehCorrecao, ehTeste, onFinalizado }: Props) {
  const [respostas, setRespostas] = useState<Record<string, RespostaDia>>(() =>
    respostasIniciais(dados.dias, dados.respostasAnteriores),
  )
  const [diasInfo, setDiasInfo] = useState<DiaInfo[]>(() =>
    diasInfoIniciais(dados),
  )
  const [diaEditando, setDiaEditando] = useState<string | null>(null)
  const [modoApagar, setModoApagar] = useState(false)
  const [etapaCancelamento, setEtapaCancelamento] =
    useState<EtapaCancelamento>("fechado")
  const [dataInicioCancelamento, setDataInicioCancelamento] = useState<
    string | null
  >(null)
  const [cancelamentoErro, setCancelamentoErro] = useState<string | null>(null)
  const [reverterAberto, setReverterAberto] = useState(false)
  const [reverterErro, setReverterErro] = useState<string | null>(null)
  const [etapaSabados, setEtapaSabados] = useState<EtapaSabados>("fechado")
  const [sabadoARemover, setSabadoARemover] = useState<string | null>(null)

  // Set de dias "queimados" pelo cancelamento parcial vigente no backend.
  // Todo dia >= dataInicioCancelamento (do ProcessamentoDados, NÃO o state
  // local do wizard de cancelamento) entra no set.
  const diasCancelados = useMemo<Set<string>>(() => {
    const inicio = dados.dataInicioCancelamento
    if (!inicio || dados.statusCancelamento !== "cancelada_parcial")
      return new Set()
    return new Set(dados.dias.filter((d) => d >= inicio))
  }, [dados.dataInicioCancelamento, dados.statusCancelamento, dados.dias])
  // Atestados/declarações são read-only no /preencher (criação/correção é em /atestados).
  const atestados = useMemo<Atestado[]>(
    () => dados.atestados ?? [],
    [dados.atestados],
  )
  const [diaDocSelecionado, setDiaDocSelecionado] = useState<string | null>(
    null,
  )

  const finalizar = useFinalizarProcessamento(dados.uuid)
  const cancelarConvocacao = useCancelarConvocacao(dados.uuid)
  const erroEnvio =
    finalizar.error instanceof Error
      ? finalizar.error.message
      : "Erro ao enviar. Tente novamente."

  const diasConvocacao = useMemo(() => [...dados.dias].sort(), [dados.dias])
  const primeiroDiaConvocacao = diasConvocacao[0] ?? dados.dataInicio

  function salvarResposta(resposta: RespostaDia) {
    setRespostas((prev) => ({ ...prev, [resposta.data]: resposta }))
    setDiaEditando(null)
  }

  // --- Desconsiderar dia (toggle ativo) ---
  const handleClickDiaApagar = useCallback(
    (diaInfo: DiaInfo) => {
      if (!modoApagar) return
      setDiasInfo((prev) =>
        prev.map((d) =>
          d.data === diaInfo.data ? { ...d, ativo: false } : d,
        ),
      )
    },
    [modoApagar],
  )

  // --- Reactivate a desconsiderado day ---
  const reativarDia = useCallback((data: string) => {
    setDiasInfo((prev) =>
      prev.map((d) => (d.data === data ? { ...d, ativo: true } : d)),
    )
  }, [])

  const diasAtivos = useMemo(
    () => diasInfo.filter((d) => d.ativo),
    [diasInfo],
  )

  const atestadosPorData = useMemo(() => {
    const map = new Map<string, Atestado[]>()
    for (const atestado of atestados) {
      for (const dia of listarDiasPeriodo(atestado.dataInicio, atestado.dataFim)) {
        map.set(dia, [...(map.get(dia) ?? []), atestado])
      }
    }
    return map
  }, [atestados])

  // Sábados dentro do período da convocação que ainda não foram adicionados
  // como extras e que não fazem parte dos dias originais convocados.
  const sabadosDisponiveis = useMemo(() => {
    const existentes = new Set(diasInfo.map((d) => d.data))
    const out: string[] = []
    const inicio = parseISO(dados.dataInicio)
    const fim = parseISO(dados.dataFim)
    const cursor = new Date(inicio)
    while (cursor <= fim) {
      if (cursor.getUTCDay() === 6) {
        const iso = cursor.toISOString().slice(0, 10)
        if (!existentes.has(iso)) out.push(iso)
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return out
  }, [diasInfo, dados.dataInicio, dados.dataFim])

  const adicionarSabadosExtras = useCallback((datas: string[]) => {
    if (datas.length === 0) return
    setDiasInfo((prev) => {
      const existentes = new Set(prev.map((d) => d.data))
      const novos = datas
        .filter((d) => !existentes.has(d))
        .map<DiaInfo>((d) => ({ data: d, tipo: "extra", ativo: true }))
      return aplicarAtestadosNosDias(
        [...prev, ...novos].sort((a, b) => a.data.localeCompare(b.data)),
        atestados,
        dados,
      )
    })
    setRespostas((prev) => {
      const next = { ...prev }
      for (const d of datas) {
        if (!next[d]) next[d] = { data: d, tipo: "sem_ocorrencia" }
      }
      return next
    })
  }, [atestados, dados])

  const removerSabadoExtra = useCallback((data: string) => {
    setDiasInfo((prev) => prev.filter((d) => d.data !== data))
    setRespostas((prev) => {
      const next = { ...prev }
      delete next[data]
      return next
    })
  }, [])

  // Sábados extras já gravados no histórico (vieram do WF2) — já foram pagos,
  // não podem ser removidos pela UI. Backend (WF3) tb bloqueia se tentar.
  const sabadosJaPagos = useMemo(
    () => new Set(dados.sabadosExtras ?? []),
    [dados.sabadosExtras],
  )

  function pedirRemoverSabado(data: string) {
    if (sabadosJaPagos.has(data)) return
    setSabadoARemover(data)
    setEtapaSabados("confirmar_remover")
  }

  function confirmarRemoverSabado() {
    if (sabadoARemover) removerSabadoExtra(sabadoARemover)
    setSabadoARemover(null)
    setEtapaSabados("fechado")
  }

  function fecharSabados() {
    setEtapaSabados("fechado")
    setSabadoARemover(null)
  }

  function abrirInfoDocumento(data: string) {
    setDiaDocSelecionado(data)
  }

  function fecharInfoDocumento() {
    setDiaDocSelecionado(null)
  }

  // Conta TUDO que foge de "sem ocorrência":
  // faltas + atrasos + dias desconsiderados.
  const totalOcorrencias = useMemo(() => {
    const desconsiderados = diasInfo.filter((d) => !d.ativo).length
    const comOcorrencia = diasAtivos.filter(
      (d) => respostas[d.data] && respostas[d.data].tipo !== "sem_ocorrencia",
    ).length
    return desconsiderados + comOcorrencia
  }, [diasInfo, diasAtivos, respostas])

  async function enviar() {
    // Usa `||` (não `??`) porque o backend pode devolver "" em vez de null
    // quando a coluna Protocolo do monday está vazia.
    const protocolo = dados.protocolo || gerarProtocolo()
    const datasOriginais = new Set(dados.dias)
    const sabadosExtras = diasInfo
      .filter((d) => d.tipo === "extra" && d.ativo)
      .map((d) => d.data)
    const sabadosExtrasSet = new Set(sabadosExtras)
    const todasExtras = diasInfo
      .filter((d) => !datasOriginais.has(d.data) && !sabadosExtrasSet.has(d.data))
      .map((d) => d.data)
    const payload = {
      // Atestado/declaração agora tem ledger no backend pra dedup; respostas
      // manuais em dia coberto seguem normais (o WF3 ignora se já tem doc).
      // Dias queimados pelo cancelamento parcial são filtrados — backend
      // trata como falta automaticamente via Cancelamento Início no Entrada.
      respostas: diasAtivos
        .filter((d) => !diasCancelados.has(d.data))
        .map(
          (d) =>
            respostas[d.data] ?? { data: d.data, tipo: "sem_ocorrencia" as const },
        ),
      protocolo,
      diasExtras: todasExtras,
      diasDesativados: diasInfo.filter((d) => !d.ativo).map((d) => d.data),
      sabadosExtras,
      ehCorrecao: !!ehCorrecao,
    }
    const resultado = await finalizar.mutateAsync(payload)
    salvarProtocolo({
      protocolo: resultado.protocolo,
      uuid: dados.uuid,
      nome: dados.nome,
      dataInicio: dados.dataInicio,
      dataFim: dados.dataFim,
      concluidoEm: dados.concluidoEm ?? new Date().toISOString(),
      editadoEm: resultado.editado ? new Date().toISOString() : null,
    })
    onFinalizado?.(resultado.protocolo)
  }

  function abrirCancelamento() {
    setModoApagar(false)
    setCancelamentoErro(null)
    setDataInicioCancelamento(null)
    setEtapaCancelamento("escolha")
  }

  function fecharCancelamento() {
    if (cancelarConvocacao.isPending) return
    setEtapaCancelamento("fechado")
    setCancelamentoErro(null)
    setDataInicioCancelamento(null)
  }

  async function executarCancelamentoTotal() {
    setCancelamentoErro(null)
    try {
      await cancelarConvocacao.mutateAsync({
        tipo: "total",
        dataInicioCancelamento: null,
      })
      setEtapaCancelamento("sucesso_total")
    } catch (err) {
      setCancelamentoErro(
        err instanceof Error
          ? err.message
          : "Erro ao cancelar a convocação. Tente novamente.",
      )
    }
  }

  async function executarCancelamentoParcial(data: string) {
    setCancelamentoErro(null)
    try {
      await cancelarConvocacao.mutateAsync({
        tipo: "parcial",
        dataInicioCancelamento: data,
      })
      // Cancelamento parcial NÃO finaliza mais a convocação.
      // Fecha o dialog e volta pro painel — operacional ainda precisa lançar
      // respostas dos dias não-cancelados e clicar "Finalizar".
      // useProcessamento já invalida a query → refetch traz dataInicioCancelamento
      // do backend e pinta os dias queimados.
      setEtapaCancelamento("fechado")
      setDataInicioCancelamento(null)
    } catch (err) {
      setCancelamentoErro(
        err instanceof Error
          ? err.message
          : "Erro ao cancelar parcialmente. Tente novamente.",
      )
    }
  }

  async function executarReverter() {
    setReverterErro(null)
    try {
      await cancelarConvocacao.mutateAsync({
        tipo: "reverter",
        dataInicioCancelamento: null,
      })
      setReverterAberto(false)
    } catch (err) {
      setReverterErro(
        err instanceof Error
          ? err.message
          : "Erro ao reverter cancelamento. Tente novamente.",
      )
    }
  }

  function escolherDataCancelamento(data: string) {
    setDataInicioCancelamento(data)
    setCancelamentoErro(null)
    if (data === primeiroDiaConvocacao) {
      setEtapaCancelamento("confirmar_total")
      return
    }
    setEtapaCancelamento("confirmar_parcial")
  }

  function confirmarCancelamentoParcial() {
    if (!dataInicioCancelamento) return
    void executarCancelamentoParcial(dataInicioCancelamento)
  }

  // Só cancelamento TOTAL renderiza tela cheia de sucesso (finaliza convocação).
  // Parcial fecha o dialog e volta pro painel pra operacional completar.
  if (etapaCancelamento === "sucesso_total") {
    return (
      <TelaCancelamentoConvocacao
        dados={dados}
        etapa={etapaCancelamento}
        dias={diasConvocacao}
        dataInicioCancelamento={dataInicioCancelamento}
        erro={cancelamentoErro}
        isPending={cancelarConvocacao.isPending}
        onClose={fecharCancelamento}
        onEscolherParcial={() => {
          setCancelamentoErro(null)
          setEtapaCancelamento("calendario")
        }}
        onEscolherTotal={executarCancelamentoTotal}
        onSelecionarData={escolherDataCancelamento}
        onVoltarCalendario={() => setEtapaCancelamento("calendario")}
        onConfirmarTotal={executarCancelamentoTotal}
        onConfirmarParcial={confirmarCancelamentoParcial}
      />
    )
  }

  return (
    <div className="relative z-10 min-h-svh">
      {ehTeste && <BannerTeste />}
      <Header dados={dados} />

      <main className="mx-auto max-w-2xl px-4 pb-16">
        <section className="glass-strong p-8 sm:p-10 fade-up" style={{ animationDelay: "120ms" }}>
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-9 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 backdrop-blur">
              <Sparkles className="size-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-display text-3xl text-white">
                    Marque os dias com{" "}
                    <em className="italic text-[#e8c275]">ocorrência</em>
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    Todos os dias começam como{" "}
                    <span className="text-white/90">sem ocorrências</span>. Toque em
                    um dia para registrar uma falta ou atraso.
                  </p>
                </div>
              </div>

              {/* Action button: Desconsiderar */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className={`btn-action-expand btn-delete ${modoApagar ? "btn-delete-active" : ""}`}
                  onClick={() => setModoApagar((v) => !v)}
                  aria-label="Desconsiderar dia"
                >
                  {modoApagar ? (
                    <X className="size-4 shrink-0 text-orange-300" />
                  ) : (
                    <TrashCanIcon />
                  )}
                  <span className="btn-label text-orange-200">
                    {modoApagar ? "Concluir" : "Desconsiderar dia"}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-action-expand btn-cancel-convocacao"
                  onClick={abrirCancelamento}
                  aria-label="Cancelar convocação"
                >
                  <CancelFlameIcon />
                  <span className="btn-label text-red-200">
                    Cancelar convocação
                  </span>
                </button>
                {!dados.trabalhaSabado && (
                  <button
                    type="button"
                    className="btn-action-expand btn-add-sabados"
                    onClick={() => setEtapaSabados("calendario")}
                    aria-label="Adicionar sábados"
                  >
                    <CalendarPlus className="size-4 shrink-0 text-blue-300" />
                    <span className="btn-label text-blue-200">
                      Adicionar sábados
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Day grid: 2 per row, last odd item spans both columns */}
          <ul className="mt-7 grid grid-cols-2 gap-2.5 dia-grid">
            {diasInfo.map((diaInfo, i) => (
              <DiaItem
                key={diaInfo.data}
                diaInfo={diaInfo}
                resposta={respostas[diaInfo.data]}
                index={i}
                modoApagar={modoApagar}
                onEdit={() => {
                  if (!modoApagar && diaInfo.ativo) setDiaEditando(diaInfo.data)
                }}
                onApagar={() => handleClickDiaApagar(diaInfo)}
                onReativar={() => reativarDia(diaInfo.data)}
                onRemoverExtra={() => pedirRemoverSabado(diaInfo.data)}
                atestadosNoDia={atestadosPorData.get(diaInfo.data) ?? []}
                onAbrirAtestadoInfo={() => abrirInfoDocumento(diaInfo.data)}
                podeRemoverExtra={!sabadosJaPagos.has(diaInfo.data)}
                isCancelado={diasCancelados.has(diaInfo.data)}
                onAbrirReverter={() => setReverterAberto(true)}
              />
            ))}
          </ul>

          {/* Desconsiderar mode banner */}
          {modoApagar && (
            <div className="glass-banner-danger mt-4 flex items-center justify-center gap-2 px-4 py-3 fade-up">
              <Trash2 className="size-4 text-red-300/80" />
              <p className="text-sm text-red-200/80">
                Toque em um dia para desconsiderá-lo. Clique em{" "}
                <strong className="text-red-200">Concluir</strong> quando terminar.
              </p>
            </div>
          )}

          {finalizar.isError ? (
            <p className="mt-6 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-center text-sm text-rose-100">
              {erroEnvio}
            </p>
          ) : null}

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={enviar}
              disabled={finalizar.isPending || modoApagar}
              className="glass-strong glow-gold group relative inline-flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-full px-8 text-base font-medium tracking-wide text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70"
              style={{
                background:
                  "linear-gradient(135deg, #e8c275 0%, #d4a64a 55%, #6ea0ff 130%)",
                border: "1px solid rgba(255,236,194,0.5)",
              }}
            >
              {finalizar.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                <>Finalizar e enviar</>
              )}
            </button>

            <p className="text-center text-xs text-white/55">
              {totalOcorrencias === 0
                ? "Nenhuma ocorrência registrada. Você pode finalizar assim mesmo."
                : `${totalOcorrencias} ${
                    totalOcorrencias === 1 ? "dia com ocorrência" : "dias com ocorrência"
                  }.`}
            </p>
          </div>
        </section>
      </main>

      {/* Dialog: edit day occurrence */}
      <DialogDia
        dia={diaEditando}
        respostaAtual={diaEditando ? respostas[diaEditando] : undefined}
        onClose={() => setDiaEditando(null)}
        onSalvar={salvarResposta}
      />
      <DialogCancelamento
        etapa={etapaCancelamento}
        dias={diasConvocacao}
        dataInicioCancelamento={dataInicioCancelamento}
        erro={cancelamentoErro}
        isPending={cancelarConvocacao.isPending}
        onClose={fecharCancelamento}
        onEscolherParcial={() => {
          setCancelamentoErro(null)
          setEtapaCancelamento("calendario")
        }}
        onEscolherTotal={executarCancelamentoTotal}
        onSelecionarData={escolherDataCancelamento}
        onVoltarCalendario={() => setEtapaCancelamento("calendario")}
        onConfirmarTotal={executarCancelamentoTotal}
        onConfirmarParcial={confirmarCancelamentoParcial}
      />
      <DialogSelecionarSabados
        open={etapaSabados === "calendario"}
        sabadosDisponiveis={sabadosDisponiveis}
        dataInicio={dados.dataInicio}
        onClose={fecharSabados}
        onConfirmar={(datas) => {
          adicionarSabadosExtras(datas)
          fecharSabados()
        }}
      />
      <DialogConfirmarRemoverSabado
        open={etapaSabados === "confirmar_remover"}
        data={sabadoARemover}
        onCancelar={fecharSabados}
        onConfirmar={confirmarRemoverSabado}
      />
      <DialogDiaComDocumento
        data={diaDocSelecionado}
        documentos={
          diaDocSelecionado ? atestadosPorData.get(diaDocSelecionado) ?? [] : []
        }
        onClose={fecharInfoDocumento}
      />
      <DialogReverterCancelamento
        open={reverterAberto}
        carregando={cancelarConvocacao.isPending}
        erro={reverterErro}
        dataInicioCancelamento={dados.dataInicioCancelamento ?? null}
        onCancelar={() => {
          if (cancelarConvocacao.isPending) return
          setReverterAberto(false)
          setReverterErro(null)
        }}
        onConfirmar={executarReverter}
      />
    </div>
  )
}

/* ─── Day grid item ─── */

type DiaItemProps = {
  diaInfo: DiaInfo
  resposta: RespostaDia | undefined
  index: number
  modoApagar: boolean
  onEdit: () => void
  onApagar: () => void
  onReativar: () => void
  onRemoverExtra: () => void
  atestadosNoDia: Atestado[]
  onAbrirAtestadoInfo: () => void
  podeRemoverExtra?: boolean
  isCancelado: boolean
  onAbrirReverter: () => void
}

function DiaItem({
  diaInfo,
  resposta,
  index,
  modoApagar,
  onEdit,
  onApagar,
  onReativar,
  onRemoverExtra,
  atestadosNoDia,
  onAbrirAtestadoInfo,
  podeRemoverExtra = true,
  isCancelado,
  onAbrirReverter,
}: DiaItemProps) {
  const isDisabled = !diaInfo.ativo
  const isExtra = diaInfo.tipo === "extra"
  const isAtestado = diaInfo.tipo === "atestado" || atestadosNoDia.length > 0
  // Quando todos os docs no dia são declaração → visual violeta.
  // Misto ou atestado → visual âmbar (atestado tem prioridade).
  const ehDeclaracaoPura =
    isAtestado &&
    atestadosNoDia.length > 0 &&
    atestadosNoDia.every((a) => a.tipoDocumento === "declaracao")

  const tileBase =
    "group relative flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-4 text-left"
  // Cancelado tem prioridade sobre os outros estados — mantém glass-tile-3d
  // pra preservar tilt mousemove, sobrepõe fogo via .glass-tile-cancelado.
  const tileStyle = isCancelado
    ? "glass-tile glass-tile-3d glass-tile-cancelado"
    : isDisabled
      ? "glass-tile-disabled"
      : isAtestado
        ? ehDeclaracaoPura
          ? "glass-tile-declaracao"
          : "glass-tile-atestado"
        : isExtra
          ? "glass-tile-extra"
          : "glass-tile glass-tile-3d"

  const shakeClass = modoApagar && diaInfo.ativo ? "shake-mode" : ""

  function handleClick() {
    // Cancelado captura primeiro: click abre dialog de reverter.
    if (isCancelado) {
      onAbrirReverter()
      return
    }
    if (modoApagar && diaInfo.ativo) {
      onApagar()
    } else if (isDisabled) {
      // Reativar via overlay
      return
    } else if (isAtestado) {
      onAbrirAtestadoInfo()
    } else if (!modoApagar) {
      onEdit()
    }
  }

  // 3D tilt: cursor sets --mx/--my, CSS does perspective rotateX/Y.
  // Cancelado mantém tilt — fogo é overlay, botão ainda responde.
  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    if (isDisabled && !isCancelado) return
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  return (
    <li
      className={`fade-up ${shakeClass}`.trim()}
      style={{ animationDelay: `${200 + index * 60}ms` }}
    >
      <button
        type="button"
        className={`${tileBase} ${tileStyle}`}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <p
          className={`text-[10px] uppercase tracking-[0.18em] ${
            isCancelado
              ? "text-orange-300/55"
              : isDisabled
                ? "text-white/30"
                : "text-white/55"
          }`}
        >
          {formatarDiaSemana(diaInfo.data)}
        </p>
        <p
          className={`text-display text-2xl leading-none ${
            isCancelado
              ? "text-orange-200/60"
              : isDisabled
                ? "text-white/35 line-through"
                : "text-white/95"
          }`}
        >
          {formatarDiaCurto(diaInfo.data)}
        </p>
        <div className="mt-1 text-xs">
          {isCancelado ? (
            <span className="inline-flex items-center gap-1.5 text-orange-300/85">
              Cancelado
            </span>
          ) : isDisabled ? (
            <span className="inline-flex items-center gap-1.5 text-violet-300/75">
              <LampBroken />
              Desconsiderado
            </span>
          ) : isAtestado ? (
            <span
              className={`inline-flex items-center gap-1.5 ${
                ehDeclaracaoPura ? "text-violet-200" : "text-amber-200"
              }`}
            >
              <FileText className="size-3" />
              {rotularDocumentoTile(atestadosNoDia)}
            </span>
          ) : (
            <BadgeResposta resposta={resposta} />
          )}
        </div>

        {isAtestado && !isDisabled ? (
          <svg
            className={
              ehDeclaracaoPura ? "declaracao-dash-svg" : "atestado-dash-svg"
            }
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="100%" height="100%" rx="16" ry="16" />
          </svg>
        ) : null}

        {isCancelado && (
          <>
            {/* Tile cortado ao meio na diagonal — duas metades com gap
                visível: esquerda desce (mais embaixo), direita sobe
                levemente. Glow laranja-vermelho na borda do corte via
                drop-shadow (respeita clip-path) → efeito de corte quente. */}
            <span className="tile-cut tile-cut-left" aria-hidden="true" />
            <span className="tile-cut tile-cut-right" aria-hidden="true" />
          </>
        )}

        {isExtra && !isDisabled && !isAtestado && (
          <svg
            className="extra-dash-svg"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              rx="16"
              ry="16"
            />
          </svg>
        )}

        {isExtra && !podeRemoverExtra && !isDisabled && !isAtestado && (
          <span
            className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-blue-300/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-200 ring-1 ring-blue-300/30"
            title="Sábado extra já pago — não removível"
          >
            Pago
          </span>
        )}

        {isExtra && !modoApagar && !isDisabled && !isAtestado && podeRemoverExtra && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Remover sábado extra"
            onClick={(e) => {
              e.stopPropagation()
              onRemoverExtra()
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                onRemoverExtra()
              }
            }}
            className="btn-remover-sabado absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full ring-1 ring-blue-300/40 transition-all"
          >
            <X className="size-3 text-blue-200" />
          </span>
        )}

        {modoApagar && diaInfo.ativo && !isExtra && !isAtestado && (
          <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-red-400/15 ring-1 ring-red-400/30 transition-all group-hover:bg-red-400/25">
            <X className="size-3 text-red-300" />
          </div>
        )}

        {/* Overlay for reactivating desconsiderados */}
        {isDisabled && (
          <div
            className="disabled-overlay"
            onClick={(e) => {
              e.stopPropagation()
              onReativar()
            }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/90 backdrop-blur transition-all hover:bg-white/15">
              <RotateCcw className="size-3" />
              Reativar
            </span>
          </div>
        )}
      </button>
    </li>
  )
}

/* ─── Header ─── */

function Header({ dados }: { dados: ProcessamentoDados }) {
  return (
    <header className="mx-auto max-w-2xl px-4 pt-12 pb-8 fade-up">
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
        Registro de ocorrências
      </p>
      <h1 className="text-display mt-3 text-5xl leading-[1.05] text-white">
        {dados.nome}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dados.contrato ? (
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75 backdrop-blur">
            Contrato {dados.contrato}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75 backdrop-blur">
          <CalendarDays className="size-3.5" />
          {format(parseISO(dados.dataInicio), "dd/MM/yyyy")} —{" "}
          {format(parseISO(dados.dataFim), "dd/MM/yyyy")}
        </span>
      </div>
    </header>
  )
}

/* ─── Dialog: Edit day occurrence ─── */

type Passo = "faltou" | "atraso" | "minutos"

type DialogDiaProps = {
  dia: string | null
  respostaAtual: RespostaDia | undefined
  onClose: () => void
  onSalvar: (r: RespostaDia) => void
}

function DialogDia({ dia, respostaAtual, onClose, onSalvar }: DialogDiaProps) {
  const [passo, setPasso] = useState<Passo>("faltou")
  const [minutos, setMinutos] = useState<string>("")

  useEffect(() => {
    setPasso("faltou")
    setMinutos(
      respostaAtual?.tipo === "atraso" && respostaAtual.minutosAtraso
        ? String(respostaAtual.minutosAtraso)
        : "",
    )
  }, [dia, respostaAtual])

  if (!dia) return null

  function handleFoiTrabalhar(v: boolean) {
    if (v) {
      setPasso("atraso")
    } else {
      onSalvar({ data: dia!, tipo: "falta" })
    }
  }

  function handleChegouNoHorario(v: boolean) {
    if (v) {
      onSalvar({ data: dia!, tipo: "sem_ocorrencia" })
    } else {
      setPasso("minutos")
    }
  }

  function confirmarMinutos(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(minutos)
    if (!Number.isFinite(n) || n <= 0) return
    onSalvar({ data: dia!, tipo: "atraso", minutosAtraso: Math.round(n) })
  }

  function marcarSemOcorrencia() {
    onSalvar({ data: dia!, tipo: "sem_ocorrencia" })
  }

  return (
    <Dialog open={!!dia} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md" style={{ backdropFilter: 'blur(10px) saturate(140%) brightness(1.05)' }}>
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Registrar dia
          </p>
          <DialogTitle className="text-display text-3xl capitalize text-white">
            {formatarDiaCompleto(dia)}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Registre o que aconteceu neste dia.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-white/12" />

        {passo === "faltou" ? (
          <div className="space-y-4">
            <h3 className="text-[15px] font-medium text-white/90">
              O intermitente foi trabalhar neste dia?
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton
                onClick={() => handleFoiTrabalhar(false)}
                variant="danger"
              >
                Não, faltou
              </ChoiceButton>
              <ChoiceButton
                onClick={() => handleFoiTrabalhar(true)}
                variant="primary"
              >
                Sim
              </ChoiceButton>
            </div>
          </div>
        ) : null}

        {passo === "atraso" ? (
          <div className="space-y-4">
            <h3 className="text-[15px] font-medium text-white/90">
              Chegou no horário e cumpriu o expediente?
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton
                onClick={() => handleChegouNoHorario(false)}
                variant="danger"
              >
                Não
              </ChoiceButton>
              <ChoiceButton
                onClick={() => handleChegouNoHorario(true)}
                variant="primary"
              >
                Sim
              </ChoiceButton>
            </div>
          </div>
        ) : null}

        {passo === "minutos" ? (
          <form className="space-y-4" onSubmit={confirmarMinutos}>
            <div className="space-y-2">
              <Label htmlFor="minutos" className="text-white/85">
                Quantos minutos fora do expediente?
              </Label>
              <div className="flex items-center gap-3">
                <NumStepper
                  id="minutos"
                  value={minutos}
                  onChange={setMinutos}
                  min={1}
                  step={1}
                  placeholder="Ex: 30"
                  autoFocus
                  className="flex-1"
                />
                <span className="text-sm text-white/60">minutos</span>
              </div>
            </div>
            <ChoiceButton
              type="submit"
              variant="primary"
              disabled={!(Number(minutos) > 0)}
              className="w-full"
            >
              Confirmar
            </ChoiceButton>
          </form>
        ) : null}

        <DialogFooter className="mt-2 sm:justify-between">
          {respostaAtual && respostaAtual.tipo !== "sem_ocorrencia" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={marcarSemOcorrencia}
              className="text-white/65 hover:bg-white/10 hover:text-white"
            >
              Marcar como sem ocorrências
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/65 hover:bg-white/10 hover:text-white"
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Shared components ─── */

/* Dialog: cancelamento */

type DialogCancelamentoProps = {
  etapa: EtapaCancelamento
  dias: string[]
  dataInicioCancelamento: string | null
  erro: string | null
  isPending: boolean
  onClose: () => void
  onEscolherParcial: () => void
  onEscolherTotal: () => void
  onSelecionarData: (data: string) => void
  onVoltarCalendario: () => void
  onConfirmarTotal: () => void
  onConfirmarParcial: () => void
}

function DialogCancelamento({
  etapa,
  dias,
  dataInicioCancelamento,
  erro,
  isPending,
  onClose,
  onEscolherParcial,
  onEscolherTotal,
  onSelecionarData,
  onVoltarCalendario,
  onConfirmarTotal,
  onConfirmarParcial,
}: DialogCancelamentoProps) {
  const aberto =
    etapa === "escolha" ||
    etapa === "calendario" ||
    etapa === "confirmar_total" ||
    etapa === "confirmar_parcial"

  return (
    <Dialog open={aberto} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-lg"
        style={{ backdropFilter: "blur(10px) saturate(140%) brightness(1.05)" }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Cancelamento
          </p>
          <DialogTitle className="text-display text-3xl text-white">
            {etapa === "calendario" ? (
              <>
                Escolha o <em className="italic text-[#e8c275]">início</em>
              </>
            ) : etapa === "confirmar_total" ? (
              <>
                Cancelar <em className="italic text-[#e8c275]">tudo</em>?
              </>
            ) : etapa === "confirmar_parcial" ? (
              <>
                Confirmar <em className="italic text-[#e8c275]">cancelamento</em>?
              </>
            ) : (
              <>
                Cancelar <em className="italic text-[#e8c275]">convocação</em>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {etapa === "calendario"
              ? "O cancelamento parcial vale da data escolhida até o fim da convocação."
              : etapa === "confirmar_total"
                ? "Você selecionou todo o período da convocação."
                : etapa === "confirmar_parcial"
                  ? "Revise a data antes de prosseguir. A ação não pode ser desfeita."
                  : "Escolha se o cancelamento será total ou parcial."}
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-white/12" />

        {etapa === "escolha" ? (
          <div className="grid gap-3">
            <ChoiceButton
              onClick={onEscolherParcial}
              variant="warning"
              disabled={isPending}
              className="w-full"
            >
              Cancelar parcialmente
            </ChoiceButton>
            <ChoiceButton
              onClick={onEscolherTotal}
              variant="danger"
              disabled={isPending}
              className="w-full"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Cancelando
                </span>
              ) : (
                "Cancelar convocação"
              )}
            </ChoiceButton>
          </div>
        ) : null}

        {etapa === "calendario" ? (
          <CalendarioCancelamento
            dias={dias}
            selected={dataInicioCancelamento}
            disabled={isPending}
            onSelect={onSelecionarData}
          />
        ) : null}

        {etapa === "confirmar_total" ? (
          <div className="space-y-4">
            <p className="rounded-2xl border border-orange-300/30 bg-orange-300/10 px-4 py-3 text-sm leading-relaxed text-orange-100">
              A data selecionada é o primeiro dia da convocação. Isso cancela o
              período inteiro. Pode prosseguir?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton onClick={onVoltarCalendario} disabled={isPending}>
                Não
              </ChoiceButton>
              <ChoiceButton
                onClick={onConfirmarTotal}
                variant="danger"
                disabled={isPending}
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Cancelando
                  </span>
                ) : (
                  "Sim"
                )}
              </ChoiceButton>
            </div>
          </div>
        ) : null}

        {etapa === "confirmar_parcial" ? (
          <div className="space-y-4">
            <p className="rounded-2xl border border-orange-300/30 bg-orange-300/10 px-4 py-3 text-sm leading-relaxed text-orange-100">
              Cancelar a convocação a partir de{" "}
              <strong className="text-orange-50">
                {dataInicioCancelamento
                  ? formatarDataNumerica(dataInicioCancelamento)
                  : "—"}
              </strong>{" "}
              até o fim do período? A ação não pode ser desfeita.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton onClick={onVoltarCalendario} disabled={isPending}>
                Voltar
              </ChoiceButton>
              <ChoiceButton
                onClick={onConfirmarParcial}
                variant="warning"
                disabled={isPending}
              >
                {isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Cancelando
                  </span>
                ) : (
                  "Confirmar"
                )}
              </ChoiceButton>
            </div>
          </div>
        ) : null}

        {erro ? (
          <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {erro}
          </p>
        ) : null}

        <DialogFooter className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isPending}
            className="text-white/65 hover:bg-white/10 hover:text-white"
          >
            Voltar ao registro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* Cancelamento em tela cheia */

type TelaCancelamentoConvocacaoProps = {
  dados: ProcessamentoDados
  etapa: EtapaCancelamento
  dias: string[]
  dataInicioCancelamento: string | null
  erro: string | null
  isPending: boolean
  onClose: () => void
  onEscolherParcial: () => void
  onEscolherTotal: () => void
  onSelecionarData: (data: string) => void
  onVoltarCalendario: () => void
  onConfirmarTotal: () => void
  onConfirmarParcial: () => void
}

function TelaCancelamentoConvocacao({
  dados,
  etapa,
  dias,
  dataInicioCancelamento,
  erro,
  isPending,
  onClose,
  onEscolherParcial,
  onEscolherTotal,
  onSelecionarData,
  onVoltarCalendario,
  onConfirmarTotal,
  onConfirmarParcial,
}: TelaCancelamentoConvocacaoProps) {
  const sucessoTotal = etapa === "sucesso_total"
  const sucessoParcial = etapa === "sucesso_parcial"

  return (
    <div className="relative z-10 flex min-h-svh flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="glass-strong w-full max-w-md p-10 text-center fade-up">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-950/70 text-red-100 shadow-[0_18px_46px_-10px_rgba(127,29,29,0.72)] ring-1 ring-red-300/35">
            {sucessoTotal || sucessoParcial ? (
              <span className="text-3xl leading-none">✓</span>
            ) : (
              <span className="text-3xl leading-none">✓</span>
            )}
          </div>

          <p className="mt-6 text-[11px] uppercase tracking-[0.32em] text-white/55">
            Cancelamento
          </p>
          <h1 className="text-display mt-2 text-4xl leading-tight text-white">
            {sucessoParcial ? (
              <>
                Cancelamento{" "}
                <em className="italic text-[#e8c275]">parcial</em>
              </>
            ) : etapa === "calendario" ? (
              <>
                Escolha o <em className="italic text-[#e8c275]">início</em>
              </>
            ) : (
              <>
                Cancelar{" "}
                <em className="italic text-[#e8c275]">convocação</em>
              </>
            )}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            {sucessoTotal
              ? `A convocação de ${dados.nome} foi cancelada com sucesso.`
              : sucessoParcial
                ? `A convocação de ${dados.nome} foi cancelada parcialmente.`
                : etapa === "calendario"
                  ? "O cancelamento parcial vale da data escolhida até o fim da convocação."
                  : etapa === "confirmar_total"
                    ? "Você selecionou todo o período da convocação."
                    : etapa === "confirmar_parcial"
                      ? "Revise a data antes de prosseguir. A ação não pode ser desfeita."
                      : "Escolha se o cancelamento será total ou parcial."}
          </p>

          <div className="mt-7 rounded-2xl border border-white/12 bg-white/5 p-5 text-left backdrop-blur">
            {etapa === "escolha" ? (
              <div className="grid gap-3">
                <ChoiceButton
                  onClick={onEscolherParcial}
                  variant="warning"
                  disabled={isPending}
                  className="w-full"
                >
                  Cancelar parcialmente
                </ChoiceButton>
                <ChoiceButton
                  onClick={onEscolherTotal}
                  variant="danger"
                  disabled={isPending}
                  className="w-full"
                >
                  {isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      Cancelando
                    </span>
                  ) : (
                    "Cancelar convocação"
                  )}
                </ChoiceButton>
              </div>
            ) : null}

            {etapa === "calendario" ? (
              <CalendarioCancelamento
                dias={dias}
                selected={dataInicioCancelamento}
                disabled={isPending}
                onSelect={onSelecionarData}
              />
            ) : null}

            {etapa === "confirmar_total" ? (
              <div className="space-y-4">
                <p className="rounded-2xl border border-orange-300/30 bg-orange-300/10 px-4 py-3 text-sm leading-relaxed text-orange-100">
                  A data selecionada é o primeiro dia da convocação. Isso
                  cancela o período inteiro. Pode prosseguir?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <ChoiceButton
                    onClick={onVoltarCalendario}
                    disabled={isPending}
                  >
                    Não
                  </ChoiceButton>
                  <ChoiceButton
                    onClick={onConfirmarTotal}
                    variant="danger"
                    disabled={isPending}
                  >
                    {isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        Cancelando
                      </span>
                    ) : (
                      "Sim"
                    )}
                  </ChoiceButton>
                </div>
              </div>
            ) : null}

            {etapa === "confirmar_parcial" ? (
              <div className="space-y-4">
                <p className="rounded-2xl border border-orange-300/30 bg-orange-300/10 px-4 py-3 text-sm leading-relaxed text-orange-100">
                  Cancelar a convocação a partir de{" "}
                  <strong className="text-orange-50">
                    {dataInicioCancelamento
                      ? formatarDataNumerica(dataInicioCancelamento)
                      : "—"}
                  </strong>{" "}
                  até o fim do período? A ação não pode ser desfeita.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <ChoiceButton
                    onClick={onVoltarCalendario}
                    disabled={isPending}
                  >
                    Voltar
                  </ChoiceButton>
                  <ChoiceButton
                    onClick={onConfirmarParcial}
                    variant="warning"
                    disabled={isPending}
                  >
                    {isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        Cancelando
                      </span>
                    ) : (
                      "Confirmar"
                    )}
                  </ChoiceButton>
                </div>
              </div>
            ) : null}

            {sucessoTotal || sucessoParcial ? (
              <div className="space-y-4 text-center">
                <p className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-4 text-sm text-emerald-100">
                  {sucessoTotal
                    ? "Convocação cancelada com sucesso."
                    : `Cancelamento parcial registrado a partir de ${
                        dataInicioCancelamento
                          ? formatarDataNumerica(dataInicioCancelamento)
                          : "data selecionada"
                      }.`}
                </p>
                <Link to="/" className="choice-btn choice-btn--primary w-full">
                  Ir para a tela inicial
                </Link>
              </div>
            ) : null}

            {erro ? (
              <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
                {erro}
              </p>
            ) : null}
          </div>

          {!sucessoTotal && !sucessoParcial ? (
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="mt-6 inline-flex items-center gap-2 text-sm text-white/55 transition hover:text-white"
            >
              <ArrowLeft className="size-4" />
              Voltar ao registro
            </button>
          ) : (
            <p className="mt-8 text-xs text-white/45">
              Este registro foi encerrado.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function CalendarioCancelamento({
  dias,
  selected,
  disabled,
  onSelect,
}: {
  dias: string[]
  selected: string | null
  disabled: boolean
  onSelect: (data: string) => void
}) {
  const primeiroDia = dias[0] ?? format(new Date(), "yyyy-MM-dd")
  const [mesVisivel, setMesVisivel] = useState(() => parseISO(primeiroDia))

  useEffect(() => {
    setMesVisivel(parseISO(primeiroDia))
  }, [primeiroDia])

  const diasPermitidos = useMemo(() => new Set(dias), [dias])
  const diasDoMes = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesVisivel), { weekStartsOn: 0 })
    const fim = endOfWeek(endOfMonth(mesVisivel), { weekStartsOn: 0 })
    const out: Date[] = []
    const d = new Date(inicio)
    while (d <= fim) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [mesVisivel])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMesVisivel((m) => subMonths(m, 1))}
          className="inline-flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
        >
          <ArrowLeft className="size-4" />
        </button>
        <p className="text-display text-lg capitalize text-white/95">
          {format(mesVisivel, "MMMM 'de' yyyy", { locale: ptBR })}
        </p>
        <button
          type="button"
          onClick={() => setMesVisivel((m) => addMonths(m, 1))}
          className="inline-flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
        >
          <ArrowLeft className="size-4 rotate-180" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div
            key={i}
            className="py-1 text-center text-[10px] uppercase tracking-wider text-white/40"
          >
            {d}
          </div>
        ))}
        {diasDoMes.map((dia) => {
          const iso = format(dia, "yyyy-MM-dd")
          const permitido = diasPermitidos.has(iso)
          const selecionado = selected && isSameDay(dia, parseISO(selected))
          const noMes = isSameMonth(dia, mesVisivel)
          return (
            <button
              key={iso}
              type="button"
              disabled={!permitido || disabled}
              onClick={() => onSelect(iso)}
              className={`flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition ${
                selecionado
                  ? "bg-orange-300 text-[#0a1224] shadow-[0_0_18px_rgba(251,146,60,0.45)]"
                  : permitido
                    ? "text-white/90 hover:bg-orange-300/15 hover:text-orange-100"
                    : noMes
                      ? "cursor-not-allowed text-white/18"
                      : "cursor-not-allowed text-white/10"
              }`}
            >
              {dia.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TrashCanIcon() {
  // SVG estilo lixeira clássica: alça curta no topo + barra grossa da tampa
  // + corpo com 3 ribs verticais. Tampa pivota e ergue ao hover.
  return (
    <svg
      className="trash-can-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Tampa: alça + barra horizontal */}
      <g className="trash-lid-svg">
        <path d="M10 3.5h4" strokeWidth="1.7" />
        <path d="M3.2 6.7h17.6" strokeWidth="2.1" />
      </g>
      {/* Corpo: silhueta levemente trapezoidal + 3 ribs */}
      <g className="trash-body-svg">
        <path
          d="M5.2 7.7l1 13.2a1.8 1.8 0 0 0 1.8 1.6h8a1.8 1.8 0 0 0 1.8-1.6l1-13.2"
          strokeWidth="1.7"
        />
        <path d="M9.2 11v8.5" strokeWidth="1.5" />
        <path d="M12 11v8.5" strokeWidth="1.5" />
        <path d="M14.8 11v8.5" strokeWidth="1.5" />
      </g>
    </svg>
  )
}

function CancelFlameIcon() {
  // SVG: 3 chamas concêntricas (outer/mid/inner) + brasas embaixo.
  // Cada chama tem keyframe próprio com duração desalinhada — efeito fire
  // realista sem ciclo perceptível. Só anima no hover do botão.
  return (
    <span className="cancel-flame-icon" aria-hidden="true">
      <svg
        className="cancel-flame-svg"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="flame-outer"
          d="M12 22c-4 0-7-2.7-7-6.4 0-2.8 1.8-4.6 3-6.2.6-.7.8-1.5.4-2.4 1.6.4 2.6 1.6 2.9 3.1.4-2.4 1.8-4 4.1-6.1 0 2.2.9 3.3 1.8 4.6 1.3 1.7 2.8 3.4 2.8 6 0 4-3 7.4-8 7.4Z"
          fill="rgba(239, 68, 68, 0.42)"
          stroke="rgba(248, 113, 113, 0.9)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          className="flame-mid"
          d="M12 20.2c-2.6 0-4.6-1.7-4.6-4.2 0-1.7 1-3 1.9-4 .8-.8 1-1.7.7-2.7 1.4.6 2.1 1.7 2.3 3 .3-1.6 1.2-2.6 2.6-3.9.1 1.5.6 2.4 1.3 3.3.9 1.2 1.7 2.2 1.7 4.1 0 2.6-2 4.4-5.9 4.4Z"
          fill="rgba(251, 146, 60, 0.6)"
          stroke="rgba(251, 191, 36, 0.85)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <path
          className="flame-inner"
          d="M12 18.4c-1.4 0-2.5-.9-2.5-2.3 0-1 .6-1.7 1.1-2.3.5-.5.6-1.1.4-1.7.8.4 1.2 1 1.4 1.8.2-1 .7-1.6 1.5-2.3 0 .9.3 1.5.8 2 .5.7 1 1.3 1 2.4 0 1.5-1.1 2.4-3.7 2.4Z"
          fill="rgba(253, 224, 71, 0.85)"
        />
      </svg>
      <span className="flame-base-glow" />
    </span>
  )
}

type NumStepperProps = {
  id?: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

function NumStepper({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  autoFocus,
  className = "",
}: NumStepperProps) {
  const num = Number(value)
  const safeNum = Number.isFinite(num) ? num : 0
  const canDec = min === undefined || safeNum > min
  const canInc = max === undefined || safeNum < max

  function bump(delta: number) {
    const base = Number.isFinite(num) ? num : (min ?? 0)
    let next = base + delta
    if (min !== undefined && next < min) next = min
    if (max !== undefined && next > max) next = max
    onChange(String(next))
  }

  // Aceita só dígitos no input — evita validação chata do HTML5 number
  // ("valor mais próximo é X") quando o usuário digita um valor que não
  // bate com o `step`. Usamos type="text" + inputMode="numeric" pra
  // mostrar teclado numérico no mobile sem o validation nativo.
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/[^\d]/g, "")
    onChange(v)
  }

  return (
    <div className={`num-stepper ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        autoFocus={autoFocus}
      />
      <div className="num-stepper-controls" aria-hidden>
        <button
          type="button"
          className="num-stepper-btn"
          onClick={() => bump(step)}
          disabled={!canInc}
          tabIndex={-1}
          aria-label="Aumentar"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          className="num-stepper-btn"
          onClick={() => bump(-step)}
          disabled={!canDec}
          tabIndex={-1}
          aria-label="Diminuir"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
    </div>
  )
}

function ChoiceButton({
  children,
  variant = "ghost",
  className = "",
  onMouseMove,
  onMouseLeave,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "primary" | "danger" | "warning"
}) {
  // Tilt 3D segue o cursor: --mx, --my (0..100%) consumidos pelo CSS .choice-btn
  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
    onMouseMove?.(e)
  }
  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
    onMouseLeave?.(e)
  }
  const variantClass =
    variant === "primary"
      ? "choice-btn--primary"
      : variant === "danger"
        ? "choice-btn--danger"
        : variant === "warning"
          ? "choice-btn--warning"
          : ""
  return (
    <button
      {...props}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`choice-btn ${variantClass} ${className}`}
    >
      {children}
    </button>
  )
}

function BadgeResposta({ resposta }: { resposta: RespostaDia | undefined }) {
  if (!resposta || resposta.tipo === "sem_ocorrencia") {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <span className="lamp lamp-on-green" />
        Sem ocorrências
      </span>
    )
  }
  if (resposta.tipo === "falta") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-300/85">
        <span className="lamp lamp-off" />
        Faltou
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-yellow-300">
      <span className="lamp lamp-flicker-yellow" />
      {resposta.minutosAtraso} min
    </span>
  )
}

/* Banner fixo no topo quando o usuário está num quadro de teste (UUID mock-).
   Avisa que NÃO é um registro real e oferece atalho pra voltar à correção.
   Sticky pra acompanhar o scroll na lista de dias. */
function BannerTeste() {
  return (
    <div className="sticky top-0 z-30 w-full border-b border-amber-300/20 bg-amber-500/[0.08] px-4 py-2.5 backdrop-blur-md fade-up">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FlaskConical className="size-4 shrink-0 text-amber-300" />
          <p className="truncate text-xs leading-relaxed text-amber-100/85">
            <span className="font-semibold">Quadro de teste</span>
            <span className="text-amber-100/60"> · nada do que for enviado aqui é registrado de verdade.</span>
          </p>
        </div>
        <Link
          to="/corrigir"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/[0.08] px-3 py-1 text-[11px] font-medium text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-300/15"
        >
          <ArrowLeft className="size-3" />
          Sair do teste
        </Link>
      </div>
    </div>
  )
}

/* Lâmpada quebrada — bulbo escurecido roxo + rachadura SVG.
   Usada no estado "Desconsiderado" pra distinguir visualmente das
   outras 3 lâmpadas (verde/sem-oco, cinza/falta, amarela/atraso). */
function LampBroken() {
  return (
    <span className="lamp-broken-wrap" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12" className="block">
        <defs>
          <radialGradient id="lb-bg" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#4a2852" />
            <stop offset="100%" stopColor="#0e0518" />
          </radialGradient>
        </defs>
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="url(#lb-bg)"
          stroke="rgba(168,85,247,0.45)"
          strokeWidth="0.4"
        />
        {/* Rachadura principal em zigue-zague */}
        <path
          d="M3.4 2.6 L4.9 4.4 L3.9 5.2 L5.4 6.9 L4.4 8.7"
          stroke="rgba(240,210,255,0.9)"
          strokeWidth="0.7"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Trinca secundária menor */}
        <path
          d="M7.6 4 L7 5.6"
          stroke="rgba(240,210,255,0.55)"
          strokeWidth="0.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}


/* ─── Dialog: Selecionar sábados extras ─── */

type DialogSelecionarSabadosProps = {
  open: boolean
  sabadosDisponiveis: string[]
  dataInicio: string
  onClose: () => void
  onConfirmar: (datas: string[]) => void
}

function DialogSelecionarSabados({
  open,
  sabadosDisponiveis,
  dataInicio,
  onClose,
  onConfirmar,
}: DialogSelecionarSabadosProps) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [mesVisivel, setMesVisivel] = useState(() => parseISO(dataInicio))
  const [prevOpen, setPrevOpen] = useState(open)

  // Reset interno quando o diálogo abre — padrão setState-during-render
  // (lint react-hooks/set-state-in-effect proíbe usar useEffect aqui).
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSelecionados(new Set())
      setMesVisivel(parseISO(sabadosDisponiveis[0] ?? dataInicio))
    }
  }

  const permitidos = useMemo(
    () => new Set(sabadosDisponiveis),
    [sabadosDisponiveis],
  )

  const diasDoMes = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesVisivel), { weekStartsOn: 0 })
    const fim = endOfWeek(endOfMonth(mesVisivel), { weekStartsOn: 0 })
    const out: Date[] = []
    const d = new Date(inicio)
    while (d <= fim) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [mesVisivel])

  function toggle(iso: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(iso)) next.delete(iso)
      else next.add(iso)
      return next
    })
  }

  function handleConfirmar() {
    if (selecionados.size === 0) return
    onConfirmar([...selecionados].sort())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md"
        style={{
          backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
        }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-blue-200/80">
            Sábados extras
          </p>
          <DialogTitle className="text-display text-3xl text-white">
            Adicionar <em className="italic text-[#6ea0ff]">sábados</em>
          </DialogTitle>
          <DialogDescription className="text-white/65">
            Selecione os sábados extras trabalhados. Você receberá VT pelos
            dias adicionados.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-white/12" />

        {sabadosDisponiveis.length === 0 ? (
          <p className="rounded-2xl border border-white/12 bg-white/5 px-4 py-6 text-center text-sm text-white/70">
            Nenhum sábado disponível no período da convocação.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMesVisivel((m) => subMonths(m, 1))}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                aria-label="Mês anterior"
              >
                <ArrowLeft className="size-4" />
              </button>
              <p className="text-display text-lg capitalize text-white/95">
                {format(mesVisivel, "MMMM 'de' yyyy", { locale: ptBR })}
              </p>
              <button
                type="button"
                onClick={() => setMesVisivel((m) => addMonths(m, 1))}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white/75 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                aria-label="Próximo mês"
              >
                <ArrowLeft className="size-4 rotate-180" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                <div
                  key={i}
                  className="py-1 text-center text-[10px] uppercase tracking-wider text-white/40"
                >
                  {d}
                </div>
              ))}
              {diasDoMes.map((dia) => {
                const iso = format(dia, "yyyy-MM-dd")
                const permitido = permitidos.has(iso)
                const selecionado = selecionados.has(iso)
                const noMes = isSameMonth(dia, mesVisivel)
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={!permitido}
                    onClick={() => toggle(iso)}
                    className={`flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition ${
                      selecionado
                        ? "bg-blue-300 text-[#0a1224] shadow-[0_0_18px_rgba(110,160,255,0.45)]"
                        : permitido
                          ? "text-white/90 hover:bg-blue-300/15 hover:text-blue-100"
                          : noMes
                            ? "cursor-not-allowed text-white/18"
                            : "cursor-not-allowed text-white/10"
                    }`}
                  >
                    {dia.getDate()}
                  </button>
                )
              })}
            </div>

            <p className="text-center text-xs text-white/55">
              {selecionados.size === 0
                ? "Toque nos sábados para selecionar."
                : `${selecionados.size} ${
                    selecionados.size === 1
                      ? "sábado selecionado"
                      : "sábados selecionados"
                  }.`}
            </p>
          </div>
        )}

        <DialogFooter className="mt-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/65 hover:bg-white/10 hover:text-white"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={selecionados.size === 0}
            className="bg-blue-300 text-[#0a1224] hover:bg-blue-200 disabled:opacity-50"
          >
            Adicionar{selecionados.size > 0 ? ` (${selecionados.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Dialog: Confirmar remover sábado extra ─── */

type DialogConfirmarRemoverSabadoProps = {
  open: boolean
  data: string | null
  onCancelar: () => void
  onConfirmar: () => void
}

function DialogConfirmarRemoverSabado({
  open,
  data,
  onCancelar,
  onConfirmar,
}: DialogConfirmarRemoverSabadoProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-sm"
        style={{
          backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
        }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-blue-200/80">
            Sábado extra
          </p>
          <DialogTitle className="text-display text-2xl text-white">
            Remover este sábado?
          </DialogTitle>
          <DialogDescription className="text-white/65">
            {data
              ? `Remover ${formatarDataNumerica(data)} dos sábados extras. O benefício de VT não será mais solicitado para esta data.`
              : "Remover este sábado extra. O benefício de VT não será mais solicitado para esta data."}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Button
            variant="ghost"
            onClick={onCancelar}
            className="text-white/85 hover:bg-white/10 hover:text-white"
          >
            Cancelar
          </Button>
          <Button
            onClick={onConfirmar}
            className="bg-blue-300 text-[#0a1224] hover:bg-blue-200"
          >
            Remover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Dialog: Reverter cancelamento parcial ─── */

type DialogReverterCancelamentoProps = {
  open: boolean
  carregando: boolean
  erro: string | null
  dataInicioCancelamento: string | null
  onCancelar: () => void
  onConfirmar: () => void
}

function DialogReverterCancelamento({
  open,
  carregando,
  erro,
  dataInicioCancelamento,
  onCancelar,
  onConfirmar,
}: DialogReverterCancelamentoProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-sm"
        style={{
          backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
        }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-orange-300/80">
            Cancelamento parcial
          </p>
          <DialogTitle className="text-display text-2xl text-white">
            Reverter cancelamento?
          </DialogTitle>
          <DialogDescription className="text-white/65">
            {dataInicioCancelamento
              ? `Os dias cancelados a partir de ${formatarDataNumerica(
                  dataInicioCancelamento,
                )} voltarão a contar normalmente. Lembre de lançar atrasos/faltas antes de finalizar.`
              : "Os dias cancelados voltarão a contar normalmente."}
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <p className="mt-2 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
            {erro}
          </p>
        )}

        <DialogFooter className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Button
            variant="ghost"
            onClick={onCancelar}
            disabled={carregando}
            className="text-white/85 hover:bg-white/10 hover:text-white"
          >
            Voltar
          </Button>
          <Button
            onClick={onConfirmar}
            disabled={carregando}
            className="bg-orange-300 text-[#1a0a05] hover:bg-orange-200 disabled:opacity-60"
          >
            {carregando ? "Revertendo…" : "Reverter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Dialog: Dia já cobertto por atestado/declaração (read-only info) ─── */

type DialogDiaComDocumentoProps = {
  data: string | null
  documentos: Atestado[]
  onClose: () => void
}

function DialogDiaComDocumento({
  data,
  documentos,
  onClose,
}: DialogDiaComDocumentoProps) {
  if (!data) return null
  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-md"
        style={{ backdropFilter: "blur(10px) saturate(140%) brightness(1.05)" }}
      >
        <DialogHeader>
          <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200/80">
            Dia com documento
          </p>
          <DialogTitle className="text-display text-3xl capitalize text-white">
            {formatarDiaCompleto(data)}
          </DialogTitle>
          <DialogDescription className="text-white/65">
            Este dia já tem documento lançado. Para corrigir ou remover,
            acesse a área <span className="text-white/90">Atestados e declarações</span>.
          </DialogDescription>
        </DialogHeader>

        <ul className="mt-2 space-y-2.5">
          {documentos.map((doc) => {
            const rotulo =
              doc.tipoDocumento === "atestado"
                ? "Atestado médico"
                : doc.periodos.length === 2
                  ? "Declaração integral"
                  : doc.periodos[0] === "manha"
                    ? "Declaração matutina"
                    : "Declaração vespertina"
            const periodo =
              doc.dataInicio === doc.dataFim
                ? formatarDataNumerica(doc.dataInicio)
                : `${formatarDataNumerica(doc.dataInicio)} a ${formatarDataNumerica(doc.dataFim)}`
            return (
              <li
                key={doc.id}
                className="rounded-2xl border border-white/12 bg-white/5 p-4 text-sm text-white/80"
              >
                <p className="font-medium text-white/95">{rotulo}</p>
                <p className="mt-1 text-xs text-white/55">{periodo}</p>
                {doc.nomeArquivo && (
                  <p className="mt-1 text-xs text-white/45">{doc.nomeArquivo}</p>
                )}
                {doc.mondayItemUrl && (
                  <a
                    href={doc.mondayItemUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber-200 transition hover:text-amber-100"
                  >
                    <ExternalLink className="size-3.5" />
                    Abrir no Controle de Atestados
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        <DialogFooter className="mt-2 sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/85 hover:bg-white/10 hover:text-white"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
