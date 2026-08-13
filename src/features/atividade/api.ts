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

/**
 * Marca (ou desmarca) um erro como visto/tratado. Não conserta nem apaga nada — só tira da
 * contagem que pede atenção, pra falha antiga já resolvida não empatar com quebra nova.
 */
export async function reconhecerErro(
  id: string,
  opts: { nota?: string; desfazer?: boolean } = {},
): Promise<{ reconhecido_em: string | null; por: string | null }> {
  const res = await fetch(`/api/atividade/${encodeURIComponent(id)}/reconhecer`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as { erro?: string }
    throw new AtividadeApiError(res.status, corpo.erro ?? `erro_${res.status}`)
  }
  return (await res.json()) as { reconhecido_em: string | null; por: string | null }
}

export type PeriodoRelatorio = "diario" | "semanal" | "mensal" | "personalizado"

/**
 * Baixa o relatório XLSX e dispara o download no navegador.
 *
 * O escopo é decidido no SERVIDOR: OP recebe o próprio relatório mesmo mandando
 * `todos=1`. O nome do arquivo vem do Content-Disposition pra bater com o que o
 * backend gerou (período nas duas pontas).
 */
export async function baixarRelatorio(opts: {
  periodo: PeriodoRelatorio
  de?: string
  ate?: string
  todos: boolean
}): Promise<void> {
  const p = new URLSearchParams({ periodo: opts.periodo })
  if (opts.periodo === "personalizado") {
    p.set("de", opts.de ?? "")
    p.set("ate", opts.ate ?? "")
  }
  if (opts.todos) p.set("todos", "1")
  const res = await fetch(`/api/atividade/relatorio?${p}`, { credentials: "same-origin" })
  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as { erro?: string }
    throw new AtividadeApiError(res.status, corpo.erro ?? `erro_${res.status}`)
  }
  const blob = await res.blob()
  const nome =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
    "relatorio-atividade.pdf"
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke adiado: revogar síncrono cancela o download em WebView de celular.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
