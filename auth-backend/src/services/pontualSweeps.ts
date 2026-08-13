// Varreduras do pontual — caronas do GET /api/jobs/tick (Hobby = 2 crons, não há vaga
// pra um terceiro; o padrão de carona isolada é o mesmo do sweep de bloqueio).
//
// NUNCA usar job de tipo "pontual" em pi.jobs: o runner o marca gated e mata calado
// (runner.ts HANDLERS). Estas funções rodam inline no tick.
import { config } from "../config.js"
import { query } from "../db.js"
import { liberarPrePagamento, anotarPastaDrive } from "../pontual/prepagamento.js"

/**
 * Expira reservas de pré-pagamento esquecidas.
 *
 * Regra: felipeta não veio até `data_fim + PONTUAL_RESERVA_EXPIRA_DIAS` (default 15) →
 * a dívida volta ao FIFO. Sem isto, convocação abandonada trava o residual pra sempre e o
 * fechamento mensal abate menos do que devia — o modo de falha silencioso da reserva.
 *
 * `hoje` entra de fora (testável; e o workflow do mensal proíbe Date no corpo — regra da
 * casa pra qualquer código que possa migrar pra lá).
 *
 * Guarda anti-corrida: pula item com gatilho de pagamento em curso
 * (`pontual:gatilho:<item>` pendente) — expirar debaixo de uma felipeta rodando devolveria
 * a dívida ao pool no meio do consumo.
 */
export async function expirarReservasPontual(hoje: Date): Promise<{ liberadas: number; puladas: number }> {
  const corte = new Date(hoje)
  corte.setUTCDate(corte.getUTCDate() - config.pontualReservaExpiraDias)
  const corteIso = corte.toISOString().slice(0, 10)

  const { rows } = await query<{ item_origem_id: string }>(
    `SELECT p.item_origem_id::text
       FROM pontual_prepagamento p
      WHERE p.estado = 'reservado'
        AND p.data_fim < $1
        -- IDADE DA PRÓPRIA RESERVA, não só do período. Duas coisas dependem disto:
        --  1. convocação RETROATIVA (papel 'passado') nasce com data_fim semanas atrás — sem
        --     esta linha ela é expirada no primeiro tick, minutos depois de criada, e a
        --     felipeta perde a reserva de uma convocação que ninguém abandonou;
        --  2. blindagem contra chamador com data errada (foi como o teste de setembro
        --     liberou 4 convocações vivas de agosto).
        AND p.criado_em < now() - interval '2 days'
      LIMIT 50`,
    [corteIso],
  )
  let liberadas = 0
  let puladas = 0
  for (const r of rows) {
    const { rows: gatilho } = await query<{ status: string }>(
      `SELECT status FROM efeitos_externos WHERE chave = $1`,
      [`pontual:gatilho:${r.item_origem_id}`],
    )
    if (gatilho[0] && gatilho[0].status !== "confirmado") {
      puladas++
      continue
    }
    liberadas += await liberarPrePagamento(r.item_origem_id, "reserva_expirada")
  }
  return { liberadas, puladas }
}

/**
 * Back-fill de pasta do Drive que ficou pendente na criação (Drive fora do ar no momento).
 *
 * Reusa o resolvedor do fluxo normal (`arquivarDrive` sem arquivos — ele não tem early
 * return por lista vazia), então o caminho/nome saem IGUAIS aos da criação. Best-effort:
 * uma pasta que falhar de novo fica pra próxima passada.
 */
export async function backfillPastasPontual(limite = 5): Promise<{ resolvidas: number; falhas: number }> {
  const { rows } = await query<{
    id: string
    item_origem_id: string
    nome: string | null
    contrato: string | null
    data_inicio: string
    data_fim: string
  }>(
    `SELECT id, item_origem_id::text, nome, contrato, data_inicio, data_fim
       FROM pontual_prepagamento
      WHERE pasta_estado = 'pendente' AND estado IN ('reservado', 'consumido')
      ORDER BY criado_em
      LIMIT $1`,
    [limite],
  )
  let resolvidas = 0
  let falhas = 0
  for (const r of rows) {
    try {
      const { arquivarDrive } = await import("./driveArquivar.js")
      const res = await arquivarDrive({
        tipo: "convocacao",
        nome: r.nome ?? "",
        contrato: r.contrato ?? "",
        data_inicio: r.data_inicio,
        data_fim: r.data_fim,
        item_entrada_id: r.item_origem_id,
        arquivos: [],
      })
      await anotarPastaDrive(r.id, {
        pastaPessoaId: res.pasta_pessoa_drive_id,
        pastaConvocacaoId: res.pasta_convocacao_drive_id,
        nome: res.pasta_convocacao_nome,
        caminho: res.pasta_caminho,
      })
      resolvidas++
    } catch {
      falhas++
    }
  }
  return { resolvidas, falhas }
}
