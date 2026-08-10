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

export type ConvocacaoResposta = {
  ok: true
  itemId: string
  itemUrl: string
  rm?: ConvocacaoRmEstado
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
