import { useState } from "react"
import { useLocation, type Location } from "react-router-dom"

import { SlideStack, type SlideDirection } from "./SlideStack"

type Props = {
  /** Função que renderiza o conteúdo dado um Location. Pra usar com React
   *  Router, passe `(loc) => <Routes location={loc}>...</Routes>`. */
  renderRoutes: (location: Location) => React.ReactNode
}

const NIVEL: Record<string, number> = {
  "/": 0,
  "/teste": 1,
  "/convocar": 1,
  "/corrigir": 1,
  "/atestados": 1,
}

function nivel(pathname: string): number {
  if (pathname.startsWith("/preencher/")) return 2
  return NIVEL[pathname] ?? 1
}

/**
 * Wrapper que aplica carrossel slide na navegação entre rotas.
 * Detecta direção (forward = mais fundo, backward = subir) via mapa NIVEL.
 *
 * Detecta mudança de path durante render comparando location atual com
 * o último renderizado (padrão "Computing the next state during rendering"
 * dos docs do React) — atualiza state inline antes de retornar JSX.
 */
export function PageTransition({ renderRoutes }: Props) {
  const location = useLocation()
  const [renderedPath, setRenderedPath] = useState(location.pathname)
  const [direction, setDirection] = useState<SlideDirection>("forward")

  if (location.pathname !== renderedPath) {
    const novoNivel = nivel(location.pathname)
    const antigoNivel = nivel(renderedPath)
    setDirection(novoNivel < antigoNivel ? "backward" : "forward")
    setRenderedPath(location.pathname)
  }

  return (
    <SlideStack slideKey={location.pathname} direction={direction}>
      {renderRoutes(location)}
    </SlideStack>
  )
}
