import type { ArtefatoExecucao } from "./types"

/**
 * Rótulos e links dos artefatos — "o que foi gerado".
 *
 * O link é DERIVADO aqui, não lido do banco, quando o provedor não devolveu uma URL
 * canônica. Motivo: o link do Monday redireciona pelo slug da conta de quem está
 * logado (não é estável entre usuários), e gravar URL congelaria um palpite em
 * milhares de linhas históricas — derivar deixa uma mudança de código consertar
 * todas de uma vez.
 *
 * `rm_idfinanc` e `rm_convocacao` NÃO TÊM URL: renderizam como código copiável. Link
 * falso é pior que nenhum link, porque quem clica conclui que a automação gravou
 * errado.
 */

const LABEL_TIPO: Record<string, string> = {
  monday_item: "Item no Monday",
  monday_subitem: "Subitem no Monday",
  monday_asset: "Arquivo anexado",
  caju_pedido: "Pedido Caju",
  caju_boleto: "Boleto Caju",
  rm_idfinanc: "IDFINANC (RM)",
  rm_convocacao: "Convocação no RM",
  rm_historico: "Histórico de benefício (RM)",
  rm_ausencia: "Ausência no RM",
  drive_pasta: "Pasta no Drive",
  drive_arquivo: "Arquivo no Drive",
  protocolo: "Protocolo",
  convocacao_uuid: "UUID da convocação",
  desconto_item: "Item na Base de Desconto",
  solicitacao: "Solicitação de Pagamento",
  job: "Job na fila",
}

export const rotuloTipoArtefato = (t: string): string => LABEL_TIPO[t] ?? t.replaceAll("_", " ")

const BOARD_DESCONTO = "18400981023"
const BASE_MONDAY = "https://contato-serv.monday.com"

/** URL do artefato, ou null quando não existe link honesto pra ele. */
export function linkArtefato(a: ArtefatoExecucao): string | null {
  if (a.url) return a.url
  switch (a.tipo) {
    case "monday_item":
    case "monday_subitem":
      // Sem board_id no artefato o Monday resolve o item sozinho por /pulses/<id>.
      return `${BASE_MONDAY}/pulses/${a.chave}`
    case "desconto_item":
      return `${BASE_MONDAY}/boards/${BOARD_DESCONTO}/pulses/${a.chave}`
    case "caju_pedido":
    case "caju_boleto":
      return `https://app.caju.com.br/orders/${a.chave}`
    case "drive_pasta":
      return `https://drive.google.com/drive/folders/${a.chave}`
    case "drive_arquivo":
      return `https://drive.google.com/file/d/${a.chave}/view`
    default:
      // rm_*, protocolo, convocacao_uuid, job, monday_asset: código copiável.
      return null
  }
}
