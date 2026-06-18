import { comOperador } from "@/lib/http"
import type {
  DescontoDados,
  PayloadRegistrarRetirada,
  ResultadoRegistrarRetirada,
} from "./types"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const USE_MOCK = !BASE_URL

// Estado mock por uuid — muda em memória entre buscar e registrar (DP testa
// fluxo completo localmente sem n8n real).
type MockState = DescontoDados

const MOCK_DESCONTOS: Record<string, MockState> = {
  "mock-pendente": {
    uuid: "mock-pendente",
    itemId: "mock-item-001",
    empregadoNome: "FULANO DE TAL",
    chapa: "006323",
    contrato: "SEMSA",
    periodoInicio: "2026-05-01",
    periodoFim: "2026-05-20",
    vrDevido: 245.0,
    vtDevido: 150.0,
    retiradaAnterior: null,
    status: "pendente",
  },
  "mock-registrado": {
    uuid: "mock-registrado",
    itemId: "mock-item-002",
    empregadoNome: "MARIA OLIVEIRA",
    chapa: "007201",
    contrato: "CETAM",
    periodoInicio: "2026-05-01",
    periodoFim: "2026-05-15",
    vrDevido: 180.0,
    vtDevido: 120.0,
    retiradaAnterior: {
      vrRetirado: 150.0,
      vtRetirado: 80.0,
      registradoEm: "2026-05-21T14:30:00Z",
    },
    status: "registrado",
  },
  "mock-zerar": {
    uuid: "mock-zerar",
    itemId: "mock-item-003",
    empregadoNome: "JOÃO PEREIRA",
    chapa: "005712",
    contrato: "DETRAN",
    periodoInicio: "2026-05-05",
    periodoFim: "2026-05-25",
    vrDevido: 320.0,
    vtDevido: 200.0,
    retiradaAnterior: null,
    status: "pendente",
  },
}

function isMockUuid(uuid: string): boolean {
  return uuid in MOCK_DESCONTOS || uuid.startsWith("mock-")
}

function snapshot(m: MockState): DescontoDados {
  return {
    uuid: m.uuid,
    itemId: m.itemId,
    empregadoNome: m.empregadoNome,
    chapa: m.chapa,
    contrato: m.contrato,
    periodoInicio: m.periodoInicio,
    periodoFim: m.periodoFim,
    vrDevido: m.vrDevido,
    vtDevido: m.vtDevido,
    retiradaAnterior: m.retiradaAnterior ? { ...m.retiradaAnterior } : null,
    status: m.status,
  }
}

export async function buscarDesconto(uuid: string): Promise<DescontoDados> {
  if (USE_MOCK || isMockUuid(uuid)) {
    await new Promise((r) => setTimeout(r, 400))
    const mock = MOCK_DESCONTOS[uuid]
    if (!mock) {
      const err = new Error("Desconto não encontrado") as Error & {
        status?: number
      }
      err.status = 404
      throw err
    }
    return snapshot(mock)
  }

  const res = await fetch(
    `/api/descontos/ler?uuid=${encodeURIComponent(uuid)}`,
    { credentials: "same-origin" },
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  return {
    uuid: String(raw.uuid),
    itemId: String(raw.item_id ?? raw.itemId ?? ""),
    empregadoNome: String(raw.empregado_nome ?? raw.empregadoNome ?? ""),
    chapa: String(raw.chapa ?? ""),
    contrato: raw.contrato ?? null,
    periodoInicio: String(raw.periodo_inicio ?? raw.periodoInicio ?? ""),
    periodoFim: String(raw.periodo_fim ?? raw.periodoFim ?? ""),
    vrDevido: Number(raw.vr_devido ?? raw.vrDevido ?? 0),
    vtDevido: Number(raw.vt_devido ?? raw.vtDevido ?? 0),
    retiradaAnterior: mapRetiradaAnterior(raw.retirada_anterior ?? raw.retiradaAnterior),
    status:
      (raw.status as "pendente" | "registrado") ??
      (raw.retirada_anterior || raw.retiradaAnterior ? "registrado" : "pendente"),
  }
}

function mapRetiradaAnterior(raw: unknown): DescontoDados["retiradaAnterior"] {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const vr = Number(o.vr_retirado ?? o.vrRetirado ?? 0)
  const vt = Number(o.vt_retirado ?? o.vtRetirado ?? 0)
  const ts = String(o.registrado_em ?? o.registradoEm ?? "")
  if (!ts && vr === 0 && vt === 0) return null
  return { vrRetirado: vr, vtRetirado: vt, registradoEm: ts }
}

export class RegistrarRetiradaApiError extends Error {
  status?: number
  erro?: string

  constructor(message: string, status?: number, erro?: string) {
    super(message)
    this.name = "RegistrarRetiradaApiError"
    this.status = status
    this.erro = erro
  }
}

export async function registrarRetiradaManual(
  uuid: string,
  payload: PayloadRegistrarRetirada,
): Promise<ResultadoRegistrarRetirada> {
  if (USE_MOCK || isMockUuid(uuid)) {
    await new Promise((r) => setTimeout(r, 600))
    const mock = MOCK_DESCONTOS[uuid]
    if (!mock) {
      throw new RegistrarRetiradaApiError(
        "Desconto não encontrado.",
        404,
        "nao_encontrado",
      )
    }
    mock.retiradaAnterior = {
      vrRetirado: payload.vrRetirado,
      vtRetirado: payload.vtRetirado,
      registradoEm: new Date().toISOString(),
    }
    mock.status = "registrado"
    return {
      ok: true,
      uuid: mock.uuid,
      vrRetirado: payload.vrRetirado,
      vtRetirado: payload.vtRetirado,
      vrRestante: Math.max(0, mock.vrDevido - payload.vrRetirado),
      vtRestante: Math.max(0, mock.vtDevido - payload.vtRetirado),
    }
  }

  const res = await fetch(`/api/descontos/registrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(
      comOperador({
        uuid,
        vr_retirado: payload.vrRetirado,
        vt_retirado: payload.vtRetirado,
      }),
    ),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new RegistrarRetiradaApiError(
      data.mensagem || `Erro ${res.status}`,
      res.status,
      data.erro,
    )
  }
  return {
    ok: data.ok !== false,
    uuid: String(data.uuid ?? uuid),
    vrRetirado: Number(data.vr_retirado ?? data.vrRetirado ?? payload.vrRetirado),
    vtRetirado: Number(data.vt_retirado ?? data.vtRetirado ?? payload.vtRetirado),
    vrRestante: Number(data.vr_restante ?? data.vrRestante ?? 0),
    vtRestante: Number(data.vt_restante ?? data.vtRestante ?? 0),
  }
}
