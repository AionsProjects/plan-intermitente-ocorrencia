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
  unidade: string
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
  unidade: string
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
  unidade: string
  data: string
  beneficios: BeneficioPontoFacultativo[]
  aviso: string | null
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

/** Unidade com contagem de convocações no mês corrente (vinda do
 *  endpoint /ponto-facultativo-opcoes após patch do WF). `foraRm` = true
 *  quando label do item Monday não consta nas unidades oficiais do RM
 *  (label órfã, criada manualmente sem alinhamento com tabela TBSECAO). */
export type UnidadeComCount = {
  label: string
  qtdIntermitentes: number
  foraRm?: boolean
}

export type PontoFacultativoOpcoes = {
  ok: boolean
  unidadeColumnId: string
  unidadesPorContrato: Record<ContratoPontoFacultativo, UnidadeComCount[]>
  /** Totais por contrato. Útil pra UI exibir "X convocações ativas". */
  contagens?: Record<string, number>
  mesReferencia?: string
}
