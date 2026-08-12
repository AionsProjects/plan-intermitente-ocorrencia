import type { DetalheExecucao, ListaAtividade } from "./types"

// Chama /api direto (fetch), não `chamarProcesso`: o histórico é do backend por
// natureza — não existe espelho no n8n pra rotear.

async function pegar<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" })
  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as { erro?: string }
    throw new AtividadeApiError(res.status, corpo.erro ?? `erro_${res.status}`)
  }
  return (await res.json()) as T
}

// Sem parameter properties: `erasableSyntaxOnly` está ligado no tsconfig, e
// atribuição no construtor é o padrão das outras classes de erro do projeto
// (ConvocacaoApiError em features/convocar/api.ts).
export class AtividadeApiError extends Error {
  status: number
  erro: string

  constructor(status: number, erro: string) {
    super(erro)
    this.name = "AtividadeApiError"
    this.status = status
    this.erro = erro
  }
}

export function listarAtividade(todos: boolean): Promise<ListaAtividade> {
  return pegar<ListaAtividade>(`/api/atividade${todos ? "?todos=1" : ""}`)
}

export function buscarDetalheExecucao(id: string): Promise<DetalheExecucao> {
  return pegar<DetalheExecucao>(`/api/atividade/${encodeURIComponent(id)}`)
}
