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
  optanteVT?: boolean
  optanteVtLabel?: string // "SIM", "NÃO" ou "SIM*"
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
  optanteVT: SimNao
  sabado: SimNao
  insalubridade: Insalubridade
  interior: SimNao
  dataInicio: string // YYYY-MM-DD
  dataFim: string // YYYY-MM-DD
  justificativa: Justificativa
  empregadoSubstituido: string
  termoConvocacao: File | null
  termoInsalubridade: File | null
  /** Mês destino: board atual (default) ou próximo. Resolve o board no registry. */
  papel?: "passado" | "atual" | "proximo"
}

/**
 * Estado da convocação no RM.
 *
 * `undefined` NÃO é "deu tudo certo": significa que quem atendeu a requisição não foi o nosso
 * backend (o n8n respondeu antes), então a convocação no RM nem foi tentada.
 */
/**
 * Lançamento no RM (evento eSocial S-2260). Espelha `EstadoRmResposta` no backend.
 *
 * `codigos` é array porque uma convocação partida por atestado vira mais de uma no RM
 * (05→20 com atestado 10→11 = 05→09 e 12→20).
 */
export type ConvocacaoRmEstado =
  | { estado: "gravado"; codigos: string[] }
  | { estado: "enfileirado"; job_id: string; codigos?: string[]; motivo?: string }
  // "pode ter gravado, estamos lendo pra saber" — nunca apresentar como falha.
  | { estado: "conciliando"; job_id: string; codigos?: string[] }
  | { estado: "coberto_por_ausencia" }
  | { estado: "invalido"; motivo?: string }
  | { estado: "desligado" | "sem_chapa" | "rm_nao_configurado" }
  | { estado: "nao_enfileirado"; motivo?: string }

/**
 * Pré-pagamento calculado junto da convocação (fase 1 do pontual).
 *
 * `estado` diz se o número vale:
 * - `reservado` — calculado e a dívida abatida está guardada pra esta convocação. É o caso bom.
 * - `invalido` — cálculo recusado (`motivoInvalido` nomeia o porquê). A convocação existe; quem
 *   recalcula é a felipeta.
 * - `nao_gravado` — calculou mas não conseguiu gravar o snapshot. Os valores estão no item do
 *   monday, mas a reserva não existe: outra convocação da mesma pessoa pode abater a mesma dívida.
 *
 * `semSaldo` não é erro: o desconto comeu o benefício inteiro e não há nada a pagar.
 */
export type ConvocacaoPrePagamento = {
  estado: "reservado" | "invalido" | "nao_gravado"
  motivoInvalido: string | null
  semSaldo: boolean
  diasVR: number | null
  diasVT: number | null
  vrDia: number | null
  vtDia: number | null
  brutoVR: number | null
  brutoVT: number | null
  descontoVR: number | null
  descontoVT: number | null
  liquidoVR: number | null
  liquidoVT: number | null
  creditoVR: number | null
  creditoVT: number | null
  pixVR: number | null
  pixVT: number | null
  pastaUrl: string | null
}

export type ConvocacaoResposta = {
  ok: true
  itemId: string
  itemUrl: string
  rm?: ConvocacaoRmEstado
  prepagamento?: ConvocacaoPrePagamento | null
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
