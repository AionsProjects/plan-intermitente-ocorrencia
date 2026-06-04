import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type VoltarFn = (() => void) | null

type NavValue = {
  /** Handler de "voltar etapa" da página atual (null = desabilitado). */
  voltar: VoltarFn
  /** Página registra (ou limpa) seu voltar + destino do Home. */
  registrarVoltar: (fn: VoltarFn, homeTo?: string) => void
  homeTo: string
  configAberto: boolean
  abrirConfig: () => void
  fecharConfig: () => void
}

const NavCtx = createContext<NavValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [voltar, setVoltarState] = useState<VoltarFn>(null)
  const [homeTo, setHomeTo] = useState("/")
  const [configAberto, setConfigAberto] = useState(false)

  const registrarVoltar = useCallback((fn: VoltarFn, home = "/") => {
    setVoltarState(() => fn) // wrap: guarda a função como valor
    setHomeTo(home)
  }, [])

  const value = useMemo<NavValue>(
    () => ({
      voltar,
      registrarVoltar,
      homeTo,
      configAberto,
      abrirConfig: () => setConfigAberto(true),
      fecharConfig: () => setConfigAberto(false),
    }),
    [voltar, registrarVoltar, homeTo, configAberto],
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
