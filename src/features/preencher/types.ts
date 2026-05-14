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
  protocolo: string | null
  editado: boolean
  editadoEm: string | null
  respostasAnteriores?: RespostaDia[]
  diasExtras?: string[]
  diasDesativados?: string[]
  trabalhaSabado: boolean
  sabadosExtras?: string[]
}

export type RespostaDia = {
  data: string
  tipo: TipoOcorrencia
  minutosAtraso?: number
}

export type PayloadFinalizar = {
  respostas: RespostaDia[]
  protocolo: string
  diasExtras?: string[]
  diasDesativados?: string[]
  sabadosExtras?: string[]
  ehCorrecao?: boolean
}

export type TipoCancelamentoConvocacao = "total" | "parcial"

export type PayloadCancelarConvocacao = {
  tipo: TipoCancelamentoConvocacao
  dataInicioCancelamento: string | null
}

export type ResultadoCancelarConvocacao = {
  ok: boolean
  tipo: TipoCancelamentoConvocacao
  dataInicioCancelamento: string | null
  desconto?: {
    acao?: "create" | "update" | "skip"
    descontoVR?: number
    descontoVT?: number
    motivo?: string | null
  }
}

export type DiaInfo = {
  data: string
  tipo: "padrao" | "extra"
  ativo: boolean
}
