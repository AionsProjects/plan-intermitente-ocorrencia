import type {
  BeneficioPontoFacultativo,
  ContratoPontoFacultativo,
  PontoFacultativoAplicacao,
  PontoFacultativoItem,
  PontoFacultativoPayload,
  PontoFacultativoPreview,
} from "./types"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const USE_MOCK = !BASE_URL

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

function mockPreview(payload: PontoFacultativoPayload): PontoFacultativoPreview {
  const itens = [0, 1, 2].map((i) => mockItem(i, payload))
  return {
    ok: true,
    contrato: payload.contrato,
    data: payload.data,
    beneficios: payload.beneficios,
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
    data: String(raw.data ?? ""),
    beneficios: Array.isArray(raw.beneficios)
      ? (raw.beneficios.map(String).filter((b) => b === "VR" || b === "VT") as BeneficioPontoFacultativo[])
      : [],
    totalColaboradores: Number(
      raw.total_colaboradores ?? raw.totalColaboradores ?? itens.length,
    ),
    totalVR: Number(raw.total_vr ?? raw.totalVR ?? 0),
    totalVT: Number(raw.total_vt ?? raw.totalVT ?? 0),
    total: Number(raw.total ?? 0),
    itens,
  }
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
    body: JSON.stringify(payload),
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
