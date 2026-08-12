// Estado do pré-pagamento pontual em Postgres.
import { query } from "../db.js"

/** Soma de reserva viva por item de desconto do board (`DescontoMensal.id`). */
export type ReservasVivas = Map<string, { vr: number; vt: number }>

/**
 * Quanto de cada dívida está PROMETIDO a um pré-pagamento que ainda não pagou.
 *
 * "Vivo" = pré-pagamento `reservado` ou `consumido`. `liberado`/`invalido` já devolveram a
 * dívida ao FIFO e não contam.
 *
 * ⚠️ Esta função é a metade que faz a reserva EXISTIR de verdade. Gravar a reserva sem
 * subtraí-la na leitura é reserva decorativa: o mensal (e a próxima convocação) continuam
 * lendo o residual cru do board `18400981023` e abatem a mesma dívida de novo — que é
 * exatamente o problema que a reserva foi criada pra impedir.
 *
 * Devolve Map vazio em qualquer falha: preferir "não subtrair" a derrubar a prévia do
 * mensal é escolha consciente — o pior caso é o comportamento de hoje, sem reserva.
 */
export async function lerReservasVivas(): Promise<ReservasVivas> {
  const mapa: ReservasVivas = new Map()
  try {
    const { rows } = await query<{ desconto_monday_item_id: string; vr: string; vt: string }>(
      `SELECT r.desconto_monday_item_id,
              COALESCE(SUM(r.vr), 0)::text AS vr,
              COALESCE(SUM(r.vt), 0)::text AS vt
         FROM pontual_reserva_desconto r
         JOIN pontual_prepagamento p ON p.id = r.prepagamento_id
        WHERE p.estado IN ('reservado', 'consumido')
        GROUP BY r.desconto_monday_item_id`,
    )
    for (const r of rows) {
      mapa.set(r.desconto_monday_item_id, { vr: Number(r.vr) || 0, vt: Number(r.vt) || 0 })
    }
  } catch (e) {
    console.warn("[pontual] ler reservas vivas falhou — seguindo sem subtrair:", (e as Error)?.message ?? e)
  }
  return mapa
}
