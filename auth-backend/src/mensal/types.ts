// "teste": board sandbox (cópia do mês sem valores) registrado no registry — só aparece com controles de teste ativos
export type PapelMensal = "atual" | "proximo" | "teste"
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
  /**
   * VR - Unitário. `null` quando a regra do contrato é MENSAL (ex. DETRAN): o benefício é pago
   * por mês, então preencher um valor-dia ao lado do mensal dava leitura dúbia no board.
   * `null` LIMPA a célula (≠ 0, que leria como "zero por dia").
   */
  vrDia: number | null
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
    /** Grupo do board Solicitação (18393673859) do mês de CAIXA (ex: JULHO/26). */
    grupoSolicitacao?: string | null
    /**
     * Mês de CAIXA escolhido pro pagamento ("YYYY-MM") — a gaveta dos boards Solicitação e
     * Controle Caju. Default: mês atual. Fica no snapshot pra execução criar/usar a MESMA
     * gaveta que a prévia mostrou, mesmo que o run atravesse a virada do mês.
     */
    caixa: string
    /**
     * Data de vencimento do lançamento financeiro, POR CONTRATO ("CONTRATO" -> "YYYY-MM-DD").
     * Vira `<DataVencimento>` no XML do FopRotinas. Escolhida na APROVAÇÃO (não na prévia),
     * porque o operador precisa ver os contratos antes de decidir; gravada aqui pra ficar
     * auditável e pra execução usar exatamente o que foi aprovado.
     * Contrato ausente = cai no default (hoje), que era o comportamento antigo.
     * Só o vencimento varia: `DataEmissao` continua sendo hoje, porque `consultarIdfinanc`
     * usa ela como filtro pra achar os lançamentos que o FopRotinas acabou de criar.
     */
    vencimentos?: Record<string, string>
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
