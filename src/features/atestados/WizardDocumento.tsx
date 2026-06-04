import { useEffect, useMemo, useRef, useState } from "react"
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Clock3,
  Pencil,
  Plus,
  Search,
  Unlock,
  Upload,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { ComboboxFiltravel } from "@/components/ui/combobox-filtravel"
import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { ChoiceButton } from "./ChoiceButton"
import { useConvocacoesEmpregado } from "./useAtestados"
import {
  DOC_ACCEPT,
  DOC_MAX_BYTES,
  criarIdLocal,
  formatarBytes,
  isSabadoIso,
  listarDiasPeriodo,
} from "./shared"
import { contratoDoCodigoSecao } from "./mapaSecaoContrato"
import {
  isRetroativoLiberado,
  liberarRetroativo,
  revogarRetroativo,
  senhaCorreta,
} from "./retroativoStorage"
import { nomeFeriado, useFeriados } from "@/lib/feriadosBoard"
import {
  ACOMPANHANTES,
  CONTRATOS_COLABORADOR,
  EXEMPLOS_SAIDA_RETORNO,
  HORARIOS_ALMOCO,
  TIPOS_COM_ACOMPANHANTE,
  TIPOS_DOCUMENTACAO,
  UNIDADE_NAO_ENCONTRADA,
  unidadeColumnIdParaContrato,
  unidadesParaContrato,
  type AcompanhanteLabel,
  type ContratoColaboradorLabel,
  type HorarioAlmocoLabel,
  type TipoDocumentacaoLabel,
} from "./opcoesAtestadoForm"
import type {
  ConvocacaoResumida,
  DocumentoLancamento,
  EmpregadoRM,
} from "./types"

type ModoWizard = "intermitente" | "clt"

type Props = {
  modo: ModoWizard
  empregado: EmpregadoRM | null
  convocacao: ConvocacaoResumida | null
  documentosSessao: DocumentoLancamento[]
  onCancelar: () => void
  onAdicionar: (doc: DocumentoLancamento) => void
}

type Etapa =
  | { tipo: "tipo-doc" }
  | { tipo: "calendario" }
  | { tipo: "dados-trabalho" }
  | { tipo: "unidade" }
  | { tipo: "upload" }
  | { tipo: "observacao" }
  | { tipo: "preview" }

const ORDEM: Record<Etapa["tipo"], number> = {
  "tipo-doc": 1,
  calendario: 2,
  "dados-trabalho": 3,
  unidade: 4,
  upload: 5,
  observacao: 6,
  preview: 7,
}

function etapaKey(e: Etapa): string {
  return e.tipo
}

function formatCpf(raw: string): string {
  // Aceita CPF cru (11 dígitos) ou já formatado. Retorna 000.000.000-00.
  const digits = raw.replace(/\D/g, "")
  if (digits.length !== 11) return raw
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function diffDias(inicio: string, fim: string): number {
  if (!inicio || !fim) return 0
  const a = new Date(inicio + "T00:00:00Z")
  const b = new Date(fim + "T00:00:00Z")
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

function sabadosAtivosDaConvocacao(conv: ConvocacaoResumida): string[] {
  if (!conv.trabalhaSabado) return []
  const out: string[] = []
  for (const dia of listarDiasPeriodo(conv.dataInicio, conv.dataFim)) {
    if (isSabadoIso(dia)) out.push(dia)
  }
  return out
}

type Draft = {
  // identidade (CLT preenche; intermitente vem da convocação)
  empregadoNome: string
  contratoColaborador: ContratoColaboradorLabel | ""
  // tipo + datas
  tipoDocumentacaoLabel: TipoDocumentacaoLabel | ""
  dataInicio: string
  dataFim: string
  /** Emissão sempre = dataInicio; campo mantido só pra compat com draftInicial. */
  emissaoAtestado: string
  // trabalho
  saidaRetornoTexto: string
  horarioAlmocoLabel: HorarioAlmocoLabel | ""
  acompanhanteLabel: AcompanhanteLabel
  // unidade
  unidadeLabel: string | null
  unidadeNaoEncontradaTexto: string
  // observação + arquivo
  observacao: string
  arquivo: File | null
}

/** Tenta achar contrato válido por label exato. */
function matchContrato(
  candidato: string | undefined | null,
): ContratoColaboradorLabel | "" {
  if (!candidato) return ""
  const norm = candidato.toUpperCase().trim()
  const match = CONTRATOS_COLABORADOR.find((c) => c.label === norm)
  return match ? (match.label as ContratoColaboradorLabel) : ""
}

/**
 * Infere contrato a partir do localUnidade/secao do RM quando o backend
 * não devolve `contrato` explicitamente. Procura substring de cada label
 * conhecido dentro do texto.
 *
 * Ex: "DETRAN - MANAUS" → "DETRAN"
 *     "SEMSA - ADM" → "SEMSA"
 *     "SEDUC INTERIOR - COORDENADORIA 3" → "SEDUC INTERIOR"
 */
function inferContratoDoLocal(
  texto: string | undefined | null,
): ContratoColaboradorLabel | "" {
  if (!texto) return ""
  const norm = texto.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  // Ordem importa: labels mais específicos antes (ex: "SEDUC INTERIOR" antes de "SEDUC SEDE")
  const ordenado = [...CONTRATOS_COLABORADOR].sort(
    (a, b) => b.label.length - a.label.length,
  )
  for (const c of ordenado) {
    const labelNorm = c.label.normalize("NFD").replace(/[̀-ͯ]/g, "")
    if (norm.includes(labelNorm)) {
      return c.label as ContratoColaboradorLabel
    }
  }
  return ""
}

function draftInicial(
  _modo: ModoWizard,
  empregado: EmpregadoRM | null,
  convocacao: ConvocacaoResumida | null,
): Draft {
  // Prioridade do contrato:
  // 1) Convocação (intermitente acoplado — não usado mais, mas mantém compat)
  // 2) Campo `contrato` vindo direto do RM (celetista — backend inferiu)
  // 3) Mapa determinístico via código de seção (3º octeto do TBSECAO.CODIGO).
  //    Derivado do dump completo de celetistas — mais robusto que parse de texto.
  // 4) Infere a partir do localUnidade/secao do RM (fallback texto)
  const contratoConv = matchContrato(convocacao?.contrato)
  const contratoRM = matchContrato(empregado?.contrato)
  const contratoDaSecao = contratoDoCodigoSecao(
    empregado?.codigo ?? empregado?.secaoCodigo,
  )
  const contratoInferido = inferContratoDoLocal(
    empregado?.localUnidade ?? empregado?.secao,
  )
  const contratoColaborador: ContratoColaboradorLabel | "" =
    contratoConv || contratoRM || contratoDaSecao || contratoInferido || ""

  // Unidade default: prefere localUnidade (descrição amigável). Só preenche
  // se a unidade existir nas opções conhecidas do contrato selecionado.
  // Caso contrário deixa null pra operacional escolher / fallback "UNIDADE
  // NÃO ENCONTRADA".
  const unidadeCandidata =
    empregado?.localUnidade ?? empregado?.secao ?? ""
  const unidadesContrato = unidadesParaContrato(contratoColaborador)
  const unidadesOficiais = unidadesContrato.filter((u) => u !== UNIDADE_NAO_ENCONTRADA)
  const unidadeInicial = unidadesContrato.includes(unidadeCandidata)
    ? unidadeCandidata
    : unidadesOficiais.length === 1
      ? unidadesOficiais[0]
      : null

  return {
    empregadoNome: empregado?.nome ?? "",
    contratoColaborador,
    tipoDocumentacaoLabel: "",
    dataInicio: "",
    dataFim: "",
    emissaoAtestado: "",
    saidaRetornoTexto: "",
    horarioAlmocoLabel: "",
    acompanhanteLabel: "Sem acompanhamento",
    unidadeLabel: unidadeInicial,
    unidadeNaoEncontradaTexto: "",
    observacao: "",
    arquivo: null,
  }
}


export function WizardDocumento({
  modo,
  empregado,
  convocacao,
  documentosSessao,
  onCancelar,
  onAdicionar,
}: Props) {
  const etapaInicial: Etapa = { tipo: "tipo-doc" }
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial)
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const [draft, setDraft] = useState<Draft>(() =>
    draftInicial(modo, empregado, convocacao),
  )
  useFeriados()

  const sabadosAtivos = useMemo(
    () => (convocacao ? sabadosAtivosDaConvocacao(convocacao) : []),
    [convocacao],
  )

  // Mês visualizado no calendário. Lifted pro parent pra que o hook
  // `useConvocacoesEmpregado` reaja à navegação prev/next quando user
  // habilita o modo retroativo. Sem retroativo, fica fixo no mês corrente.
  const hojeRef = useMemo(() => new Date(), [])
  const [mesVisivel, setMesVisivel] = useState<Date>(() => startOfMonth(hojeRef))
  const mesParaQuery = useMemo(
    () => format(mesVisivel, "yyyy-MM"),
    [mesVisivel],
  )
  const convocacoesQuery = useConvocacoesEmpregado(
    modo === "intermitente" && empregado?.chapa ? empregado.chapa : "",
    mesParaQuery,
  )
  const diasConvocados = useMemo(() => {
    if (modo !== "intermitente") return new Set<string>()
    const convs = convocacoesQuery.data ?? []
    const set = new Set<string>()
    for (const c of convs) {
      // Ignora convocações canceladas / bloqueadas
      const status = (c.statusConvocacao ?? "").toLowerCase()
      if (status.includes("cancel") || status.includes("bloque")) continue
      for (const dia of listarDiasPeriodo(c.dataInicio, c.dataFim)) {
        set.add(dia)
      }
    }
    return set
  }, [modo, convocacoesQuery.data])
  function ir(nova: Etapa) {
    const novaOrdem = ORDEM[nova.tipo]
    const atualOrdem = ORDEM[etapa.tipo]
    setDirecao(novaOrdem >= atualOrdem ? "forward" : "backward")
    setEtapa(nova)
  }

  function voltar() {
    if (etapa.tipo === etapaInicial.tipo) {
      onCancelar()
      return
    }
    if (etapa.tipo === "calendario") return ir({ tipo: "tipo-doc" })
    if (etapa.tipo === "dados-trabalho") return ir({ tipo: "calendario" })
    if (etapa.tipo === "unidade") return ir({ tipo: "dados-trabalho" })
    if (etapa.tipo === "upload")
      return ir(
        precisaUnidade(draft.contratoColaborador)
          ? { tipo: "unidade" }
          : { tipo: "dados-trabalho" },
      )
    if (etapa.tipo === "observacao") return ir({ tipo: "upload" })
    if (etapa.tipo === "preview") return ir({ tipo: "observacao" })
  }

  function precisaUnidade(contrato: string): boolean {
    return unidadesParaContrato(contrato).length > 0
  }

  function diaPermitido(dia: string): { ok: boolean; motivo?: string } {
    // Feriado (board, por contrato) bloqueia: atestado em feriado não gera desconto.
    const feriado = nomeFeriado(dia, draft.contratoColaborador)
    if (feriado) {
      return { ok: false, motivo: `Feriado: ${feriado}` }
    }
    // Intermitente e CLT agora ambos vêm do RM com chapa.
    // Bloqueia só conflito local: mesma chapa + mesma modalidade já cobrindo
    // o dia na sessão atual. Backend valida o resto.
    if (empregado?.chapa) {
      const modalidade = modo === "clt" ? "CELETISTA" : "INTERMITENTE"
      const colide = documentosSessao.some(
        (d) =>
          d.modalidadeContrato === modalidade &&
          d.chapa === empregado.chapa &&
          dia >= d.dataInicio &&
          dia <= d.dataFim,
      )
      if (colide) {
        return { ok: false, motivo: "Já há documento nesta data para esta chapa na sessão." }
      }
    }
    return { ok: true }
  }

  function finalizar() {
    if (
      !draft.tipoDocumentacaoLabel ||
      !draft.dataInicio ||
      !draft.dataFim ||
      !draft.horarioAlmocoLabel ||
      !draft.arquivo ||
      !draft.contratoColaborador ||
      !draft.empregadoNome
    )
      return
    const unidadeCol = unidadeColumnIdParaContrato(draft.contratoColaborador)
    const modalidade = modo === "clt" ? "CELETISTA" : "INTERMITENTE"
    const doc: DocumentoLancamento = {
      id: criarIdLocal(modo === "clt" ? "clt" : "atest"),
      modalidadeContrato: modalidade,
      chapa: empregado?.chapa ?? "",
      empregadoNome: draft.empregadoNome,
      empregadoCpf: empregado?.cpf,
      uuidConvocacao: convocacao?.uuid ?? "",
      itemEntradaId: convocacao?.itemEntradaId,
      trabalhaSabado: convocacao?.trabalhaSabado ?? false,
      optanteVT: convocacao?.optanteVT ?? false,
      tipoDocumentacaoLabel: draft.tipoDocumentacaoLabel,
      diasAtestado: diffDias(draft.dataInicio, draft.dataFim),
      dataInicio: draft.dataInicio,
      dataFim: draft.dataFim,
      emissaoAtestado: draft.dataInicio,
      saidaRetornoTexto: draft.saidaRetornoTexto,
      horarioAlmocoLabel: draft.horarioAlmocoLabel,
      acompanhanteLabel: draft.acompanhanteLabel,
      contratoColaborador: draft.contratoColaborador,
      unidadeLabel: draft.unidadeLabel,
      unidadeDropdownColumnId: unidadeCol,
      unidadeNaoEncontradaTexto: draft.unidadeNaoEncontradaTexto,
      observacao: draft.observacao,
      arquivo: draft.arquivo,
      nomeArquivo: draft.arquivo.name,
      tamanhoArquivo: draft.arquivo.size,
      sabadosAtivos,
    }
    onAdicionar(doc)
  }

  function renderEtapa(): React.ReactNode {
    if (etapa.tipo === "tipo-doc") {
      return (
        <EtapaTipoDocumentacao
          atual={draft.tipoDocumentacaoLabel}
          onEscolher={(label) => {
            setDraft((p) => ({ ...p, tipoDocumentacaoLabel: label }))
            ir({ tipo: "calendario" })
          }}
        />
      )
    }
    if (etapa.tipo === "calendario") {
      const ehDiaUnico =
        draft.tipoDocumentacaoLabel === "Declaração Médica" ||
        draft.tipoDocumentacaoLabel === "Declaração Acompanhamento"
      return (
        <EtapaCalendario
          ehDiaUnico={ehDiaUnico}
          diaPermitido={diaPermitido}
          diasConvocados={diasConvocados}
          carregandoConvocacoes={
            modo === "intermitente" ? convocacoesQuery.isFetching : false
          }
          mostraConvocacao={modo === "intermitente"}
          mesVisivel={mesVisivel}
          setMesVisivel={setMesVisivel}
          hoje={hojeRef}
          onConfirmar={(di, df) => {
            setDraft((p) => ({
              ...p,
              dataInicio: di,
              dataFim: df,
            }))
            ir({ tipo: "dados-trabalho" })
          }}
        />
      )
    }
    if (etapa.tipo === "dados-trabalho") {
      return (
        <EtapaDadosTrabalho
          draft={draft}
          onChange={setDraft}
          onContinuar={() => {
            const proxima: Etapa = precisaUnidade(draft.contratoColaborador)
              ? { tipo: "unidade" }
              : { tipo: "upload" }
            ir(proxima)
          }}
        />
      )
    }
    if (etapa.tipo === "unidade") {
      return (
        <EtapaUnidade
          contrato={draft.contratoColaborador}
          unidadeLabel={draft.unidadeLabel}
          unidadeNaoEncontradaTexto={draft.unidadeNaoEncontradaTexto}
          onChange={(label, texto) =>
            setDraft((p) => ({
              ...p,
              unidadeLabel: label,
              unidadeNaoEncontradaTexto: texto ?? "",
            }))
          }
          onContinuar={() => ir({ tipo: "upload" })}
        />
      )
    }
    if (etapa.tipo === "upload") {
      return (
        <EtapaUpload
          arquivoAtual={draft.arquivo}
          onConfirmar={(arquivo) => {
            setDraft((p) => ({ ...p, arquivo }))
            ir({ tipo: "observacao" })
          }}
        />
      )
    }
    if (etapa.tipo === "observacao") {
      return (
        <EtapaObservacao
          valor={draft.observacao}
          onChange={(v) => setDraft((p) => ({ ...p, observacao: v }))}
          onContinuar={() => ir({ tipo: "preview" })}
        />
      )
    }
    return <EtapaPreview draft={draft} modo={modo} onConfirmar={finalizar} onEditar={() => voltar()} />
  }

  return (
    <div>
      <button
        type="button"
        onClick={voltar}
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-foreground/55 transition hover:text-foreground/85"
      >
        <ArrowLeft className="size-3.5" />
        {etapa.tipo === etapaInicial.tipo ? "Trocar pessoa" : "Voltar"}
      </button>

      {modo === "intermitente" && empregado && (
        <div className="mb-5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.04] px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-amber-700 dark:text-amber-100">
              Intermitente · RM
            </span>
            <span className="truncate text-sm font-medium text-foreground/95">
              {empregado.nome}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/60">
            <span>
              Chapa <strong className="text-foreground/85">{empregado.chapa || "—"}</strong>
            </span>
            {empregado.cpf && <span className="text-foreground/45">·</span>}
            {empregado.cpf && (
              <span>
                CPF{" "}
                <span className="font-mono text-foreground/75">
                  {formatCpf(empregado.cpf)}
                </span>
              </span>
            )}
            {empregado.funcao && (
              <span className="text-foreground/45">·</span>
            )}
            {empregado.funcao && <span>{empregado.funcao}</span>}
            {empregado.secao && (
              <span className="text-foreground/45">·</span>
            )}
            {empregado.secao && (
              <span>Seção <span className="text-foreground/75">{empregado.secao}</span></span>
            )}
            {(empregado.codigo || empregado.secaoCodigo) && (
              <span className="text-foreground/45">·</span>
            )}
            {(empregado.codigo || empregado.secaoCodigo) && (
              <span>
                Cód.{" "}
                <span className="font-mono text-foreground/65">
                  {empregado.codigo || empregado.secaoCodigo}
                </span>
              </span>
            )}
            {empregado.admissao && (
              <span className="text-foreground/45">·</span>
            )}
            {empregado.admissao && (
              <span>Adm. <span className="text-foreground/75">{empregado.admissao}</span></span>
            )}
          </div>
        </div>
      )}

      {modo === "clt" && empregado && (
        <div className="mb-5 rounded-2xl border border-violet-300/25 bg-violet-300/[0.04] px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-violet-700 dark:text-violet-100">
              CLT · RM
            </span>
            <span className="truncate text-sm font-medium text-foreground/95">
              {empregado.nome}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/60">
            <span>
              Chapa <strong className="text-foreground/85">{empregado.chapa || "—"}</strong>
            </span>
            {empregado.cpf && <span className="text-foreground/45">·</span>}
            {empregado.cpf && (
              <span>
                CPF{" "}
                <span className="font-mono text-foreground/75">
                  {formatCpf(empregado.cpf)}
                </span>
              </span>
            )}
            {empregado.funcao && <span className="text-foreground/45">·</span>}
            {empregado.funcao && <span>{empregado.funcao}</span>}
            {empregado.secao && <span className="text-foreground/45">·</span>}
            {empregado.secao && (
              <span>Seção <span className="text-foreground/75">{empregado.secao}</span></span>
            )}
            {(empregado.codigo || empregado.secaoCodigo) && (
              <span className="text-foreground/45">·</span>
            )}
            {(empregado.codigo || empregado.secaoCodigo) && (
              <span>
                Cód.{" "}
                <span className="font-mono text-foreground/65">
                  {empregado.codigo || empregado.secaoCodigo}
                </span>
              </span>
            )}
            {empregado.admissao && <span className="text-foreground/45">·</span>}
            {empregado.admissao && (
              <span>Adm. <span className="text-foreground/75">{empregado.admissao}</span></span>
            )}
          </div>
        </div>
      )}

      <SlideStack slideKey={etapaKey(etapa)} direction={direcao}>
        {renderEtapa()}
      </SlideStack>
    </div>
  )
}

// ============================================================================
// ETAPAS
// ============================================================================

function EtapaTipoDocumentacao({
  atual,
  onEscolher,
}: {
  atual: TipoDocumentacaoLabel | ""
  onEscolher: (label: TipoDocumentacaoLabel) => void
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-700/85 dark:text-amber-200/85">
        Tipo de documentação
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Qual <em className="italic text-[#e8c275]">documento</em>?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/65">
        Atestados afetam VR/VT. Licenças e declarações têm regra própria.
      </p>

      <div className="mt-6">
        <SelectGlass
          valor={atual}
          opcoes={TIPOS_DOCUMENTACAO.map((t) => t.label)}
          placeholder="Selecione o tipo"
          onChange={(v) => onEscolher(v as TipoDocumentacaoLabel)}
          searchable
        />
      </div>
    </div>
  )
}

function EtapaCalendario({
  ehDiaUnico,
  diaPermitido,
  diasConvocados,
  carregandoConvocacoes,
  mostraConvocacao,
  mesVisivel,
  setMesVisivel,
  hoje,
  onConfirmar,
}: {
  ehDiaUnico: boolean
  diaPermitido: (dia: string) => { ok: boolean; motivo?: string }
  diasConvocados: Set<string>
  carregandoConvocacoes: boolean
  mostraConvocacao: boolean
  mesVisivel: Date
  setMesVisivel: (d: Date | ((prev: Date) => Date)) => void
  hoje: Date
  onConfirmar: (dataInicio: string, dataFim: string) => void
}) {
  // Por padrão só mês corrente é permitido. Modo retroativo libera nav
  // pra meses anteriores (nunca pra mês futuro) — persistido em
  // localStorage com TTL fim-do-dia.
  const fimMesVisivel = useMemo(() => endOfMonth(mesVisivel), [mesVisivel])
  const mesCorrenteInicio = useMemo(() => startOfMonth(hoje), [hoje])
  const ehMesCorrente = isSameMonth(mesVisivel, hoje)

  const [retroativoAtivo, setRetroativoAtivo] = useState(() => isRetroativoLiberado())
  const [painelSenhaAberto, setPainelSenhaAberto] = useState(false)
  const [senhaInput, setSenhaInput] = useState("")
  const [senhaErro, setSenhaErro] = useState<string | null>(null)
  const senhaInputRef = useRef<HTMLInputElement>(null)

  function tentarLiberar() {
    if (senhaCorreta(senhaInput)) {
      liberarRetroativo()
      setRetroativoAtivo(true)
      setPainelSenhaAberto(false)
      setSenhaInput("")
      setSenhaErro(null)
      return
    }
    setSenhaErro("Senha incorreta. Solicite ao DP.")
    setSenhaInput("")
    senhaInputRef.current?.focus()
  }

  function fecharPainelSenha() {
    setPainelSenhaAberto(false)
    setSenhaInput("")
    setSenhaErro(null)
  }

  useEffect(() => {
    if (painelSenhaAberto) {
      const t = setTimeout(() => senhaInputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [painelSenhaAberto])

  const podeNavegarPrev = retroativoAtivo
  const podeNavegarNext = !ehMesCorrente && mesVisivel < mesCorrenteInicio

  const [diaInicio, setDiaInicio] = useState<string | null>(null)
  const [dialogAberto, setDialogAberto] = useState(false)
  const [quantidadeDias, setQuantidadeDias] = useState("1")
  const [diaFim, setDiaFim] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Limpa seleção ao navegar entre meses pra evitar período órfão fora do mês visível.
  useEffect(() => {
    setDiaInicio(null)
    setDiaFim(null)
    setErro(null)
  }, [mesVisivel])

  const diasGrade = useMemo(() => {
    const inicio = startOfWeek(mesVisivel, { weekStartsOn: 0 })
    const fim = endOfWeek(fimMesVisivel, { weekStartsOn: 0 })
    const out: Date[] = []
    const d = new Date(inicio)
    while (d <= fim) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [mesVisivel, fimMesVisivel])

  function clicarDia(iso: string) {
    setErro(null)
    if (ehDiaUnico) {
      setDiaInicio(iso)
      setDiaFim(iso)
      return
    }
    setDiaInicio(iso)
    setDiaFim(null)
    setQuantidadeDias("1")
    setDialogAberto(true)
  }

  function confirmarQuantidade() {
    if (!diaInicio) return
    const n = Math.max(1, Math.min(60, Number(quantidadeDias) || 1))
    const inicio = new Date(diaInicio + "T00:00:00Z")
    const fim = new Date(inicio)
    fim.setUTCDate(fim.getUTCDate() + n - 1)
    const fimIso = fim.toISOString().slice(0, 10)
    // Restrição só pra retroativo: atestado retroativo NÃO pode passar
    // do mês visualizado (senão invadiria mês mais recente).
    // Mês corrente PODE atravessar pro próximo mês (atestado real cobre
    // período sem se preocupar com fronteira de mês).
    if (!ehMesCorrente) {
      const fimMesIso = format(fimMesVisivel, "yyyy-MM-dd")
      if (fimIso > fimMesIso) {
        setErro(
          `Período passa do fim do mês visualizado (${fimMesIso}). Reduza a quantidade de dias.`,
        )
        return
      }
    }
    setDiaFim(fimIso)
    setDialogAberto(false)
  }

  // Dias destacados no calendário entre inicio e fim
  const diasDestacados = useMemo(() => {
    if (!diaInicio || !diaFim) return new Set<string>()
    return new Set(listarDiasPeriodo(diaInicio, diaFim))
  }, [diaInicio, diaFim])

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-700/85 dark:text-amber-200/85">
        Período do documento
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        {ehDiaUnico ? (
          <>
            Dia do <em className="italic text-[#e8c275]">comparecimento</em>
          </>
        ) : (
          <>
            Data de <em className="italic text-[#e8c275]">início</em>
          </>
        )}
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/65">
        {ehDiaUnico
          ? "Clique no dia do comparecimento."
          : "Clique na data inicial. O sistema vai perguntar quantos dias de ausência."}
      </p>
      <p className="mt-1 text-xs text-foreground/45">
        {retroativoAtivo
          ? "Retroativo liberado · navegue para meses anteriores."
          : `Restrito ao mês corrente · ${format(hoje, "MMMM 'de' yyyy", { locale: ptBR })}.`}
        {carregandoConvocacoes && " Carregando convocações…"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-foreground/55">
        {mostraConvocacao && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            Dia de convocação
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-300" />
          Atestado
        </span>
        {mostraConvocacao && (
          <span className="inline-flex items-center gap-1.5">
            <span className="relative inline-flex size-2 items-center justify-center rounded-full bg-amber-300">
              <span className="absolute inset-0 rounded-full bg-emerald-400/55" />
            </span>
            Atestado + convocação
          </span>
        )}
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          {/* Slot prev — só renderiza ChevronLeft se retroativo ativo */}
          <div className="size-9">
            {podeNavegarPrev && (
              <button
                type="button"
                onClick={() => setMesVisivel((m) => subMonths(m, 1))}
                className="flex size-9 items-center justify-center rounded-full border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/70 transition hover:bg-[rgb(var(--ink)/0.08)] hover:text-foreground"
                aria-label="Mês anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <p className="text-display text-lg capitalize text-foreground/95">
              {format(mesVisivel, "MMMM 'de' yyyy", { locale: ptBR })}
            </p>
            {!ehMesCorrente && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/35 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-100">
                <Clock3 className="size-3" />
                Retroativo
              </span>
            )}
          </div>

          {/* Slot next — só renderiza se podeNavegarNext (mês passado, não-corrente) */}
          <div className="size-9">
            {podeNavegarNext && (
              <button
                type="button"
                onClick={() => setMesVisivel((m) => addMonths(m, 1))}
                className="flex size-9 items-center justify-center rounded-full border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-foreground/70 transition hover:bg-[rgb(var(--ink)/0.08)] hover:text-foreground"
                aria-label="Próximo mês"
              >
                <ChevronRight className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Container ÚNICO que cresce horizontalmente pra revelar input.
            Fechado: chip btn-action-expand normal (icone only idle, label
            on hover). Aberto: mesma borda, expande pra direita esquerda
            revelando input + Liberar inline. Sem segundo container,
            sem divisórias, sem pop no centro. */}
        <div className="flex justify-end">
          {retroativoAtivo ? (
            <button
              type="button"
              onClick={() => {
                revogarRetroativo()
                setRetroativoAtivo(false)
                setMesVisivel(mesCorrenteInicio)
              }}
              className="btn-action-expand btn-atestado-retroativo btn-atestado-retroativo-active"
              aria-label="Trancar retroativo"
            >
              <Unlock className="size-4 text-amber-700 dark:text-amber-200" />
              <span className="btn-label text-amber-700 dark:text-amber-50">Retroativo liberado · trancar</span>
            </button>
          ) : (
            ehMesCorrente && (
              <div
                className={`retroativo-unlock ${
                  painelSenhaAberto ? "retroativo-unlock-aberto" : ""
                }`}
              >
                <button
                  type="button"
                  aria-expanded={painelSenhaAberto}
                  aria-label="Atestado retroativo"
                  onClick={() =>
                    painelSenhaAberto ? fecharPainelSenha() : setPainelSenhaAberto(true)
                  }
                  className="retroativo-unlock-trigger"
                >
                  <Plus className="size-4" />
                  <span className="retroativo-unlock-label">Atestado retroativo</span>
                </button>

                {painelSenhaAberto && (
                  <div className="retroativo-unlock-input-wrap">
                    <input
                      ref={senhaInputRef}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={senhaInput}
                      onChange={(e) => {
                        setSenhaInput(e.target.value)
                        setSenhaErro(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") tentarLiberar()
                        if (e.key === "Escape") fecharPainelSenha()
                      }}
                      placeholder="senha do DP"
                      className="retroativo-unlock-input"
                    />
                    <button
                      type="button"
                      onClick={tentarLiberar}
                      disabled={senhaInput.length === 0}
                      className="retroativo-unlock-liberar"
                    >
                      Liberar
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {painelSenhaAberto && senhaErro && (
          <p className="ml-auto max-w-xs rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-1.5 text-[11px] text-rose-700 dark:text-rose-100">
            {senhaErro}
          </p>
        )}

        <div className="grid grid-cols-7 gap-1">
          {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
            <div
              key={i}
              className="py-1 text-center text-[10px] uppercase tracking-wider text-foreground/40"
            >
              {d}
            </div>
          ))}
          {diasGrade.map((dia) => {
            const iso = format(dia, "yyyy-MM-dd")
            const noMes = isSameMonth(dia, mesVisivel)
            const feriadoNome = nomeFeriado(iso)
            const eFeriado = !!feriadoNome
            const permitido = noMes && diaPermitido(iso).ok
            const ehInicio = iso === diaInicio
            const noRange = diasDestacados.has(iso) && iso !== diaInicio
            const ehConvocacao = diasConvocados.has(iso)
            const ehAtestadoOuRange = ehInicio || noRange
            const overlap = ehAtestadoOuRange && ehConvocacao

            // Cor por estado:
            //  - selecionado/range = âmbar (atestado)
            //  - dias com convocação ganham ponto verde discreto inferior
            //  - overlap (atestado em dia de convocação) = âmbar + halo verde
            //    + ponto verde (ainda visível) → mistura visual
            //  - feriado nacional = emerald + bloqueado
            let cls = ""
            if (ehInicio) {
              cls = overlap
                ? "bg-amber-300 text-[#0a1224] shadow-[0_0_22px_rgba(232,194,117,0.55),inset_0_0_0_1px_rgba(52,211,153,0.65)]"
                : "bg-amber-300 text-[#0a1224] shadow-[0_0_18px_rgba(232,194,117,0.45)]"
            } else if (noRange) {
              cls = overlap
                ? "bg-amber-300/22 text-amber-700 dark:text-amber-100 ring-1 ring-emerald-400/40"
                : "bg-amber-300/16 text-amber-700 dark:text-amber-100"
            } else if (eFeriado && noMes) {
              cls = "calendario-dia-feriado"
            } else if (permitido) {
              cls = "text-foreground/90 hover:bg-amber-300/15 hover:text-amber-700 dark:text-amber-100 glass-tile-3d-mini"
            } else if (noMes) {
              cls = "cursor-not-allowed text-foreground/18"
            } else {
              cls = "cursor-not-allowed text-foreground/10"
            }

            return (
              <button
                key={iso}
                type="button"
                title={eFeriado ? `Feriado nacional: ${feriadoNome}` : undefined}
                disabled={!permitido}
                onClick={() => clicarDia(iso)}
                className={`relative flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition ${cls}`}
              >
                <span>{dia.getDate()}</span>
                {ehConvocacao && noMes && (
                  <span
                    aria-label="Convocação ativa"
                    className={`pointer-events-none absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full ${
                      ehInicio
                        ? "bg-emerald-700 shadow-[0_0_6px_rgba(6,95,70,0.6)]"
                        : ehAtestadoOuRange
                          ? "bg-emerald-500"
                          : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                    }`}
                  />
                )}
              </button>
            )
          })}
        </div>

        <p className="text-center text-xs text-foreground/55">
          {diaInicio && diaFim
            ? diaInicio === diaFim
              ? `${format(parseISO(diaInicio), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })} · 1 dia`
              : `${format(parseISO(diaInicio), "dd/MM")} a ${format(parseISO(diaFim), "dd/MM/yyyy")} · ${diasDestacados.size} dias`
            : "Selecione a data inicial."}
        </p>

        {erro && (
          <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-xs text-rose-700 dark:text-rose-100">
            {erro}
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <ChoiceButton
          variant="primary"
          disabled={!diaInicio || !diaFim}
          onClick={() => diaInicio && diaFim && onConfirmar(diaInicio, diaFim)}
        >
          Próximo
        </ChoiceButton>
      </div>

      {dialogAberto && diaInicio && (
        <DialogQuantidadeDias
          dataInicio={diaInicio}
          quantidade={quantidadeDias}
          onChange={setQuantidadeDias}
          onConfirmar={confirmarQuantidade}
          onCancelar={() => {
            setDialogAberto(false)
            if (!diaFim) setDiaInicio(null)
          }}
        />
      )}
    </div>
  )
}

function DialogQuantidadeDias({
  dataInicio,
  quantidade,
  onChange,
  onConfirmar,
  onCancelar,
}: {
  dataInicio: string
  quantidade: string
  onChange: (v: string) => void
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const n = Number(quantidade) || 0
  const valido = n >= 1 && n <= 60

  function bump(delta: number) {
    const novo = Math.max(1, Math.min(60, (n || 0) + delta))
    onChange(String(novo))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent
        className="glass-modal border-0 bg-transparent p-7 text-foreground sm:max-w-sm"
        style={{ backdropFilter: "blur(10px) saturate(140%) brightness(1.05)" }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-amber-300/15 ring-1 ring-amber-300/40">
              <CalendarClock className="size-3.5 text-amber-700 dark:text-amber-200" />
            </span>
            <p className="text-[10px] uppercase tracking-[0.3em] text-amber-700/85 dark:text-amber-200/85">
              Período do atestado
            </p>
          </div>
          <DialogTitle className="text-display mt-2 text-2xl text-foreground">
            Quantos <em className="italic text-[#e8c275]">dias</em> de ausência?
          </DialogTitle>
          <DialogDescription className="text-foreground/65">
            Início em{" "}
            <strong className="text-foreground">
              {format(parseISO(dataInicio), "dd 'de' MMMM", { locale: ptBR })}
            </strong>
            . O sistema vai destacar todos os dias do atestado no calendário.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 h-px bg-[rgb(var(--ink)/0.12)]" />

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Diminuir"
            onClick={() => bump(-1)}
            disabled={n <= 1}
            className="glass-tile-3d-mini inline-flex size-11 items-center justify-center rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-xl text-foreground/85 transition hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-700 dark:text-amber-100 disabled:opacity-30"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={quantidade}
            autoFocus
            onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valido) onConfirmar()
            }}
            className="w-28 rounded-2xl border border-amber-300/40 bg-amber-300/8 px-3 py-4 text-center text-4xl font-semibold text-amber-700 dark:text-amber-100 focus:border-amber-300/80 focus:outline-none focus:ring-2 focus:ring-amber-300/30"
          />
          <button
            type="button"
            aria-label="Aumentar"
            onClick={() => bump(1)}
            disabled={n >= 60}
            className="glass-tile-3d-mini inline-flex size-11 items-center justify-center rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] text-xl text-foreground/85 transition hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-700 dark:text-amber-100 disabled:opacity-30"
          >
            +
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-foreground/45">
          {n === 1 ? "1 dia" : n > 0 ? `${n} dias` : "Mínimo 1 · máximo 60"}
        </p>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="text-xs text-foreground/55 transition hover:text-foreground/85"
          >
            Cancelar
          </button>
          <ChoiceButton
            variant="primary"
            disabled={!valido}
            onClick={onConfirmar}
          >
            Confirmar
          </ChoiceButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EtapaDadosTrabalho({
  draft,
  onChange,
  onContinuar,
}: {
  draft: Draft
  onChange: (next: Draft | ((p: Draft) => Draft)) => void
  onContinuar: () => void
}) {
  // Form Atestado Ponta tem campo "Acompanhante?" NÃO obrigatório → sempre
  // mostra como opcional. Tipos de acompanhamento ganham destaque (default
  // sugerido). Demais: default "Sem acompanhamento", operacional pode mudar.
  const tipoDocAcomp =
    !!draft.tipoDocumentacaoLabel &&
    TIPOS_COM_ACOMPANHANTE.has(
      draft.tipoDocumentacaoLabel as TipoDocumentacaoLabel,
    )
  const valido =
    draft.saidaRetornoTexto.trim().length > 0 &&
    !!draft.horarioAlmocoLabel &&
    !!draft.contratoColaborador

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-700/85 dark:text-amber-200/85">
        Dados de trabalho
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Como foi o <em className="italic text-[#e8c275]">expediente</em>?
      </h2>

      <div className="mt-6 space-y-5">
        {draft.contratoColaborador ? (
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
              Contrato do colaborador
            </label>
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/[0.05] px-4 py-3">
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.22em] text-amber-700 dark:text-amber-100">
                RM
              </span>
              <span className="text-sm font-medium text-foreground/90">
                {draft.contratoColaborador}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-rose-700/85 dark:text-rose-200/85">
              Contrato do colaborador — não inferido
            </label>
            <SelectGlass
              valor={draft.contratoColaborador}
              opcoes={CONTRATOS_COLABORADOR.map((c) => c.label)}
              placeholder="Selecione o contrato"
              onChange={(v) =>
                onChange((p) => ({
                  ...p,
                  contratoColaborador: v as ContratoColaboradorLabel,
                  unidadeLabel: null,
                  unidadeNaoEncontradaTexto: "",
                }))
              }
            />
            <p className="mt-2 text-[10px] text-rose-700/70 dark:text-rose-200/70">
              Seção do RM fora do mapa conhecido. Escolha manualmente.
            </p>
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
            Saída e/ou retorno ao trabalho
          </label>
          <input
            type="text"
            maxLength={255}
            value={draft.saidaRetornoTexto}
            onChange={(e) =>
              onChange((p) => ({ ...p, saidaRetornoTexto: e.target.value }))
            }
            placeholder="Ex: Saída às 07:30 – Retorno às 15:00"
            className="mt-3 w-full rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-foreground placeholder:text-foreground/30 focus:border-amber-300/50 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXEMPLOS_SAIDA_RETORNO.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() =>
                  onChange((p) => ({ ...p, saidaRetornoTexto: ex }))
                }
                className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--ink)/0.1)] bg-[rgb(var(--ink)/0.03)] px-2.5 py-1 text-[10px] text-foreground/65 transition hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-700 dark:text-amber-100"
              >
                <ClipboardPaste className="size-3" />
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
            Horário de almoço
          </label>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {HORARIOS_ALMOCO.map((h) => (
              <ChoiceButton
                key={h.id}
                selected={draft.horarioAlmocoLabel === h.label}
                onClick={() =>
                  onChange((p) => ({
                    ...p,
                    horarioAlmocoLabel: h.label as HorarioAlmocoLabel,
                  }))
                }
              >
                {h.label}
              </ChoiceButton>
            ))}
          </div>
        </div>


        <div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-foreground/55">
            Acompanhante
            <span className="rounded-full border border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.04)] px-2 py-0.5 text-[9px] tracking-normal text-foreground/45">
              opcional
            </span>
            {tipoDocAcomp && (
              <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[9px] tracking-normal text-amber-700 dark:text-amber-100">
                relevante
              </span>
            )}
          </label>
          <SelectGlass
            valor={draft.acompanhanteLabel}
            opcoes={ACOMPANHANTES.map((a) => a.label)}
            placeholder="Sem acompanhamento"
            onChange={(v) =>
              onChange((p) => ({ ...p, acompanhanteLabel: v as AcompanhanteLabel }))
            }
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <ChoiceButton variant="primary" disabled={!valido} onClick={() => valido && onContinuar()}>
          Próximo
        </ChoiceButton>
      </div>
    </div>
  )
}

function EtapaUnidade({
  contrato,
  unidadeLabel,
  unidadeNaoEncontradaTexto,
  onChange,
  onContinuar,
}: {
  contrato: string
  unidadeLabel: string | null
  unidadeNaoEncontradaTexto: string
  onChange: (label: string | null, naoEncontradaTexto?: string) => void
  onContinuar: () => void
}) {
  const opcoes = useMemo(() => [...unidadesParaContrato(contrato)], [contrato])
  const ehNaoEncontrada =
    unidadeLabel === UNIDADE_NAO_ENCONTRADA ||
    (unidadeLabel ?? "").includes("UNIDADE NÃO ENCONTRADA")

  const valido =
    !!unidadeLabel &&
    (!ehNaoEncontrada || unidadeNaoEncontradaTexto.trim().length > 0)

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-700/85 dark:text-amber-200/85">
        Unidade do órgão
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        <em className="italic text-[#e8c275]">{contrato}</em> · qual unidade?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/65">
        Selecione a unidade do colaborador. Se não estiver na lista, marque
        "Unidade não encontrada" e descreva no campo livre.
      </p>

      <div className="mt-6 space-y-4">
        <ComboboxFiltravel
          valor={unidadeLabel ?? ""}
          opcoes={opcoes}
          placeholder="Selecione a unidade"
          buscaPlaceholder="Buscar unidade"
          emptyMessage="Não há unidades cadastradas para este contrato"
          noMatchMessage="Nenhuma unidade encontrada para esse termo"
          onChange={(v) => onChange(v || null, unidadeNaoEncontradaTexto)}
        />

        {ehNaoEncontrada && (
          <div className="fade-up">
            <label className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
              Especifique a unidade
            </label>
            <input
              type="text"
              maxLength={255}
              value={unidadeNaoEncontradaTexto}
              onChange={(e) => onChange(unidadeLabel, e.target.value)}
              placeholder="Nome da unidade"
              className="mt-3 w-full rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-foreground placeholder:text-foreground/30 focus:border-amber-300/50 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <ChoiceButton variant="primary" disabled={!valido} onClick={() => valido && onContinuar()}>
          Próximo
        </ChoiceButton>
      </div>
    </div>
  )
}

function EtapaUpload({
  arquivoAtual,
  onConfirmar,
}: {
  arquivoAtual: File | null
  onConfirmar: (arquivo: File) => void
}) {
  const [arquivo, setArquivo] = useState<File | null>(arquivoAtual)
  const [erro, setErro] = useState<string | null>(null)
  const [successFlash, setSuccessFlash] = useState(false)

  function tilt(e: React.MouseEvent<HTMLLabelElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function tiltLeave(e: React.MouseEvent<HTMLLabelElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  function escolher(file: File | null) {
    setErro(null)
    if (!file) return
    const ok =
      file.type === "application/pdf" ||
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      file.type === "image/heic" ||
      /\.(pdf|jpe?g|png|heic)$/i.test(file.name)
    if (!ok) {
      setErro("Envie um arquivo PDF, JPG, PNG ou HEIC.")
      setArquivo(null)
      return
    }
    if (file.size > DOC_MAX_BYTES) {
      setErro("O arquivo deve ter no máximo 15 MB.")
      setArquivo(null)
      return
    }
    setArquivo(file)
    setSuccessFlash(true)
    setTimeout(() => setSuccessFlash(false), 520)
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-700/85 dark:text-amber-200/85">
        Arquivo
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Anexar <em className="italic text-[#e8c275]">documento</em>
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/65">
        PDF, JPG, PNG ou HEIC. Tamanho máximo 15 MB.
      </p>

      <label
        onMouseMove={tilt}
        onMouseLeave={tiltLeave}
        className={`upload-tile mt-7 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-amber-300/35 bg-amber-300/8 px-5 py-10 text-center hover:border-amber-300/60 hover:bg-amber-300/12 ${
          successFlash ? "upload-success" : ""
        }`}
      >
        <Upload className="mb-3 size-7 text-amber-700 dark:text-amber-200" />
        <span className="text-sm font-medium text-foreground/90">
          {arquivo ? arquivo.name : "Selecionar arquivo"}
        </span>
        <span className="mt-1 text-xs text-foreground/50">
          {arquivo ? formatarBytes(arquivo.size) : "Clique para anexar"}
        </span>
        <input
          type="file"
          accept={DOC_ACCEPT}
          className="sr-only"
          onChange={(e) => escolher(e.currentTarget.files?.[0] ?? null)}
        />
      </label>

      {erro && (
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-100">
          {erro}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <ChoiceButton
          variant="primary"
          disabled={!arquivo}
          onClick={() => arquivo && onConfirmar(arquivo)}
        >
          Próximo
        </ChoiceButton>
      </div>
    </div>
  )
}

function EtapaObservacao({
  valor,
  onChange,
  onContinuar,
}: {
  valor: string
  onChange: (v: string) => void
  onContinuar: () => void
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-foreground/55">
        Observação · opcional
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Algum <em className="italic text-[#e8c275]">esclarecimento</em>?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/65">
        Use apenas se houver detalhe importante. Pode pular.
      </p>

      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={1000}
        placeholder="Ex: Atestado emitido após avaliação no pronto-socorro."
        className="mt-6 w-full rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-amber-300/50 focus:outline-none"
      />

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onContinuar}
          className="text-xs text-foreground/55 transition hover:text-foreground/85"
        >
          Pular
        </button>
        <ChoiceButton variant="primary" onClick={onContinuar}>
          Próximo
        </ChoiceButton>
      </div>
    </div>
  )
}

function EtapaPreview({
  draft,
  modo,
  onConfirmar,
  onEditar,
}: {
  draft: Draft
  modo: ModoWizard
  onConfirmar: () => void
  onEditar: () => void
}) {
  const periodo =
    draft.dataInicio === draft.dataFim
      ? format(parseISO(draft.dataInicio), "dd/MM/yyyy")
      : `${format(parseISO(draft.dataInicio), "dd/MM/yyyy")} a ${format(parseISO(draft.dataFim), "dd/MM/yyyy")}`
  const dias = diffDias(draft.dataInicio, draft.dataFim)

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-700/85 dark:text-emerald-300/85">
        Revisar antes de adicionar
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-foreground">
        Conferir <em className="italic text-emerald-700 dark:text-emerald-300">documento</em>
      </h2>

      <div className="preview-doc-tile tone-atestado mt-6 space-y-2.5 rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.05)] p-5 pl-7 text-sm text-foreground/80">
        <Linha label="Modalidade" valor={modo === "clt" ? "CELETISTA" : "INTERMITENTE"} />
        <Linha label="Colaborador" valor={draft.empregadoNome} />
        <Linha label="Contrato" valor={draft.contratoColaborador} />
        {draft.unidadeLabel && (
          <Linha
            label="Unidade"
            valor={
              draft.unidadeLabel.includes("UNIDADE NÃO ENCONTRADA")
                ? `Não encontrada — "${draft.unidadeNaoEncontradaTexto}"`
                : draft.unidadeLabel
            }
          />
        )}
        <Linha label="Tipo" valor={draft.tipoDocumentacaoLabel} />
        <Linha label="Período" valor={`${periodo} (${dias} ${dias === 1 ? "dia" : "dias"})`} />
        <Linha label="Saída/Retorno" valor={draft.saidaRetornoTexto} />
        <Linha label="Almoço" valor={draft.horarioAlmocoLabel} />
        {draft.acompanhanteLabel !== "Sem acompanhamento" && (
          <Linha label="Acompanhante" valor={draft.acompanhanteLabel} />
        )}
        <Linha
          label="Arquivo"
          valor={`${draft.arquivo?.name ?? "—"} (${draft.arquivo ? formatarBytes(draft.arquivo.size) : "0 KB"})`}
        />
        {draft.observacao && <Linha label="Observação" valor={draft.observacao} />}
      </div>

      <p className="mt-4 text-xs text-foreground/50">
        Adicionando à sessão — envio efetivo só ao clicar em{" "}
        <strong className="text-foreground/75">Concluir</strong> no resumo.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onEditar}
          className="inline-flex items-center gap-1.5 text-xs text-foreground/55 transition hover:text-foreground/85"
        >
          <Pencil className="size-3.5" />
          Voltar e editar
        </button>
        <ChoiceButton variant="primary" onClick={onConfirmar}>
          Adicionar à sessão
        </ChoiceButton>
      </div>
    </div>
  )
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <p>
      <span className="text-foreground/55">{label}:</span>{" "}
      <strong className="text-foreground">{valor}</strong>
    </p>
  )
}

// ============================================================================
// SelectGlass — dropdown leve com busca opcional
// ============================================================================

function SelectGlass({
  valor,
  opcoes,
  placeholder,
  onChange,
  searchable,
}: {
  valor: string
  opcoes: readonly string[] | string[]
  placeholder: string
  onChange: (v: string) => void
  searchable?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")

  const filtradas = useMemo(() => {
    if (!searchable || !busca.trim()) return opcoes
    const q = busca
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
    return opcoes.filter((o) =>
      o
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .includes(q),
    )
  }, [opcoes, busca, searchable])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-left text-foreground transition hover:border-amber-300/40 hover:bg-[rgb(var(--ink)/0.06)]"
      >
        <span className={valor ? "text-foreground" : "text-foreground/40"}>
          {valor || placeholder}
        </span>
        <ChevronRight
          className={`size-4 text-foreground/55 transition-transform ${aberto ? "rotate-90" : ""}`}
        />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-hidden rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-card/95 shadow-[0_18px_36px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-[rgb(var(--ink)/0.1)] px-3 py-2">
              <Search className="size-3.5 text-foreground/55" />
              <input
                autoFocus
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/30 focus:outline-none"
              />
            </div>
          )}
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtradas.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o)
                    setAberto(false)
                    setBusca("")
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-amber-300/10 hover:text-amber-700 dark:text-amber-100 ${
                    o === valor
                      ? "bg-amber-300/15 text-amber-700 dark:text-amber-100"
                      : "text-foreground/85"
                  }`}
                >
                  <Building2 className="size-3.5 shrink-0 text-foreground/45" />
                  {o}
                </button>
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="px-4 py-3 text-xs text-foreground/50">
                Nenhum resultado.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
