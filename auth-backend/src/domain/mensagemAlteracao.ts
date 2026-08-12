// Monta a mensagem de WhatsApp de uma (ou N) alterações do board do Plano.
// Puro: recebe alterações já classificadas e devolve texto.
//
// Estilo herdado do WF "Notificar Advertência 4 em 3 meses": **sem emoji**
// (pedido do dono do produto em 2026-08-04), negrito do WhatsApp com *asteriscos*.
import type { AlteracaoClassificada, Origem } from "./alteracaoBoard.js"

export interface ContextoMensagem {
  competencia: string // 'YYYY-MM'
  /** Base do Monday. monday.com redireciona pro slug da conta de quem está logado. */
  baseMonday?: string
}

/** '2026-08' -> '08/26'. Mesmo formato do nome do board ("08/26 - Plan. de Intermitente - Contato"). */
export function competenciaCurta(c: string): string {
  const [ano, mes] = c.split("-")
  return `${mes}/${String(ano).slice(-2)}`
}

/** Cabeçalho único das mensagens. */
function titulo(competencia: string): string {
  return `*Alteração no Plan de Intermitente ${competenciaCurta(competencia)}*`
}

function dataHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const PARTICULAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"])

/**
 * `operador_nome` vem com sobrenome repetido do cadastro — "THALLISON GOMES SOUZA
 * SOUZA", "KARINE ROMASKEVIS DE OLIVEIRA ROMASKEVIS", "ISAAC ... GOMES Gomes".
 * Remove repetição de palavra (partículas podem repetir), preservando a 1ª ocorrência.
 * Só exibição — o dado na origem continua torto.
 */
export function nomeLimpo(nome: string | null | undefined): string | null {
  const bruto = String(nome ?? "").trim()
  if (!bruto) return null
  const vistos = new Set<string>()
  const out: string[] = []
  for (const palavra of bruto.split(/\s+/)) {
    const chave = palavra.toUpperCase()
    if (PARTICULAS.has(chave)) {
      out.push(palavra)
      continue
    }
    if (vistos.has(chave)) continue
    vistos.add(chave)
    out.push(palavra)
  }
  return out.join(" ")
}

function urlItem(a: AlteracaoClassificada, base: string): string | null {
  if (!a.boardId || !a.itemId) return null
  return `${base}/boards/${a.boardId}/pulses/${a.itemId}`
}

/** Linha de autoria + o aviso que a origem exige. */
export function linhaAutoria(a: AlteracaoClassificada): string {
  const quando = dataHora(a.ocorridoEm)
  const nome = nomeLimpo(a.operadorNome)
  switch (a.origem) {
    case "app":
      return `Por ${nome ?? "operador não identificado"} (pelo app), ${quando}`
    case "monday_direto":
    case "dp_direto":
      return `Por ${nomeLimpo(a.autorNome) ?? `usuário ${a.autorId}`}, ${quando}`
    case "api_inexplicada":
      return `Por integração (sem registro no app), ${quando}`
    default:
      return `${quando}`
  }
}

const AVISO: Partial<Record<Origem, string>> = {
  monday_direto: "*Atenção:* alteração feita direto no Monday, por fora do app.",
  api_inexplicada: "*Atenção:* escrita de API sem registro no app. Investigar.",
}

function descreve(a: AlteracaoClassificada): string {
  const alvo = a.colunaTitulo && a.colunaTitulo !== "Name" ? `${a.colunaTitulo}: ` : ""
  return `${alvo}${a.resumo ?? "(sem detalhe)"}`
}

// ---------------------------------------------------------------------------

/** Mensagem de UMA alteração (modo `imediato` — 1 msg por alteração). */
export function mensagemUnica(a: AlteracaoClassificada, ctx: ContextoMensagem): string {
  const base = ctx.baseMonday ?? "https://monday.com"
  const linhas = [
    titulo(ctx.competencia),
    "",
    `*${a.itemNome ?? `item ${a.itemId ?? "?"}`}*`,
    descreve(a),
    "",
    linhaAutoria(a),
  ]
  const aviso = AVISO[a.origem]
  if (aviso) linhas.push("", aviso)
  const url = urlItem(a, base)
  if (url) linhas.push("", url)
  return linhas.join("\n")
}

/**
 * Mensagem agrupada (modo `digest`, ou quando o fusível de teto_msgs_hora estoura).
 * Agrupa por item pra não repetir o nome da pessoa a cada coluna — uma convocação
 * mexe em ~12 colunas de uma vez.
 */
export function mensagemAgrupada(
  alteracoes: AlteracaoClassificada[],
  ctx: ContextoMensagem,
  opts: { colapsada?: boolean; janelaMin?: number } = {},
): string {
  if (alteracoes.length === 1) return mensagemUnica(alteracoes[0]!, ctx)
  const base = ctx.baseMonday ?? "https://monday.com"

  const porItem = new Map<string, AlteracaoClassificada[]>()
  for (const a of alteracoes) {
    const k = String(a.itemId ?? a.itemNome ?? "?")
    if (!porItem.has(k)) porItem.set(k, [])
    porItem.get(k)!.push(a)
  }

  const linhas = [
    titulo(ctx.competencia),
    `${alteracoes.length} alterações em ${porItem.size} item(ns)`,
  ]
  if (opts.colapsada) {
    linhas.push(
      "",
      `*Atenção:* volume alto${opts.janelaMin ? ` nos últimos ${opts.janelaMin} min` : ""}. Mensagens agrupadas para não inundar o grupo.`,
    )
  }

  for (const [, lista] of porItem) {
    const primeira = lista[0]!
    linhas.push("", `*${primeira.itemNome ?? `item ${primeira.itemId ?? "?"}`}*`)
    for (const a of lista) linhas.push(`- ${descreve(a)}`)
    linhas.push(linhaAutoria(primeira))
    const aviso = AVISO[primeira.origem]
    if (aviso) linhas.push(aviso)
    const url = urlItem(primeira, base)
    if (url) linhas.push(url)
  }

  return linhas.join("\n")
}
