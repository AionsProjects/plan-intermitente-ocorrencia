import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { setOperadorProvider } from "@/lib/http"
import { temNivel, type Papel, type Usuario } from "@/features/auth/types"

type AuthValue = {
  usuario: Usuario | null
  carregando: boolean
  /** Inicia o SSO Google (popup). */
  login: () => void
  logout: () => Promise<void>
  /** Codigo de erro do ultimo login Google (ex: dominio_nao_permitido), ou null. */
  erroGoogle: string | null
  /** Usuario atinge o nivel minimo? (esconder UI so-DP, etc.) */
  podeVer: (nivelMinimo: Papel) => boolean
}

const AuthCtx = createContext<AuthValue | null>(null)

const QK = ["auth", "me"] as const

// Abre o SSO Google numa janela popup. Ao terminar, o callback do backend grava o
// resultado em localStorage (dispara 'storage' aqui). `aoConcluir(resultado)` recebe
// "ok" ou um codigo de erro (ex: "dominio_nao_permitido"); undefined se a popup so fechou.
function abrirLoginGoogle(aoConcluir: (resultado?: string) => void) {
  const largura = 480
  const altura = 640
  const esq = window.screenX + (window.outerWidth - largura) / 2
  const topo = window.screenY + (window.outerHeight - altura) / 2
  const popup = window.open(
    "/auth/google/login",
    "pi-google-login",
    `popup=yes,width=${largura},height=${altura},left=${esq},top=${topo}`,
  )
  // Popup bloqueada -> cai no fluxo de pagina inteira.
  if (!popup) {
    window.location.assign("/auth/google/login")
    return
  }
  const onMsg = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return
    const d = e.data as { tipo?: string; erro?: string; ok?: boolean } | null
    if (d?.tipo === "pi-auth") finalizar(d.erro ?? "ok")
  }
  // Sinal primario: o callback grava em localStorage -> dispara 'storage' aqui.
  // Valor = "resultado:timestamp" (resultado = "ok" ou codigo de erro).
  const onStorage = (e: StorageEvent) => {
    if (e.key !== "pi-auth-event" || !e.newValue) return
    finalizar(e.newValue.split(":")[0])
  }
  const timer = window.setInterval(() => {
    // popup.closed pode lancar por COOP do Google — ignora.
    let fechado = false
    try { fechado = popup.closed } catch { /* COOP */ }
    if (fechado) finalizar()
  }, 700)
  let feito = false
  function finalizar(resultado?: string) {
    if (feito) return
    feito = true
    window.clearInterval(timer)
    window.removeEventListener("message", onMsg)
    window.removeEventListener("storage", onStorage)
    aoConcluir(resultado)
  }
  window.addEventListener("message", onMsg)
  window.addEventListener("storage", onStorage)
}

// GET /auth/me (mesma origem, cookie de sessao). 401 -> sem usuario (nao e erro).
// Backend devolve snake_case -> mapeia pro tipo do front.
async function buscarUsuario(): Promise<Usuario | null> {
  const res = await fetch("/auth/me", { credentials: "same-origin" })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Erro ${res.status} ao carregar sessao`)
  const r = (await res.json()) as Record<string, unknown>
  return {
    id: String(r.id),
    email: String(r.email),
    nome: String(r.nome ?? ""),
    sobrenome: (r.sobrenome as string | null) ?? null,
    cpf: (r.cpf as string | null) ?? null,
    papel: r.papel as Usuario["papel"],
    ativo: Boolean(r.ativo),
    perfilCompleto: Boolean(r.perfil_completo),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [erroGoogle, setErroGoogle] = useState<string | null>(null)

  const { data: usuario = null, isLoading } = useQuery({
    queryKey: QK,
    queryFn: buscarUsuario,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const logoutMut = useMutation({
    mutationFn: async () => {
      await fetch("/auth/logout", { method: "POST", credentials: "same-origin" })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  })

  // Registra a identidade do operador pro helper http (injeta nos payloads do n8n).
  useEffect(() => {
    setOperadorProvider(() =>
      usuario
        ? { email: usuario.email, nome: usuario.nome, papel: usuario.papel }
        : null,
    )
    return () => setOperadorProvider(() => null)
  }, [usuario])

  const value = useMemo<AuthValue>(
    () => ({
      usuario,
      carregando: isLoading,
      erroGoogle,
      login: () => {
        setErroGoogle(null)
        abrirLoginGoogle((resultado) => {
          if (resultado && resultado !== "ok") setErroGoogle(resultado)
          else qc.invalidateQueries({ queryKey: ["auth"] })
        })
      },
      logout: async () => {
        await logoutMut.mutateAsync()
      },
      podeVer: (nivelMinimo: Papel) =>
        !!usuario && temNivel(usuario.papel, nivelMinimo),
    }),
    [usuario, isLoading, erroGoogle, logoutMut],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx)
  if (!v) throw new Error("useAuth fora do AuthProvider")
  return v
}
