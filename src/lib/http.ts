// Helper compartilhado pras chamadas ao n8n + identidade do operador.
//
// Identidade vem de um GETTER registrado pelo AuthProvider (setOperadorProvider),
// evitando import circular — este modulo nao depende do React.
//
// O campo `operador` e injetado nos payloads de escrita. O n8n IGNORA chaves
// desconhecidas, entao isso NAO quebra os WFs atuais; a identidade so passa a ser
// usada quando os WFs forem fiados (fora do escopo desta etapa). Em rotas publicas
// (/preencher/:uuid, /descontos/:uuid) o usuario pode nao estar logado -> operador null.

export interface OperadorInfo {
  email: string
  nome: string
  papel: string
}

let operadorProvider: () => OperadorInfo | null = () => null

export function setOperadorProvider(fn: () => OperadorInfo | null): void {
  operadorProvider = fn
}

export function operadorAtual(): OperadorInfo | null {
  return operadorProvider()
}

// Anexa `operador` a um corpo JSON sem mutar o original.
export function comOperador<T extends object>(
  body: T,
): T & { operador: OperadorInfo | null } {
  return { ...body, operador: operadorAtual() }
}

// Anexa `operador` a um FormData (multipart) como campo JSON.
export function anexarOperador(fd: FormData): FormData {
  fd.append("operador", JSON.stringify(operadorAtual()))
  return fd
}

// ---------------------------------------------------------------------------
// Chaveamento do Plano de Fuga (contingência): n8n PRIMÁRIO; backend = rota de fuga.
// Modo por processo vem de GET /api/rotas (pi.rotas_processo): 'n8n' | 'auto' | 'api'.
//  - n8n : sempre VITE_N8N_BASE_URL (comportamento de hoje; default).
//  - api : sempre /api (flip manual de contingência; leitura E escrita).
//  - auto: LEITURA tenta n8n (timeout) e cai pro /api em erro de rede/timeout/5xx.
//          ESCRITA em auto = só n8n (timeout ≠ não-executou; retry duplicaria).
// Convenção espelho: a rota backend tem o MESMO path do webhook, sob /api.
// ---------------------------------------------------------------------------

const N8N_BASE = (import.meta.env.VITE_N8N_BASE_URL as string | undefined) ?? ""
const TIMEOUT_LEITURA_MS = 8000

type ModoRota = "n8n" | "auto" | "api"
let rotasCache: { mapa: Record<string, string>; em: number } | null = null

async function mapaRotas(): Promise<Record<string, string>> {
  const agora = Date.now()
  if (rotasCache && agora - rotasCache.em < 60_000) return rotasCache.mapa
  try {
    const res = await fetch("/api/rotas", { credentials: "include" })
    if (res.ok) {
      const j = (await res.json()) as { rotas?: Record<string, string> }
      rotasCache = { mapa: j.rotas ?? {}, em: agora }
      try {
        localStorage.setItem("pi_rotas", JSON.stringify(rotasCache))
      } catch {
        /* storage cheio/indisponível: cache só em memória */
      }
      return rotasCache.mapa
    }
  } catch {
    /* backend fora — cai pro cache/persistido abaixo */
  }
  if (rotasCache) return rotasCache.mapa
  try {
    const raw = localStorage.getItem("pi_rotas")
    if (raw) return (JSON.parse(raw) as { mapa: Record<string, string> }).mapa ?? {}
  } catch {
    /* sem cache persistido */
  }
  return {} // default: tudo 'n8n' — nunca pior que hoje
}

function modoDe(mapa: Record<string, string>, processo: string): ModoRota {
  const global = mapa["*"]
  if (global === "api") return "api" // kill-switch
  const m = mapa[processo] ?? global ?? "n8n"
  return m === "auto" || m === "api" ? m : "n8n"
}

let degradado = false
export function sessaoDegradada(): boolean {
  return degradado
}

// Chama um processo respeitando o modo. `path` = nome do webhook (ex: "intermitente-ler?uuid=x").
// A rota espelho do backend vive em /api/<mesmo path>.
export async function chamarProcesso(
  processo: string,
  path: string,
  init: RequestInit = {},
  opts: { tipo: "leitura" | "escrita" } = { tipo: "leitura" },
): Promise<Response> {
  const mapa = await mapaRotas()
  const modo = modoDe(mapa, processo)
  const urlN8n = `${N8N_BASE}/${path}`
  const urlApi = `/api/${path}`

  if (modo === "api" || !N8N_BASE) {
    return fetch(urlApi, { ...init, credentials: "include" })
  }
  if (modo === "n8n" || opts.tipo === "escrita") {
    // escrita NUNCA faz failover automático — timeout não prova que o n8n não executou.
    return fetch(urlN8n, init)
  }
  // auto + leitura: tenta n8n com timeout; erro de rede/timeout/5xx → backend.
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT_LEITURA_MS)
    const res = await fetch(urlN8n, { ...init, signal: ctl.signal })
    clearTimeout(t)
    if (res.status >= 500) throw new Error(`n8n ${res.status}`)
    return res
  } catch {
    degradado = true
    console.warn(`[fuga] leitura '${processo}' caiu pro backend (/api/${path})`)
    return fetch(urlApi, { ...init, credentials: "include" })
  }
}
