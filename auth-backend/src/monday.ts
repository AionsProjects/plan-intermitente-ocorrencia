import { config } from "./config.js"

// Helper minimo pra Monday API (GraphQL). Token so no backend (config.mondayToken).

export class ErroMonday extends Error {
  constructor(
    msg: string,
    public detalhe?: unknown,
  ) {
    super(msg)
    this.name = "ErroMonday"
  }
}

export async function mondayGraphql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!config.mondayToken) throw new ErroMonday("MONDAY_TOKEN ausente")
  const res = await fetch(config.mondayApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.mondayToken,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  })
  const data = (await res.json()) as { data?: T; errors?: unknown }
  if (!res.ok || data.errors) {
    throw new ErroMonday(`Monday API erro ${res.status}`, data.errors)
  }
  return data.data as T
}

export interface ColunaMonday {
  id: string
  title: string
  type: string
}

// Le as colunas (id+titulo+tipo) de um board.
export async function lerColunas(boardId: string): Promise<ColunaMonday[]> {
  const d = await mondayGraphql<{ boards: { columns: ColunaMonday[] }[] }>(
    `query($ids:[ID!]){ boards(ids:$ids){ columns{ id title type } } }`,
    { ids: [boardId] },
  )
  return d.boards?.[0]?.columns ?? []
}

// Le colunas com settings_str (pra extrair labels de status/dropdown).
export async function lerColunasSettings(
  boardId: string,
  columnIds: string[],
): Promise<{ id: string; title: string; settings_str: string }[]> {
  const d = await mondayGraphql<{
    boards: { columns: { id: string; title: string; settings_str: string }[] }[]
  }>(
    `query($ids:[ID!]){ boards(ids:$ids){ columns(ids:${JSON.stringify(columnIds)}){ id title settings_str } } }`,
    { ids: [boardId] },
  )
  return d.boards?.[0]?.columns ?? []
}

// Cria item num board/grupo com column_values (objeto -> JSON). Retorna id + url.
export async function createItem(
  boardId: string,
  itemName: string,
  columnValues: Record<string, unknown>,
  groupId?: string,
): Promise<{ id: string; url: string }> {
  const d = await mondayGraphql<{ create_item: { id: string } }>(
    `mutation($board:ID!,$group:String,$name:String!,$cols:JSON!){
       create_item(board_id:$board, group_id:$group, item_name:$name, column_values:$cols, create_labels_if_missing:true){ id }
     }`,
    { board: boardId, group: groupId ?? null, name: itemName, cols: JSON.stringify(columnValues) },
  )
  const id = d.create_item.id
  return { id, url: `https://contato-serv.monday.com/boards/${boardId}/pulses/${id}` }
}

// Upload de arquivo numa coluna file (POST /v2/file, multipart GraphQL).
export async function uploadFileToColumn(
  itemId: string,
  columnId: string,
  buffer: Buffer,
  filename: string,
  mime = "application/octet-stream",
): Promise<void> {
  if (!config.mondayToken) throw new ErroMonday("MONDAY_TOKEN ausente")
  const query =
    `mutation($file:File!){ add_file_to_column(item_id:${itemId}, column_id:"${columnId}", file:$file){ id } }`
  const fd = new FormData()
  fd.append("query", query)
  fd.append("map", JSON.stringify({ "0": ["variables.file"] }))
  fd.append("0", new Blob([buffer], { type: mime }), filename)
  const res = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: { Authorization: config.mondayToken },
    body: fd,
  })
  const j = (await res.json()) as { errors?: unknown }
  if (!res.ok || j.errors) throw new ErroMonday("upload Monday falhou", j.errors)
}

export interface WebhookMonday {
  id: string
  board_id: string
  config?: string
}

export async function listarWebhooks(boardId: string): Promise<WebhookMonday[]> {
  const d = await mondayGraphql<{ webhooks: WebhookMonday[] }>(
    `query($id:ID!){ webhooks(board_id:$id){ id board_id config } }`,
    { id: boardId },
  )
  return d.webhooks ?? []
}

export interface ItemMonday {
  id: string
  name: string
  column_values: { id: string; text: string | null; value: string | null }[]
}

// Le itens de um board (1 pagina; limit ate 500). Pra boards pequenos (feriados, valores).
// Pra boards grandes usar cursor (items_page.cursor) — futuro.
export async function lerItens(
  boardId: string,
  columnIds?: string[],
  limit = 500,
): Promise<ItemMonday[]> {
  const colsArg = columnIds && columnIds.length ? `(ids: ${JSON.stringify(columnIds)})` : ""
  const d = await mondayGraphql<{
    boards: { items_page: { items: ItemMonday[] } }[]
  }>(
    `query($ids:[ID!], $limit:Int!){
       boards(ids:$ids){ items_page(limit:$limit){ items{ id name column_values${colsArg}{ id text value } } } }
     }`,
    { ids: [boardId], limit },
  )
  return d.boards?.[0]?.items_page?.items ?? []
}

// Acha itens por valor exato de uma coluna (items_page_by_column_values). Eficiente
// pra lookup (protocolo, uuid) sem varrer o board todo.
export async function acharItensPorColuna(
  boardId: string,
  columnId: string,
  valor: string,
  colunasRetorno?: string[],
  limit = 10,
): Promise<ItemMonday[]> {
  const colsArg =
    colunasRetorno && colunasRetorno.length ? `(ids: ${JSON.stringify(colunasRetorno)})` : ""
  const d = await mondayGraphql<{
    items_page_by_column_values: { items: ItemMonday[] }
  }>(
    `query($board:ID!,$col:String!,$val:[String]!,$limit:Int!){
       items_page_by_column_values(board_id:$board, limit:$limit,
         columns:[{column_id:$col, column_values:$val}]){
         items{ id name column_values${colsArg}{ id text value } }
       }
     }`,
    { board: boardId, col: columnId, val: [valor], limit },
  )
  return d.items_page_by_column_values?.items ?? []
}

// Cria webhook change_column_value num board apontando pra url, restrito a uma coluna.
export async function criarWebhook(
  boardId: string,
  url: string,
  columnId: string,
): Promise<WebhookMonday> {
  const d = await mondayGraphql<{ create_webhook: WebhookMonday }>(
    `mutation($board:ID!,$url:String!,$cfg:JSON){
       create_webhook(board_id:$board, url:$url, event:change_column_value, config:$cfg){ id board_id }
     }`,
    { board: boardId, url, cfg: JSON.stringify({ columnId }) },
  )
  return d.create_webhook
}
