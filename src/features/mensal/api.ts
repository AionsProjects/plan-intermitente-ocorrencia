export type Papel = "atual" | "proximo" | "teste"

export interface MesInfo {
  existe: boolean
  board_id?: string
  competencia?: string | null
}
export interface MesesResp { atual: MesInfo; proximo: MesInfo; teste?: MesInfo }

export interface PessoaMensal {
  nome: string
  chapa: string
  cpf: string
  contrato: string
  funcao: string
  unidade: string
  interior: string
}
export interface ContratoQtd { contrato: string; qtd: number }
export interface PessoasResp {
  papel: Papel
  board_id: string
  competencia: string | null
  total: number
  porContrato: ContratoQtd[]
  pessoas: PessoaMensal[]
}

export interface PessoaPrevia {
  itemId: string
  nome: string
  chapa: string
  contrato: string
}
export interface ContratoPrevia {
  contrato: string
  ordem: number
  pessoas: PessoaPrevia[]
  bloqueado: boolean
  motivoBloqueio: string | null
  totais: { vr: number | null; vt: number | null; credito: number | null; pix: number | null }
  efeitosPrevistos: string[]
}
export interface SnapshotPrevia {
  versao: 1
  papel: Papel
  competencia: string
  boardId: string
  criadoEm: string
  contratos: ContratoPrevia[]
  alertas: string[]
  apoio: {
    solicitacoesProcessadas: string[]
    parametrosBeneficios: number
    feriados: number
    descontosPendentes: number
    grupoControleCaju: string | null
  }
}
export interface PreviaResp {
  run_id: string
  snapshot: SnapshotPrevia
  status: "aguardando_aprovacao"
  modo: "homologacao" | "producao"
}

export type RunItemStatus = "pendente" | "rodando" | "ok" | "erro" | "bloqueado" | "cancelado"
export type RunStatusGeral =
  | "aguardando_aprovacao"
  | "fila"
  | "rodando"
  | "recuperando"
  | "concluido"
  | "concluido_com_erro"
  | "falhou"
  | "cancelado"
  | "cancelado_com_pendencia"

export interface RunItem {
  ordem: number
  contrato: string
  qtd: number
  status: RunItemStatus
  etapa_atual: string
  tentativas: number
  erro_msg: string | null
  motivo_bloqueio: string | null
  referencias_externas: Record<string, unknown>
  atualizado_em: string
}
export interface RunHeader {
  run_id: string
  papel: string
  competencia: string | null
  status: RunStatusGeral
  modo: "homologacao" | "producao"
  etapa_atual: string
  total_contratos: number
  ok_contratos: number
  erro_contratos: number
  criado_em: string
  atualizado_em: string
  finalizado_em: string | null
}
export interface RunStatus { run: RunHeader; itens: RunItem[] }

export interface EventoMensal {
  id: number
  contrato: string | null
  etapa: string
  estado: string
  tentativa: number
  mensagem: string | null
  metadados: Record<string, unknown>
  criado_em: string
}
export interface EventosResp { eventos: EventoMensal[]; proximo_after: number }
export interface AoVivoResp {
  run: RunHeader
  itens: RunItem[]
  eventos: EventoMensal[]
  proximo_after: number
}

/** Erro de API com o código cru + corpo (pra tratar conflitos como 409). */
export class MensalApiError extends Error {
  codigo: string
  status: number
  corpo: Record<string, unknown>
  constructor(codigo: string, status: number, corpo: Record<string, unknown>) {
    super(codigo)
    this.name = "MensalApiError"
    this.codigo = codigo
    this.status = status
    this.corpo = corpo
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new MensalApiError((body.erro as string) || `Erro ${res.status}`, res.status, body)
  }
  return body as T
}

const jsonPost = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
})

export interface MensalConfig {
  modo: "homologacao" | "producao"
  workflowEnabled: boolean
  productionEnabled: boolean
  /** true em homologação ou na janela de ensaio (MENSAL_TEST_BYPASS_ANTIFRAUDE). */
  controlesTeste?: boolean
}
export function buscarConfigMensal(): Promise<MensalConfig> {
  return requestJson("/api/mensal/config")
}
export function buscarMeses(): Promise<MesesResp> {
  return requestJson("/api/mensal/meses")
}
export function buscarPessoas(papel: Papel): Promise<PessoasResp> {
  return requestJson(`/api/mensal/pessoas?papel=${papel}`)
}
export function criarPreviaMensal(papel: Papel, bypassAntifraude = false): Promise<PreviaResp> {
  return requestJson("/api/mensal/runs/previa", jsonPost({ papel, bypassAntifraude }))
}
export function aprovarRunMensal(runId: string, somenteContratos?: string[]): Promise<{ ok: boolean; workflow_run_id: string }> {
  return requestJson(`/api/mensal/runs/${runId}/aprovar`, jsonPost({ somenteContratos }))
}
export function cancelarRunMensal(runId: string, motivo: string): Promise<{ ok: boolean; status: RunStatusGeral }> {
  return requestJson(`/api/mensal/runs/${runId}/cancelar`, jsonPost({ motivo }))
}
export function retomarRunMensal(runId: string): Promise<{ ok: boolean; workflow_run_id: string }> {
  return requestJson(`/api/mensal/runs/${runId}/retomar`, jsonPost())
}
export function buscarRunStatus(runId: string): Promise<RunStatus> {
  return requestJson(`/api/mensal/runs/${runId}`)
}
export function buscarEventosMensal(runId: string, after = 0): Promise<EventosResp> {
  return requestJson(`/api/mensal/runs/${runId}/eventos?after=${after}`)
}
/** Run global em andamento (reatar acompanhamento após reload). */
export function buscarRunAtivo(): Promise<{ run: RunHeader | null }> {
  return requestJson(`/api/mensal/runs/ativo`)
}
/** Consolidado: run + itens + eventos (delta) numa chamada. */
export function buscarAoVivo(runId: string, after = 0): Promise<AoVivoResp> {
  return requestJson(`/api/mensal/runs/${runId}/ao-vivo?after=${after}`)
}
