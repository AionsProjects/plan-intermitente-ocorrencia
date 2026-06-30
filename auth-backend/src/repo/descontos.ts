// Repositório do ledger de descontos (pi.descontos). Upsert idempotente por
// (uuid_convocacao, origem). Usado por Cancelar e Finalizar.
import { query } from "../db.js"

export interface DescontoUpsert {
  uuid_convocacao: string
  origem?: string // default 'convocacao'
  protocolo?: string | null
  nome?: string | null
  chapa?: string | null
  contrato?: string | null
  data_inicio?: string | null
  data_fim?: string | null
  dias_perde_vr?: number
  dias_perde_vt?: number
  qtd_atrasos?: number
  desconto_vr: number
  desconto_vt: number
  status?: string // default PENDENTE
}

/** Cria/atualiza o desconto. residual = desconto; descontado = 0 (ainda não abatido). */
export async function upsertDesconto(d: DescontoUpsert): Promise<{ id: string }> {
  const origem = d.origem ?? "convocacao"
  const status = d.status ?? "PENDENTE"
  const { rows } = await query<{ id: string }>(
    `INSERT INTO descontos (
       uuid_convocacao, origem, protocolo, nome, chapa, contrato,
       data_inicio, data_fim, dias_perde_vr, dias_perde_vt, qtd_atrasos,
       desconto_vr, desconto_vt, residual_vr, residual_vt, descontado_vr, descontado_vt,
       status, atualizado_em
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,$13,0,0,$14, now()
     )
     ON CONFLICT (uuid_convocacao, origem) WHERE uuid_convocacao IS NOT NULL DO UPDATE SET
       protocolo=EXCLUDED.protocolo, nome=EXCLUDED.nome, chapa=EXCLUDED.chapa,
       contrato=EXCLUDED.contrato, data_inicio=EXCLUDED.data_inicio, data_fim=EXCLUDED.data_fim,
       dias_perde_vr=EXCLUDED.dias_perde_vr, dias_perde_vt=EXCLUDED.dias_perde_vt,
       qtd_atrasos=EXCLUDED.qtd_atrasos, desconto_vr=EXCLUDED.desconto_vr, desconto_vt=EXCLUDED.desconto_vt,
       residual_vr=EXCLUDED.residual_vr, residual_vt=EXCLUDED.residual_vt,
       status=EXCLUDED.status, atualizado_em=now()
     RETURNING id`,
    [
      d.uuid_convocacao, origem, d.protocolo ?? null, d.nome ?? null, d.chapa ?? null,
      d.contrato ?? null, d.data_inicio ?? null, d.data_fim ?? null,
      d.dias_perde_vr ?? 0, d.dias_perde_vt ?? 0, d.qtd_atrasos ?? 0,
      d.desconto_vr, d.desconto_vt, status,
    ],
  )
  return rows[0]!
}

/** Status do desconto existente do período (p/ bloqueio desconto_em_consumo). */
export async function descontoExistente(
  uuidConvocacao: string,
  origem = "convocacao",
): Promise<{ status: string; descontadoVR: number; descontadoVT: number } | null> {
  const { rows } = await query<{ status: string; descontado_vr: string; descontado_vt: string }>(
    `SELECT status, descontado_vr, descontado_vt FROM descontos
      WHERE uuid_convocacao = $1 AND origem = $2 LIMIT 1`,
    [uuidConvocacao, origem],
  )
  const r = rows[0]
  if (!r) return null
  return { status: r.status, descontadoVR: Number(r.descontado_vr), descontadoVT: Number(r.descontado_vt) }
}

/** Reverte (zera/remove) o desconto de uma convocação — usado no cancelar "reverter". */
export async function removerDescontoConvocacao(uuidConvocacao: string, origem = "convocacao"): Promise<void> {
  await query(`DELETE FROM descontos WHERE uuid_convocacao = $1 AND origem = $2`, [uuidConvocacao, origem])
}
