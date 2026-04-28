import type { PayloadFinalizar, ProcessamentoDados, RespostaDia } from "./types"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const USE_MOCK = !BASE_URL

function mockDias(inicio: string, fim: string): string[] {
  const dias: string[] = []
  const atual = new Date(inicio)
  const fimData = new Date(fim)
  while (atual <= fimData) {
    dias.push(atual.toISOString().slice(0, 10))
    atual.setUTCDate(atual.getUTCDate() + 1)
  }
  return dias
}

type MockState = ProcessamentoDados & {
  respostasAnteriores: RespostaDia[]
  diasExtras: string[]
  diasDesativados: string[]
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
  },
  "mock-correcao": {
    uuid: "mock-correcao",
    nome: "Maria Aparecida Souza",
    contrato: "CT-2026-088",
    dataInicio: "2026-04-15",
    dataFim: "2026-04-21",
    dias: mockDias("2026-04-15", "2026-04-21"),
    status: "concluido",
    concluidoEm: "2026-04-22T09:15:00Z",
    protocolo: "PROT-TEST-DEMO",
    editado: false,
    editadoEm: null,
    respostasAnteriores: [
      { data: "2026-04-15", tipo: "sem_ocorrencia" },
      { data: "2026-04-16", tipo: "atraso", minutosAtraso: 25 },
      { data: "2026-04-17", tipo: "falta" },
      { data: "2026-04-18", tipo: "sem_ocorrencia" },
      { data: "2026-04-19", tipo: "sem_ocorrencia" },
      { data: "2026-04-20", tipo: "atraso", minutosAtraso: 10 },
      { data: "2026-04-21", tipo: "sem_ocorrencia" },
      { data: "2026-04-23", tipo: "atraso", minutosAtraso: 45 },
    ],
    diasExtras: ["2026-04-23"],
    diasDesativados: [],
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
  },
}

// Seed localStorage with demo protocols so the "Recentes" list shows up
// immediately on first load — useful for testing the correction flow.
if (USE_MOCK && typeof window !== "undefined") {
  try {
    const KEY = "plano-intermitentes:protocolos"
    const existentes = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    const protocolosExistentes = new Set(
      Array.isArray(existentes)
        ? existentes.map((e: { protocolo: string }) => e.protocolo)
        : [],
    )
    const seeds = Object.values(MOCK_PROCESSAMENTOS)
      .filter((m) => m.status === "concluido" && m.protocolo)
      .filter((m) => !protocolosExistentes.has(m.protocolo!))
      .map((m) => ({
        protocolo: m.protocolo!,
        uuid: m.uuid,
        nome: m.nome,
        dataInicio: m.dataInicio,
        dataFim: m.dataFim,
        concluidoEm: m.concluidoEm ?? new Date().toISOString(),
        editadoEm: m.editadoEm,
      }))
    if (seeds.length > 0) {
      const merged = [
        ...seeds,
        ...(Array.isArray(existentes) ? existentes : []),
      ]
      localStorage.setItem(KEY, JSON.stringify(merged.slice(0, 50)))
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
  }
}

export async function buscarProcessamento(
  uuid: string,
): Promise<ProcessamentoDados> {
  if (USE_MOCK) {
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
    protocolo: raw.protocolo ?? null,
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
  }
}

export async function finalizarProcessamento(
  uuid: string,
  payload: PayloadFinalizar,
): Promise<{ protocolo: string; editado: boolean }> {
  if (USE_MOCK) {
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

  const res = await fetch(
    `${BASE_URL}/intermitente-finalizar?uuid=${encodeURIComponent(uuid)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid,
        respostas,
        protocolo: payload.protocolo,
        dias_extras: payload.diasExtras ?? [],
        dias_desativados: payload.diasDesativados ?? [],
        eh_correcao: payload.ehCorrecao ?? false,
      }),
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

/**
 * Looks up a UUID by protocol code.
 * Mock mode: scans MOCK_PROCESSAMENTOS by their protocolo field.
 * Real mode: hits a (TODO) n8n endpoint that resolves protocolo → uuid.
 */
export async function buscarUuidPorProtocolo(
  protocolo: string,
): Promise<{ uuid: string; nome: string }> {
  const limpo = protocolo.trim().toUpperCase()
  if (USE_MOCK) {
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
    `${BASE_URL}/intermitente-buscar-protocolo?protocolo=${encodeURIComponent(limpo)}`,
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  return { uuid: raw.uuid, nome: raw.nome }
}
