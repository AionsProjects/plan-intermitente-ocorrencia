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

/** Consulta SQL no RM (RealizaConsulta via ponte). Retorna o array de linhas. */
export async function consultarSql<T = Record<string, unknown>>(p: ConsultaParams): Promise<T[]> {
  const body = {
    ambiente: p.ambiente ?? "producao",
    solicitante: p.solicitante ?? "backend-pi",
    codigo_sql: p.codigoSql,
    codigo_sistema: p.codigoSistema ?? "P",
    codigo_coligada: p.codigoColigada ?? 3,
    parametros: { $CODCOLIGADA: p.codigoColigada ?? 3, ...(p.parametros ?? {}) },
  }
  const r = await post<unknown>("/consultar-rm", body)
  // a ponte pode devolver array direto ou { dados: [...] }
  if (Array.isArray(r)) return r as T[]
  const obj = r as { dados?: T[]; result?: T[]; rows?: T[] } | null
  return (obj?.dados ?? obj?.result ?? obj?.rows ?? []) as T[]
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
