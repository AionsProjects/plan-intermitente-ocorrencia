// Reancoragem do rastro do RM na virada de mês.
//
// PROBLEMA. `pi.convocacoes_rm.item_origem_id` é o item do board Entrada — a única chave que
// existe no instante do lançamento. A virada (WF n8n "DP - Plan. de Intermitentes (BENAUT)",
// cron `0 17 14 * *`) duplica o board central COM os itens (`duplicate_board_with_pulses_and_
// updates`), ARQUIVA todos os itens do central e recria a folha do mês seguinte. Uma convocação
// que atravessa o dia 14 passa a existir em DOIS itens: o original arquivado e a cópia ativa.
//
// Sem espelho, um cancelamento feito pela CÓPIA chama `removerConvocacoesDoItem(<id da cópia>)`,
// não acha rastro nenhum e conclui "nada a fazer" — o board fica cancelado e o S-2260 fica de pé
// no RM. É exatamente o desfecho que `convocacaoRemover.ts` chama de pior possível.
//
// POR QUE ESPELHO E NÃO TROCA DE ÂNCORA: o link `Item Origem` do board Histórico continua
// apontando pro item ARQUIVADO (medido: dos 13 Históricos criados em 01–13/07, 7 apontam hoje
// pra itens `18418191275/archived`). Mover `item_origem_id` pra cópia consertaria o caminho da
// cópia e quebraria o do Histórico. Os dois ids precisam achar a mesma linha.
//
// CHAVE DA RECONCILIAÇÃO: o `Código Convocação RM`. Ele é único (contador do RM), a duplicação
// copia valor de coluna (medido: a cópia de julho preservou chapa/contrato/datas) e ele já está
// gravado tanto na linha do Postgres quanto na célula do item. Casar por código é determinístico
// — nada de heurística por nome/período.
import { query } from "../db.js"
import { mondayGraphql } from "../monday.js"

export interface RemapeamentoRm {
  /** Linhas vivas com código, candidatas a ganhar espelho. */
  candidatos: number
  /** Espelhos gravados nesta passada. */
  remapeados: Array<{ codigo: string; de: string; para: string }>
  /** Já tinham o mesmo espelho — virada re-executada. */
  jaNoBoard: number
  /** Vivos SEM item correspondente na cópia: precisam de olho humano. */
  semItemNaCopia: Array<{ codigo: string; item_origem_id: string; chapa: string }>
  /** Vivos sem código (estado `reservado`): não dá pra casar por código. */
  semCodigo: Array<{ id: string; item_origem_id: string; chapa: string }>
}

interface LinhaViva {
  id: string
  item_origem_id: string
  item_espelho_id: string | null
  chapa: string
  codigo: string | null
}

/** Código do RM -> item da cópia. Separado pra poder ser stubado no teste (o resto é banco). */
export async function itensPorCodigoRm(
  boardId: string,
  colCodRm: string,
  codigos: string[],
): Promise<Map<string, string>> {
  const d = await mondayGraphql<{
    items_page_by_column_values: {
      items: Array<{ id: string; column_values: Array<{ id: string; text: string | null }> }>
    }
  }>(
    `query($board:ID!,$col:String!,$vals:[String]!,$limit:Int!){
       items_page_by_column_values(board_id:$board, limit:$limit,
         columns:[{column_id:$col, column_values:$vals}]){
         items{ id column_values(ids:[$col]){ id text } }
       }
     }`,
    { board: boardId, col: colCodRm, vals: codigos, limit: Math.max(codigos.length * 2, 25) },
  )
  const m = new Map<string, string>()
  for (const it of d.items_page_by_column_values?.items ?? []) {
    const cod = (it.column_values?.[0]?.text ?? "").trim()
    // Colisão não deveria existir (código é único no RM). Se houver, o primeiro vence e a
    // segunda linha cai em `semItemNaCopia` — visível, em vez de escolher em silêncio.
    if (cod && !m.has(cod)) m.set(cod, String(it.id))
  }
  return m
}

/**
 * Aponta as convocações vivas do RM também pro item equivalente no board `boardId` (a cópia
 * recém-criada), casando pelo `Código Convocação RM`.
 *
 * Idempotente: rodar de novo não grava nada (o espelho já está lá). Nunca apaga, nunca move a
 * âncora, nunca inventa linha. Um código vivo sem item na cópia é DEVOLVIDO como pendência, não
 * engolido: pode ser item que o DP apagou à mão, e aí o registro no RM ficou órfão.
 */
export async function remapearConvocacoesRmParaBoard(
  boardId: string,
  colCodRm: string,
  buscar: typeof itensPorCodigoRm = itensPorCodigoRm,
): Promise<RemapeamentoRm> {
  const { rows: vivos } = await query<LinhaViva>(
    `SELECT id::text, item_origem_id::text, item_espelho_id::text, chapa, codigo
       FROM convocacoes_rm
      WHERE estado IN ('reservado','no_rm','a_remover')
      ORDER BY criado_em`,
  )

  const out: RemapeamentoRm = {
    candidatos: 0,
    remapeados: [],
    jaNoBoard: 0,
    semItemNaCopia: [],
    semCodigo: [],
  }

  const comCodigo = vivos.filter((v) => {
    if (v.codigo) return true
    out.semCodigo.push({ id: v.id, item_origem_id: v.item_origem_id, chapa: v.chapa })
    return false
  })
  out.candidatos = comCodigo.length
  if (!comCodigo.length) return out

  // Uma consulta só: `items_page_by_column_values` aceita N valores na mesma coluna.
  const codigos = [...new Set(comCodigo.map((v) => v.codigo as string))]
  const itemPorCodigo = await buscar(boardId, colCodRm, codigos)

  for (const v of comCodigo) {
    const novo = itemPorCodigo.get(v.codigo as string)
    if (!novo) {
      out.semItemNaCopia.push({ codigo: v.codigo as string, item_origem_id: v.item_origem_id, chapa: v.chapa })
      continue
    }
    // Espelho igual ao original = o item nem foi duplicado (rodou contra o próprio board).
    if (novo === v.item_espelho_id || novo === v.item_origem_id) {
      out.jaNoBoard++
      continue
    }
    // `observacao` deixa o rastro legível pro DP — a linha nunca é apagada, e sem isso a forense
    // de "esse C03S virou qual item na cópia" se perde.
    await query(
      `UPDATE convocacoes_rm
          SET item_espelho_id = $2::bigint,
              observacao = concat_ws(' | ', observacao,
                'virada: espelho ' || item_origem_id || ' -> ' || $2::text || ' (board ' || $3::text || ')'),
              atualizado_em = now()
        WHERE id = $1`,
      [v.id, novo, boardId],
    )
    out.remapeados.push({ codigo: v.codigo as string, de: v.item_origem_id, para: novo })
  }

  return out
}
