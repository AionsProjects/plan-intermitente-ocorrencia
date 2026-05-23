import {
  CONTRATOS_OPERACIONAIS,
  UNIDADES_POR_CONTRATO,
} from "@/lib/unidadesContrato"

export type EmpregadoRM = {
  nome: string
  chapa: string
  cpf: string
  funcao: string
  admissao: string // YYYY-MM-DD
  secao: string
  codcoligada: number
  // Campos extras vindos do endpoint celetista (opcionais — intermitente
  // não retorna esses). Quando ausentes, podem ser inferidos via fallback.
  codigo?: string         // código da seção (ex: "01.01.0004.01.0001")
  secaoCodigo?: string    // alias de codigo
  localUnidade?: string   // ex: "DETRAN - MANAUS"
  contrato?: string       // contrato inferido pelo n8n a partir de localUnidade
}

export type MondayLabel = string
export type SimNao = MondayLabel
export type Insalubridade = MondayLabel
export type Solicitante = MondayLabel

export const CONTRATOS = CONTRATOS_OPERACIONAIS
export type Contrato = MondayLabel

export const JUSTIFICATIVAS = [
  "AFASTAMENTO",
  "ATESTADO",
  "FÉRIAS",
  "FALTA",
  "SUSPENSÃO",
  "NÃO INICIADO",
  "DESLIGAMENTO",
  "LICENÇA MATERNIDADE",
  "SEM CONVOCAÇÃO",
  "MOP P/ CLT",
  "POSTO VAGO",
  "APOIO",
  "DEMITIDO",
] as const
export type Justificativa = MondayLabel

export const OPCOES_CONVOCACAO_FALLBACK = {
  solicitantes: ["OPERACIONAL", "RH"],
  contratos: CONTRATOS,
  sabados: ["SIM", "NÃO"],
  insalubridades: ["SIM", "NÃO", "NÃO INFORMADO"],
  interiores: ["SIM", "NÃO"],
  justificativas: JUSTIFICATIVAS,
  unidadesPorContrato: UNIDADES_POR_CONTRATO,
  unidadeColumnId: null,
} as const

export type ConvocacaoOpcoes = {
  solicitantes: string[]
  contratos: string[]
  sabados: string[]
  insalubridades: string[]
  interiores: string[]
  justificativas: string[]
  unidadesPorContrato: Record<string, string[]>
  unidadeColumnId: string | null
}

export type ConvocacaoPayload = {
  name: string
  empregado: EmpregadoRM
  escala: string
  solicitante: Solicitante
  contrato: Contrato
  localUnidade: string
  sabado: SimNao
  insalubridade: Insalubridade
  interior: SimNao
  dataInicio: string // YYYY-MM-DD
  dataFim: string // YYYY-MM-DD
  justificativa: Justificativa
  empregadoSubstituido: string
  termoConvocacao: File | null
  termoInsalubridade: File | null
}

export type ConvocacaoResposta = {
  ok: true
  itemId: string
  itemUrl: string
}

export type ConvocacaoConflito = {
  item_id?: string
  item_url?: string
  nome?: string
  chapa?: string
  data_inicio?: string
  data_fim?: string
  status_convocacao?: string
}
