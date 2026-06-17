import type {
  BeneficioPontoFacultativo,
  ContratoPontoFacultativo,
  PontoFacultativoAplicacao,
  PontoFacultativoItem,
  PontoFacultativoOpcoes,
  PontoFacultativoPayload,
  PontoFacultativoPreview,
  UnidadeComCount,
} from "./types"
import { comOperador } from "@/lib/http"
import { CONTRATOS_PONTO_FACULTATIVO as CONTRATOS } from "./types"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const USE_MOCK = !BASE_URL

// Mocks reproduzem volume real do RM:
// - SEMSA ~102 unidades (UBS + DISA + ADM)
// - SEDUC INTERIOR ~68 (1 sede da coord + escolas espalhadas)
// - SEDUC ESCOLA ~57 (escolas urbanas)
// - SEDUC SEDE pequeno (~6)
// - DETRAN/TRE/CETAM listas curtas
// Nomes reais misturados com sintéticos. Inclui "RAYOL", "SAO JOSE",
// "GABRIELLE" pra cobrir cenários de busca dos critérios.
function gerar(prefixo: string, base: string[], extras: number): string[] {
  const out = [...base.map((b) => `${prefixo} - ${b.toUpperCase()}`)]
  const sintetico = [
    "ALVORADA",
    "BAIRRO DA UNIAO",
    "CAMPOS SALES",
    "CIDADE NOVA",
    "COROADO",
    "DOM PEDRO",
    "EDUCANDOS",
    "FLORES",
    "JAPIIM",
    "MORRO DA LIBERDADE",
    "NOVO ALEIXO",
    "PARQUE 10",
    "PETROPOLIS",
    "PRESIDENTE VARGAS",
    "PUARAQUEQUARA",
    "REDENCAO",
    "SAO LAZARO",
    "TARUMA",
    "VILA DA PRATA",
    "ZUMBI DOS PALMARES",
  ]
  for (let i = 0; i < extras; i++) {
    out.push(`${prefixo} - ${sintetico[i % sintetico.length]} ${Math.floor(i / sintetico.length) + 1}`)
  }
  return out
}

const MOCK_UNIDADES_STR: Record<ContratoPontoFacultativo, string[]> = {
  SEMSA: gerar(
    "SEMSA",
    [
      "ADM",
      "ALVORADA",
      "COMPENSA",
      "DISTRITO LESTE",
      "DISTRITO NORTE",
      "DISTRITO OESTE",
      "DISTRITO SUL",
      "JORGE TEIXEIRA",
      "RAYOL DOS SANTOS",
      "SAO JOSE",
      "SEDE",
      "ZONA NORTE",
    ],
    90,
  ),
  "SEDUC ESCOLA": gerar(
    "SEDUC ESCOLA",
    [
      "IRMA GABRIELLE",
      "MAYARA REDMAN",
      "PROF JACIRA CABOCLO",
      "DOM JOAO DE SOUZA",
      "ANGELO RAMAZZOTTI",
    ],
    52,
  ),
  "SEDUC SEDE": [
    "SEDUC - MANAUS",
    "SEDUC - DEPOSITO",
    "SEDUC - SAO JOSE",
    "SEDUC - ADM CENTRAL",
    "SEDUC - DIRETORIA",
    "SEDUC - PROTOCOLO",
  ],
  "SEDUC INTERIOR": gerar(
    "SEDUC INTERIOR",
    [
      "SEDE DA COORDENADORIA",
      "ESCOLA ESTADUAL INTERIOR",
      "CETI PARINTINS",
      "CETI TABATINGA",
      "CETI ITACOATIARA",
      "CETI MANACAPURU",
    ],
    62,
  ),
  DETRAN: ["DETRAN - INTERMITENTE", "DETRAN - SEDE", "DETRAN - CIRETRAN"],
  "TRE PB": ["TRE PB - INTERMITENTE", "TRE PB - SEDE"],
  CETAM: [
    "CETAM - GASTRONOMIA",
    "CETAM - PARINTINS",
    "CETAM - MANACAPURU",
    "CETAM - TEFE",
    "CETAM - PRESIDENCIA",
  ],
}

/** Converte fallback string[] em UnidadeComCount[] com qtd aleatória mock
 *  pra UX de teste mostrar mistura de unidades cheias e vazias. */
function MOCK_UNIDADES_COM_COUNT(): Record<ContratoPontoFacultativo, UnidadeComCount[]> {
  const seedHash = (s: string) =>
    s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)
  const out = {} as Record<ContratoPontoFacultativo, UnidadeComCount[]>
  for (const contrato of CONTRATOS) {
    out[contrato] = MOCK_UNIDADES_STR[contrato].map((label) => {
      const hash = Math.abs(seedHash(label))
      // ~40% das unidades vazias, resto entre 1-6 pessoas
      const qtd = hash % 10 < 4 ? 0 : (hash % 6) + 1
      return { label, qtdIntermitentes: qtd }
    })
  }
  return out
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function mockItem(
  seed: number,
  payload: PontoFacultativoPayload,
): PontoFacultativoItem {
  const vt = payload.beneficios.includes("VT")
  const vr = payload.beneficios.includes("VR")
  const semVT = seed === 2
  const valorVR = vr ? 24.5 : 0
  const valorVT = vt && !semVT ? (seed === 1 ? 7.5 : 15) : 0
  return {
    itemEntradaId: `mock-entrada-${seed}`,
    itemHistoricoId: `mock-hist-${seed}`,
    uuid: `mock-uuid-${seed}`,
    nome: ["RIO BARBOSA DA SILVA", "KAREN CHAVES DE OLIVEIRA", "MARIA DO CARMO"][seed] ?? "COLABORADOR TESTE",
    chapa: `00705${seed}`,
    cpf: `0010813527${seed}`,
    contrato: payload.contrato,
    unidade: payload.unidade,
    funcao: seed === 1 ? "MOTO BOY" : "TECNICO EM NIVEL MEDIO",
    periodoInicio: payload.data.slice(0, 8) + "01",
    periodoFim: payload.data.slice(0, 8) + "25",
    data: payload.data,
    optanteVT: !semVT,
    vtMeiaVolta: seed === 1,
    trabalhaSabado: seed === 0,
    aplicaVR: valorVR > 0,
    aplicaVT: valorVT > 0,
    valorVR,
    valorVT,
    total: round2(valorVR + valorVT),
    avisos: semVT && vt ? ["Nao optante VT"] : [],
  }
}

/** Mock preview — exportado para a área de testes pré-popular estados. */
export function mockPreview(
  payload: PontoFacultativoPayload,
  opts: { vazio?: boolean } = {},
): PontoFacultativoPreview {
  const itens = opts.vazio ? [] : [0, 1, 2].map((i) => mockItem(i, payload))
  return {
    ok: true,
    contrato: payload.contrato,
    unidade: payload.unidade,
    data: payload.data,
    beneficios: payload.beneficios,
    aviso: opts.vazio ? "sem_intermitentes_unidade_data" : null,
    totalColaboradores: itens.length,
    totalVR: round2(itens.reduce((acc, i) => acc + i.valorVR, 0)),
    totalVT: round2(itens.reduce((acc, i) => acc + i.valorVT, 0)),
    total: round2(itens.reduce((acc, i) => acc + i.total, 0)),
    itens,
  }
}

function mapItem(raw: Record<string, unknown>): PontoFacultativoItem {
  return {
    itemEntradaId: String(raw.item_entrada_id ?? raw.itemEntradaId ?? ""),
    itemHistoricoId:
      raw.item_historico_id || raw.itemHistoricoId
        ? String(raw.item_historico_id ?? raw.itemHistoricoId)
        : null,
    uuid: raw.uuid ? String(raw.uuid) : null,
    nome: String(raw.nome ?? raw.empregado_nome ?? ""),
    chapa: String(raw.chapa ?? ""),
    cpf: raw.cpf ? String(raw.cpf) : null,
    contrato: String(raw.contrato ?? ""),
    unidade: String(raw.unidade ?? ""),
    funcao: raw.funcao ? String(raw.funcao) : null,
    periodoInicio: String(raw.periodo_inicio ?? raw.periodoInicio ?? ""),
    periodoFim: String(raw.periodo_fim ?? raw.periodoFim ?? ""),
    data: String(raw.data ?? ""),
    optanteVT: Boolean(raw.optante_vt ?? raw.optanteVT),
    vtMeiaVolta: Boolean(raw.vt_meia_volta ?? raw.vtMeiaVolta),
    trabalhaSabado: Boolean(raw.trabalha_sabado ?? raw.trabalhaSabado),
    aplicaVR: Boolean(raw.aplica_vr ?? raw.aplicaVR),
    aplicaVT: Boolean(raw.aplica_vt ?? raw.aplicaVT),
    valorVR: Number(raw.valor_vr ?? raw.valorVR ?? 0),
    valorVT: Number(raw.valor_vt ?? raw.valorVT ?? 0),
    total: Number(raw.total ?? 0),
    avisos: Array.isArray(raw.avisos) ? raw.avisos.map(String) : [],
  }
}

function mapPreview(raw: Record<string, unknown>): PontoFacultativoPreview {
  const itens = Array.isArray(raw.itens)
    ? raw.itens.map((i) => mapItem(i as Record<string, unknown>))
    : []
  return {
    ok: raw.ok !== false,
    contrato: String(raw.contrato ?? "") as ContratoPontoFacultativo,
    unidade: String(raw.unidade ?? ""),
    data: String(raw.data ?? ""),
    beneficios: Array.isArray(raw.beneficios)
      ? (raw.beneficios.map(String).filter((b) => b === "VR" || b === "VT") as BeneficioPontoFacultativo[])
      : [],
    aviso: raw.aviso ? String(raw.aviso) : null,
    totalColaboradores: Number(
      raw.total_colaboradores ?? raw.totalColaboradores ?? itens.length,
    ),
    totalVR: Number(raw.total_vr ?? raw.totalVR ?? 0),
    totalVT: Number(raw.total_vt ?? raw.totalVT ?? 0),
    total: Number(raw.total ?? 0),
    itens,
  }
}

function mapUnidadeEntry(item: unknown): UnidadeComCount | null {
  if (typeof item === "string") {
    const label = item.trim()
    if (!label) return null
    return { label, qtdIntermitentes: 0 }
  }
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>
    const label = String(obj.label ?? obj.name ?? "").trim()
    if (!label) return null
    return {
      label,
      qtdIntermitentes: Number(obj.qtd_intermitentes ?? obj.qtdIntermitentes ?? 0),
      foraRm: Boolean(obj._fora_rm ?? obj.foraRm) || undefined,
    }
  }
  return null
}

function mapOpcoes(raw: Record<string, unknown>): PontoFacultativoOpcoes {
  const bruto = raw.unidades_por_contrato ?? raw.unidadesPorContrato ?? {}
  const src = typeof bruto === "object" && bruto ? (bruto as Record<string, unknown>) : {}
  const unidadesPorContrato = Object.fromEntries(
    CONTRATOS.map((contrato) => {
      const lista = Array.isArray(src[contrato])
        ? (src[contrato] as unknown[])
            .map(mapUnidadeEntry)
            .filter((u): u is UnidadeComCount => u !== null)
        : []
      return [contrato, lista]
    }),
  ) as Record<ContratoPontoFacultativo, UnidadeComCount[]>
  const contagens = typeof raw.contagens === "object" && raw.contagens
    ? (raw.contagens as Record<string, number>)
    : undefined
  return {
    ok: raw.ok !== false,
    unidadeColumnId: String(raw.unidade_column_id ?? raw.unidadeColumnId ?? ""),
    unidadesPorContrato,
    contagens,
    mesReferencia: raw.mes_referencia ? String(raw.mes_referencia) : undefined,
  }
}

export async function buscarOpcoesPontoFacultativo(): Promise<PontoFacultativoOpcoes> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 180))
    return {
      ok: true,
      unidadeColumnId: "dropdown_mm3mcnmn",
      unidadesPorContrato: MOCK_UNIDADES_COM_COUNT(),
    }
  }

  const res = await fetch(`${BASE_URL}/ponto-facultativo-opcoes`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.mensagem || `Erro ${res.status}`)
  }
  return mapOpcoes(data)
}

export async function previewPontoFacultativo(
  payload: PontoFacultativoPayload,
): Promise<PontoFacultativoPreview> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    return mockPreview(payload)
  }

  const res = await fetch(`${BASE_URL}/ponto-facultativo-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.mensagem || `Erro ${res.status}`)
  }
  return mapPreview(data)
}

export async function aplicarPontoFacultativo(
  payload: PontoFacultativoPayload,
): Promise<PontoFacultativoAplicacao> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 650))
    const preview = mockPreview(payload)
    return { ...preview, processados: preview.itens.length, ignorados: 0 }
  }

  const res = await fetch(`${BASE_URL}/ponto-facultativo-aplicar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(comOperador(payload)),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.mensagem || `Erro ${res.status}`)
  }
  const preview = mapPreview(data)
  return {
    ...preview,
    processados: Number(data.processados ?? preview.itens.length),
    ignorados: Number(data.ignorados ?? 0),
  }
}
