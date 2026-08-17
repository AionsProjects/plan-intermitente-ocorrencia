// Cliente Monday — substitui os nós `mondayCom` + HTTP api.monday.com dos WFs n8n.
// Token: cred "Ray0" via MONDAY_TOKEN (runtime). Helpers de parsing são PUROS (testáveis
// offline); só gql()/mutations tocam a rede. Mapa de colunas vem de cada domínio.
import { config } from "../config.js"
import { indexarColunas, type MondayItem } from "./monday.parse.js"

// Re-exporta os helpers puros + tipos pra quem importa só "./monday.js".
export * from "./monday.parse.js"

const API_URL = "https://api.monday.com/v2"
const FILE_URL = "https://api.monday.com/v2/file"

export interface MondayError extends Error {
  monday: true
  detalhe: unknown
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

function token(): string {
  if (!config.mondayToken) {
    throw new Error("MONDAY_TOKEN ausente — configure no .env do backend")
  }
  return config.mondayToken
}

function erro(msg: string, detalhe: unknown): MondayError {
  const e = new Error(msg) as MondayError
  e.monday = true
  e.detalhe = detalhe
  return e
}

/** Executa uma operação GraphQL. Lança MondayError em `errors`. */
export async function gql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token(),
      "API-Version": config.mondayApiVersion,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  })
  const j = (await r.json()) as { data?: T; errors?: unknown }
  if (!r.ok || j.errors) {
    throw erro(`Monday GraphQL falhou (HTTP ${r.status})`, j.errors ?? `http ${r.status}`)
  }
  return j.data as T
}

/** Lê TODOS os itens de um board (paginado por cursor, 100/página). */
export async function lerItens(boardId: number): Promise<MondayItem[]> {
  const out: MondayItem[] = []
  let cursor: string | null = null
  do {
    const q: string = cursor
      ? `query($c:String!){ next_items_page(limit:100, cursor:$c){ cursor items{ id name column_values{ id text value } } } }`
      : `query($b:ID!){ boards(ids:[$b]){ items_page(limit:100){ cursor items{ id name column_values{ id text value } } } } }`
    const vars = cursor ? { c: cursor } : { b: String(boardId) }
    const d = await gql<{
      next_items_page?: { cursor: string | null; items: RawItem[] }
      boards?: Array<{ items_page: { cursor: string | null; items: RawItem[] } }>
    }>(q, vars)
    const page: { cursor: string | null; items: RawItem[] } = cursor
      ? d.next_items_page!
      : d.boards![0]!.items_page
    for (const it of page.items) {
      out.push({ id: it.id, name: it.name, cv: indexarColunas(it.column_values) })
    }
    cursor = page.cursor
  } while (cursor)
  return out
}

interface RawItem {
  id: string
  name: string
  column_values: Array<{ id: string; text: string | null; value: string | null }>
}

export interface ActivityLogRaw {
  id: string
  event: string
  user_id: string
  created_at: string
  data: Record<string, unknown>
}

/**
 * Lê o histórico de alterações de um board numa janela.
 *
 * Cuidados que custaram medição (08/08/2026, board 18418191275):
 * - vem do MAIS NOVO pro mais antigo;
 * - `limit` máximo 100 por página, e `page` começa em 1 (não há cursor aqui);
 * - 30 dias de um board dão ~3.000 logs = 30 páginas. Parar cedo TRUNCA em silêncio,
 *   por isso `maxPaginas` é generoso e o retorno avisa quando bateu no teto;
 * - `data` chega como STRING JSON, não objeto;
 * - a retenção depende do plano do Monday — por isso o sweep persiste no mesmo ciclo.
 */
export async function lerActivityLogs(
  boardId: number,
  de: Date,
  ate: Date,
  maxPaginas = 60,
): Promise<{ logs: ActivityLogRaw[]; truncado: boolean }> {
  const logs: ActivityLogRaw[] = []
  let pagina = 1
  for (; pagina <= maxPaginas; pagina++) {
    const d = await gql<{
      boards: Array<{ activity_logs: Array<{ id: string; event: string; data: string; user_id: string; created_at: string }> }>
    }>(
      `query($b:[ID!],$de:ISO8601DateTime!,$ate:ISO8601DateTime!,$p:Int!){
         boards(ids:$b){ activity_logs(from:$de, to:$ate, limit:100, page:$p){
           id event data user_id created_at } } }`,
      { b: [String(boardId)], de: de.toISOString(), ate: ate.toISOString(), p: pagina },
    )
    const page = d.boards?.[0]?.activity_logs ?? []
    if (!page.length) return { logs, truncado: false }
    for (const l of page) {
      let dados: Record<string, unknown> = {}
      try {
        dados = JSON.parse(l.data) as Record<string, unknown>
      } catch {
        /* log sem data parseável ainda vale pelo evento */
      }
      logs.push({ id: l.id, event: l.event, user_id: String(l.user_id), created_at: l.created_at, data: dados })
    }
    if (page.length < 100) return { logs, truncado: false }
  }
  return { logs, truncado: true }
}

/** Mapa user_id -> nome. O activity_log só devolve o id. */
export async function lerUsuarios(): Promise<Map<string, string>> {
  const d = await gql<{ users: Array<{ id: string; name: string }> }>(`{ users(limit:500){ id name } }`)
  return new Map((d.users ?? []).map((u) => [String(u.id), u.name]))
}

/** Lê 1 item por id. Retorna null se não existir. */
export async function lerItem(itemId: number): Promise<MondayItem | null> {
  const d = await gql<{ items: RawItem[] }>(
    `query($i:[ID!]){ items(ids:$i){ id name column_values{ id text value } } }`,
    { i: [String(itemId)] },
  )
  const it = d.items?.[0]
  return it ? { id: it.id, name: it.name, cv: indexarColunas(it.column_values) } : null
}

/**
 * Busca itens por valor de uma coluna (ex: uuid). Usa items_page_by_column_values.
 * `valores` casa exato. Retorna [] se nada achar.
 */
export async function lerPorColuna(
  boardId: number,
  columnId: string,
  valores: string[],
): Promise<MondayItem[]> {
  const d = await gql<{
    items_page_by_column_values: { items: RawItem[] }
  }>(
    `query($b:ID!,$col:String!,$vals:[String]!){
       items_page_by_column_values(limit:100, board_id:$b,
         columns:[{column_id:$col, column_values:$vals}]){
         items{ id name column_values{ id text value } }
       }
     }`,
    { b: String(boardId), col: columnId, vals: valores },
  )
  return (d.items_page_by_column_values?.items ?? []).map((it) => ({
    id: it.id,
    name: it.name,
    cv: indexarColunas(it.column_values),
  }))
}

/** Atualiza múltiplas colunas de 1 item (idempotente). `valores` = mapa column_id -> valor interno. */
export async function mudarColunas(
  boardId: number,
  itemId: number,
  valores: Record<string, unknown>,
): Promise<string> {
  const d = await gql<{ change_multiple_column_values: { id: string } }>(
    `mutation($b:ID!,$i:ID!,$vals:JSON!){
       change_multiple_column_values(board_id:$b, item_id:$i, column_values:$vals){ id }
     }`,
    { b: String(boardId), i: String(itemId), vals: JSON.stringify(valores) },
  )
  return d.change_multiple_column_values.id
}

/** Cria um item no board/grupo com valores de coluna. Retorna o id criado. */
export async function criarItem(
  boardId: number,
  nome: string,
  valores: Record<string, unknown>,
  groupId?: string,
): Promise<string> {
  const d = await gql<{ create_item: { id: string } }>(
    `mutation($b:ID!,$g:String,$n:String!,$vals:JSON!){
       create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$vals){ id }
     }`,
    { b: String(boardId), g: groupId ?? null, n: nome, vals: JSON.stringify(valores) },
  )
  return d.create_item.id
}

export interface SubitemRef {
  id: string
  name: string | null
  board: { id: string } | null
}

/**
 * Item + subitems + o BOARD de cada subitem. Query separada de `lerItem` porque `subitems`
 * pesa na complexidade do Monday e quase nenhum caller precisa.
 *
 * O `board.id` de cada subitem é o que permite ATUALIZAR: board de subitem é próprio e muda
 * na virada, então chumbar o id (o que o WF3 fazia: 18413180938, de junho) vira lixo no mês
 * seguinte. Aqui ele vem do próprio item.
 */
export async function lerItemComSubitems(
  itemId: number,
): Promise<{ item: MondayItem; subitems: SubitemRef[] } | null> {
  const d = await gql<{
    items: Array<RawItem & { subitems?: Array<{ id: string; name: string | null; board?: { id: string } | null }> }>
  }>(
    `query($i:[ID!]){ items(ids:$i){ id name column_values{ id text value } subitems{ id name board{ id } } } }`,
    { i: [String(itemId)] },
  )
  const it = d.items?.[0]
  if (!it) return null
  return {
    item: { id: it.id, name: it.name, cv: indexarColunas(it.column_values) },
    subitems: (it.subitems ?? []).map((s) => ({
      id: String(s.id),
      name: s.name ?? null,
      board: s.board?.id != null ? { id: String(s.board.id) } : null,
    })),
  }
}

/**
 * Cria subitem sob um item pai.
 *
 * Não recebe board de propósito: o Monday resolve pelo pai. `create_labels_if_missing` porque
 * o contrato da metade pode ser um label que ainda não existe na coluna do subitem.
 */
export async function criarSubitem(
  parentItemId: number,
  nome: string,
  valores: Record<string, unknown>,
): Promise<string> {
  const d = await gql<{ create_subitem: { id: string } }>(
    `mutation($p:ID!,$n:String!,$vals:JSON!){
       create_subitem(parent_item_id:$p, item_name:$n, column_values:$vals, create_labels_if_missing:true){ id }
     }`,
    { p: String(parentItemId), n: nome, vals: JSON.stringify(valores) },
  )
  return d.create_subitem.id
}

/** Apaga um item (usado em testes de escrita + cleanup). */
export async function deletarItem(itemId: number): Promise<void> {
  await gql(`mutation($i:ID!){ delete_item(item_id:$i){ id } }`, { i: String(itemId) })
}

/** Move item pra outro grupo. */
export async function moverParaGrupo(itemId: number, groupId: string): Promise<void> {
  await gql(
    `mutation($i:ID!,$g:String!){ move_item_to_group(item_id:$i, group_id:$g){ id } }`,
    { i: String(itemId), g: groupId },
  )
}

/** Upload de arquivo numa coluna file (multipart GraphQL no /v2/file). */
export async function anexarArquivo(
  itemId: number,
  columnId: string,
  arquivo: Blob | Buffer,
  nomeArquivo: string,
): Promise<string> {
  const query = `mutation($file:File!){ add_file_to_column(item_id:${itemId}, column_id:"${columnId}", file:$file){ id } }`
  const fd = new FormData()
  fd.append("query", query)
  fd.append("map", JSON.stringify({ image: "variables.file" }))
  const blob = arquivo instanceof Blob ? arquivo : new Blob([new Uint8Array(arquivo)])
  fd.append("image", blob, nomeArquivo)
  const r = await fetch(FILE_URL, {
    method: "POST",
    headers: { Authorization: token(), "API-Version": config.mondayApiVersion },
    body: fd,
  })
  const j = (await r.json()) as { data?: { add_file_to_column: { id: string } }; errors?: unknown }
  if (!r.ok || j.errors) throw erro(`Monday upload falhou (HTTP ${r.status})`, j.errors)
  return j.data!.add_file_to_column.id
}
