import {
  Banknote, CalendarOff, CalendarPlus, CalendarX, CircleMinus, ClipboardCheck, FileText, Split,
  type LucideIcon,
} from "lucide-react"

/** Espelha as colunas de pi.audit_lancamentos + contadores dos filhos. */
export interface Execucao {
  id: string
  acao: string
  uuid_alvo: string | null
  pessoa_nome: string | null
  contrato: string | null
  payload_resumo: unknown
  criado_em: string
  operador_email: string | null
  operador_nome: string | null
  estado: EstadoExecucao
  motor: string
  etapa_atual: string | null
  erro_etapa: string | null
  erro_msg: string | null
  duracao_ms: number | null
  finalizado_em: string | null
  /** Preenchido = alguém do DP já viu e tratou. Sai da contagem que pede atenção. */
  erro_reconhecido_em: string | null
  erro_reconhecido_por: string | null
  erro_reconhecido_nota: string | null
  qtd_etapas: number
  qtd_artefatos: number
}

export type EstadoExecucao = "aberta" | "ok" | "erro" | "parcial" | "abandonada" | "recusado"

export interface EtapaExecucao {
  id: number
  etapa: string
  estado: "rodando" | "ok" | "erro" | "pulado" | "aviso"
  tentativa: number
  duracao_ms: number | null
  mensagem: string | null
  metadados: Record<string, unknown>
  criado_em: string
}

export interface ArtefatoExecucao {
  id: number
  evento_id: number | null
  tipo: string
  chave: string
  rotulo: string | null
  url: string | null
  efeito_chave: string | null
  criado_em: string
}

export interface DetalheExecucao {
  execucao: Execucao
  etapas: EtapaExecucao[]
  artefatos: ArtefatoExecucao[]
}

export interface ListaAtividade {
  atividades: Execucao[]
  escopo: "proprio" | "todos"
  limite: number
  /** true = há mais coisa além do que veio; a busca local não alcança tudo. */
  truncado: boolean
}

/** Rótulos pt-BR das ações. Vieram do AtividadeTab, onde já existiam. */
export const LABEL_ACAO: Record<string, string> = {
  convocacao: "Convocação",
  registro: "Registro de ocorrência",
  cancelamento: "Cancelamento",
  split: "Divisão de convocação",
  atestado: "Atestado / Declaração",
  ponto_facultativo: "Ponto facultativo",
  desconto: "Registro de desconto",
  mensal: "Pagamento mensal",
  // O front declarava `mensal_fechamento` no TipoAtividade enquanto o servidor
  // gravava `mensal`. Os dois entram pra lista não filtrar errado no histórico antigo.
  mensal_fechamento: "Pagamento mensal",
  pontual_pagamento: "Pagamento pontual",
}

/**
 * Ícone por tipo de ação.
 *
 * Carrega o TIPO sem gastar texto na linha: o nome do tipo ("Convocação", "Pagamento
 * pontual") ocupava a linha secundária inteira e empurrava contrato e período pra fora.
 * Um glifo de 14px na frente do nome resolve, e o rótulo escrito continua no detalhe.
 */
export const ICONE_ACAO: Record<string, LucideIcon> = {
  convocacao: CalendarPlus,
  registro: ClipboardCheck,
  cancelamento: CalendarX,
  split: Split,
  atestado: FileText,
  ponto_facultativo: CalendarOff,
  desconto: CircleMinus,
  mensal: Banknote,
  mensal_fechamento: Banknote,
  pontual_pagamento: Banknote,
}

export const COR_ACAO: Record<string, string> = {
  convocacao: "text-sky-400",
  registro: "text-emerald-400",
  cancelamento: "text-red-400",
  split: "text-violet-400",
  atestado: "text-amber-400",
  ponto_facultativo: "text-cyan-400",
  desconto: "text-blue-400",
  mensal: "text-fuchsia-400",
  mensal_fechamento: "text-fuchsia-400",
  // Verde-limão: é pagamento, mas não é o mensal — o DP precisa distinguir de longe.
  pontual_pagamento: "text-lime-400",
}

/** Ordem dos chips de filtro. `mensal_fechamento` fica fora — é sinônimo de `mensal`. */
export const ACOES_FILTRAVEIS = [
  "convocacao", "registro", "cancelamento", "split",
  "atestado", "ponto_facultativo", "desconto", "mensal", "pontual_pagamento",
] as const

export const rotuloAcao = (a: string): string => LABEL_ACAO[a] ?? a.replaceAll("_", " ")

/**
 * Lâmpada por desfecho. `aberta` usa amarela (que pisca sozinha no CSS) porque uma
 * execução aberta é uma execução em andamento — ou uma que morreu no meio, e nos dois
 * casos "está pendente" é a leitura certa.
 */
export function lampDoEstado(e: EstadoExecucao): string {
  if (e === "ok") return "lamp--green"
  if (e === "erro" || e === "abandonada") return "lamp--red"
  if (e === "parcial") return "lamp--yellow"
  if (e === "aberta") return "lamp--yellow"
  // 'recusado' cai no neutro de propósito: a regra funcionou e decidiu não agir.
  // Vermelho leria como quebra; verde leria como feito. Nenhum dos dois é verdade.
  return "lamp--off"
}

// 'recusado' NÃO entra: é desfecho de negócio, não falha. Fora daqui ele sai do
// filtro "só erros", do contador de falhas e do botão de reconhecer erro.
export const ehFalha = (e: EstadoExecucao): boolean => e === "erro" || e === "abandonada"

export const LABEL_ESTADO: Record<EstadoExecucao, string> = {
  aberta: "em andamento",
  ok: "concluída",
  erro: "com erro",
  parcial: "concluída com pendência",
  abandonada: "interrompida",
  recusado: "não permitida",
}
