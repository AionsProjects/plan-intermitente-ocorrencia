import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react"
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react"
import { useNavigate } from "react-router-dom"

/**
 * ZoomTransition — assinatura de navegação do Liquid Glass v2.
 *
 * Clicar num tile expande o PRÓPRIO botão até virar a tela (660ms, label
 * serif crescendo no vidro); voltar contrai a tela de volta ao tile de
 * origem. A troca de rota acontece escondida atrás do overlay.
 *
 * IMPLEMENTAÇÃO (difere do protótipo de propósito — lá as telas são leves):
 *
 * 1. FLIP por transform: o overlay tem SEMPRE o tamanho da viewport e anima
 *    só translate+scale — transform e opacity rodam na thread do COMPOSITOR,
 *    então o movimento continua fluido mesmo com o React ocupado montando a
 *    rota nova (animar left/top/width/height cortava no meio).
 * 2. Overlay PERSISTENTE e ciclo imperativo: o elemento é montado uma única
 *    vez (invisível) e o click só troca estilos via ref. Nada de mount de
 *    camada nem re-render de contexto no caminho crítico — era isso que
 *    segurava o início da animação em ~meio segundo.
 *
 * A navegação disparada por zoom marca uma flag que o PageTransition consome
 * pra NÃO deslizar o carrossel por baixo do overlay, e a classe `zoom-nav`
 * no <html> segura o replay dos fade-up da tela de destino.
 */

type Rect = { left: number; top: number; width: number; height: number }

let navegacaoZoom = false

/** PageTransition chama no path-change: true = navegação veio de um zoom. */
export function consumirNavegacaoZoom(): boolean {
  const v = navegacaoZoom
  navegacaoZoom = false
  return v
}

function reduzirMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reduceAnim === "1"
  )
}

/**
 * Tirar a classe `zoom-nav` reativaria o fade-up dos elementos já montados
 * (animation-name none→fade-up REINICIA a animação — replay tardio). Antes
 * de remover, congela os .fade-up atuais no estado final via inline style;
 * elementos montados depois (próximas navegações) animam normalmente.
 */
function soltarZoomNav(): void {
  document.querySelectorAll<HTMLElement>(".fade-up").forEach((n) => {
    n.style.animation = "none"
    n.style.opacity = "1"
  })
  document.documentElement.classList.remove("zoom-nav")
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
const MOVE = `transform 660ms ${EASE}, border-radius 660ms ${EASE}`

/** transform + border-radius que fazem o overlay fullscreen PARECER o tile. */
function estiloNoTile(rect: Rect) {
  const sx = Math.max(rect.width / window.innerWidth, 0.001)
  const sy = Math.max(rect.height / window.innerHeight, 0.001)
  return {
    transform: `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})`,
    // compensa o scale pra que o raio VISUAL seja ~22px em ambos os eixos
    borderRadius: `${22 / sx}px / ${22 / sy}px`,
  }
}

type ZoomApi = {
  /** Expande o elemento clicado até virar a tela e navega pra `to`. */
  zoomTo: (e: ReactMouseEvent<HTMLElement>, label: string, to: string) => void
  /** Contrai a tela atual de volta ao tile que a abriu e navega pra `to`. */
  zoomBack: (to?: string) => void
}

const ZoomContext = createContext<ZoomApi | null>(null)

export function useZoom(): ZoomApi {
  const ctx = useContext(ZoomContext)
  if (!ctx) throw new Error("useZoom precisa do <ZoomProvider>")
  return ctx
}

export function ZoomProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const overlayRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const animandoRef = useRef(false)
  const origemRef = useRef<{ rect: Rect; label: string } | null>(null)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      document.documentElement.classList.remove("zoom-nav")
    }
  }, [])

  const agendar = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms))
  }, [])

  const esconder = useCallback(() => {
    const el = overlayRef.current
    if (!el) return
    el.style.transition = "none"
    el.style.visibility = "hidden"
    el.style.opacity = "0"
  }, [])

  const zoomTo = useCallback(
    (e: ReactMouseEvent<HTMLElement>, label: string, to: string) => {
      const el = overlayRef.current
      const lb = labelRef.current
      if (animandoRef.current) return
      if (!el || !lb || reduzirMotion()) {
        origemRef.current = null
        navigate(to)
        return
      }
      const r = e.currentTarget.getBoundingClientRect()
      const rect = { left: r.left, top: r.top, width: r.width, height: r.height }
      origemRef.current = { rect, label }
      animandoRef.current = true

      // estado inicial = tile clicado (sem transição), num único frame
      const noTile = estiloNoTile(rect)
      lb.textContent = label
      lb.style.transition = "none"
      lb.style.opacity = "0"
      el.style.transition = "none"
      el.style.visibility = "visible"
      el.style.transform = noTile.transform
      el.style.borderRadius = noTile.borderRadius
      el.style.opacity = "1"
      void el.offsetWidth // reflow: fixa o estado inicial antes de animar

      el.style.transition = `${MOVE}, opacity 320ms ease`
      el.style.transform = "translate(0px, 0px) scale(1, 1)"
      el.style.borderRadius = "0px"
      lb.style.transition = "opacity 300ms ease 120ms"
      lb.style.opacity = "0.95"

      agendar(() => {
        navegacaoZoom = true
        // Destino monta já assentado — sem replay do fade-up atrás do overlay.
        document.documentElement.classList.add("zoom-nav")
        navigate(to)
        // revela a rota nova (transform/opacity seguem no compositor)
        el.style.opacity = "0"
        lb.style.opacity = "0"
      }, 660)
      agendar(() => {
        soltarZoomNav()
        animandoRef.current = false
        esconder()
      }, 1000)
    },
    [navigate, agendar, esconder],
  )

  const zoomBack = useCallback(
    (to: string = "/") => {
      const el = overlayRef.current
      const lb = labelRef.current
      if (animandoRef.current) return
      const origem = origemRef.current
      origemRef.current = null
      if (!origem || !el || !lb || reduzirMotion()) {
        navigate(to)
        return
      }
      navegacaoZoom = true
      // Hub volta já assentado — replay do fade-up durante a contração fica
      // esquisito (tiles nascendo enquanto o overlay encolhe por cima).
      document.documentElement.classList.add("zoom-nav")
      navigate(to)
      animandoRef.current = true

      lb.textContent = origem.label
      lb.style.transition = "none"
      lb.style.opacity = "0.9"
      el.style.transition = "none"
      el.style.visibility = "visible"
      el.style.transform = "translate(0px, 0px) scale(1, 1)"
      el.style.borderRadius = "0px"
      el.style.opacity = "1"
      void el.offsetWidth

      const noTile = estiloNoTile(origem.rect)
      // fade termina junto com o movimento (delay) — nunca para no tile
      el.style.transition = `${MOVE}, opacity 340ms ease 320ms`
      el.style.transform = noTile.transform
      el.style.borderRadius = noTile.borderRadius
      el.style.opacity = "0"
      lb.style.transition = "opacity 240ms ease"
      lb.style.opacity = "0"

      agendar(() => {
        soltarZoomNav()
        animandoRef.current = false
        esconder()
      }, 700)
    },
    [navigate, agendar, esconder],
  )

  const api = useMemo(() => ({ zoomTo, zoomBack }), [zoomTo, zoomBack])

  return (
    <ZoomContext.Provider value={api}>
      {children}
      {/* Persistente: montado 1x, invisível; o ciclo só troca estilos. */}
      <div
        ref={overlayRef}
        className="zoom-overlay"
        style={{ visibility: "hidden", opacity: 0 }}
        aria-hidden
      >
        <div ref={labelRef} className="zoom-label" style={{ fontSize: 46 }} />
      </div>
    </ZoomContext.Provider>
  )
}
