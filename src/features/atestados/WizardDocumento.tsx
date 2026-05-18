import { useMemo, useState } from "react"
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
  ChevronRight,
  ClipboardPaste,
  Pencil,
  Search,
  Upload,
} from "lucide-react"

import { SlideStack, type SlideDirection } from "@/components/SlideStack"

import { ChoiceButton } from "./ChoiceButton"
import {
  DOC_ACCEPT,
  DOC_MAX_BYTES,
  criarIdLocal,
  dataDentroPeriodo,
  formatarBytes,
  isDomingoIso,
  isSabadoIso,
  listarDiasPeriodo,
} from "./shared"
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
  DocumentoExistente,
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
  | { tipo: "identificacao-clt" } // só CLT — pede nome + contrato
  | { tipo: "tipo-doc" }
  | { tipo: "calendario" }
  | { tipo: "dados-trabalho" }
  | { tipo: "unidade" }
  | { tipo: "upload" }
  | { tipo: "observacao" }
  | { tipo: "preview" }

const ORDEM: Record<Etapa["tipo"], number> = {
  "identificacao-clt": 0,
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

function diasCobertosPorDocsExistentes(
  docsExistentes: DocumentoExistente[],
): Map<string, DocumentoExistente[]> {
  const map = new Map<string, DocumentoExistente[]>()
  for (const d of docsExistentes) {
    for (const dia of listarDiasPeriodo(d.dataInicio, d.dataFim)) {
      map.set(dia, [...(map.get(dia) ?? []), d])
    }
  }
  return map
}

function diasCobertosPorSessao(
  documentosSessao: DocumentoLancamento[],
  uuidConvocacao: string,
): Map<string, DocumentoLancamento[]> {
  const map = new Map<string, DocumentoLancamento[]>()
  for (const d of documentosSessao) {
    if (d.uuidConvocacao !== uuidConvocacao) continue
    for (const dia of listarDiasPeriodo(d.dataInicio, d.dataFim)) {
      map.set(dia, [...(map.get(dia) ?? []), d])
    }
  }
  return map
}

type Draft = {
  // identidade (CLT preenche; intermitente vem da convocação)
  empregadoNome: string
  contratoColaborador: ContratoColaboradorLabel | ""
  // tipo + datas
  tipoDocumentacaoLabel: TipoDocumentacaoLabel | ""
  dataInicio: string
  dataFim: string
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

function draftInicial(
  modo: ModoWizard,
  empregado: EmpregadoRM | null,
  convocacao: ConvocacaoResumida | null,
): Draft {
  const contratoConv = convocacao?.contrato ?? ""
  const contratoValido = CONTRATOS_COLABORADOR.find(
    (c) => c.label === contratoConv.toUpperCase(),
  )
  return {
    empregadoNome: modo === "clt" ? "" : empregado?.nome ?? "",
    contratoColaborador: contratoValido
      ? (contratoValido.label as ContratoColaboradorLabel)
      : "",
    tipoDocumentacaoLabel: "",
    dataInicio: "",
    dataFim: "",
    emissaoAtestado: "",
    saidaRetornoTexto: "",
    horarioAlmocoLabel: "",
    acompanhanteLabel: "Sem acompanhamento",
    unidadeLabel: null,
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
  const etapaInicial: Etapa =
    modo === "clt" ? { tipo: "identificacao-clt" } : { tipo: "tipo-doc" }
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial)
  const [direcao, setDirecao] = useState<SlideDirection>("forward")
  const [draft, setDraft] = useState<Draft>(() =>
    draftInicial(modo, empregado, convocacao),
  )

  const sabadosAtivos = useMemo(
    () => (convocacao ? sabadosAtivosDaConvocacao(convocacao) : []),
    [convocacao],
  )
  const docsExistentesPorDia = useMemo(
    () =>
      convocacao
        ? diasCobertosPorDocsExistentes(convocacao.documentosExistentes)
        : new Map<string, DocumentoExistente[]>(),
    [convocacao],
  )
  const sessaoPorDia = useMemo(
    () =>
      convocacao
        ? diasCobertosPorSessao(documentosSessao, convocacao.uuid)
        : new Map<string, DocumentoLancamento[]>(),
    [documentosSessao, convocacao],
  )

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
    if (etapa.tipo === "tipo-doc" && modo === "clt") {
      return ir({ tipo: "identificacao-clt" })
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
    return !!unidadeColumnIdParaContrato(contrato)
  }

  // Validações (modo intermitente — CLT pula bloqueios de docExistentes)
  function diaTemAtestadoBloqueante(dia: string): boolean {
    if (modo === "clt") return false
    const existentes = docsExistentesPorDia.get(dia) ?? []
    if (existentes.some((d) => d.tipoDocumento === "atestado")) return true
    const sessao = sessaoPorDia.get(dia) ?? []
    if (sessao.some((d) => d.tipoDocumento === "atestado")) return true
    return false
  }

  function diaPermitido(dia: string): { ok: boolean; motivo?: string } {
    if (modo === "clt") {
      // CLT só bloqueia dias sobrepostos na sessão atual mesmo nome.
      if (
        documentosSessao.some(
          (d) =>
            d.modalidadeContrato === "CELETISTA" &&
            d.empregadoNome.trim().toUpperCase() ===
              draft.empregadoNome.trim().toUpperCase() &&
            dia >= d.dataInicio &&
            dia <= d.dataFim,
        )
      ) {
        return { ok: false, motivo: "Já há documento nesta data para esta pessoa." }
      }
      return { ok: true }
    }
    if (!convocacao) return { ok: false, motivo: "Sem convocação." }
    if (!dataDentroPeriodo(dia, convocacao.dataInicio, convocacao.dataFim)) {
      return { ok: false, motivo: "Fora do período da convocação." }
    }
    if (isDomingoIso(dia)) {
      return { ok: false, motivo: "Domingo não conta na convocação." }
    }
    if (isSabadoIso(dia) && !sabadosAtivos.includes(dia)) {
      return { ok: false, motivo: "Sábado não está ativo nesta convocação." }
    }
    if (diaTemAtestadoBloqueante(dia)) {
      return { ok: false, motivo: "Já existe atestado neste dia." }
    }
    return { ok: true }
  }

  function rangeValido(inicio: string, fim: string): { ok: boolean; motivo?: string } {
    const dias = listarDiasPeriodo(inicio, fim)
    for (const d of dias) {
      const r = diaPermitido(d)
      if (!r.ok) return { ok: false, motivo: `${d}: ${r.motivo}` }
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
      emissaoAtestado: draft.emissaoAtestado || draft.dataInicio,
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
    if (etapa.tipo === "identificacao-clt") {
      return (
        <EtapaIdentificacaoCLT
          draft={draft}
          onChange={setDraft}
          onContinuar={() => ir({ tipo: "tipo-doc" })}
        />
      )
    }
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
      const tituloMin = convocacao?.dataInicio ?? "2024-01-01"
      const ehDiaUnico =
        draft.tipoDocumentacaoLabel === "Declaração Médica" ||
        draft.tipoDocumentacaoLabel === "Declaração Acompanhamento"
      return (
        <EtapaCalendario
          tituloMin={tituloMin}
          modo={modo}
          convocacao={convocacao}
          ehDiaUnico={ehDiaUnico}
          diaPermitido={diaPermitido}
          rangeValido={rangeValido}
          onConfirmar={(di, df) => {
            setDraft((p) => ({
              ...p,
              dataInicio: di,
              dataFim: df,
              emissaoAtestado: p.emissaoAtestado || di,
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
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/85"
      >
        <ArrowLeft className="size-3.5" />
        {etapa.tipo === etapaInicial.tipo
          ? modo === "clt"
            ? "Sair"
            : "Trocar convocação"
          : "Voltar"}
      </button>

      {modo === "intermitente" && convocacao && (
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-white/65 backdrop-blur">
          <p className="truncate">
            <span className="text-white/90">{empregado?.nome ?? "—"}</span>
            {" · "}
            <span className="text-white/55">
              {format(parseISO(convocacao.dataInicio), "dd/MM", { locale: ptBR })}
              {" — "}
              {format(parseISO(convocacao.dataFim), "dd/MM", { locale: ptBR })}
            </span>
            {" · "}
            <span className="text-white/55">{convocacao.contrato}</span>
          </p>
        </div>
      )}

      {modo === "clt" && etapa.tipo !== "identificacao-clt" && draft.empregadoNome && (
        <div className="mb-5 rounded-2xl border border-violet-300/25 bg-violet-300/[0.05] px-4 py-3 text-xs text-violet-100 backdrop-blur">
          <p className="truncate">
            <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]">
              CLT
            </span>{" "}
            <span className="ml-2 text-white/90">{draft.empregadoNome}</span>
            {draft.contratoColaborador && (
              <>
                {" · "}
                <span className="text-white/55">{draft.contratoColaborador}</span>
              </>
            )}
          </p>
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

function EtapaIdentificacaoCLT({
  draft,
  onChange,
  onContinuar,
}: {
  draft: Draft
  onChange: (next: Draft | ((p: Draft) => Draft)) => void
  onContinuar: () => void
}) {
  const valido =
    draft.empregadoNome.trim().length >= 3 && !!draft.contratoColaborador

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-violet-200/85">
        CLT · Identificação
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Quem é o <em className="italic text-[#b6a4ff]">colaborador</em>?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
        Digite o nome completo do celetista e selecione o contrato. CLT não tem
        cadastro no RM — operacional preenche manualmente.
      </p>

      <div className="mt-7 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Nome do Colaborador
          </label>
          <input
            type="text"
            autoFocus
            maxLength={255}
            value={draft.empregadoNome}
            onChange={(e) =>
              onChange((p) => ({
                ...p,
                empregadoNome: e.target.value.toUpperCase(),
              }))
            }
            placeholder="NOME COMPLETO EM MAIÚSCULO"
            className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-violet-300/50 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Contrato do Colaborador
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
        </div>
      </div>

      <div className="mt-7 flex justify-end">
        <ChoiceButton
          variant="primary"
          disabled={!valido}
          onClick={() => valido && onContinuar()}
        >
          Próximo
        </ChoiceButton>
      </div>
    </div>
  )
}

function EtapaTipoDocumentacao({
  atual,
  onEscolher,
}: {
  atual: TipoDocumentacaoLabel | ""
  onEscolher: (label: TipoDocumentacaoLabel) => void
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/85">
        Tipo de documentação
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Qual <em className="italic text-[#e8c275]">documento</em>?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
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
  tituloMin,
  modo,
  convocacao,
  ehDiaUnico,
  diaPermitido,
  rangeValido,
  onConfirmar,
}: {
  tituloMin: string
  modo: ModoWizard
  convocacao: ConvocacaoResumida | null
  ehDiaUnico: boolean
  diaPermitido: (dia: string) => { ok: boolean; motivo?: string }
  rangeValido: (i: string, f: string) => { ok: boolean; motivo?: string }
  onConfirmar: (dataInicio: string, dataFim: string) => void
}) {
  const [inicio, setInicio] = useState<string | null>(null)
  const [fim, setFim] = useState<string | null>(null)
  const [mesVisivel, setMesVisivel] = useState(() => parseISO(tituloMin))
  const [erro, setErro] = useState<string | null>(null)

  const diasDoMes = useMemo(() => {
    const inicioMes = startOfWeek(startOfMonth(mesVisivel), { weekStartsOn: 0 })
    const fimMes = endOfWeek(endOfMonth(mesVisivel), { weekStartsOn: 0 })
    const out: Date[] = []
    const d = new Date(inicioMes)
    while (d <= fimMes) {
      out.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [mesVisivel])

  function selecionar(iso: string) {
    setErro(null)
    if (ehDiaUnico) {
      setInicio(iso)
      setFim(iso)
      return
    }
    if (!inicio || (inicio && fim)) {
      setInicio(iso)
      setFim(null)
      return
    }
    let i = inicio
    let f = iso
    if (iso < inicio) {
      i = iso
      f = inicio
    }
    const r = rangeValido(i, f)
    if (!r.ok) {
      setErro(r.motivo ?? "Range inválido.")
      setInicio(iso)
      setFim(null)
      return
    }
    setInicio(i)
    setFim(f)
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/85">
        Período do documento
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        {ehDiaUnico ? (
          <>
            Dia do <em className="italic text-[#e8c275]">comparecimento</em>
          </>
        ) : (
          <>
            Datas de <em className="italic text-[#e8c275]">cobertura</em>
          </>
        )}
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
        {modo === "clt"
          ? "Sem restrição de convocação. Selecione o período do documento."
          : convocacao
            ? `Dentro do período da convocação (${format(parseISO(convocacao.dataInicio), "dd/MM")} — ${format(parseISO(convocacao.dataFim), "dd/MM")}).`
            : "Selecione o período."}
      </p>

      <div className="mt-6 space-y-4">
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
            const permitido = diaPermitido(iso).ok
            const noMes = isSameMonth(dia, mesVisivel)
            const selecionado = iso === inicio || iso === fim
            const noRange = inicio && fim && iso > inicio && iso < fim
            return (
              <button
                key={iso}
                type="button"
                disabled={!permitido}
                onClick={() => selecionar(iso)}
                className={`flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition ${
                  selecionado
                    ? "bg-amber-300 text-[#0a1224] shadow-[0_0_18px_rgba(232,194,117,0.45)]"
                    : noRange
                      ? "bg-amber-300/16 text-amber-100"
                      : permitido
                        ? "text-white/90 hover:bg-amber-300/15 hover:text-amber-100 glass-tile-3d-mini"
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
          {inicio && fim
            ? inicio === fim
              ? format(parseISO(inicio), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
              : `${format(parseISO(inicio), "dd/MM/yyyy")} a ${format(parseISO(fim), "dd/MM/yyyy")}`
            : inicio
              ? "Agora selecione a data final."
              : "Selecione a data inicial."}
        </p>

        {erro && (
          <p className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-xs text-rose-100">
            {erro}
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <ChoiceButton
          variant="primary"
          disabled={!inicio || !fim}
          onClick={() => inicio && fim && onConfirmar(inicio, fim)}
        >
          Próximo
        </ChoiceButton>
      </div>
    </div>
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
  const mostraAcompanhante = !!draft.tipoDocumentacaoLabel &&
    TIPOS_COM_ACOMPANHANTE.has(draft.tipoDocumentacaoLabel as TipoDocumentacaoLabel)
  const valido =
    draft.saidaRetornoTexto.trim().length > 0 &&
    !!draft.horarioAlmocoLabel &&
    !!draft.emissaoAtestado

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/85">
        Dados de trabalho
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Como foi o <em className="italic text-[#e8c275]">expediente</em>?
      </h2>

      <div className="mt-6 space-y-5">
        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
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
            className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-amber-300/50 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXEMPLOS_SAIDA_RETORNO.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() =>
                  onChange((p) => ({ ...p, saidaRetornoTexto: ex }))
                }
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/65 transition hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-100"
              >
                <ClipboardPaste className="size-3" />
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Horário de almoço
          </label>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {HORARIOS_ALMOCO.map((h) => (
              <ChoiceButton
                key={h.id}
                variant={draft.horarioAlmocoLabel === h.label ? "primary" : "ghost"}
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
          <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
            Emissão do atestado
          </label>
          <input
            type="date"
            value={draft.emissaoAtestado}
            onChange={(e) =>
              onChange((p) => ({ ...p, emissaoAtestado: e.target.value }))
            }
            className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-white focus:border-amber-300/50 focus:outline-none"
          />
        </div>

        {mostraAcompanhante && (
          <div className="fade-up">
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
              Acompanhante
            </label>
            <SelectGlass
              valor={draft.acompanhanteLabel}
              opcoes={ACOMPANHANTES.map((a) => a.label)}
              placeholder="Selecione"
              onChange={(v) =>
                onChange((p) => ({ ...p, acompanhanteLabel: v as AcompanhanteLabel }))
              }
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
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/85">
        Unidade do órgão
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        <em className="italic text-[#e8c275]">{contrato}</em> · qual unidade?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
        Selecione a unidade do colaborador. Se não estiver na lista, marque
        "Unidade não encontrada" e descreva no campo livre.
      </p>

      <div className="mt-6 space-y-4">
        <SelectGlass
          valor={unidadeLabel ?? ""}
          opcoes={opcoes}
          placeholder="Selecione a unidade"
          onChange={(v) => onChange(v || null, unidadeNaoEncontradaTexto)}
          searchable
        />

        {ehNaoEncontrada && (
          <div className="fade-up">
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
              Especifique a unidade
            </label>
            <input
              type="text"
              maxLength={255}
              value={unidadeNaoEncontradaTexto}
              onChange={(e) => onChange(unidadeLabel, e.target.value)}
              placeholder="Nome da unidade"
              className="mt-3 w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-amber-300/50 focus:outline-none"
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
      <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/85">
        Arquivo
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Anexar <em className="italic text-[#e8c275]">documento</em>
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
        PDF, JPG, PNG ou HEIC. Tamanho máximo 15 MB.
      </p>

      <label
        onMouseMove={tilt}
        onMouseLeave={tiltLeave}
        className={`upload-tile mt-7 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-amber-300/35 bg-amber-300/8 px-5 py-10 text-center hover:border-amber-300/60 hover:bg-amber-300/12 ${
          successFlash ? "upload-success" : ""
        }`}
      >
        <Upload className="mb-3 size-7 text-amber-200" />
        <span className="text-sm font-medium text-white/90">
          {arquivo ? arquivo.name : "Selecionar arquivo"}
        </span>
        <span className="mt-1 text-xs text-white/50">
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
        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
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
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
        Observação · opcional
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Algum <em className="italic text-[#e8c275]">esclarecimento</em>?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
        Use apenas se houver detalhe importante. Pode pular.
      </p>

      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={1000}
        placeholder="Ex: Atestado emitido após avaliação no pronto-socorro."
        className="mt-6 w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-amber-300/50 focus:outline-none"
      />

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onContinuar}
          className="text-xs text-white/55 transition hover:text-white/85"
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
      <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/85">
        Revisar antes de adicionar
      </p>
      <h2 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        Conferir <em className="italic text-emerald-300">documento</em>
      </h2>

      <div className="preview-doc-tile tone-atestado mt-6 space-y-2.5 rounded-2xl border border-white/12 bg-white/5 p-5 pl-7 text-sm text-white/80">
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
        <Linha label="Emissão" valor={format(parseISO(draft.emissaoAtestado), "dd/MM/yyyy")} />
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

      <p className="mt-4 text-xs text-white/50">
        Adicionando à sessão — envio efetivo só ao clicar em{" "}
        <strong className="text-white/75">Concluir</strong> no resumo.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onEditar}
          className="inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/85"
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
      <span className="text-white/55">{label}:</span>{" "}
      <strong className="text-white">{valor}</strong>
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
        className="flex w-full items-center justify-between rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-left text-white transition hover:border-amber-300/40 hover:bg-white/[0.06]"
      >
        <span className={valor ? "text-white" : "text-white/40"}>
          {valor || placeholder}
        </span>
        <ChevronRight
          className={`size-4 text-white/55 transition-transform ${aberto ? "rotate-90" : ""}`}
        />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-hidden rounded-2xl border border-white/12 bg-[#0a1224]/95 shadow-[0_18px_36px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Search className="size-3.5 text-white/55" />
              <input
                autoFocus
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
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
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-amber-300/10 hover:text-amber-100 ${
                    o === valor
                      ? "bg-amber-300/15 text-amber-100"
                      : "text-white/85"
                  }`}
                >
                  <Building2 className="size-3.5 shrink-0 text-white/45" />
                  {o}
                </button>
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="px-4 py-3 text-xs text-white/50">
                Nenhum resultado.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
