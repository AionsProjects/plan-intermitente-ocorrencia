// Registry de boards (pi.boards) — resolve o board Monday do mês por papel.
// O board Entrada duplica todo mês; o registry diz qual é o atual/proximo.
import { query } from "../db.js"

export async function boardPorPapel(papel: "atual" | "proximo" | "passado"): Promise<number | null> {
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel = $1 AND ativo = true ORDER BY atualizado_em DESC LIMIT 1`,
    [papel],
  )
  return rows[0] ? Number(rows[0].monday_board_id) : null
}

export const boardAtual = () => boardPorPapel("atual")
export const boardProximo = () => boardPorPapel("proximo")
