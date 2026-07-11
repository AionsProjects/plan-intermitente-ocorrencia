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
  itemIds?: string[]
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

export interface PlanUpdatePrevia {
  itemId: string
  vtDia: number
  vrDia: number
  vrMensal: number
  diasVR: number
  diasVT: number
  creditoVR: number
  creditoVT: number
}

export interface DescontoUpdatePrevia {
  id: string
  residualVR: number
  residualVT: number
  descontadoVR: number
  descontadoVT: number
  status: "PARCIAL" | "FINALIZADO"
}

export interface ContratoPreviaMensal {
  contrato: string
  ordem: number
  pessoas: PessoaPreviaMensal[]
  bloqueado: boolean
  motivoBloqueio: string | null
  totais: { vr: number | null; vt: number | null; credito: number | null; pix: number | null }
  efeitosPrevistos: string[]
  planUpdates?: PlanUpdatePrevia[]
  descontoUpdates?: DescontoUpdatePrevia[]
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
    /** Grupo do board Solicitação (18393673859) da competência (ex: JULHO/26). */
    grupoSolicitacao?: string | null
    /** Colunas do board Plano resolvidas por título -> id (pros updates de escrita). */
    colunasPlano?: Record<string, string>
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
