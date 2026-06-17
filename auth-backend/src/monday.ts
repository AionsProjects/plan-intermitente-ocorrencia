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
