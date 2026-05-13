export type EmpregadoRM = {
  nome: string
  chapa: string
  cpf: string
  funcao: string
  admissao: string // YYYY-MM-DD
  secao: string
  codcoligada: number
}

export type MondayLabel = string
export type SimNao = MondayLabel
export type Insalubridade = MondayLabel
export type Solicitante = MondayLabel

export const CONTRATOS = [
  "SEDUC SEDE",
  "SEDUC ESCOLA",
  "SEDUC INTERIOR",
  "DETRAN",
  "CETAM",
  "SEMSA",
  "TRE PB",
  "URUGUAIANA",
  "ADMINISTRATIVO",
] as const
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
} as const

export type ConvocacaoOpcoes = {
  solicitantes: string[]
  contratos: string[]
  sabados: string[]
  insalubridades: string[]
  interiores: string[]
  justificativas: string[]
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
