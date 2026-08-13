// Snapshot + reserva do pré-pagamento pontual.
//
// A promessa da bifurcação: o número mostrado na convocação é o número pago dias depois,
// quando a felipeta vier. Sem snapshot, a fase 2 recalcularia contra um FIFO que mudou no
// meio, e o operador veria um valor na tela e outro no pagamento — exatamente a
// desconfiança que faz o DP conferir tudo à mão hoje.
import { pool, query } from "../db.js"
import type { PessoaCalculadaMensal } from "../mensal/calculo.js"
import type { ReservaCalculada } from "./calculo.js"

export interface EntradaPrePagamento {
  itemOrigemId: string
  mondayBoardId?: string | null
  uuidConvocacao?: string | null
  chapa: string
  cpf?: string | null
  nome?: string | null
  contrato?: string | null
  codSecao?: string | null
  dataInicio: string
  dataFim: string
  /** Ausente quando o cálculo falhou — a linha nasce `invalido` com o motivo. */
  pessoa?: PessoaCalculadaMensal
  reservas?: ReservaCalculada[]
  calculo?: Record<string, unknown>
  motivoInvalido?: string | null
}

export interface PrePagamentoGravado {
  id: string
  estado: "reservado" | "invalido"
}

/**
 * Grava o snapshot e toma a reserva, em UMA transação.
 *
 * Atômico porque snapshot sem reserva é pior que nenhum dos dois: prometeria abater uma
 * dívida que segue livre pro mensal consumir, e o pagamento sairia menor do que a tela
 * mostrou. E reserva sem snapshot prenderia dívida sem ninguém dono dela.
 *
 * ⚠️ Substitui o pré-pagamento vivo do mesmo item, se houver: LIBERA o antigo antes de
 * inserir o novo. A ordem importa — o `uq_prepag_item_vivo` recusaria dois vivos, e o CHECK
 * `reservado <= residual` recusaria a reserva nova por conta da própria reserva antiga. E é
 * INSERT de linha nova, não UPDATE: "por que essa convocação pagou isso?" precisa da cadeia,
 * não do último estado.
 *
 * Não lança: devolve `null` se a gravação falhar. Quem chama fecha a execução como
 * `parcial` — o item já existe no board com os valores certos, e a felipeta recalcula
 * avisando na tela.
 */
export async function reservarPrePagamento(
  inp: EntradaPrePagamento,
): Promise<PrePagamentoGravado | null> {
  const c = await pool.connect()
  try {
    await c.query("BEGIN")
    // Libera o vivo anterior (recálculo). `estado='liberado'` o tira do índice parcial e
    // devolve a dívida ao FIFO; o CASCADE das reservas vem do DELETE abaixo.
    const { rows: antigos } = await c.query<{ id: string }>(
      `UPDATE pontual_prepagamento SET estado = 'liberado', atualizado_em = now()
        WHERE item_origem_id = $1 AND estado IN ('reservado', 'consumido')
        RETURNING id`,
      [inp.itemOrigemId],
    )
    for (const a of antigos) {
      await c.query(`DELETE FROM pontual_reserva_desconto WHERE prepagamento_id = $1`, [a.id])
    }

    const p = inp.pessoa
    const estado: "reservado" | "invalido" = p ? "reservado" : "invalido"
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO pontual_prepagamento
         (item_origem_id, monday_board_id, uuid_convocacao, chapa, cpf, nome, contrato,
          cod_secao, data_inicio, data_fim,
          dias_vr, dias_vt, vr_dia, vt_dia, bruto_vr, bruto_vt, desconto_vr, desconto_vt,
          liquido_vr, liquido_vt, credito_vr, credito_vt, pix_vr, pix_vt, regra_aplicada,
          calculo, estado, motivo_invalido)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
               $26::jsonb,$27,$28)
       RETURNING id`,
      [
        inp.itemOrigemId, inp.mondayBoardId ?? null, inp.uuidConvocacao ?? null,
        inp.chapa, inp.cpf ?? null, inp.nome ?? null, inp.contrato ?? null,
        inp.codSecao ?? null, inp.dataInicio, inp.dataFim,
        p?.diasVR ?? null, p?.diasVT ?? null, p?.vrDia ?? null, p?.vtDia ?? null,
        p?.brutoVR ?? null, p?.brutoVT ?? null, p?.descontoVR ?? null, p?.descontoVT ?? null,
        p?.liquidoVR ?? null, p?.liquidoVT ?? null, p?.creditoVR ?? null, p?.creditoVT ?? null,
        p?.pixVR ?? null, p?.pixVT ?? null, p?.regraAplicada ?? null,
        JSON.stringify(inp.calculo ?? {}), estado, inp.motivoInvalido ?? null,
      ],
    )
    const id = rows[0]!.id

    for (const r of inp.reservas ?? []) {
      if (r.vr <= 0 && r.vt <= 0) continue
      await c.query(
        `INSERT INTO pontual_reserva_desconto (prepagamento_id, desconto_monday_item_id, vr, vt)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (prepagamento_id, desconto_monday_item_id)
           DO UPDATE SET vr = EXCLUDED.vr, vt = EXCLUDED.vt`,
        [id, r.descontoMondayItemId, r.vr, r.vt],
      )
    }

    await c.query("COMMIT")
    return { id, estado }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined)
    console.warn("[pontual] gravar pré-pagamento falhou:", (e as Error)?.message ?? e)
    return null
  } finally {
    c.release()
  }
}

/**
 * Anota a pasta do Drive no snapshot já gravado.
 *
 * Segunda escrita de propósito: o snapshot (Postgres, ms, insubstituível) não pode esperar o
 * Drive (rede, segundos). Se o Drive travar, o número está salvo e `pasta_estado` fica
 * `pendente` — a fase 2 resolve a pasta ela mesma, que é idempotente, e faz o back-fill.
 */
export async function anotarPastaDrive(
  prepagamentoId: string,
  pasta: {
    pastaPessoaId: string
    pastaConvocacaoId: string
    nome: string
    caminho: string
  },
): Promise<void> {
  await query(
    `UPDATE pontual_prepagamento
        SET pasta_pessoa_drive_id = $2, pasta_convocacao_drive_id = $3,
            pasta_convocacao_nome = $4, pasta_caminho = $5,
            pasta_estado = 'pronta', pasta_resolvida_em = now(), atualizado_em = now()
      WHERE id = $1`,
    [prepagamentoId, pasta.pastaPessoaId, pasta.pastaConvocacaoId, pasta.nome, pasta.caminho],
  ).catch((e) => {
    console.warn("[pontual] anotar pasta do Drive falhou:", (e as Error)?.message ?? e)
  })
}

export interface PrePagamentoVivo {
  id: string
  item_origem_id: string
  chapa: string
  nome: string | null
  contrato: string | null
  data_inicio: string
  data_fim: string
  dias_vr: number | null
  dias_vt: number | null
  liquido_vr: number | null
  liquido_vt: number | null
  credito_vr: number | null
  credito_vt: number | null
  pix_vr: number | null
  pix_vt: number | null
  desconto_vr: number | null
  desconto_vt: number | null
  estado: string
  motivo_invalido: string | null
  pasta_convocacao_drive_id: string | null
  pasta_pessoa_drive_id: string | null
  pasta_convocacao_nome: string | null
  pasta_estado: string
}

/** O pré-pagamento que a felipeta vai consumir. `null` = a fase 2 recalcula e avisa. */
export async function lerPrePagamentoVivo(itemOrigemId: string): Promise<PrePagamentoVivo | null> {
  const { rows } = await query<PrePagamentoVivo>(
    `SELECT id, item_origem_id::text, chapa, nome, contrato, data_inicio, data_fim,
            dias_vr, dias_vt, liquido_vr, liquido_vt, credito_vr, credito_vt,
            pix_vr, pix_vt, desconto_vr, desconto_vt, estado, motivo_invalido,
            pasta_convocacao_drive_id, pasta_pessoa_drive_id, pasta_convocacao_nome, pasta_estado
       FROM pontual_prepagamento
      WHERE item_origem_id = $1 AND estado IN ('reservado', 'consumido')
      LIMIT 1`,
    [itemOrigemId],
  )
  return rows[0] ?? null
}

export interface ReservaDoSnapshot {
  descontoMondayItemId: string
  vr: number
  vt: number
}

export interface PrePagamentoCompleto extends PrePagamentoVivo {
  monday_board_id: string | null
  cpf: string | null
  cod_secao: string | null
  bruto_vr: number | null
  bruto_vt: number | null
  vr_dia: number | null
  vt_dia: number | null
  regra_aplicada: string | null
  /** Entrada + saída do cálculo da fase 1 — `calculo->entrada` guarda interior/funcao/optanteVT. */
  calculo: Record<string, unknown>
  reservas: ReservaDoSnapshot[]
}

/**
 * O snapshot INTEIRO + reservas — o que a fase 2 (felipeta) consome.
 *
 * Leitor separado do `lerPrePagamentoVivo` de propósito: o vivo serve consultas leves
 * (cancelamento, tela), este carrega `calculo` jsonb e faz um segundo SELECT. `null` tem o
 * mesmo contrato do vivo: a felipeta recalcula e avisa.
 */
export async function lerPrePagamentoCompleto(itemOrigemId: string): Promise<PrePagamentoCompleto | null> {
  const { rows } = await query<Omit<PrePagamentoCompleto, "reservas">>(
    `SELECT id, item_origem_id::text, monday_board_id::text, chapa, cpf, nome, contrato,
            cod_secao, data_inicio, data_fim, dias_vr, dias_vt, vr_dia, vt_dia,
            bruto_vr, bruto_vt, liquido_vr, liquido_vt, credito_vr, credito_vt,
            pix_vr, pix_vt, desconto_vr, desconto_vt, regra_aplicada, calculo,
            estado, motivo_invalido,
            pasta_convocacao_drive_id, pasta_pessoa_drive_id, pasta_convocacao_nome, pasta_estado
       FROM pontual_prepagamento
      WHERE item_origem_id = $1 AND estado IN ('reservado', 'consumido')
      LIMIT 1`,
    [itemOrigemId],
  )
  const s = rows[0]
  if (!s) return null
  const { rows: reservas } = await query<{ desconto_monday_item_id: string; vr: string; vt: string }>(
    `SELECT desconto_monday_item_id, vr, vt FROM pontual_reserva_desconto
      WHERE prepagamento_id = $1 ORDER BY id`,
    [s.id],
  )
  return {
    ...s,
    reservas: reservas.map((r) => ({
      descontoMondayItemId: r.desconto_monday_item_id,
      vr: Number(r.vr) || 0,
      vt: Number(r.vt) || 0,
    })),
  }
}

/**
 * Marca o snapshot como consumido e APAGA as reservas — uma transação.
 *
 * O DELETE não é limpeza: é correção de dupla contagem. Depois que a felipeta decrementa o
 * residual no board Desconto, manter a reserva "viva" faria `lerReservasVivas` subtrair a
 * MESMA dívida de novo do pool do mensal. Os deltas sobrevivem em `calculo->reservas` (fase 1
 * grava lá) pra auditoria e pro balãozinho.
 *
 * `consumido` significa "FIFO consumido", não "pagamento concluído" — a conclusão é a chave
 * `pontual:{item}:fechamento` + o estado da execução.
 */
export async function marcarConsumido(prepagamentoId: string): Promise<boolean> {
  const c = await pool.connect()
  try {
    await c.query("BEGIN")
    const { rows } = await c.query<{ id: string }>(
      `UPDATE pontual_prepagamento SET estado = 'consumido', atualizado_em = now()
        WHERE id = $1 AND estado = 'reservado' RETURNING id`,
      [prepagamentoId],
    )
    await c.query(`DELETE FROM pontual_reserva_desconto WHERE prepagamento_id = $1`, [prepagamentoId])
    await c.query("COMMIT")
    return rows.length > 0
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

/**
 * Solta a reserva e marca o snapshot como liberado.
 *
 * Três gatilhos: cancelamento da convocação, recálculo (via `reservarPrePagamento`) e
 * EXPIRAÇÃO. Sem o terceiro, felipeta esquecida trava a dívida pra sempre e o mensal abate
 * menos do que devia, sem ninguém perceber.
 */
export async function liberarPrePagamento(itemOrigemId: string, motivo: string): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `UPDATE pontual_prepagamento
        SET estado = 'liberado', motivo_invalido = COALESCE(motivo_invalido, $2),
            atualizado_em = now()
      WHERE item_origem_id = $1 AND estado = 'reservado'
      RETURNING id`,
    [itemOrigemId, motivo],
  )
  for (const r of rows) {
    await query(`DELETE FROM pontual_reserva_desconto WHERE prepagamento_id = $1`, [r.id])
  }
  return rows.length
}
