export type EmpregadoRM = {
  nome: string
  chapa: string
  cpf: string
  funcao: string
  admissao: string // YYYY-MM-DD
  secao: string
  codcoligada: number
}

export type SimNao = "SIM" | "NÃO"
export type Insalubridade = SimNao | "NÃO INFORMADO"
export type Solicitante = "OPERACIONAL" | "RH"

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
export type Contrato = (typeof CONTRATOS)[number]

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
export type Justificativa = (typeof JUSTIFICATIVAS)[number]

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
