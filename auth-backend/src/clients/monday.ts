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
