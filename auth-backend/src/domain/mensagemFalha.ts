// Texto do alerta de falha no WhatsApp. Módulo PURO — nada de I/O, pra ser testável.
//
// Espelha domain/mensagemAlteracao.ts: negrito com *asteriscos* e **SEM EMOJI**
// (padrão pedido pelo dono do produto em 2026-08-04, vale pra frota).
import { limparTexto } from "./sanitizar.js"

export type OrigemAlerta = "execucao" | "job" | "workflow" | "abandonada"

export interface DadosFalha {
  execucaoId?: string | null
  origem: OrigemAlerta
  acao?: string | null
  /** Rótulo pt-BR da ação, já resolvido pelo chamador. */
  acaoLabel?: string | null
  etapa?: string | null
  etapaLabel?: string | null
  erro?: string | null
  pessoa?: string | null
  contrato?: string | null
  tentativa?: number | null
  maxTentativas?: number | null
  /** ISO. Formatado no fuso de Manaus — o servidor roda em UTC na Vercel. */
  quando?: string | null
  /** Id do evento pra ancorar no hash do link. */
  eventoId?: number | null
}

const FUSO = "America/Manaus"

/** `12/08 14:07` no fuso de Manaus. Sem isto a hora da mensagem não bate com a do log. */
export function quandoCurto(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO,
    }).replace(",", "")
  } catch {
    return ""
  }
}

/**
 * Deep link pra linha do log.
 *
 * ⚠️ O evento vai no HASH, não em query: hash não é enviado ao servidor nem aparece
 * nos logs da Vercel, e esta URL viaja por WhatsApp. Mesma disciplina de não pôr dado
 * pessoal em query string.
 */
export function linkExecucao(baseUrl: string, execucaoId: string, eventoId?: number | null): string {
  const base = baseUrl.replace(/\/$/, "")
  return `${base}/atividade?exec=${execucaoId}${eventoId ? `#e:${eventoId}` : ""}`
}

const TITULO_ORIGEM: Record<OrigemAlerta, string> = {
  execucao: "Falha na automação",
  job: "Falha na fila (esgotou as tentativas)",
  workflow: "Falha no pagamento mensal",
  abandonada: "Execução interrompida no meio",
}

/**
 * Uma falha, uma mensagem.
 *
 * Todo campo passa por `limparTexto` ANTES de entrar no corpo: o texto é gravado em
 * pi.alerta_falha e enviado pro WhatsApp, e o erro pode carregar `Bearer` ou CPF.
 */
export function mensagemFalha(d: DadosFalha, baseUrl: string): string {
  const l: string[] = []
  const titulo = TITULO_ORIGEM[d.origem]
  const acao = d.acaoLabel || d.acao
  l.push(`*${titulo}${acao ? ` — ${acao}` : ""}*`)

  const fase = d.etapaLabel || d.etapa
  if (fase) {
    const tent = d.tentativa && d.tentativa > 1
      ? ` (tentativa ${d.tentativa}${d.maxTentativas ? ` de ${d.maxTentativas}` : ""})`
      : ""
    l.push(`Fase: ${limparTexto(fase, 80)}${tent}`)
  }
  if (d.pessoa) {
    l.push(`Pessoa: ${limparTexto(d.pessoa, 80)}${d.contrato ? ` — ${limparTexto(d.contrato, 40)}` : ""}`)
  } else if (d.contrato) {
    l.push(`Contrato: ${limparTexto(d.contrato, 40)}`)
  }
  if (d.quando) l.push(`Quando: ${quandoCurto(d.quando)}`)
  if (d.erro) l.push(`Erro: ${limparTexto(d.erro, 240)}`)

  if (d.origem === "abandonada") {
    // Distinção que muda o que o DP faz: não houve erro, a execução parou de reportar.
    l.push("", "A execução abriu e nunca fechou — pode ter sido aba fechada no meio ou função encerrada antes do fim.")
  }
  if (d.execucaoId) l.push("", `Ver: ${linkExecucao(baseUrl, d.execucaoId, d.eventoId)}`)
  return l.join("\n")
}

/**
 * Mensagem única para N falhas — usada quando o fusível de mensagens/hora estoura.
 *
 * Avisa EXPLICITAMENTE que colapsou. A falha a evitar aqui é silêncio: um teto que
 * engole mensagens sem dizer que engoliu é pior que ruído.
 */
export function mensagemFalhaAgrupada(itens: DadosFalha[], baseUrl: string): string {
  const l: string[] = [`*${itens.length} falhas na automação na última hora*`]
  l.push("Muitas falhas de uma vez — as mensagens foram agrupadas.", "")
  // Agrupa por (ação, fase) e conta: trinta linhas idênticas não informam nada.
  const contagem = new Map<string, number>()
  for (const d of itens) {
    const k = `${d.acaoLabel || d.acao || "?"} · ${d.etapaLabel || d.etapa || "?"}`
    contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
    l.push(`${n}x ${k}`)
  }
  const primeiro = itens.find((d) => d.execucaoId)
  if (primeiro?.execucaoId) {
    l.push("", `Uma delas: ${linkExecucao(baseUrl, primeiro.execucaoId, primeiro.eventoId)}`)
  }
  l.push("", `Todas: ${baseUrl.replace(/\/$/, "")}/atividade?st=erro`)
  return l.join("\n")
}

/**
 * Assinatura de dedupe: `md5(acao|etapa|erro NORMALIZADO)` — o hash é feito por quem
 * chama; aqui fica a normalização, que é a parte que precisa de teste.
 *
 * Sem tirar dígitos, uuid e id de request, `HTTP 504 req-id abc` e `HTTP 504 req-id
 * def` viram assinaturas diferentes e o dedupe NUNCA dispara — que é exatamente o
 * cenário de tempestade que ele existe pra conter (RM fora do ar no mensal = uma falha
 * por contrato, mensagem igual).
 */
export function normalizarErro(erro: string | null | undefined): string {
  return String(erro ?? "")
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    // Token ALFANUMÉRICO misto (letra + dígito, 5+ chars) = id opaco: `aaa111`,
    // `req-9f2c`, `c03s003779`. `\b\d+\b` sozinho não pegava isso — `111` dentro de
    // `aaa111` não tem fronteira de palavra — e ids assim furavam o dedupe, que é
    // justamente o que ele existe pra conter.
    .replace(/\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9-]{5,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}
