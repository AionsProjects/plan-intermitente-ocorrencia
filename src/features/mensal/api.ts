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
}
export interface ContratoQtd {
  contrato: string
  qtd: number
}
export interface PessoasResp {
  papel: Papel
  board_id: string
  competencia: string | null
  total: number
  porContrato: ContratoQtd[]
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

// Dispara a automação mensal (n8n krRj3) com um runId — o n8n usa pra reportar o progresso ao vivo.
export async function dispararPagamentoMensal(
  papel: Papel,
  competencia: string | null,
  runId: string,
): Promise<DisparoResp> {
  if (!N8N) {
    // sem backend n8n configurado (dev): simula sucesso pra validar o fluxo
    await new Promise((r) => setTimeout(r, 1200))
    return { ok: true, mensagem: "Modo dev: disparo simulado (VITE_N8N_BASE_URL vazio)." }
  }
  const res = await fetch(`${N8N}/intermitente-mensal-fechamento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ papel, competencia, runId }),
  })
  const j = (await res.json().catch(() => ({}))) as { mensagem?: string }
  if (!res.ok) throw new Error(j.mensagem || `Erro ${res.status} ao disparar`)
  return { ok: true, mensagem: j.mensagem }
}

// Acompanhamento ao vivo do run (polling).
export type RunItemStatus = "pendente" | "rodando" | "ok" | "erro"
export type RunStatusGeral =
  | "preparando"
  | "rodando"
  | "concluido"
  | "concluido_com_erro"
  | "falhou"
export interface RunItem {
  ordem: number
  contrato: string
  qtd: number
  status: RunItemStatus
  erro_msg: string | null
}
export interface RunHeader {
  run_id: string
  papel: string
  competencia: string | null
  status: RunStatusGeral
  total_contratos: number
  ok_contratos: number
  erro_contratos: number
  criado_em: string
  atualizado_em: string
  finalizado_em: string | null
}
export interface RunStatus {
  run: RunHeader | null
  itens: RunItem[]
}

export function buscarRunStatus(runId: string): Promise<RunStatus> {
  return getJson<RunStatus>(`/api/mensal/run/${runId}`)
}
