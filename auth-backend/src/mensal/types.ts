export type PapelMensal = "atual" | "proximo"
export type ModoMensal = "homologacao" | "producao"

export type StatusRunMensal =
  | "aguardando_aprovacao"
  | "fila"
  | "rodando"
  | "recuperando"
  | "concluido"
  | "concluido_com_erro"
  | "falhou"
  | "cancelado"
  | "cancelado_com_pendencia"

export type StatusContratoMensal = "pendente" | "rodando" | "ok" | "erro" | "bloqueado" | "cancelado"

export interface PessoaPreviaMensal {
  itemId: string
  nome: string
  chapa: string
  cpf: string
  contrato: string
  funcao: string
  unidade: string
  interior: string
  dataInicio: string
  dataFim: string
  diasVR?: number
  diasVT?: number
  vrDia?: number
  vtDia?: number
  brutoVR?: number
  brutoVT?: number
  descontoVR?: number
  descontoVT?: number
  liquidoVR?: number
  liquidoVT?: number
  creditoVR?: number
  creditoVT?: number
  pixVR?: number
  pixVT?: number
  regraAplicada?: string
}

export interface ContratoPreviaMensal {
  contrato: string
  ordem: number
  pessoas: PessoaPreviaMensal[]
  bloqueado: boolean
  motivoBloqueio: string | null
  totais: { vr: number | null; vt: number | null; credito: number | null; pix: number | null }
  efeitosPrevistos: string[]
}

export interface SnapshotPreviaMensal {
  versao: 1
  papel: PapelMensal
  competencia: string
  boardId: string
  criadoEm: string
  contratos: ContratoPreviaMensal[]
  alertas: string[]
  apoio: {
    solicitacoesProcessadas: string[]
    parametrosBeneficios: number
    feriados: number
    descontosPendentes: number
    grupoControleCaju: string | null
  }
}

export interface EventoMensalInput {
  runId: string
  contrato?: string | null
  etapa: string
  estado: string
  tentativa?: number
  mensagem?: string | null
  metadados?: Record<string, unknown>
}
