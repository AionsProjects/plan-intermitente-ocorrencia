import type { PayloadFinalizar, ProcessamentoDados } from "./types"

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

const MOCK_PROCESSAMENTOS: Record<string, ProcessamentoDados> = {
  "mock-aguardando": {
    uuid: "mock-aguardando",
    nome: "Isaac Gomes",
    contrato: "CT-2026-042",
    dataInicio: "2026-04-20",
    dataFim: "2026-04-25",
    dias: mockDias("2026-04-20", "2026-04-25"),
    status: "aguardando",
    concluidoEm: null,
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
  },
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
    // Retornar uma cópia para que o React Query detecte mudanças
    return { ...mock, dias: [...mock.dias] }
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
  // WF2 retorna snake_case; converter para o shape do frontend
  return {
    uuid: raw.uuid,
    nome: raw.nome,
    contrato: raw.contrato ?? null,
    dataInicio: raw.data_inicio,
    dataFim: raw.data_fim,
    dias: raw.dias ?? [],
    status: raw.status,
    concluidoEm: raw.concluido_em ?? null,
  }
}

export async function finalizarProcessamento(
  uuid: string,
  payload: PayloadFinalizar,
): Promise<void> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 600))
    const mock = MOCK_PROCESSAMENTOS[uuid]
    if (mock) {
      mock.status = "concluido"
      mock.concluidoEm = new Date().toISOString()
    }
    return
  }

  // WF3 espera snake_case
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
      body: JSON.stringify({ uuid, respostas }),
    },
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
}
