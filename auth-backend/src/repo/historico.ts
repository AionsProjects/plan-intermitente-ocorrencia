// Board HISTÓRICO (18411141462) — o item por convocação (uuid). Constantes de
// coluna extraídas dos WFs (Cancelar/Split/Finalizar). Board fixo, não duplica.
import { lerPorColuna, mudarColunas, gql, type MondayItem } from "../clients/monday.js"

export const BOARD_HISTORICO = 18411141462

export const COL_HIST = {
  uuid: "text_mm2xjend",
  contrato: "text_mm2x1ktb",
  chapa: "text_mm33v9kp",
  dataInicio: "date_mm2xtp93",
  dataFim: "date_mm2xrr5q",
  itemOrigem: "link_mm2x1rk0",
  optanteVt: "color_mm34ry47",
  trabalhaSabado: "color_mm34yyet",
  statusCancel: "color_mm3b9v4n",
  ledgerBeneficios: "long_text_mm3ct3hg",
  sabadosExtras: "text_mm3bfn6h",
  respostas: "long_text_mm2xtcpw",
  diasDesativados: "long_text_mm2xm820",
  atestados: "long_text_mm3cp43g",
  split: "long_text_mm3m8k0m",
} as const

export async function buscarHistoricoPorUuid(uuid: string): Promise<MondayItem | null> {
  const items = await lerPorColuna(BOARD_HISTORICO, COL_HIST.uuid, [uuid])
  return items[0] ?? null
}

/** Extrai item_origem_id + board de origem do link (coluna link_mm2x1rk0). */
export function parseItemOrigem(item: MondayItem): { itemId: string | null; boardId: string | null } {
  const cv = item.cv[COL_HIST.itemOrigem]
  let url = cv?.text || ""
  if (!url && cv?.value) {
    try {
      const parsed = typeof cv.value === "string" ? JSON.parse(cv.value) : cv.value
      url = (parsed as { url?: string })?.url || ""
    } catch {
      url = ""
    }
  }
  const item_ = String(url).match(/pulses\/(\d+)/)
  const board = String(url).match(/boards\/(\d+)/)
  return { itemId: item_ ? item_[1] : null, boardId: board ? board[1] : null }
}

export function textoCol(item: MondayItem, col: string): string | null {
  return item.cv[col]?.text ?? null
}

export function jsonCol<T>(item: MondayItem, col: string, fallback: T): T {
  const t = textoCol(item, col)
  if (!t) return fallback
  try {
    return JSON.parse(t) as T
  } catch {
    return fallback
  }
}

export async function atualizarHistorico(
  itemId: string,
  valores: Record<string, unknown>,
): Promise<void> {
  await mudarColunas(BOARD_HISTORICO, Number(itemId), valores)
}

/** change_simple_column_value (long_text aceita string direto — usado pelo split). */
export async function mudarColunaSimples(
  boardId: number,
  itemId: string,
  columnId: string,
  value: string,
): Promise<void> {
  await gql(
    `mutation($b:ID!,$i:ID!,$c:String!,$v:String!){
       change_simple_column_value(board_id:$b, item_id:$i, column_id:$c, value:$v){ id }
     }`,
    { b: String(boardId), i: itemId, c: columnId, v: value },
  )
}
