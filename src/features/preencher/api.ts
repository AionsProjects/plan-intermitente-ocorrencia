import { comOperador } from "@/lib/http"
import type {
  Atestado,
  PayloadAplicarSplit,
  PayloadCancelarConvocacao,
  PayloadFinalizar,
  ProcessamentoDados,
  PontoFacultativo,
  RespostaDia,
  ResultadoAplicarSplit,
  ResultadoCancelarConvocacao,
  SplitConvocacao,
} from "./types"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const USE_MOCK = !BASE_URL

// UUIDs/protocolos com prefixos reservados que SEMPRE caem no mock local,
// mesmo quando o n8n real está configurado. Útil pra ter chaves fixas de
// teste em produção sem precisar mexer em .env.
function isMockUuid(uuid: string): boolean {
  return uuid in MOCK_PROCESSAMENTOS || uuid.startsWith("mock-")
}
function isMockProtocol(protocolo: string): boolean {
  const limpo = protocolo.trim().toUpperCase()
  return (
    limpo.startsWith("PROT-TEST-") ||
    limpo.startsWith("PROT-DEMO-") ||
    Object.values(MOCK_PROCESSAMENTOS).some((m) => m.protocolo === limpo)
  )
}

function mockDias(
  inicio: string,
  fim: string,
  incluirSabado = false,
): string[] {
  const dias: string[] = []
  const atual = new Date(inicio)
  const fimData = new Date(fim)
  while (atual <= fimData) {
    const dow = atual.getUTCDay()
    // Pula domingos (0); pula sábados (6) quando não inclui
    if (dow !== 0 && (incluirSabado || dow !== 6)) {
      dias.push(atual.toISOString().slice(0, 10))
    }
    atual.setUTCDate(atual.getUTCDate() + 1)
  }
  return dias
}

type MockState = ProcessamentoDados & {
  respostasAnteriores: RespostaDia[]
  diasExtras: string[]
  diasDesativados: string[]
  sabadosExtras: string[]
  atestados: Atestado[]
  pontosFacultativos?: PontoFacultativo[]
}

const MOCK_PROCESSAMENTOS: Record<string, MockState> = {
  "mock-aguardando": {
    uuid: "mock-aguardando",
    nome: "Isaac Gomes",
    contrato: "CT-2026-042",
    dataInicio: "2026-04-20",
    dataFim: "2026-04-25",
    dias: mockDias("2026-04-20", "2026-04-25"),
    status: "aguardando",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
  },
  "mock-pronto-split": {
    uuid: "mock-pronto-split",
    nome: "Maria Oliveira",
    contrato: "CETAM",
    dataInicio: "2026-05-01",
    dataFim: "2026-05-20",
    dias: mockDias("2026-05-01", "2026-05-20"),
    status: "aguardando",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
    split: null,
  },
  "mock-concluido": {
    uuid: "mock-concluido",
    nome: "Fulano de Tal",
    contrato: "CT-2026-001",
    dataInicio: "2026-04-10",
    dataFim: "2026-04-12",
    dias: mockDias("2026-04-10", "2026-04-12"),
    status: "concluido",
    concluidoEm: "2026-04-13T15:32:00Z",
    protocolo: "PROT-DEMO-1234",
    editado: false,
    editadoEm: null,
    respostasAnteriores: [
      { data: "2026-04-10", tipo: "sem_ocorrencia" },
      { data: "2026-04-11", tipo: "falta" },
      { data: "2026-04-12", tipo: "atraso", minutosAtraso: 15 },
    ],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
  },
  "mock-expirado": {
    uuid: "mock-expirado",
    nome: "Ciclano Silva",
    contrato: "CT-2025-999",
    dataInicio: "2025-12-01",
    dataFim: "2025-12-03",
    dias: mockDias("2025-12-01", "2025-12-03"),
    status: "expirado",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
  },
  "mock-sabados": {
    uuid: "mock-sabados",
    nome: "Marina Pereira",
    contrato: "CT-2026-115",
    dataInicio: "2026-04-01",
    dataFim: "2026-04-30",
    dias: mockDias("2026-04-01", "2026-04-30", false),
    status: "aguardando",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: ["2026-04-25"],
    atestados: [],
    pontosFacultativos: [],
  },
  "mock-cancelado-parcial": {
    uuid: "mock-cancelado-parcial",
    nome: "Joana Cancelamento",
    contrato: "DETRAN",
    dataInicio: "2026-05-25",
    dataFim: "2026-05-29",
    dias: mockDias("2026-05-25", "2026-05-29"),
    status: "aguardando",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
    dataInicioCancelamento: "2026-05-28",
    statusCancelamento: "cancelada_parcial",
  },
  "mock-corrigir-cancelado": {
    uuid: "mock-corrigir-cancelado",
    nome: "Soraia Correção Demo",
    contrato: "DETRAN",
    dataInicio: "2026-05-25",
    dataFim: "2026-05-30",
    dias: mockDias("2026-05-25", "2026-05-30"),
    status: "concluido",
    concluidoEm: "2026-05-23T17:49:11.000Z",
    protocolo: "PROT-DEMO-CANC",
    editado: false,
    editadoEm: null,
    respostasAnteriores: [
      { data: "2026-05-25", tipo: "sem_ocorrencia" },
      { data: "2026-05-26", tipo: "sem_ocorrencia" },
      { data: "2026-05-27", tipo: "sem_ocorrencia" },
    ],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
    dataInicioCancelamento: "2026-05-28",
    statusCancelamento: "cancelada_parcial",
  },
  "mock-com-sabado": {
    uuid: "mock-com-sabado",
    nome: "Bruno Lima",
    contrato: "CT-2026-220",
    dataInicio: "2026-04-06",
    dataFim: "2026-04-11",
    dias: mockDias("2026-04-06", "2026-04-11", true),
    status: "aguardando",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: true,
    sabadosExtras: [],
    atestados: [],
    pontosFacultativos: [],
  },
  "mock-atestado": {
    uuid: "mock-atestado",
    nome: "Lorena Marques",
    contrato: "CT-2026-331",
    dataInicio: "2026-04-20",
    dataFim: "2026-04-26",
    dias: mockDias("2026-04-20", "2026-04-26", false),
    status: "aguardando",
    concluidoEm: null,
    protocolo: null,
    editado: false,
    editadoEm: null,
    respostasAnteriores: [],
    diasExtras: [],
    diasDesativados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
    atestados: [
      {
        id: "atest-mock-1",
        tipoDocumento: "atestado",
        dataInicio: "2026-04-22",
        dataFim: "2026-04-24",
        periodos: [],
        primeiroDiaFoiTrabalhar: true,
        primeiroDiaTrabalhouSeisHoras: false,
        nomeArquivo: "atestado-exemplo.pdf",
        tamanhoArquivo: 284_000,
        mondayItemId: "mock",
        mondayItemUrl:
          "https://contato-serv.monday.com/boards/18298015951/pulses/000000",
      },
    ],
    pontosFacultativos: [
      {
        data: "2026-04-25",
        contrato: "CT-2026-331",
        origem: "ponto_facultativo:CT-2026-331:2026-04-25",
        beneficios: ["VT"],
        valorVR: 0,
        valorVT: 15,
      },
    ],
  },
}

// Limpa entradas de teste antigas que foram auto-seedadas em versões
// anteriores (PROT-DEMO-* e PROT-TEST-*). Hoje a chave de teste fica
// num botão discreto separado, não na lista de recentes.
if (typeof window !== "undefined") {
  try {
    const KEY = "plano-intermitentes:protocolos"
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const existentes = JSON.parse(raw)
      if (Array.isArray(existentes)) {
        const limpos = existentes.filter(
          (e: { protocolo: string }) =>
            !e.protocolo?.startsWith("PROT-DEMO-") &&
            !e.protocolo?.startsWith("PROT-TEST-"),
        )
        if (limpos.length !== existentes.length) {
          localStorage.setItem(KEY, JSON.stringify(limpos))
        }
      }
    }
  } catch {
    // ignore
  }
}

function snapshot(m: MockState): ProcessamentoDados {
  return {
    uuid: m.uuid,
    nome: m.nome,
    contrato: m.contrato,
    dataInicio: m.dataInicio,
    dataFim: m.dataFim,
    dias: [...m.dias],
    status: m.status,
    concluidoEm: m.concluidoEm,
    protocolo: m.protocolo,
    editado: m.editado,
    editadoEm: m.editadoEm,
    respostasAnteriores: [...m.respostasAnteriores],
    diasExtras: [...m.diasExtras],
    diasDesativados: [...m.diasDesativados],
    trabalhaSabado: m.trabalhaSabado,
    sabadosExtras: [...m.sabadosExtras],
    atestados: m.atestados.map((a) => ({ ...a })),
    pontosFacultativos: (m.pontosFacultativos ?? []).map((p) => ({ ...p })),
    dataInicioCancelamento: m.dataInicioCancelamento ?? null,
    statusCancelamento: m.statusCancelamento ?? null,
    split: m.split ? { ...m.split } : null,
  }
}

function mapPontoFacultativo(raw: Record<string, unknown>): PontoFacultativo {
  const beneficiosRaw = Array.isArray(raw.beneficios) ? raw.beneficios : []
  const beneficios = beneficiosRaw
    .map(String)
    .filter((b) => b === "VR" || b === "VT") as PontoFacultativo["beneficios"]
  return {
    data: String(raw.data ?? ""),
    contrato:
      (raw.contrato as string | null | undefined) ??
      (raw.contrato_colaborador as string | null | undefined) ??
      null,
    origem:
      (raw.origem as string | null | undefined) ??
      (raw.origin as string | null | undefined) ??
      null,
    beneficios,
    valorVR: Number(raw.valor_vr ?? raw.valorVR ?? 0),
    valorVT: Number(raw.valor_vt ?? raw.valorVT ?? 0),
  }
}

function mapAtestado(raw: Record<string, unknown>): Atestado {
  const tipoDocRaw =
    (raw.tipoDocumento as string | undefined) ??
    (raw.tipo_documento as string | undefined) ??
    "atestado"
  const tipoDocumento: Atestado["tipoDocumento"] =
    tipoDocRaw === "declaracao" ? "declaracao" : "atestado"
  const periodosRaw =
    (raw.periodos as unknown[] | undefined) ??
    (raw.tipo_periodo
      ? [String(raw.tipo_periodo)]
      : [])
  const periodos = (periodosRaw as string[])
    .filter((p) => p === "manha" || p === "tarde") as Atestado["periodos"]

  const labelRaw =
    (raw.tipoDocumentacaoLabel as string | undefined) ??
    (raw.tipo_documentacao_label as string | undefined) ??
    null
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    tipoDocumento,
    tipoDocumentacaoLabel: labelRaw,
    dataInicio: String(raw.dataInicio ?? raw.data_inicio ?? ""),
    dataFim: String(raw.dataFim ?? raw.data_fim ?? ""),
    periodos,
    primeiroDiaFoiTrabalhar:
      (raw.primeiroDiaFoiTrabalhar as boolean | undefined) ??
      (raw.primeiro_dia_foi_trabalhar as boolean | undefined) ??
      false,
    primeiroDiaTrabalhouSeisHoras:
      (raw.primeiroDiaTrabalhouSeisHoras as boolean | undefined) ??
      (raw.primeiro_dia_trabalhou_seis_horas as boolean | undefined),
    nomeArquivo: String(raw.nomeArquivo ?? raw.nome_arquivo ?? "Documento"),
    tamanhoArquivo: Number(raw.tamanhoArquivo ?? raw.tamanho_arquivo ?? 0),
    mondayItemId:
      (raw.mondayItemId as string | null | undefined) ??
      (raw.monday_item_id as string | null | undefined) ??
      null,
    mondayItemUrl:
      (raw.mondayItemUrl as string | null | undefined) ??
      (raw.monday_item_url as string | null | undefined) ??
      null,
    arquivoUrl:
      (raw.arquivoUrl as string | null | undefined) ??
      (raw.arquivo_url as string | null | undefined) ??
      null,
  }
}

function payloadFinalizarSnake(
  uuid: string,
  payload: PayloadFinalizar,
  respostas: Array<{
    data: string
    tipo: RespostaDia["tipo"]
    minutos_atraso: number | null
  }>,
) {
  return {
    uuid,
    respostas,
    protocolo: payload.protocolo,
    dias_extras: payload.diasExtras ?? [],
    dias_desativados: payload.diasDesativados ?? [],
    sabados_extras: payload.sabadosExtras ?? [],
    eh_correcao: payload.ehCorrecao ?? false,
    split: payload.split
      ? {
          data_inicio_parte2: payload.split.dataInicioParte2,
          contrato_parte1: payload.split.contratoParte1,
          contrato_parte2: payload.split.contratoParte2,
        }
      : null,
  }
}

export async function buscarProcessamento(
  uuid: string,
): Promise<ProcessamentoDados> {
  if (USE_MOCK || isMockUuid(uuid)) {
    await new Promise((r) => setTimeout(r, 400))
    const mock = MOCK_PROCESSAMENTOS[uuid]
    if (!mock) {
      const err = new Error("Processamento não encontrado") as Error & {
        status?: number
      }
      err.status = 404
      throw err
    }
    return snapshot(mock)
  }

  const res = await fetch(
    `${BASE_URL}/intermitente-ler?uuid=${encodeURIComponent(uuid)}`,
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  return {
    uuid: raw.uuid,
    nome: raw.nome,
    contrato: raw.contrato ?? null,
    dataInicio: raw.data_inicio,
    dataFim: raw.data_fim,
    dias: raw.dias ?? [],
    status: raw.status,
    concluidoEm: raw.concluido_em ?? null,
    // Normaliza "" → null. O monday devolve string vazia em colunas text
    // não preenchidas, e isso quebra o `??` (que só captura null/undefined)
    // no FormularioWizard, fazendo o frontend mandar protocolo: "".
    protocolo: raw.protocolo || null,
    editado: !!raw.editado,
    editadoEm: raw.editado_em ?? null,
    respostasAnteriores: (raw.respostas ?? []).map(
      (r: { data: string; tipo: RespostaDia["tipo"]; minutos_atraso?: number | null }) => ({
        data: r.data,
        tipo: r.tipo,
        minutosAtraso: r.minutos_atraso ?? undefined,
      }),
    ),
    diasExtras: raw.dias_extras ?? [],
    diasDesativados: raw.dias_desativados ?? [],
    trabalhaSabado:
      raw.trabalha_sabado === true ||
      raw.trabalha_sabado === "SIM" ||
      raw.trabalha_sabado === "sim",
    sabadosExtras: raw.sabados_extras ?? [],
    atestados: Array.isArray(raw.atestados)
      ? raw.atestados.map(mapAtestado)
      : [],
    pontosFacultativos: Array.isArray(raw.pontos_facultativos)
      ? raw.pontos_facultativos.map(mapPontoFacultativo)
      : [],
    dataInicioCancelamento:
      (raw.data_inicio_cancelamento as string | null | undefined) ?? null,
    statusCancelamento:
      normalizaStatusCancelamento(raw.status_cancelamento) ?? null,
    split: mapSplit(raw.split),
  }
}

function mapSplit(raw: unknown): SplitConvocacao | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const dataInicioParte2 = String(
    o.dataInicioParte2 ?? o.data_inicio_parte2 ?? "",
  )
  const contratoParte1 = String(o.contratoParte1 ?? o.contrato_parte1 ?? "")
  const contratoParte2 = String(o.contratoParte2 ?? o.contrato_parte2 ?? "")
  if (!dataInicioParte2 || !contratoParte1 || !contratoParte2) return null
  return { dataInicioParte2, contratoParte1, contratoParte2 }
}

function normalizaStatusCancelamento(
  raw: unknown,
): import("./types").StatusCancelamento | null {
  if (!raw) return null
  const norm = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
  if (norm.includes("parcial")) return "cancelada_parcial"
  if (norm.includes("cancel")) return "cancelada"
  if (norm.includes("valid")) return "valida"
  return null
}

export async function finalizarProcessamento(
  uuid: string,
  payload: PayloadFinalizar,
): Promise<{ protocolo: string; editado: boolean }> {
  if (USE_MOCK || isMockUuid(uuid)) {
    await new Promise((r) => setTimeout(r, 600))
    const mock = MOCK_PROCESSAMENTOS[uuid]
    if (mock) {
      const ehReedicao = mock.status === "concluido"
      mock.status = "concluido"
      mock.concluidoEm = mock.concluidoEm ?? new Date().toISOString()
      mock.protocolo = payload.protocolo
      mock.respostasAnteriores = payload.respostas
      mock.diasExtras = payload.diasExtras ?? []
      mock.diasDesativados = payload.diasDesativados ?? []
      mock.sabadosExtras = payload.sabadosExtras ?? []
      if (ehReedicao || payload.ehCorrecao) {
        mock.editado = true
        mock.editadoEm = new Date().toISOString()
      }
      return { protocolo: mock.protocolo, editado: mock.editado }
    }
    return { protocolo: payload.protocolo, editado: false }
  }

  const respostas = payload.respostas.map((r) => ({
    data: r.data,
    tipo: r.tipo,
    minutos_atraso: r.minutosAtraso ?? null,
  }))

  const bodyJson = payloadFinalizarSnake(uuid, payload, respostas)
  const res = await fetch(
    `${BASE_URL}/intermitente-finalizar?uuid=${encodeURIComponent(uuid)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comOperador(bodyJson)),
    },
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const data = await res.json().catch(() => ({}))
  return {
    protocolo: data.protocolo ?? payload.protocolo,
    editado: !!data.editado,
  }
}

export class CancelarConvocacaoApiError extends Error {
  status?: number
  erro?: string

  constructor(message: string, status?: number, erro?: string) {
    super(message)
    this.name = "CancelarConvocacaoApiError"
    this.status = status
    this.erro = erro
  }
}

export async function cancelarConvocacao(
  uuid: string,
  payload: PayloadCancelarConvocacao,
): Promise<ResultadoCancelarConvocacao> {
  if (USE_MOCK || isMockUuid(uuid)) {
    await new Promise((r) => setTimeout(r, 500))
    const mock = MOCK_PROCESSAMENTOS[uuid]
    if (!mock) {
      throw new CancelarConvocacaoApiError(
        "Processamento não encontrado.",
        404,
        "nao_encontrado",
      )
    }
    // Aplica mutação no mock state pra próxima leitura refletir
    if (payload.tipo === "reverter") {
      mock.dataInicioCancelamento = null
      mock.statusCancelamento = "valida"
    } else if (payload.tipo === "parcial") {
      mock.dataInicioCancelamento = payload.dataInicioCancelamento
      mock.statusCancelamento = "cancelada_parcial"
    } else if (payload.tipo === "total") {
      mock.dataInicioCancelamento = null
      mock.statusCancelamento = "cancelada"
      // Total finaliza convocação
      mock.status = "concluido"
      mock.concluidoEm = mock.concluidoEm ?? new Date().toISOString()
    }
    return {
      ok: true,
      tipo: payload.tipo,
      dataInicioCancelamento: payload.dataInicioCancelamento,
      desconto: {
        acao: payload.tipo === "reverter" ? "skip" : "create",
        descontoVR: 0,
        descontoVT: 0,
        motivo: "mock",
      },
    }
  }

  const res = await fetch(
    `${BASE_URL}/intermitente-cancelar-convocacao?uuid=${encodeURIComponent(uuid)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        comOperador({
          uuid,
          tipo: payload.tipo,
          data_inicio_cancelamento: payload.dataInicioCancelamento,
        }),
      ),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new CancelarConvocacaoApiError(
      data.mensagem || `Erro ${res.status}`,
      res.status,
      data.erro,
    )
  }

  return {
    ok: data.ok !== false,
    tipo: data.tipo ?? payload.tipo,
    dataInicioCancelamento:
      data.data_inicio_cancelamento ?? payload.dataInicioCancelamento,
    desconto: data.desconto,
  }
}

export class AplicarSplitApiError extends Error {
  status?: number
  erro?: string

  constructor(message: string, status?: number, erro?: string) {
    super(message)
    this.name = "AplicarSplitApiError"
    this.status = status
    this.erro = erro
  }
}

export async function aplicarSplit(
  uuid: string,
  payload: PayloadAplicarSplit,
): Promise<ResultadoAplicarSplit> {
  if (USE_MOCK || isMockUuid(uuid)) {
    await new Promise((r) => setTimeout(r, 500))
    const mock = MOCK_PROCESSAMENTOS[uuid]
    if (!mock) {
      throw new AplicarSplitApiError(
        "Processamento não encontrado.",
        404,
        "nao_encontrado",
      )
    }
    if (payload.tipo === "reverter") {
      mock.split = null
    } else {
      mock.split = {
        dataInicioParte2: payload.dataInicioParte2,
        contratoParte1: payload.contratoParte1,
        contratoParte2: payload.contratoParte2,
      }
    }
    return { ok: true, split: mock.split }
  }

  const body =
    payload.tipo === "reverter"
      ? { tipo: "reverter" as const }
      : {
          tipo: "aplicar" as const,
          data_inicio_parte2: payload.dataInicioParte2,
          contrato_parte1: payload.contratoParte1,
          contrato_parte2: payload.contratoParte2,
        }

  const res = await fetch(
    `${BASE_URL}/intermitente-aplicar-split?uuid=${encodeURIComponent(uuid)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comOperador(body)),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new AplicarSplitApiError(
      data.mensagem || `Erro ${res.status}`,
      res.status,
      data.erro,
    )
  }
  return {
    ok: data.ok !== false,
    split: mapSplit(data.split),
  }
}

/**
 * Looks up a UUID by protocol code.
 * Mock mode: scans MOCK_PROCESSAMENTOS by their protocolo field.
 * Real mode: hits a (TODO) n8n endpoint that resolves protocolo → uuid.
 */
export async function buscarUuidPorProtocolo(
  protocolo: string,
): Promise<{ uuid: string; nome: string }> {
  const limpo = protocolo.trim().toUpperCase()
  if (USE_MOCK || isMockProtocol(limpo)) {
    await new Promise((r) => setTimeout(r, 300))
    const found = Object.values(MOCK_PROCESSAMENTOS).find(
      (m) => m.protocolo === limpo,
    )
    if (!found) {
      const err = new Error("Protocolo não encontrado") as Error & {
        status?: number
      }
      err.status = 404
      throw err
    }
    return { uuid: found.uuid, nome: found.nome }
  }

  const res = await fetch(
    `/api/intermitente/buscar-protocolo?protocolo=${encodeURIComponent(limpo)}`,
    { credentials: "same-origin" },
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  return { uuid: raw.uuid, nome: raw.nome }
}
