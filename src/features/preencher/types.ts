export type StatusProcessamento = "aguardando" | "concluido" | "expirado"

export type TipoOcorrencia = "falta" | "atraso" | "sem_ocorrencia"

export type StatusCancelamento =
  | "valida"
  | "cancelada_parcial"
  | "cancelada"

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
  atestados?: Atestado[]
  // Cancelamento parcial: dias >= dataInicioCancelamento ficam "queimados"
  // no painel (escuros + animação de fogo). null = sem cancelamento.
  dataInicioCancelamento?: string | null
  statusCancelamento?: StatusCancelamento | null
  // Split de convocação: dias >= dataInicioParte2 ganham visual violeta
  // (.glass-tile-parte2). null = sem split. Ao finalizar, backend cria
  // 2 subitems no item ENTRADA com contratos distintos.
  split?: SplitConvocacao | null
}

export type SplitConvocacao = {
  dataInicioParte2: string
  contratoParte1: string
  contratoParte2: string
}

export type RespostaDia = {
  data: string
  tipo: TipoOcorrencia
  minutosAtraso?: number
}

export type TipoDocumento = "atestado" | "declaracao"
export type PeriodoTurno = "manha" | "tarde"

// Atestado/declaração agora vivem na feature /atestados. Aqui o tipo é
// read-only: representa o que o WF2 devolveu pra renderizar tiles
// informativos com link pro board Controle de Atestados. Criação,
// remoção e correção de docs acontecem em /atestados.
export type Atestado = {
  id: string
  tipoDocumento: TipoDocumento
  /** Label granular do board Controle de Atestados (ex: "Atestado Médico",
   *  "Licença-Maternidade"). Quando disponível, usar em vez de rotular
   *  por tipoDocumento binário. */
  tipoDocumentacaoLabel?: string | null
  dataInicio: string
  dataFim: string
  periodos: PeriodoTurno[]
  primeiroDiaFoiTrabalhar: boolean
  primeiroDiaTrabalhouSeisHoras?: boolean
  nomeArquivo: string
  tamanhoArquivo: number
  mondayItemId?: string | null
  mondayItemUrl?: string | null
  arquivoUrl?: string | null
}

export type PayloadFinalizar = {
  respostas: RespostaDia[]
  protocolo: string
  diasExtras?: string[]
  diasDesativados?: string[]
  sabadosExtras?: string[]
  ehCorrecao?: boolean
  /** Quando setado, backend cria 2 subitems no item ENTRADA (Parte 1 / Parte 2)
   *  com contratos distintos. Sem split = comportamento atual (1 item). */
  split?: SplitConvocacao | null
}

export type PayloadAplicarSplit =
  | {
      tipo: "aplicar"
      dataInicioParte2: string
      contratoParte1: string
      contratoParte2: string
    }
  | { tipo: "reverter" }

export type ResultadoAplicarSplit = {
  ok: boolean
  split: SplitConvocacao | null
}

export type TipoCancelamentoConvocacao = "total" | "parcial" | "reverter"

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
  tipo: "padrao" | "extra" | "atestado"
  ativo: boolean
  /** Nome do feriado nacional quando aplica. null/undefined = não é feriado.
   *  Frontend bloqueia edição e mostra visual emerald no tile. */
  feriado?: string | null
}
