// Tipos do fechamento mensal de intermitentes.

export type PapelMensal = "atual" | "proximo"

export interface MensalPessoa {
  nome: string
  chapa: string
  cpf: string | null
  liquidoVR: number
  liquidoVT: number
  credito: number
  pix: number
  descontoVR: number
  descontoVT: number
  regra: string | null
}

export interface MensalContrato {
  contrato: string
  codSecao: string
  pessoas: number
  vr: number
  vt: number
  credito: number
  pix: number
  detalhe: MensalPessoa[]
}

export interface MensalPreview {
  ok: boolean
  competencia: string | null
  competenciaLabel: string | null
  anoComp: number | null
  mesComp: number | null
  totalContratos: number
  totalPessoas: number
  totalVR: number
  totalVT: number
  totalCredito: number
  totalPix: number
  descontosAtualizar: number
  ignorados: number
  contratos: MensalContrato[]
  aviso: string | null
}

export interface MensalPayload {
  competencia: string // "YYYY-MM"
  papel: PapelMensal
}

export interface MensalFechamento {
  ok: boolean
  mensagem?: string
}
