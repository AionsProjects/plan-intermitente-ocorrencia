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
  /**
   * Id da execução que o front abriu (lib/atividade.ts). A rota que executar se ANEXA a
   * ele em vez de abrir outra — sem isso a ação gera DUAS linhas no histórico, uma do
   * front e uma da rota. O n8n ignora chave desconhecida, então mandar sempre é seguro.
   */
  execucaoId?: string | null,
): T & { operador: OperadorInfo | null } {
  const extra = execucaoId ? { execucao_id: execucaoId } : {}
  return { ...body, ...extra, operador: operadorAtual() }
}

// Anexa `operador` a um FormData (multipart) como campo JSON.
export function anexarOperador(fd: FormData, execucaoId?: string | null): FormData {
  fd.append("operador", JSON.stringify(operadorAtual()))
  // Campo, não chave de JSON: convocar e atestados vão por multipart. Mesmo papel do
  // `execucao_id` em `comOperador` — a rota se anexa à execução que o front abriu.
  if (execucaoId) fd.append("execucao_id", execucaoId)
  return fd
}

// ---------------------------------------------------------------------------
// Chaveamento do Plano de Fuga (contingência). Modo por processo vem de
// GET /api/rotas (pi.rotas_processo):
//  - n8n   : sempre VITE_N8N_BASE_URL. n8n é o executor (default histórico).
//  - api   : sempre /api. Sem rota de fuga.
//  - auto  : n8n PRIMÁRIO. LEITURA tenta n8n (timeout) e cai pro /api em rede/timeout/5xx;
//            ESCRITA cai pro /api somente em 404 (webhook ausente é prova; lentidão não é).
//  - escape: /api PRIMÁRIO — a premissa de docs/paridade ("o código é o principal").
//            LEITURA cai pro n8n em rede/timeout/5xx/404. ESCRITA fica só no /api e o erro
//            sobe pro operador: 5xx/timeout não provam que o backend não gravou, e repetir
//            no n8n duplicaria desconto e pagamento.
// Convenção espelho: a rota backend tem o MESMO path do webhook, sob /api.
// ---------------------------------------------------------------------------

const N8N_BASE = (import.meta.env.VITE_N8N_BASE_URL as string | undefined) ?? ""
const TIMEOUT_LEITURA_MS = 8000
const CACHE_FRESCOR_MS = 60_000
/**
 * Validade do mapa persistido. Sem teto, o cache do localStorage vira uma trava: com o
 * backend fora, um navegador já usado guarda `escape`/`api` pra sempre e insiste no /api
 * que não responde — justamente quando a fuga precisava valer. Expirado e sem backend, o
 * mapa volta a `{}` = tudo n8n, que é o pior caso seguro.
 */
const CACHE_VALIDADE_MS = 24 * 60 * 60 * 1000

type ModoRota = "n8n" | "auto" | "api" | "escape"
let rotasCache: { mapa: Record<string, string>; em: number } | null = null

async function mapaRotas(): Promise<Record<string, string>> {
  const agora = Date.now()
  if (rotasCache && agora - rotasCache.em < CACHE_FRESCOR_MS) return rotasCache.mapa
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
  // Backend não respondeu: cache velho serve, mas só dentro da validade (ver
  // CACHE_VALIDADE_MS). Fora dela, `{}` = tudo n8n.
  if (rotasCache && agora - rotasCache.em < CACHE_VALIDADE_MS) return rotasCache.mapa
  try {
    const raw = localStorage.getItem("pi_rotas")
    if (raw) {
      const p = JSON.parse(raw) as { mapa?: Record<string, string>; em?: number }
      if (p.em && agora - p.em < CACHE_VALIDADE_MS) return p.mapa ?? {}
      localStorage.removeItem("pi_rotas")
    }
  } catch {
    /* sem cache persistido */
  }
  return {} // default: tudo 'n8n' — nunca pior que hoje
}

function modoDe(mapa: Record<string, string>, processo: string): ModoRota {
  const global = mapa["*"]
  if (global === "api") return "api" // kill-switch
  const m = mapa[processo] ?? global ?? "n8n"
  return m === "auto" || m === "api" || m === "escape" ? m : "n8n"
}

// Sessão degradada = alguma chamada saiu do caminho normal (fuga acionada ou escrita que
// falhou no primário). O front mostra um aviso: fuga silenciosa é pior que fuga nenhuma,
// porque o operador conclui a tarefa achando que gravou no lugar de sempre.
let degradado = false
const ouvintesDegradado = new Set<() => void>()

export function sessaoDegradada(): boolean {
  return degradado
}

/** Assina mudanças pra `useSyncExternalStore`. Devolve a função de cancelar. */
export function assinarDegradado(fn: () => void): () => void {
  ouvintesDegradado.add(fn)
  return () => {
    ouvintesDegradado.delete(fn)
  }
}

function marcarDegradado(msg: string): void {
  console.warn(`[fuga] ${msg}`)
  if (degradado) return // só a primeira transição notifica
  degradado = true
  for (const fn of ouvintesDegradado) fn()
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

  // Sem n8n configurado (modo mock / build sem VITE_N8N_BASE_URL) não existe pra onde
  // fugir: todo modo colapsa em /api. Precisa vir antes dos ramos que montam urlN8n.
  if (modo === "api" || !N8N_BASE) {
    return fetch(urlApi, { ...init, credentials: "include" })
  }
  if (modo === "n8n") {
    return fetch(urlN8n, init)
  }

  if (modo === "escape") {
    if (opts.tipo === "escrita") {
      // Só /api, sempre. Repetir uma escrita no n8n porque o /api demorou ou devolveu 5xx
      // duplicaria o efeito (desconto lançado duas vezes, pedido Caju duplicado): a falha
      // não prova que o backend não gravou. O erro sobe, o operador vê, e a volta pro n8n
      // é o flip manual de `pi.rotas_processo` — decisão de gente, não de retry.
      try {
        const res = await fetch(urlApi, { ...init, credentials: "include" })
        if (res.status >= 500) {
          marcarDegradado(`escrita '${processo}' falhou no backend (${res.status})`)
        }
        return res
      } catch (e) {
        marcarDegradado(`escrita '${processo}' não alcançou o backend`)
        throw e
      }
    }
    // Leitura: /api com timeout; rede/timeout/5xx → n8n. Leitura é idempotente, então o
    // failover é seguro.
    //
    // ⚠️ 404 NÃO cai, ao contrário do modo `auto`. Lá o 404 vem do n8n e significa "webhook
    // desregistrado" — prova de WF desligado. Aqui vem do NOSSO backend, onde 404 é a
    // resposta de negócio normal (`intermitente-ler` com uuid inexistente, protocolo que
    // não existe). Tratar como queda mandaria o operador pro n8n e acenderia o aviso de
    // fuga em cima de um "não encontrado" legítimo — e rota que faltou no deploy tem que
    // ser barulhenta, não silenciosamente desviada pra regra velha.
    //
    // 401/403 idem: sessão expirada é problema de auth, e desviar mascararia o gate.
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), TIMEOUT_LEITURA_MS)
      const res = await fetch(urlApi, { ...init, credentials: "include", signal: ctl.signal })
      clearTimeout(t)
      if (res.status >= 500) throw new Error(`api ${res.status}`)
      return res
    } catch {
      marcarDegradado(`leitura '${processo}' caiu pro n8n (${path})`)
      return fetch(urlN8n, init)
    }
  }

  // Daqui pra baixo: modo 'auto' (n8n primário, backend como queda).
  if (opts.tipo === "escrita") {
    // Timeout/5xx/rede nao provam que o n8n deixou de executar; 404 sim.
    const res = await fetch(urlN8n, init)
    if (res.status === 404) {
      marcarDegradado(`escrita '${processo}' caiu pro backend (/api/${path})`)
      return fetch(urlApi, { ...init, credentials: "include" })
    }
    return res
  }
  // auto + leitura: tenta n8n com timeout; erro de rede/timeout/5xx/404 → backend.
  // (404 no host do n8n = webhook desregistrado = WF desligado → failover.)
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT_LEITURA_MS)
    const res = await fetch(urlN8n, { ...init, signal: ctl.signal })
    clearTimeout(t)
    if (res.status >= 500 || res.status === 404) throw new Error(`n8n ${res.status}`)
    return res
  } catch {
    marcarDegradado(`leitura '${processo}' caiu pro backend (/api/${path})`)
    return fetch(urlApi, { ...init, credentials: "include" })
  }
}
