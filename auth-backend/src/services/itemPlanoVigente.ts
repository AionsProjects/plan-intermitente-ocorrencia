// Item do Plano onde ESCREVER hoje, a partir do item que o Histórico ou o espelho PG conhece.
//
// A virada (dia 14) duplica o board com os itens e ARQUIVA os originais. O link `Item Origem` do
// Histórico continua no original, de propósito (ver viradaConvocacoesRm.ts), e
// `pi.convocacoes.item_origem_id` de convocação ativada antes da virada também. Escrever no item
// arquivado falha ("Monday GraphQL falhou") — foi o que deixou o cancelamento da ELIANA (007412,
// 28/09/2026) fora do Plano: o corte antecipado para 09/09 nunca chegou na cópia, que seguiu
// mostrando 23/09.
//
// A ponte entre os dois é o espelho que a virada grava no rastro do RM (`item_espelho_id`, casado
// pelo Código Convocação RM). Só troca quando o Monday confirma: original fora de 'active' e cópia
// 'active'. Qualquer dúvida — sem espelho, mais de um espelho, Monday sem resposta — fica com o
// original, que é o comportamento de antes: falha visível em vez de escrever no item errado.
//
// Só para ESCRITA no Plano. Chaves de banco (pré-pagamento, rastro do RM, payload de job) seguem no
// item que as criou.
import { query } from "../db.js"
import { gql } from "../clients/monday.js"

export interface ItemPlano {
  itemId: string | null
  boardId: string | null
}

export interface ItemPlanoVigente extends ItemPlano {
  /** Preenchido quando houve troca: o item arquivado que ficou para trás. */
  arquivado?: string
}

export interface EstadoItemMonday {
  state: string
  boardId: string | null
}

export interface DepsItemPlano {
  /** Espelhos da virada conhecidos pelo rastro do RM para o item. */
  espelhos(itemId: string): Promise<string[]>
  /** Estado e board de cada item no Monday (itens ausentes ficam fora do mapa). */
  estados(ids: string[]): Promise<Map<string, EstadoItemMonday>>
}

async function espelhosPg(itemId: string): Promise<string[]> {
  const { rows } = await query<{ esp: string }>(
    `SELECT DISTINCT item_espelho_id::text AS esp FROM convocacoes_rm
      WHERE item_origem_id = $1::bigint AND item_espelho_id IS NOT NULL`,
    [itemId],
  )
  return rows.map((r) => r.esp)
}

async function estadosMonday(ids: string[]): Promise<Map<string, EstadoItemMonday>> {
  const d = await gql<{ items: Array<{ id: string; state: string; board: { id: string } | null }> }>(
    `query($i:[ID!]){ items(ids:$i){ id state board { id } } }`,
    { i: ids },
  )
  return new Map((d.items ?? []).map((it) => [String(it.id), { state: it.state, boardId: it.board?.id ?? null }]))
}

const DEPS_PADRAO: DepsItemPlano = { espelhos: espelhosPg, estados: estadosMonday }

/**
 * Ids que representam a MESMA convocação no Plano antes e depois da virada: o original e as
 * cópias, pelo espelho do rastro do RM. Em lote. Todo id pedido volta com ele mesmo incluído.
 *
 * Serve pra LEITURA por item: quem busca pelo id da cópia (webhook do board atual) tem que achar
 * o que foi gravado com o id do original (pré-pagamento, espelho PG), e vice-versa.
 */
export interface ParVirada {
  /** Item original (âncora do rastro). */
  o: string
  /** Cópia da virada. */
  e: string
}

async function paresPg(ids: string[]): Promise<ParVirada[]> {
  const { rows } = await query<ParVirada>(
    `SELECT DISTINCT item_origem_id::text AS o, item_espelho_id::text AS e FROM convocacoes_rm
      WHERE item_espelho_id IS NOT NULL
        AND (item_origem_id = ANY($1::bigint[]) OR item_espelho_id = ANY($1::bigint[]))`,
    [ids],
  )
  return rows
}

export async function equivalentesVirada(
  ids: Array<string | null | undefined>,
  pares: (ids: string[]) => Promise<ParVirada[]> = paresPg,
): Promise<Map<string, string[]>> {
  const pedidos = [...new Set(ids.map((i) => String(i ?? "").trim()).filter((i) => /^\d+$/.test(i)))]
  if (!pedidos.length) return new Map()
  const out = new Map<string, Set<string>>(pedidos.map((i) => [i, new Set([i])]))
  for (const p of await pares(pedidos)) {
    out.get(p.o)?.add(p.e)
    out.get(p.e)?.add(p.o)
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

/** `equivalentesVirada` para um id só. Sem id, lista vazia. */
export async function idsEquivalentes(itemId: string | null | undefined): Promise<string[]> {
  const id = String(itemId ?? "").trim()
  if (!id) return []
  return (await equivalentesVirada([id])).get(id) ?? [id]
}

export async function itemPlanoVigente(
  origem: ItemPlano,
  deps: Partial<DepsItemPlano> = {},
): Promise<ItemPlanoVigente> {
  const d = { ...DEPS_PADRAO, ...deps }
  const manter: ItemPlanoVigente = { itemId: origem.itemId, boardId: origem.boardId }
  if (!origem.itemId) return manter
  try {
    const esp = (await d.espelhos(String(origem.itemId))).filter((e) => e && e !== String(origem.itemId))
    if (esp.length !== 1) return manter
    const copia = esp[0]!
    const est = await d.estados([String(origem.itemId), copia])
    const orig = est.get(String(origem.itemId))
    const novo = est.get(copia)
    if (orig?.state === "active" || novo?.state !== "active" || !novo.boardId) return manter
    return { itemId: copia, boardId: novo.boardId, arquivado: String(origem.itemId) }
  } catch {
    return manter
  }
}
