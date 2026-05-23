export const CONTRATOS_PONTO_FACULTATIVO = [
  "SEMSA",
  "SEDUC ESCOLA",
  "SEDUC SEDE",
  "SEDUC INTERIOR",
  "DETRAN",
  "TRE PB",
  "CETAM",
] as const

export type ContratoPontoFacultativo =
  (typeof CONTRATOS_PONTO_FACULTATIVO)[number]

export type BeneficioPontoFacultativo = "VR" | "VT"

export type PontoFacultativoPayload = {
  contrato: ContratoPontoFacultativo
  data: string
  beneficios: BeneficioPontoFacultativo[]
}

export type PontoFacultativoItem = {
  itemEntradaId: string
  itemHistoricoId: string | null
  uuid: string | null
  nome: string
  chapa: string
  cpf: string | null
  contrato: string
  funcao: string | null
  periodoInicio: string
  periodoFim: string
  data: string
  optanteVT: boolean
  vtMeiaVolta: boolean
  trabalhaSabado: boolean
  aplicaVR: boolean
  aplicaVT: boolean
  valorVR: number
  valorVT: number
  total: number
  avisos: string[]
}

export type PontoFacultativoPreview = {
  ok: boolean
  contrato: ContratoPontoFacultativo
  data: string
  beneficios: BeneficioPontoFacultativo[]
  totalColaboradores: number
  totalVR: number
  totalVT: number
  total: number
  itens: PontoFacultativoItem[]
}

export type PontoFacultativoAplicacao = PontoFacultativoPreview & {
  processados: number
  ignorados: number
}
