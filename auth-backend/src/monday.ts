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
