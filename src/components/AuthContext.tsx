import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SessaoExpiradaDialog } from "@/components/SessaoExpiradaDialog"
import { setOperadorProvider } from "@/lib/http"
import { assinarSessaoRejeitada } from "@/lib/sessaoRejeitada"
import { proximaUrlSegura } from "@/lib/proximaUrl"
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
//
// `semRedirecionar`: se a popup for bloqueada, NÃO cai no login de página inteira — isso
// descartaria a tela atual (o diálogo de sessão expirada existe justamente pra não perder
// o que foi preenchido). Nesse caso conclui com "popup_bloqueado".
function abrirLoginGoogle(
  aoConcluir: (resultado?: string) => void,
  opcoes: { semRedirecionar?: boolean } = {},
) {
  const largura = 480
  const altura = 640
  const esq = window.screenX + (window.outerWidth - largura) / 2
  const topo = window.screenY + (window.outerHeight - altura) / 2
  // Repassa o `?next=` da tela de login ao backend, que o guarda num cookie httpOnly
  // pelo round-trip do Google. No caminho de POPUP isto é redundante (a janela-mãe
  // continua em /login?next=… e navega quando o /auth/me atualiza); é o caminho de
  // PÁGINA INTEIRA que precisa — e é o do celular, onde o link do alerta é aberto.
  const next = proximaUrlSegura(new URLSearchParams(window.location.search).get("next"))
  const url = `/auth/google/login${next ? `?next=${encodeURIComponent(next)}` : ""}`
  const popup = window.open(
    url,
    "pi-google-login",
    `popup=yes,width=${largura},height=${altura},left=${esq},top=${topo}`,
  )
  // Popup bloqueada -> cai no fluxo de pagina inteira.
  if (!popup) {
    if (opcoes.semRedirecionar) {
      aoConcluir("popup_bloqueado")
      return
    }
    window.location.assign(url)
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
  // Tela aberta que parece logada, mas o cookie de sessão venceu/sumiu (ver sessaoRejeitada.ts).
  const [sessaoExpirada, setSessaoExpirada] = useState(false)

  const { data: usuario = null, isLoading } = useQuery({
    queryKey: QK,
    queryFn: buscarUsuario,
    staleTime: 5 * 60_000,
    retry: false,
  })

  // Um 401 em /api só vira diálogo se (1) a tela se acha logada — em rota pública sem login
  // o 401 é esperado — e (2) o /auth/me confirma. Rajadas de 401 (a tela dispara várias
  // chamadas) colapsam numa verificação só.
  const usuarioRef = useRef(usuario)
  useEffect(() => {
    usuarioRef.current = usuario
  }, [usuario])
  const verificandoRef = useRef(false)
  useEffect(() => {
    return assinarSessaoRejeitada(() => {
      if (!usuarioRef.current || verificandoRef.current) return
      verificandoRef.current = true
      fetch("/auth/me", { credentials: "same-origin" })
        .then((res) => {
          if (res.status === 401) setSessaoExpirada(true)
        })
        .catch(() => {
          /* sem rede: não dá pra afirmar que a sessão caiu */
        })
        .finally(() => {
          verificandoRef.current = false
        })
    })
  }, [])

  // Voltou a ter sessão (login em outra aba ou na popup)? Fecha o diálogo e atualiza o
  // usuário — pode ser outra pessoa que entrou. Não toca na query enquanto a sessão
  // continua morta: um /auth/me nulo ali faria o RequireAuth jogar a pessoa pro /login.
  const sessaoVoltou = useCallback(async () => {
    try {
      const res = await fetch("/auth/me", { credentials: "same-origin" })
      if (!res.ok) return
      await qc.invalidateQueries({ queryKey: QK })
      setSessaoExpirada(false)
    } catch {
      /* segue com o diálogo aberto */
    }
  }, [qc])

  useEffect(() => {
    if (!sessaoExpirada) return
    const aoVoltarPraAba = () => {
      if (document.visibilityState === "visible") void sessaoVoltou()
    }
    window.addEventListener("focus", aoVoltarPraAba)
    document.addEventListener("visibilitychange", aoVoltarPraAba)
    return () => {
      window.removeEventListener("focus", aoVoltarPraAba)
      document.removeEventListener("visibilitychange", aoVoltarPraAba)
    }
  }, [sessaoExpirada, sessaoVoltou])

  const reentrarComGoogle = useCallback(() => {
    setErroGoogle(null)
    abrirLoginGoogle(
      (resultado) => {
        if (resultado && resultado !== "ok") setErroGoogle(resultado)
        else void sessaoVoltou()
      },
      { semRedirecionar: true },
    )
  }, [sessaoVoltou])

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

  return (
    <AuthCtx.Provider value={value}>
      {children}
      <SessaoExpiradaDialog aberto={sessaoExpirada} erro={erroGoogle} onGoogle={reentrarComGoogle} />
    </AuthCtx.Provider>
  )
}

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx)
  if (!v) throw new Error("useAuth fora do AuthProvider")
  return v
}
