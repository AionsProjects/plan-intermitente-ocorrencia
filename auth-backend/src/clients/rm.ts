// Cliente da ponte AIONS RM (TOTVS) — substitui os nós HTTP "consultar-rm/enviar-rm"
// dos WFs. Header AIONS-AUTH. SEMPRE em lotes no chamador (ngrok derruba volume);
// aqui só o request unitário + retry/backoff. Writes (enviar-rm) são gated: o caller
// decide; este client só executa o POST.
import { config } from "../config.js"
import {
  contextoDataServer,
  executeWithXmlParamsDireto,
  saveRecordDireto,
  temRmSoap,
  type RmSoapError,
} from "./rmSoap.js"

export interface RmError extends Error {
  rm: true
  status?: number
  detalhe?: unknown
}

function erro(msg: string, status?: number, detalhe?: unknown): RmError {
  const e = new Error(msg) as RmError
  e.rm = true
  e.status = status
  e.detalhe = detalhe
  return e
}

function base(): string {
  if (!config.rmBridgeUrl) throw erro("RM_BRIDGE_URL ausente no .env")
  return config.rmBridgeUrl.replace(/\/$/, "")
}

// Timeout da ponte. Sem isto, uma ponte pendurada (lenta, sem recusar) prendia a função até a
// plataforma matá-la — SEM exceção, então nenhum `catch` rodava e o efeito ficava `pendente` no
// ledger para sempre. Foi o que produziu os dois `efeito_pendente_requer_conciliacao:rm_integrar`
// de 31/08/2026 (ANGELA e ALCINEI): reserva feita, `integrarIdfinanc` pendurado, morte silenciosa,
// e o retry do workflow batendo na guarda. O caminho SOAP direto já tinha timeout; a ponte não.
const TIMEOUT_PONTE_LEITURA_MS = 30_000
const TIMEOUT_PONTE_ESCRITA_MS = 120_000

/** Só `/consultar-rm` lê; todo o resto executa processo, envia registro ou apaga. */
export function ehLeituraPonte(path: string): boolean {
  return path === "/consultar-rm"
}

/** AbortSignal.timeout dispara TimeoutError; rede lenta também pode vir como AbortError. */
export function ehTimeout(e: unknown): boolean {
  const nome = (e as { name?: string } | null)?.name ?? ""
  return nome === "TimeoutError" || nome === "AbortError"
}

/**
 * Repetir depois de um timeout é seguro na LEITURA e proibido na ESCRITA — o `AbortSignal` corta
 * o nosso lado, não o do RM, então o processo pode ter executado. Repetir ali duplicaria histórico
 * ou lançamento financeiro. É a mesma assimetria que `seguroCairPraPonte` aplica ao fallback.
 */
export function podeRepetirAposFalha(path: string, e: unknown): boolean {
  return ehLeituraPonte(path) || !ehTimeout(e)
}

async function post<T = unknown>(path: string, body: unknown, tentativas = 3): Promise<T> {
  const timeoutMs = ehLeituraPonte(path) ? TIMEOUT_PONTE_LEITURA_MS : TIMEOUT_PONTE_ESCRITA_MS
  let ultimo: unknown
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(base() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "AIONS-AUTH": config.rmAionsAuth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const txt = await r.text()
      const json = txt ? safeJson(txt) : null
      if (!r.ok) throw erro(`RM ${path} HTTP ${r.status}`, r.status, json ?? txt.slice(0, 300))
      return json as T
    } catch (e) {
      // Mensagem própria: "TimeoutError: signal timed out" não diz nem a rota nem o tempo, e é
      // exatamente a linha que faltava para diagnosticar a morte silenciosa.
      ultimo = ehTimeout(e)
        ? erro(`RM ${path} timeout apos ${timeoutMs}ms — desfecho DESCONHECIDO no RM`)
        : e
      if (!podeRepetirAposFalha(path, e)) break
      if (i < tentativas - 1) await sleep(800 * (i + 1)) // backoff linear
    }
  }
  throw ultimo instanceof Error ? ultimo : erro(`RM ${path} falhou`)
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface ConsultaParams {
  codigoSql: string // ex "BEN 2"
  parametros?: Record<string, unknown>
  ambiente?: string // default producao
  solicitante?: string
  codigoSistema?: string // default P
  codigoColigada?: number // default 3
  /**
   * Proíbe a queda pra ponte AIONS: direto ou erro.
   *
   * Para quem trata LISTA VAZIA como fato de negócio, a ponte é perigosa — ela responde 200 com
   * shape que o parser não reconhece e vira `[]` (ver `consultar`), e aí "o RM está instável"
   * fica indistinguível de "não há nada". Na leitura de atestado isso significa gravar um S-2260
   * por cima de dia coberto, em silêncio. Não adiciona dependência nova: quem lê atestado pra
   * convocar já precisa do RM direto pra gravar.
   */
  semPonte?: boolean
}

// ---------------------------------------------------------------------------
// RM DIRETO (sem ponte) — API consultaSQLServer/RealizaConsulta, Basic Auth.
// SÓ LEITURA: a API REST do RM não cobre SaveRecord/processos, então enviarRm(),
// executarProcesso() e deletarRm() continuam pela ponte AIONS.
// Medido em 01/08/2026 (mesma consulta, mesmas linhas, 1a linha idêntica):
//   BEN 2  889ms direto x 4145ms ponte | IDFINAN 380ms x 920ms | MONK23 1153ms x 1386ms
// ---------------------------------------------------------------------------

function temRmDireto(): boolean {
  return !!(config.rmDiretoUrl && config.rmDiretoUser && config.rmDiretoPass)
}

/** `?parameters=CHAVE%3Dvalor%3BCHAVE2%3Dvalor2` — `=` e `;` ficam encodados, como a doc exige. */
function queryParametros(parametros: Record<string, unknown>): string {
  return Object.entries(parametros)
    .map(([k, v]) => `${encodeURIComponent(k)}%3D${encodeURIComponent(String(v))}`)
    .join("%3B")
}

async function consultarDireto<T>(
  codigoSql: string,
  coligadaUrl: number,
  sistema: string,
  parametros: Record<string, unknown>,
): Promise<T[]> {
  const base = config.rmDiretoUrl.replace(/\/$/, "")
  const url =
    `${base}/api/framework/v1/consultaSQLServer/RealizaConsulta/` +
    `${encodeURIComponent(codigoSql)}/${coligadaUrl}/${sistema}/?parameters=${queryParametros(parametros)}`
  const auth = Buffer.from(`${config.rmDiretoUser}:${config.rmDiretoPass}`).toString("base64")
  // Timeout explícito: um RM pendurado (lento, sem recusar) não tem nada que o interrompa,
  // e sem isso a leitura ficaria presa em vez de cair pro fallback.
  const r = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
  const txt = await r.text()
  if (!r.ok) throw erro(`RM direto ${codigoSql} HTTP ${r.status}`, r.status, txt.slice(0, 300))
  const j = safeJson(txt)
  // Sucesso sem registros vem como []; qualquer outra coisa é resposta inesperada.
  if (!Array.isArray(j)) throw erro(`RM direto ${codigoSql}: resposta nao-array`, r.status, txt.slice(0, 300))
  return j as T[]
}

/**
 * Consulta SQL no RM. Tenta DIRETO (rápido, sem ngrok) e cai pra ponte AIONS se falhar —
 * a ponte segue como rota de fuga, não como caminho principal.
 */
async function consultar<T>(p: ConsultaParams, parametros: Record<string, unknown>): Promise<T[]> {
  const coligada = p.codigoColigada ?? 3
  const sistema = p.codigoSistema ?? "P"
  if (temRmDireto()) {
    try {
      return await consultarDireto<T>(p.codigoSql, coligada, sistema, parametros)
    } catch (e) {
      // `semPonte` propaga o erro: pra quem lê lista vazia como fato de negócio, cair pra ponte
      // troca uma falha visível por um `[]` que mente.
      if (p.semPonte) throw e
      console.warn(`[rm] direto falhou (${(e as Error).message}) — caindo pra ponte AIONS`)
    }
  }
  if (p.semPonte) throw new Error(`rm: ${p.codigoSql} exige RM direto (RM_DIRETO_* nao configurado)`)
  const r = await post<unknown>("/consultar-rm", {
    ambiente: p.ambiente ?? "producao",
    solicitante: p.solicitante ?? "backend-pi",
    codigo_sql: p.codigoSql,
    codigo_sistema: sistema,
    codigo_coligada: coligada,
    parametros,
  })
  // a ponte pode devolver array direto ou { dados: [...] }
  if (Array.isArray(r)) return r as T[]
  const obj = r as { dados?: T[]; result?: T[]; rows?: T[] } | null
  return (obj?.dados ?? obj?.result ?? obj?.rows ?? []) as T[]
}

/** Consulta SQL no RM (RealizaConsulta). Injeta `$CODCOLIGADA`. Retorna o array de linhas. */
export async function consultarSql<T = Record<string, unknown>>(p: ConsultaParams): Promise<T[]> {
  return consultar<T>(p, { $CODCOLIGADA: p.codigoColigada ?? 3, ...(p.parametros ?? {}) })
}

// ---------------------------------------------------------------------------
// ESCRITA — política ASSIMÉTRICA em relação à leitura.
// Na leitura, cair pra ponte custa segundos. Na escrita, cair pra ponte depois de um timeout
// duplica histórico ou lançamento financeiro: o AbortSignal corta o nosso lado, não o do RM.
// Por isso só voltamos pra ponte quando o erro PROVA que nada executou (DNS/conexão/401/403/404).
// ---------------------------------------------------------------------------

/** `dry_run` e `ambiente != producao` só existem na ponte — nunca podem ir pro direto. */
function podeEscreverDireto(ambiente: string | undefined, dryRun: boolean): boolean {
  if (dryRun) return false
  if ((ambiente ?? "producao") !== "producao") return false
  return config.rmEscritaDireta && temRmSoap()
}

/** true = o erro prova que o RM não executou nada -> a ponte pode tentar sem duplicar. */
function seguroCairPraPonte(e: unknown): boolean {
  const s = e as RmSoapError
  return !!s?.rmSoap && s.indeterminado !== true
}

/** SaveRecord no RM (escrita real — GATED no caller). dadosXml = payload de negócio. */
export async function enviarRm(
  dadosXml: string,
  opts?: { solicitante?: string; dataServer?: string; ambiente?: string; codigoColigada?: number; dryRun?: boolean },
): Promise<unknown> {
  const ambiente = opts?.ambiente ?? "producao"
  const dataServer = opts?.dataServer ?? config.rmDataServer
  const coligada = opts?.codigoColigada ?? 3
  if (podeEscreverDireto(ambiente, opts?.dryRun === true)) {
    try {
      const { chave } = await saveRecordDireto(dataServer, dadosXml, contextoDataServer(coligada))
      return { via: "direto", chave }
    } catch (e) {
      if (!seguroCairPraPonte(e)) throw e
      console.warn(`[rm] SaveRecord direto falhou antes do RM (${(e as Error).message}) — caindo pra ponte`)
    }
  }
  return post("/enviar-rm", {
    ambiente,
    solicitante: opts?.solicitante ?? "backend-pi-saverecord",
    data_server: dataServer,
    codigo_sistema: "P",
    codigo_coligada: coligada,
    dados_xml: dadosXml,
  }, 1) // escrita não repete sozinha (ver acima)
}

/** Executa um processo RM (escrita — GATED no caller). O envelope vem pronto em `soap_xml`. */
export async function executarProcesso(payload: Record<string, unknown>): Promise<unknown> {
  const soapXml = typeof payload.soap_xml === "string" ? payload.soap_xml : ""
  if (soapXml && podeEscreverDireto(payload.ambiente as string | undefined, payload.dry_run === true)) {
    try {
      const { resultado } = await executeWithXmlParamsDireto(soapXml)
      return { via: "direto", resultado }
    } catch (e) {
      if (!seguroCairPraPonte(e)) throw e
      console.warn(`[rm] processo direto falhou antes do RM (${(e as Error).message}) — caindo pra ponte`)
    }
  }
  return post("/executar-processo-rm", payload, 1)
}

/** Consulta SQL com parâmetros EXATOS (sem injeção de $CODCOLIGADA) — paridade com nós n8n
 *  que passam chaves sem prefixo (ex: IDFNAN usa CODCOLIGADA/CODSECAO/DATAEMISSAO). */
export async function consultarSqlBruto<T = Record<string, unknown>>(p: ConsultaParams): Promise<T[]> {
  return consultar<T>(p, p.parametros ?? {})
}

/** Deleta registro RM (escrita — GATED no caller). */
export async function deletarRm(payload: Record<string, unknown>): Promise<unknown> {
  return post("/deletar-rm", payload)
}

/** Healthcheck da ponte. Read-only. */
export async function health(): Promise<{ ok: boolean; status?: unknown }> {
  try {
    const r = await fetch(base() + "/health", { headers: { "AIONS-AUTH": config.rmAionsAuth } })
    const j = await r.json().catch(() => null)
    return { ok: r.ok, status: j }
  } catch (e) {
    return { ok: false, status: (e as Error).message }
  }
}
