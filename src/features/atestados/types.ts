import type { EmpregadoRM } from "@/features/convocar/types"
import type {
  AcompanhanteLabel,
  ContratoColaboradorLabel,
  HorarioAlmocoLabel,
  ModalidadeContrato,
  TipoDocumentacaoLabel,
} from "./opcoesAtestadoForm"

export type TipoTrabalhador = "intermitente" | "clt"

/** Discriminador legado mantido em DocumentoExistente (vem do Histórico). */
export type TipoDocumento = "atestado" | "declaracao"

/** Legado — declaração de comparecimento. Não usado em novos lançamentos. */
export type PeriodoTurno = "manha" | "tarde"

export type StatusConvocacaoMonday =
  | "Válida"
  | "Cancelada"
  | "Cancelado"
  | "Cancelada parcialmente"
  | "Cancelado parcialmente"
  | "Bloqueada - conflito"
  | string

export type ConvocacaoResumida = {
  uuid: string
  itemEntradaId: string
  itemHistoricoId?: string
  dataInicio: string // YYYY-MM-DD
  dataFim: string
  contrato: string
  trabalhaSabado: boolean
  optanteVT: boolean
  status: "aguardando" | "concluido" | "expirado"
  statusConvocacao: StatusConvocacaoMonday
  dataInicioCancelamento?: string | null
  // documentos já lançados nesta convocação (vindos do Atestados JSON do Histórico)
  documentosExistentes: DocumentoExistente[]
}

export type DocumentoExistente = {
  id: string
  tipoDocumento: TipoDocumento
  /** Label original do board Controle de Atestados quando disponível. */
  tipoDocumentacaoLabel?: TipoDocumentacaoLabel | string
  dataInicio: string
  dataFim: string
  periodos: PeriodoTurno[]
  mondayItemUrl?: string | null
}

/**
 * DocumentoLancamento agora carrega todos os campos do formulário
 * "Atestado Ponta" (board Controle de Atestados, view 223887647).
 *
 * Campos legados de declaração (`periodos`, `primeiroDiaFoiTrabalhar`,
 * `primeiroDiaTrabalhouSeisHoras`) ficam opcionais — não capturados em
 * novos lançamentos, mantidos só pra compat com docs antigos.
 *
 * Quando `modalidadeContrato === "CELETISTA"`, frontend pula busca RM
 * (`chapa`, `uuidConvocacao`, `itemEntradaId` ficam vazios) e operacional
 * digita o `empregadoNome` manualmente.
 */
export type DocumentoLancamento = {
  id: string
  modalidadeContrato: ModalidadeContrato
  // pessoa
  chapa: string
  empregadoNome: string
  empregadoCpf?: string
  // convocação (intermitente only)
  uuidConvocacao: string
  itemEntradaId?: string
  trabalhaSabado: boolean
  optanteVT: boolean
  // tipo + janela
  tipoDocumentacaoLabel: TipoDocumentacaoLabel
  diasAtestado: number
  dataInicio: string
  dataFim: string
  emissaoAtestado: string // YYYY-MM-DD — default = dataInicio mas editável
  // trabalho
  saidaRetornoTexto: string
  horarioAlmocoLabel: HorarioAlmocoLabel
  acompanhanteLabel: AcompanhanteLabel
  // contrato + unidade
  contratoColaborador: ContratoColaboradorLabel
  unidadeLabel: string | null
  unidadeDropdownColumnId: string | null
  unidadeNaoEncontradaTexto: string
  // observação livre
  observacao: string
  // arquivo
  arquivo: File
  nomeArquivo: string
  tamanhoArquivo: number
  // contexto pra bloqueios (intermitente)
  sabadosAtivos: string[]
  // ------- legado opcional (declaração antiga) -------
  tipoDocumento?: TipoDocumento
  periodos?: PeriodoTurno[]
  primeiroDiaFoiTrabalhar?: boolean
  primeiroDiaTrabalhouSeisHoras?: boolean
}

export type SessaoLancamento = {
  documentos: DocumentoLancamento[]
  ultimaPessoa?: { chapa: string; nome: string }
}

export type LancarDocumentosResultado = {
  ok: boolean
  resultados: Array<{
    id: string
    mondayItemIdControle?: string | null
    descontoId?: string | null
    erro?: string
  }>
}

export type BuscarConvocacoesEmpregadoQuery = {
  chapa: string
  mes?: string // YYYY-MM
}

export type { EmpregadoRM }
