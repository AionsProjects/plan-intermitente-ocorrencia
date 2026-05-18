import { useEffect, useLayoutEffect, useRef, useState } from "react"

export type SlideDirection = "forward" | "backward"

type Props = {
  /** Identidade do conteúdo atual. Quando muda, dispara slide. */
  slideKey: string
  /** forward = atual sai pra esquerda, novo entra pela direita.
   *  backward = inverso (botão voltar). */
  direction: SlideDirection
  children: React.ReactNode
}

const DUR = 680
const EASE = "cubic-bezier(0.2, 0.84, 0.2, 1)"

/**
 * Carrossel horizontal genérico entre conteúdos.
 * Dois slots lado-a-lado num trilho 200% que desliza translateX(0% ↔ -50%).
 * Sem morphing de altura — wrapper assume altura natural do slot atual em idle.
 * `overflow-x: hidden` só durante a animação (preserva sombras/glow em idle).
 *
 * Reutilizado por:
 *  - PageTransition (transição global entre rotas)
 *  - ConvocarPage (transição interna busca → form → sucesso)
 */
export function SlideStack({ slideKey, direction, children }: Props) {
  const [renderedKey, setRenderedKey] = useState(slideKey)
  const [outgoing, setOutgoing] = useState<{
    children: React.ReactNode
    direction: SlideDirection
  } | null>(null)
  const [pos, setPos] = useState<"inicio" | "fim">("inicio")
  const ultimoChildrenRef = useRef<React.ReactNode>(children)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Mantém última versão de children sincronizada pra captura no momento da troca
  useEffect(() => {
    if (slideKey === renderedKey) {
      ultimoChildrenRef.current = children
    }
  }, [children, slideKey, renderedKey])

  useLayoutEffect(() => {
    if (slideKey === renderedKey) return

    setOutgoing({ children: ultimoChildrenRef.current, direction })
    setRenderedKey(slideKey)
    setPos("inicio")

    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setPos("fim"))
    })

    timerRef.current = window.setTimeout(() => {
      setOutgoing(null)
      setPos("inicio")
      timerRef.current = null
    }, DUR + 40)
  }, [slideKey, direction, renderedKey])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const animando = outgoing !== null
  const dirAnim = outgoing?.direction ?? "forward"

  const trilhoX = !animando
    ? "translateX(0%)"
    : pos === "inicio"
      ? dirAnim === "forward"
        ? "translateX(0%)"
        : "translateX(-50%)"
      : dirAnim === "forward"
        ? "translateX(-50%)"
        : "translateX(0%)"

  return (
    <div
      className={animando ? "slide-stack-animating" : undefined}
      style={{
        position: "relative",
        overflowX: animando ? "hidden" : "visible",
        width: "100%",
      }}
    >
      <div
        className="flex items-start"
        style={{
          width: animando ? "200%" : "100%",
          transform: trilhoX,
          transition:
            animando && pos === "fim" ? `transform ${DUR}ms ${EASE}` : "none",
          willChange: animando ? "transform" : undefined,
        }}
      >
        {animando ? (
          dirAnim === "forward" ? (
            <>
              <Slot state={pos === "inicio" ? "active" : "exit"}>
                {outgoing.children}
              </Slot>
              <Slot state={pos === "inicio" ? "enter" : "active"}>
                {children}
              </Slot>
            </>
          ) : (
            <>
              <Slot state={pos === "inicio" ? "enter" : "active"}>
                {children}
              </Slot>
              <Slot state={pos === "inicio" ? "active" : "exit"}>
                {outgoing.children}
              </Slot>
            </>
          )
        ) : (
          <Slot full>{children}</Slot>
        )}
      </div>
    </div>
  )
}

function Slot({
  children,
  full = false,
  state = "active",
}: {
  children: React.ReactNode
  full?: boolean
  state?: "active" | "enter" | "exit"
}) {
  const isActive = state === "active"
  return (
    <div
      style={{
        width: full ? "100%" : "50%",
        flexShrink: 0,
        opacity: isActive ? 1 : 0.18,
        transform: isActive ? "scale(1)" : "scale(0.985)",
        transition: `opacity ${DUR}ms ${EASE}, transform ${DUR}ms ${EASE}`,
        willChange: isActive ? undefined : "opacity, transform",
      }}
    >
      {children}
    </div>
  )
}
