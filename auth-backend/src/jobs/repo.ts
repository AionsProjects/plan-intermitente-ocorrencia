// Fila de jobs + idempotência de efeitos externos (pi.jobs / pi.efeitos_externos).
import { query } from "../db.js"

export interface Job {
  id: string
  tipo: string
  estado: string
  passo: number
  payload: Record<string, unknown>
  cursor: unknown
  tentativas: number
}

/** Enfileira um job. */
export async function enfileirar(tipo: string, payload: Record<string, unknown>): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO jobs (tipo, payload) VALUES ($1, $2::jsonb) RETURNING id`,
    [tipo, JSON.stringify(payload)],
  )
  return rows[0]!.id
}

/** Pega até N jobs prontos (due) e marca como rodando (claim atômico via UPDATE...RETURNING). */
export async function pegarDevidos(limite = 5): Promise<Job[]> {
  const { rows } = await query<Job>(
    `UPDATE jobs SET estado='rodando', atualizado_em=now()
       WHERE id IN (
         SELECT id FROM jobs
          WHERE estado IN ('pendente','aguardando_externo') AND proximo_em <= now()
          ORDER BY proximo_em ASC LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
     RETURNING id, tipo, estado, passo, payload, cursor, tentativas`,
    [limite],
  )
  return rows
}

export async function avancar(
  id: string,
  patch: { estado?: string; passo?: number; cursor?: unknown; proximoEmSeg?: number; erro?: string | null },
): Promise<void> {
  const sets: string[] = ["atualizado_em=now()"]
  const params: unknown[] = [id]
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col}=$${params.length}`) }
  if (patch.estado) add("estado", patch.estado)
  if (patch.passo != null) add("passo", patch.passo)
  if ("cursor" in patch) { params.push(JSON.stringify(patch.cursor)); sets.push(`cursor=$${params.length}::jsonb`) }
  if (patch.proximoEmSeg != null) { params.push(patch.proximoEmSeg); sets.push(`proximo_em=now() + ($${params.length} || ' seconds')::interval`) }
  if ("erro" in patch) add("erro", patch.erro ?? null)
  await query(`UPDATE jobs SET ${sets.join(", ")} WHERE id=$1`, params)
}

export async function falhar(id: string, erro: string): Promise<void> {
  await query(
    `UPDATE jobs SET tentativas=tentativas+1,
        estado = CASE WHEN tentativas+1 >= 5 THEN 'falhou' ELSE 'pendente' END,
        proximo_em = now() + ((tentativas+1)*30 || ' seconds')::interval,
        erro=$2, atualizado_em=now()
      WHERE id=$1`,
    [id, erro.slice(0, 500)],
  )
}

// ---- Idempotência de efeitos externos ----

/**
 * Reserva uma chave de efeito externo. Retorna 'novo' (pode executar), 'confirmado'
 * (já feito — PULAR) ou 'pendente' (em curso/falhou antes — decidir retry).
 */
export async function reservarEfeito(
  chave: string,
  tipo: string,
  payload?: unknown,
): Promise<"novo" | "confirmado" | "pendente"> {
  const ins = await query<{ chave: string }>(
    `INSERT INTO efeitos_externos (chave, tipo, payload) VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (chave) DO NOTHING RETURNING chave`,
    [chave, tipo, payload != null ? JSON.stringify(payload) : null],
  )
  if (ins.rows.length) return "novo"
  const { rows } = await query<{ status: string }>(`SELECT status FROM efeitos_externos WHERE chave=$1`, [chave])
  return rows[0]?.status === "confirmado" ? "confirmado" : "pendente"
}

/**
 * Contratos com efeito JÁ CONFIRMADO numa competência do mensal — fonte de verdade NOSSA
 * (não depende do estado do Monday). Chave: `mensal:<competencia>:<CONTRATO>:<etapa>`.
 * Usado pela antifraude da prévia pra saber o que já rodou quando o pagamento é por contrato.
 */
export async function contratosMensalJaExecutados(competencia: string): Promise<string[]> {
  const { rows } = await query<{ contrato: string }>(
    `SELECT DISTINCT split_part(chave, ':', 3) AS contrato
       FROM efeitos_externos
      WHERE chave LIKE $1 AND status = 'confirmado'
        AND split_part(chave, ':', 4) IN ('monday_solicitacao','caju_credito','caju_pix','rm_integrar')
        -- Simulação hoje grava em namespace próprio (mensal-homologacao:runId:...), então
        -- nem chega aqui. O filtro fica para as linhas LEGADAS de antes de 01/08, quando a
        -- simulação confirmava a chave de produção — foi o que fez o run e173b1ef pular tudo.
        AND coalesce(ref_externa, '') NOT LIKE 'homologacao:%'`,
    [`mensal:${competencia}:%`],
  )
  return rows.map((r) => r.contrato).filter(Boolean)
}

export async function confirmarEfeito(chave: string, refExterna?: string): Promise<void> {
  await query(
    `UPDATE efeitos_externos SET status='confirmado', ref_externa=$2, confirmado_em=now() WHERE chave=$1`,
    [chave, refExterna ?? null],
  )
}
