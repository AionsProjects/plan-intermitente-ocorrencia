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

type VoltarFn = (() => void) | null

type NavValue = {
  /** Dispara o "voltar etapa" da página atual (no-op se não houver). Estável. */
  voltar: () => void
  /** Há etapa anterior registrada? (controla o disabled do botão) */
  podeVoltar: boolean
  /** Página registra (ou limpa) seu voltar + destino do Home. */
  registrarVoltar: (fn: VoltarFn, homeTo?: string) => void
  homeTo: string
  configAberto: boolean
  abrirConfig: () => void
  fecharConfig: () => void
}

const NavCtx = createContext<NavValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  // A função de voltar vive num REF (não em state): páginas passam fn inline
  // que muda de identidade a cada render; guardar em state recriava o value do
  // contexto a cada render → churn que re-montava o balão e engolia cliques
  // (Home "às vezes não funcionava"). Só boolean/homeTo ficam em state.
  const voltarRef = useRef<VoltarFn>(null)
  const [podeVoltar, setPodeVoltar] = useState(false)
  const [homeTo, setHomeTo] = useState("/")
  const [configAberto, setConfigAberto] = useState(false)

  const registrarVoltar = useCallback((fn: VoltarFn, home = "/") => {
    voltarRef.current = fn ?? null
    setPodeVoltar(!!fn) // mesmo valor → React faz bail-out (sem re-render)
    setHomeTo(home)
  }, [])

  const voltar = useCallback(() => {
    voltarRef.current?.()
  }, [])

  const value = useMemo<NavValue>(
    () => ({
      voltar,
      podeVoltar,
      registrarVoltar,
      homeTo,
      configAberto,
      abrirConfig: () => setConfigAberto(true),
      fecharConfig: () => setConfigAberto(false),
    }),
    [voltar, podeVoltar, registrarVoltar, homeTo, configAberto],
  )

  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}

export function useNav(): NavValue {
  const v = useContext(NavCtx)
  if (!v) throw new Error("useNav fora do NavProvider")
  return v
}

/**
 * Página registra seu "voltar etapa" (e destino do Home, opcional) no balão
 * global. Limpa no unmount pra não vazar entre rotas. Passe `null` quando a
 * página não tiver etapa anterior (botão fica desabilitado).
 */
export function useRegistrarVoltar(fn: VoltarFn, homeTo = "/") {
  const { registrarVoltar } = useNav()
  useEffect(() => {
    registrarVoltar(fn, homeTo)
    return () => registrarVoltar(null, "/")
  }, [fn, homeTo, registrarVoltar])
}
