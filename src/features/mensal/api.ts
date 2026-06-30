// Pagamento Mensal Intermitente — leituras via backend (/api/mensal/*) + disparo via n8n.
const N8N = (import.meta.env.VITE_N8N_BASE_URL as string | undefined) ?? ""

export type Papel = "atual" | "proximo"

export interface MesInfo {
  existe: boolean
  board_id?: string
  competencia?: string | null
}
export interface MesesResp {
  atual: MesInfo
  proximo: MesInfo
}
export interface PessoaMensal {
  nome: string
  chapa: string
  cpf: string
  contrato: string
  funcao: string
  unidade: string
  interior: string
  vr: number
  vt: number
  diasVr: string
  diasVt: string
}
export interface PessoasResp {
  papel: Papel
  board_id: string
  competencia: string | null
  total: number
  totalVR: number
  totalVT: number
  pessoas: PessoaMensal[]
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error((j as { erro?: string }).erro || `Erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function buscarMeses(): Promise<MesesResp> {
  return getJson<MesesResp>("/api/mensal/meses")
}

export function buscarPessoas(papel: Papel): Promise<PessoasResp> {
  return getJson<PessoasResp>(`/api/mensal/pessoas?papel=${papel}`)
}

export interface DisparoResp {
  ok: boolean
  mensagem?: string
}

// Dispara a automação mensal (n8n krRj3). Webhook ainda a conectar no n8n.
export async function dispararPagamentoMensal(
  papel: Papel,
  competencia: string | null,
): Promise<DisparoResp> {
  if (!N8N) {
    // sem backend n8n configurado (dev): simula sucesso pra validar o fluxo
    await new Promise((r) => setTimeout(r, 1200))
    return { ok: true, mensagem: "Modo dev: disparo simulado (VITE_N8N_BASE_URL vazio)." }
  }
  const res = await fetch(`${N8N}/intermitente-mensal-fechamento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ papel, competencia }),
  })
  const j = (await res.json().catch(() => ({}))) as { mensagem?: string }
  if (!res.ok) throw new Error(j.mensagem || `Erro ${res.status} ao disparar`)
  return { ok: true, mensagem: j.mensagem }
}
