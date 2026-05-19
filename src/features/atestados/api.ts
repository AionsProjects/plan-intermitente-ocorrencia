import type {
  BuscarConvocacoesEmpregadoQuery,
  ConvocacaoResumida,
  DocumentoExistente,
  DocumentoLancamento,
  LancarDocumentosResultado,
  PeriodoTurno,
  TipoDocumento,
} from "./types"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const ANTIGO_BASE_URL = import.meta.env.VITE_N8N_ANTIGO_BASE_URL || BASE_URL
const USE_MOCK = !BASE_URL

// Reusa autocomplete RM intermitente do convocar (WF8)
export { buscarEmpregado } from "@/features/convocar/api"

// Busca celetista no RM — endpoint próprio (separado do WF8 de intermitente).
// SQL no RM filtra apenas CLT; mesma shape EmpregadoRM.
const MOCK_CELETISTAS: import("./types").EmpregadoRM[] = [
  {
    nome: "MARIA SILVA CLT",
    chapa: "100001",
    cpf: "00000000010",
    funcao: "ANALISTA DE PESSOAL",
    admissao: "2022-03-14",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
  {
    nome: "JOAO PEREIRA CELETISTA",
    chapa: "100002",
    cpf: "00000000011",
    funcao: "ASSISTENTE ADMINISTRATIVO",
    admissao: "2021-08-02",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
  {
    nome: "ANA SOUZA CLT",
    chapa: "100003",
    cpf: "00000000012",
    funcao: "MOTORISTA",
    admissao: "2024-01-22",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
]

function normaliza(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
}

export async function buscarCeletista(
  nome: string,
): Promise<import("./types").EmpregadoRM[]> {
  const query = nome.trim()
  if (query.length < 3) return []
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 250))
    const q = normaliza(query)
    return MOCK_CELETISTAS.filter((e) => normaliza(e.nome).includes(q))
  }
  const res = await fetch(
    `${ANTIGO_BASE_URL}/celetista-buscar-empregado?nome=${encodeURIComponent(query)}`,
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  const lista: unknown[] = raw.resultados ?? []
  return lista.map((r) => {
    const o = r as Record<string, unknown>
    return {
      nome: String(o.nome ?? ""),
      chapa: String(o.chapa ?? ""),
      cpf: String(o.cpf ?? ""),
      funcao: String(o.funcao ?? ""),
      admissao: String(o.admissao ?? ""),
      secao: String(o.secao ?? ""),
      codcoligada: Number(o.codcoligada ?? 3),
    }
  })
}

const MOCK_CONVOCACOES: Record<string, ConvocacaoResumida[]> = {
  "999001": [
    {
      uuid: "mock-aguardando",
      itemEntradaId: "mock-entrada-001",
      dataInicio: "2026-05-04",
      dataFim: "2026-05-22",
      contrato: "SEMSA",
      trabalhaSabado: false,
      optanteVT: true,
      status: "aguardando",
      statusConvocacao: "Válida",
      dataInicioCancelamento: null,
      documentosExistentes: [],
    },
  ],
  "999002": [
    {
      uuid: "mock-conv-bel-1",
      itemEntradaId: "mock-entrada-002",
      dataInicio: "2026-05-01",
      dataFim: "2026-05-15",
      contrato: "DETRAN",
      trabalhaSabado: true,
      optanteVT: true,
      status: "aguardando",
      statusConvocacao: "Válida",
      dataInicioCancelamento: null,
      documentosExistentes: [
        {
          id: "atest-mock-prev",
          tipoDocumento: "atestado",
          dataInicio: "2026-05-05",
          dataFim: "2026-05-05",
          periodos: [],
          mondayItemUrl:
            "https://contato-serv.monday.com/boards/18298015951/pulses/000000",
        },
      ],
    },
    {
      uuid: "mock-conv-bel-2",
      itemEntradaId: "mock-entrada-003",
      dataInicio: "2026-05-18",
      dataFim: "2026-05-30",
      contrato: "DETRAN",
      trabalhaSabado: false,
      optanteVT: true,
      status: "aguardando",
      statusConvocacao: "Válida",
      dataInicioCancelamento: null,
      documentosExistentes: [],
    },
  ],
}

export async function buscarConvocacoesEmpregado(
  query: BuscarConvocacoesEmpregadoQuery,
): Promise<ConvocacaoResumida[]> {
  const chapa = query.chapa.trim()
  if (!chapa) return []

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return MOCK_CONVOCACOES[chapa] ?? []
  }

  const params = new URLSearchParams({ chapa })
  if (query.mes) params.set("mes", query.mes)

  const res = await fetch(
    `${BASE_URL}/intermitente-convocacoes-empregado?${params.toString()}`,
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  const lista: unknown[] = raw.convocacoes ?? []
  return lista.map(mapConvocacao)
}

function mapConvocacao(raw: unknown): ConvocacaoResumida {
  const o = raw as Record<string, unknown>
  return {
    uuid: String(o.uuid ?? ""),
    itemEntradaId: String(o.item_entrada_id ?? o.itemEntradaId ?? ""),
    itemHistoricoId: o.item_historico_id
      ? String(o.item_historico_id)
      : undefined,
    dataInicio: String(o.data_inicio ?? o.dataInicio ?? ""),
    dataFim: String(o.data_fim ?? o.dataFim ?? ""),
    contrato: String(o.contrato ?? ""),
    trabalhaSabado:
      o.trabalha_sabado === true ||
      o.trabalha_sabado === "SIM" ||
      o.trabalhaSabado === true,
    optanteVT:
      o.optante_vt === true ||
      o.optante_vt === "SIM" ||
      o.optante_vt === "SIM*" ||
      o.optanteVT === true,
    status: (o.status as ConvocacaoResumida["status"]) ?? "aguardando",
    statusConvocacao: String(
      o.status_convocacao ?? o.statusConvocacao ?? "Válida",
    ),
    dataInicioCancelamento:
      (o.data_inicio_cancelamento as string | null | undefined) ?? null,
    documentosExistentes: Array.isArray(o.documentos_existentes)
      ? (o.documentos_existentes as unknown[]).map(mapDocumentoExistente)
      : Array.isArray(o.atestados)
        ? (o.atestados as unknown[]).map(mapDocumentoExistente)
        : [],
  }
}

function mapDocumentoExistente(raw: unknown): DocumentoExistente {
  const o = raw as Record<string, unknown>
  return {
    id: String(o.id ?? ""),
    tipoDocumento:
      (o.tipo_documento as TipoDocumento) ??
      (o.tipoDocumento as TipoDocumento) ??
      "atestado",
    dataInicio: String(o.data_inicio ?? o.dataInicio ?? ""),
    dataFim: String(o.data_fim ?? o.dataFim ?? ""),
    periodos: Array.isArray(o.periodos)
      ? (o.periodos as PeriodoTurno[])
      : [],
    mondayItemUrl:
      (o.monday_item_url as string | null | undefined) ??
      (o.mondayItemUrl as string | null | undefined) ??
      null,
  }
}

export class LancarDocumentosApiError extends Error {
  status?: number
  erro?: string
  resultados?: LancarDocumentosResultado["resultados"]

  constructor(
    message: string,
    options: {
      status?: number
      erro?: string
      resultados?: LancarDocumentosResultado["resultados"]
    } = {},
  ) {
    super(message)
    this.name = "LancarDocumentosApiError"
    this.status = options.status
    this.erro = options.erro
    this.resultados = options.resultados
  }
}

export async function lancarDocumentos(
  documentos: DocumentoLancamento[],
): Promise<LancarDocumentosResultado> {
  if (documentos.length === 0) {
    return { ok: true, resultados: [] }
  }

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 800))
    return {
      ok: true,
      resultados: documentos.map((d) => ({
        id: d.id,
        mondayItemIdControle: `mock-ctrl-${d.id}`,
        descontoId: `mock-desc-${d.id}`,
      })),
    }
  }

  const fd = new FormData()
  const payload = {
    documentos: documentos.map((d) => ({
      id: d.id,
      // identidade / contexto
      modalidade_contrato: d.modalidadeContrato,
      empregado_nome: d.empregadoNome,
      chapa: d.chapa || null,
      uuid_convocacao: d.uuidConvocacao || null,
      item_entrada_id: d.itemEntradaId ?? null,
      trabalha_sabado: d.trabalhaSabado,
      optante_vt: d.optanteVT,
      // tipo + janela
      tipo_documentacao_label: d.tipoDocumentacaoLabel,
      dias_atestado: d.diasAtestado,
      data_inicio: d.dataInicio,
      data_fim: d.dataFim,
      emissao_atestado: d.emissaoAtestado,
      // trabalho
      saida_retorno_texto: d.saidaRetornoTexto,
      horario_almoco_label: d.horarioAlmocoLabel,
      acompanhante_label: d.acompanhanteLabel,
      // contrato + unidade
      contrato_colaborador: d.contratoColaborador,
      unidade_label: d.unidadeLabel,
      unidade_dropdown_column_id: d.unidadeDropdownColumnId,
      unidade_nao_encontrada_texto: d.unidadeNaoEncontradaTexto,
      // observação
      observacao: d.observacao,
      // arquivo
      nome_arquivo: d.nomeArquivo,
      tamanho_arquivo: d.tamanhoArquivo,
      // legado (compat com docs antigos)
      tipo_documento_legado: d.tipoDocumento ?? null,
      periodos: d.periodos ?? [],
    })),
  }
  fd.append("payload", JSON.stringify(payload))
  for (const d of documentos) {
    fd.append(`doc_${d.id}`, d.arquivo, d.arquivo.name)
  }

  const res = await fetch(`${BASE_URL}/intermitente-lancar-documentos`, {
    method: "POST",
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new LancarDocumentosApiError(
      data.mensagem || `Erro ${res.status}`,
      {
        status: res.status,
        erro: data.erro,
        resultados: data.resultados,
      },
    )
  }
  return {
    ok: data.ok !== false,
    resultados: Array.isArray(data.resultados) ? data.resultados : [],
  }
}

