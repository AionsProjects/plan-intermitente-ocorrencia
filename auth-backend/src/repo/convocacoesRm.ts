// Repositório do rastro de convocações gravadas no RM (pi.convocacoes_rm).
// 1 linha por REGISTRO NO RM — uma convocação do Monday vira N (bifurcação, quebra por atestado).
//
// A trava de duplicidade é o índice parcial `uq_convocacoes_rm_vivo (item_origem_id, data_inicio)
// WHERE estado IN ('reservado','no_rm')`, e não uma chave semântica: o pedaço que herda o início
// do registro que está substituindo precisa caber assim que o antigo vira `a_remover`.
import { pool, query } from "../db.js"
import { chapaRm, RM_COLIGADA_CONVOCACAO } from "../domain/convocacaoRm.js"

export type EstadoLancamentoRm = "reservado" | "no_rm" | "a_remover" | "removido" | "falhou"

export type MotivoSaidaRm =
  | "cancelamento_total"
  | "cancelamento_parcial"
  | "bifurcacao"
  | "quebra_atestado"
  | "duplicidade"
  | "correcao_manual"

export interface LancamentoRm {
  id: string
  item_origem_id: string // bigint -> string no node-pg
  /**
   * Item equivalente na CÓPIA da virada de mês (mesmo `Código Convocação RM`). Preenchido por
   * `/api/boards/virada`. Existe porque a convocação que atravessa o dia 14 passa a ter dois
   * itens: o original arquivado (pra onde o `Item Origem` do Histórico continua apontando) e a
   * cópia ativa (onde o DP trabalha). As buscas casam pelos dois.
   */
  item_espelho_id: string | null
  monday_board_id: string | null
  uuid_convocacao: string | null
  coligada: number
  chapa: string // 6 dígitos (formato RM)
  codigo: string | null
  pk_rm: string | null
  contrato: string | null
  data_inicio: string // "YYYY-MM-DD" (parser de date em db.ts)
  data_fim: string
  data_convocacao: string | null
  estado_convocacao: number | null
  estado: EstadoLancamentoRm
  motivo_saida: MotivoSaidaRm | null
  origem_lancamento_id: string | null
  indeterminado: boolean
  erro: string | null
  origem_acao: string | null
  criado_por: string | null
  removido_em: Date | null
  removido_por: string | null
  observacao: string | null
  criado_em: Date
  confirmado_em: Date | null
}

export interface ReservaLancamentoRm {
  itemOrigemId: string | number
  mondayBoardId?: string | number | null
  uuidConvocacao?: string | null
  chapa: string // aceita cru; a função normaliza
  contrato?: string | null
  dataInicio: string
  dataFim: string
  dataConvocacao?: string | null
  estadoConvocacao?: number | null
  coligada?: number
  origemAcao?: string | null
  criadoPor?: string | null
  origemLancamentoId?: string | null
  payload?: unknown
}

const COLUNAS_INSERT = `item_origem_id, monday_board_id, uuid_convocacao, coligada, chapa, contrato,
   data_inicio, data_fim, data_convocacao, estado_convocacao, estado, origem_acao, criado_por,
   origem_lancamento_id, payload, atualizado_em`

function valoresInsert(p: ReservaLancamentoRm): unknown[] {
  return [
    String(p.itemOrigemId),
    p.mondayBoardId != null ? String(p.mondayBoardId) : null,
    p.uuidConvocacao ?? null,
    p.coligada ?? RM_COLIGADA_CONVOCACAO,
    chapaRm(p.chapa),
    p.contrato ?? null,
    p.dataInicio,
    p.dataFim,
    p.dataConvocacao ?? null,
    p.estadoConvocacao ?? null,
    p.origemAcao ?? null,
    p.criadoPor ?? null,
    p.origemLancamentoId ?? null,
    p.payload != null ? JSON.stringify(p.payload) : null,
  ]
}

/**
 * Reserva o slot ANTES do SaveRecord — mesma ordem que salvou o mensal em 01/08: morrer no meio
 * deixa `reservado`, que na passada seguinte aparece como `ocupado` e pede conferência, em vez de
 * gravar a convocação duas vezes.
 *
 * `ocupado` devolve quem segura o slot: `no_rm` = já lançado (pular); `reservado` = reserva
 * pendurada (conferir no RM antes de repetir).
 */
export async function reservarLancamentoRm(
  p: ReservaLancamentoRm,
): Promise<{ status: "novo" | "ocupado"; lancamento: LancamentoRm }> {
  const { rows } = await query<LancamentoRm>(
    `INSERT INTO convocacoes_rm (${COLUNAS_INSERT})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reservado',$11,$12,$13,$14::jsonb, now())
     ON CONFLICT (item_origem_id, data_inicio) WHERE estado IN ('reservado','no_rm') DO NOTHING
     RETURNING *`,
    valoresInsert(p),
  )
  if (rows[0]) return { status: "novo", lancamento: rows[0] }

  const { rows: ocupado } = await query<LancamentoRm>(
    `SELECT * FROM convocacoes_rm
      WHERE item_origem_id=$1 AND data_inicio=$2 AND estado IN ('reservado','no_rm') LIMIT 1`,
    [String(p.itemOrigemId), p.dataInicio],
  )
  return { status: "ocupado", lancamento: ocupado[0]! }
}

/**
 * Pós-SaveRecord. `AND estado='reservado'` impede que um confirm atrasado ressuscite uma linha
 * que já foi removida por cancelamento no meio do caminho.
 */
export async function confirmarLancamentoRm(
  id: string,
  r: { codigo: string; pkRm: string; payload?: unknown },
): Promise<void> {
  await query(
    `UPDATE convocacoes_rm
        SET estado='no_rm', codigo=$2, pk_rm=$3, confirmado_em=now(),
            erro=NULL, indeterminado=false,
            payload = CASE WHEN $4::jsonb IS NULL THEN payload
                           ELSE coalesce(payload,'{}'::jsonb) || $4::jsonb END,
            atualizado_em=now()
      WHERE id=$1 AND estado='reservado'`,
    [id, r.codigo, r.pkRm, r.payload != null ? JSON.stringify(r.payload) : null],
  )
}

/**
 * SaveRecord falhou. A distinção é a mesma de `RmSoapError.indeterminado`:
 *   - Fault do RM (respondeu e recusou, COM rollback) -> `falhou`, LIBERA o slot: o próximo
 *     lançamento pode tentar de novo;
 *   - timeout/5xx/resposta muda (pode ter gravado) -> continua `reservado` com
 *     `indeterminado=true`, MANTÉM o slot travado. Reenviar é o único jeito de duplicar.
 */
export async function falharLancamentoRm(
  id: string,
  erro: string,
  opts: { indeterminado?: boolean } = {},
): Promise<void> {
  await query(
    `UPDATE convocacoes_rm
        SET estado = CASE WHEN $3 THEN 'reservado' ELSE 'falhou' END,
            indeterminado = $3, erro = $2, atualizado_em = now()
      WHERE id = $1 AND estado = 'reservado'`,
    [id, erro.slice(0, 500), opts.indeterminado === true],
  )
}

/**
 * Lançamentos VIVOS por item da Entrada, EM LOTE — substitui a leitura da coluna do Monday.
 * Em lote porque o caller costuma ter dezenas de itens e uma query por item seria N+1 numa rota
 * que já fala com Monday e RM. Chave do Map = `item_origem_id` como string (bigint volta string).
 */
export async function lancamentosVivosPorItens(
  itemIds: (string | number)[],
): Promise<Map<string, LancamentoRm[]>> {
  const ids = [...new Set(itemIds.map(String))].filter((x) => /^\d+$/.test(x))
  const mapa = new Map<string, LancamentoRm[]>()
  if (!ids.length) return mapa
  const { rows } = await query<LancamentoRm>(
    `SELECT * FROM convocacoes_rm
      WHERE (item_origem_id = ANY($1::bigint[]) OR item_espelho_id = ANY($1::bigint[]))
        AND estado IN ('reservado','no_rm')
      ORDER BY item_origem_id, data_inicio`,
    [ids],
  )
  const pedidos = new Set(ids)
  for (const r of rows) {
    // Indexa pelo id que o CALLER pediu — ele conhece o item da cópia OU o original, nunca os
    // dois. Se ambos foram pedidos (varredura do board inteiro), a linha entra nas duas chaves.
    for (const k of [String(r.item_origem_id), r.item_espelho_id ? String(r.item_espelho_id) : null]) {
      if (!k || !pedidos.has(k)) continue
      const lista = mapa.get(k)
      if (lista) { if (!lista.includes(r)) lista.push(r) } else mapa.set(k, [r])
    }
  }
  return mapa
}

/**
 * Peças VIVAS que nasceram de uma bifurcação, agrupadas pelo lançamento que substituíram.
 *
 * É o que o `reverter` do split consome. Filtrar pelo `motivo_saida` do PAI é o que impede o
 * revert de engolir peças de outra origem — quebra por atestado usa a mesma mecânica de
 * substituição, e desfazer split não pode desfazer atestado.
 */
export async function pecasDeBifurcacaoDoItem(
  itemOrigemId: string | number,
): Promise<Map<string, { pai: LancamentoRm; pecas: LancamentoRm[] }>> {
  const { rows } = await query<LancamentoRm & { pai_json: LancamentoRm }>(
    `SELECT f.*, to_jsonb(p.*) AS pai_json
       FROM convocacoes_rm f
       JOIN convocacoes_rm p ON p.id = f.origem_lancamento_id
      WHERE (f.item_origem_id=$1::bigint OR f.item_espelho_id=$1::bigint)
        AND f.estado IN ('reservado','no_rm')
        AND p.motivo_saida = 'bifurcacao'
      ORDER BY f.data_inicio, f.criado_em`,
    [String(itemOrigemId)],
  )
  const mapa = new Map<string, { pai: LancamentoRm; pecas: LancamentoRm[] }>()
  for (const r of rows) {
    const { pai_json, ...peca } = r
    const k = String(peca.origem_lancamento_id)
    const g = mapa.get(k)
    if (g) g.pecas.push(peca as LancamentoRm)
    else mapa.set(k, { pai: pai_json, pecas: [peca as LancamentoRm] })
  }
  return mapa
}

/**
 * Tudo de um item, inclusive histórico — é a resposta pra "por que o código sumiu?".
 *
 * Casa pelo item original E pelo espelho da virada: depois do dia 14 o cancelamento pode chegar
 * com qualquer um dos dois ids (o Histórico guarda o original; o DP reativa pela cópia), e achar
 * "nada" nesse momento deixaria o S-2260 de pé com o board cancelado.
 */
export async function lancamentosDoItem(
  itemOrigemId: string | number,
  opts: { apenasVivos?: boolean } = {},
): Promise<LancamentoRm[]> {
  const { rows } = await query<LancamentoRm>(
    `SELECT * FROM convocacoes_rm
      WHERE (item_origem_id=$1::bigint OR item_espelho_id=$1::bigint)
        ${opts.apenasVivos ? "AND estado IN ('reservado','no_rm')" : ""}
      ORDER BY data_inicio, criado_em`,
    [String(itemOrigemId)],
  )
  return rows
}

/**
 * Por chapa + período, com overlap inclusive nas pontas.
 * Normaliza a chapa pro formato RM antes de comparar — quem passar "3330" cru sem isso recebe
 * zero linhas em silêncio, que é o modo de falha mais perigoso deste módulo.
 */
export async function lancamentosPorChapaPeriodo(
  chapa: string,
  dataInicio: string,
  dataFim: string,
  opts: { coligada?: number; apenasVivos?: boolean } = {},
): Promise<LancamentoRm[]> {
  const { rows } = await query<LancamentoRm>(
    `SELECT * FROM convocacoes_rm
      WHERE coligada=$1 AND chapa=$2 AND data_inicio <= $4 AND data_fim >= $3
        ${opts.apenasVivos ? "AND estado IN ('reservado','no_rm')" : ""}
      ORDER BY data_inicio`,
    [opts.coligada ?? RM_COLIGADA_CONVOCACAO, chapaRm(chapa), dataInicio, dataFim],
  )
  return rows
}

/**
 * Backfill do vínculo com pi.convocacoes. Chamar no gatilho "ativar", logo depois do INSERT em
 * `convocacoes` — é o instante em que o uuid passa a existir. Best-effort no caller: falhar aqui
 * não pode derrubar a ativação, porque a junção por `item_origem_id` continua funcionando.
 */
export async function vincularUuidConvocacao(
  itemOrigemId: string | number,
  uuid: string,
): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `UPDATE convocacoes_rm SET uuid_convocacao=$2, atualizado_em=now()
      WHERE item_origem_id=$1 AND uuid_convocacao IS DISTINCT FROM $2 RETURNING id`,
    [String(itemOrigemId), uuid],
  )
  return rows.length
}

/**
 * Promete a remoção ANTES de chamar o DeleteRecordByKey. O estado intermediário existe porque o
 * registro AINDA está no RM: marcar `removido` antes da chamada e morrer deixaria o C03S######
 * órfão lá, sem ninguém pra apagá-lo.
 *
 * `a_remover` está fora do índice único de propósito — libera o slot pro pedaço que herda o mesmo
 * início (o 05→09 da quebra por atestado).
 *
 * NÃO aceita `reservado`. Antes aceitava, e isso NUNCA funcionou: linha reservada tem `codigo`
 * NULL e o CHECK `ck_convocacoes_rm_codigo` exige código para `a_remover` — dava 23514 justamente
 * no caso "gravou e morreu no meio", o que mais se precisa remover. E o remédio certo ali não é
 * remover: sem código não há registro no RM pra apagar. Esse caso é `falharLancamentoRm` (libera
 * o slot) ou conciliação por leitura, se for indeterminado.
 *
 * ACEITA `a_remover` (re-marcação). A bifurcação marca dentro da transação de
 * `planejarSubstituicaoRm` — tem que marcar lá, senão a peça que herda o início bate no índice
 * parcial — e só depois chama `removerLancamentoRm`, que remarca. Recusar aqui fazia o removedor
 * devolver `sem_rastro` e **pular o DeleteRecordByKey**: o registro original sobreviveria no RM
 * enquanto as duas peças novas eram criadas. Registro triplo, calado.
 */
export async function marcarParaRemocaoRm(
  id: string,
  p: { motivo: MotivoSaidaRm; removidoPor?: string | null; observacao?: string | null },
): Promise<LancamentoRm | null> {
  const { rows } = await query<LancamentoRm>(
    `UPDATE convocacoes_rm
        SET estado='a_remover', motivo_saida=$2, removido_por=$3,
            observacao=coalesce($4, observacao), atualizado_em=now()
      WHERE id=$1 AND estado IN ('no_rm','a_remover') RETURNING *`,
    [id, p.motivo, p.removidoPor ?? null, p.observacao ?? null],
  )
  return rows[0] ?? null
}

/**
 * Encurta o período de um lançamento vivo — é o cancelamento parcial.
 *
 * Só `data_fim` muda: `data_inicio` é parte do índice único, e mexer nele transformaria a edição
 * numa convocação diferente. O registro no RM continua sendo O MESMO (mesmo C03S######), então o
 * estado segue `no_rm` — não há transição de estado aqui, só correção do que o rastro afirma.
 */
export async function atualizarPeriodoLancamentoRm(
  id: string,
  p: { dataFim: string; payload?: unknown },
): Promise<LancamentoRm | null> {
  const { rows } = await query<LancamentoRm>(
    `UPDATE convocacoes_rm
        SET data_fim = $2::date,
            payload = CASE WHEN $3::jsonb IS NULL THEN payload
                           ELSE coalesce(payload,'{}'::jsonb) || $3::jsonb END,
            atualizado_em = now()
      WHERE id = $1 AND estado = 'no_rm' RETURNING *`,
    [id, p.dataFim, p.payload != null ? JSON.stringify(p.payload) : null],
  )
  return rows[0] ?? null
}

/** Pós-DeleteRecordByKey CONFIRMADO por releitura (o rm-delete.ts faz isso; fazer igual aqui). */
export async function confirmarRemocaoRm(id: string, payload?: unknown): Promise<void> {
  await query(
    `UPDATE convocacoes_rm
        SET estado='removido', removido_em=now(),
            payload = CASE WHEN $2::jsonb IS NULL THEN payload
                           ELSE coalesce(payload,'{}'::jsonb) || $2::jsonb END,
            atualizado_em=now()
      WHERE id=$1 AND estado='a_remover'`,
    [id, payload != null ? JSON.stringify(payload) : null],
  )
}

/**
 * Troca N registros por M numa transação — é a operação da bifurcação e da quebra por atestado.
 *
 * Precisa ser atômico: fora de transação, o pedaço novo que herda o início do antigo bate no
 * índice único enquanto a marcação do antigo não commitou.
 *
 * NÃO toca no RM. Devolve o plano (o que apagar lá, o que já está reservado aqui) pro caller
 * executar — mesma separação do resto do módulo.
 */
export async function planejarSubstituicaoRm(p: {
  remover: { id: string; motivo: MotivoSaidaRm }[]
  criar: ReservaLancamentoRm[]
  removidoPor?: string | null
}): Promise<{ aRemover: LancamentoRm[]; reservados: LancamentoRm[] }> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    // O handler de `connect` do pool cobre conexão nova, mas mensal/repo.ts re-declara dentro do
    // BEGIN — seguir o precedente em vez de depender do handler.
    await client.query("SET LOCAL search_path TO pi, public")

    const aRemover: LancamentoRm[] = []
    for (const r of p.remover) {
      // Só `no_rm`, mesma razão de marcarParaRemocaoRm: `reservado` tem código NULL e o CHECK
      // recusa. Linha que não casa fica de fora do plano — o caller vê pelo tamanho de `aRemover`.
      const { rows } = await client.query<LancamentoRm>(
        `UPDATE convocacoes_rm
            SET estado='a_remover', motivo_saida=$2, removido_por=$3, atualizado_em=now()
          WHERE id=$1 AND estado='no_rm' RETURNING *`,
        [r.id, r.motivo, p.removidoPor ?? null],
      )
      if (rows[0]) aRemover.push(rows[0])
    }

    const reservados: LancamentoRm[] = []
    for (const c of p.criar) {
      const { rows } = await client.query<LancamentoRm>(
        `INSERT INTO convocacoes_rm (${COLUNAS_INSERT})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reservado',$11,$12,$13,$14::jsonb, now())
         RETURNING *`,
        valoresInsert(c),
      )
      reservados.push(rows[0]!)
    }

    await client.query("COMMIT")
    return { aRemover, reservados }
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
