// Avisa quando o backend devolve 401 numa chamada /api da própria aplicação.
//
// Por que existe: a sessão é um cookie que o navegador descarta no vencimento, mas a tela
// aberta continua parecendo logada (o /auth/me ficou em cache). O operador preenche tudo,
// clica em Convocar e leva um 401 cru — sem saber que é só entrar de novo. Esta camada
// transforma isso num sinal único; quem decide o que fazer (confirmar no /auth/me e abrir o
// diálogo de reentrada) é o AuthProvider.
//
// Um wrapper em `window.fetch` em vez de tratar em cada `api.ts`: são ~40 chamadas em 17
// arquivos, e a próxima que alguém escrever também tem que valer.

type Ouvinte = () => void

const ouvintes = new Set<Ouvinte>()
let instalado = false

/** Assina o sinal "uma chamada /api voltou 401". Devolve a função de cancelar. */
export function assinarSessaoRejeitada(fn: Ouvinte): () => void {
  ouvintes.add(fn)
  return () => {
    ouvintes.delete(fn)
  }
}

function ehApiDoApp(input: RequestInfo | URL): boolean {
  try {
    const bruto = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const u = new URL(bruto, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith("/api/")
  } catch {
    return false
  }
}

/** Idempotente. Chamar uma vez, antes de renderizar. */
export function instalarDeteccaoDeSessaoRejeitada(): void {
  if (instalado || typeof window === "undefined") return
  instalado = true
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const res = await original(input, init)
    // 401 sozinho não prova sessão caída (um proxy de upstream também pode devolvê-lo):
    // o ouvinte confirma no /auth/me antes de mostrar qualquer coisa.
    if (res.status === 401 && ehApiDoApp(input)) {
      for (const fn of ouvintes) fn()
    }
    return res
  }
}
