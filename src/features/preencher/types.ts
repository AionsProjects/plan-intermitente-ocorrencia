export type StatusProcessamento = "aguardando" | "concluido" | "expirado"

export type TipoOcorrencia = "falta" | "atraso" | "sem_ocorrencia"

export type ProcessamentoDados = {
  uuid: string
  nome: string
  contrato: string | null
  dataInicio: string
  dataFim: string
  dias: string[]
  status: StatusProcessamento
  concluidoEm: string | null
}

export type RespostaDia = {
  data: string
  tipo: TipoOcorrencia
  minutosAtraso?: number
}

export type PayloadFinalizar = {
  respostas: RespostaDia[]
}

export type DiaInfo = {
  data: string
  tipo: "padrao" | "extra"
  ativo: boolean
}
