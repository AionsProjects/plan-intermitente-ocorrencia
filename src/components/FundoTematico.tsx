import { useMemo } from "react"

import { useThemeState } from "@/lib/theme"

/**
 * Animação de fundo com a PERSONALIDADE de cada esquema de cor — discreta,
 * atrás de tudo (z-0, pointer-events-none):
 *   aurora   → ondas do mar deslizando no rodapé
 *   rosa     → pétalas de sakura caindo com balanço
 *   verde    → grãos de areia levados pelo vento + duna sutil   ("Ouro")
 *   seco     → neve fina caindo                                  ("Grafite")
 *   rubi     → brasas subindo com fade                           ("Brasa")
 *   roxo     → estrelas cintilando + estrela cadente rara        ("Nebulosa")
 * Respeita a preferência "reduzir animações" e prefers-reduced-motion (CSS).
 */

// Pseudo-random determinístico por índice — partículas estáveis entre renders.
function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function Particulas({
  n,
  className,
  estilo,
}: {
  n: number
  className: string
  estilo: (i: number) => React.CSSProperties
}) {
  const items = useMemo(() => Array.from({ length: n }, (_, i) => i), [n])
  return (
    <>
      {items.map((i) => (
        <span key={i} className={className} style={estilo(i)} />
      ))}
    </>
  )
}

function Ondas() {
  // duas camadas de onda (SVG path suave) deslizando em velocidades diferentes
  const path =
    "M0 60 Q 150 20 300 60 T 600 60 T 900 60 T 1200 60 V 120 H 0 Z"
  return (
    <>
      <svg
        className="ft-onda"
        style={{ animationDuration: "34s", opacity: 0.055, bottom: "-12px" }}
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
      >
        <path d={path} fill="rgb(var(--accent-rgb))" />
      </svg>
      <svg
        className="ft-onda"
        style={{ animationDuration: "52s", animationDirection: "reverse", opacity: 0.035, bottom: "6px" }}
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
      >
        <path d={path} fill="rgb(var(--accent-rgb))" />
      </svg>
    </>
  )
}

export function FundoTematico() {
  const { scheme, reduzirAnim } = useThemeState()
  if (reduzirAnim) return null

  return (
    <div aria-hidden className="ft-raiz pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {scheme === "aurora" && <Ondas />}

      {scheme === "rosa" && (
        <Particulas
          n={11}
          className="ft-petala"
          estilo={(i) => ({
            left: `${rnd(i) * 100}%`,
            animationDuration: `${13 + rnd(i + 40) * 12}s, ${3.2 + rnd(i + 80) * 2}s`,
            animationDelay: `${rnd(i + 20) * -24}s, 0s`,
            width: `${8 + rnd(i + 60) * 6}px`,
            height: `${8 + rnd(i + 60) * 6}px`,
          })}
        />
      )}

      {scheme === "verde" && (
        <>
          <div className="ft-duna" />
          <Particulas
            n={16}
            className="ft-areia"
            estilo={(i) => ({
              top: `${18 + rnd(i) * 70}%`,
              animationDuration: `${9 + rnd(i + 30) * 10}s`,
              animationDelay: `${rnd(i + 50) * -18}s`,
              width: `${1.5 + rnd(i + 70) * 2}px`,
              height: `${1.5 + rnd(i + 70) * 2}px`,
            })}
          />
        </>
      )}

      {scheme === "seco" && (
        <Particulas
          n={14}
          className="ft-neve"
          estilo={(i) => ({
            left: `${rnd(i) * 100}%`,
            animationDuration: `${11 + rnd(i + 33) * 10}s`,
            animationDelay: `${rnd(i + 66) * -20}s`,
            width: `${2 + rnd(i + 99) * 2.5}px`,
            height: `${2 + rnd(i + 99) * 2.5}px`,
            opacity: 0.14 + rnd(i + 11) * 0.16,
          })}
        />
      )}

      {scheme === "rubi" && (
        <Particulas
          n={12}
          className="ft-brasa"
          estilo={(i) => ({
            left: `${rnd(i) * 100}%`,
            animationDuration: `${7 + rnd(i + 25) * 8}s`,
            animationDelay: `${rnd(i + 55) * -14}s`,
            width: `${2 + rnd(i + 85) * 2.5}px`,
            height: `${2 + rnd(i + 85) * 2.5}px`,
          })}
        />
      )}

      {scheme === "roxo" && (
        <>
          <Particulas
            n={18}
            className="ft-estrela"
            estilo={(i) => ({
              left: `${rnd(i) * 100}%`,
              top: `${rnd(i + 15) * 85}%`,
              animationDuration: `${2.6 + rnd(i + 45) * 4}s`,
              animationDelay: `${rnd(i + 75) * -6}s`,
              width: `${1.5 + rnd(i + 95) * 2}px`,
              height: `${1.5 + rnd(i + 95) * 2}px`,
            })}
          />
          <span className="ft-cadente" />
        </>
      )}
    </div>
  )
}
