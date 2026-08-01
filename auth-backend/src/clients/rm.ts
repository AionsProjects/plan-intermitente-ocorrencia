// Cliente da ponte AIONS RM (TOTVS) — substitui os nós HTTP "consultar-rm/enviar-rm"
// dos WFs. Header AIONS-AUTH. SEMPRE em lotes no chamador (ngrok derruba volume);
// aqui só o request unitário + retry/backoff. Writes (enviar-rm) são gated: o caller
// decide; este client só executa o POST.
import { config } from "../config.js"

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

async function post<T = unknown>(path: string, body: unknown, tentativas = 3): Promise<T> {
  let ultimo: unknown
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(base() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "AIONS-AUTH": config.rmAionsAuth },
        body: JSON.stringify(body),
      })
      const txt = await r.text()
      const json = txt ? safeJson(txt) : null
      if (!r.ok) throw erro(`RM ${path} HTTP ${r.status}`, r.status, json ?? txt.slice(0, 300))
      return json as T
    } catch (e) {
      ultimo = e
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
  const r = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } })
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
      console.warn(`[rm] direto falhou (${(e as Error).message}) — caindo pra ponte AIONS`)
    }
  }
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

/** SaveRecord no RM (escrita real — GATED no caller). dadosXml = SOAP body já montado. */
export async function enviarRm(
  dadosXml: string,
  opts?: { solicitante?: string; dataServer?: string; ambiente?: string; codigoColigada?: number },
): Promise<unknown> {
  return post("/enviar-rm", {
    ambiente: opts?.ambiente ?? "producao",
    solicitante: opts?.solicitante ?? "backend-pi-saverecord",
    data_server: opts?.dataServer ?? config.rmDataServer,
    codigo_sistema: "P",
    codigo_coligada: opts?.codigoColigada ?? 3,
    dados_xml: dadosXml,
  })
}

/** Executa um processo RM (escrita — GATED no caller). */
export async function executarProcesso(payload: Record<string, unknown>): Promise<unknown> {
  return post("/executar-processo-rm", payload)
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
