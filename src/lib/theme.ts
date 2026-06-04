/**
 * Theme manager — modo (claro/escuro/sistema) + esquema de cores (3 tons).
 *
 * Aplica `data-theme` (light|dark) + `data-accent` (esquema) no <html> e
 * toggla `.dark` (compat utilitários `dark:`). Persiste por navegador.
 *
 * Troca SUAVE: NÃO usa efeito. Adiciona `.theme-anim` no <html> por ~1s →
 * todas as propriedades de cor interpolam (background/cor/borda/sombra) do
 * tom atual pro novo. Respeita prefers-reduced-motion (troca instantânea).
 *
 * 1º paint já setado pelo script inline em index.html (sem FOUC).
 */
import { useEffect, useReducer } from "react"

export type Mode = "system" | "light" | "dark"
export type Scheme = "aurora" | "seco" | "verde" | "rosa" | "rubi" | "roxo"
export type Fonte = "sm" | "md" | "lg"

const MODE_KEY = "pi-theme"
const SCHEME_KEY = "pi-accent"
const REDUCE_KEY = "pi-reduce-anim"
const FONTE_KEY = "pi-font"
const SCHEMES: Scheme[] = ["aurora", "seco", "verde", "rosa", "rubi", "roxo"]
const FONT_SCALE: Record<Fonte, string> = { sm: "0.92", md: "1", lg: "1.1" }

/** Tons exibidos no swatch (3 bolinhas) de cada esquema. */
export const SCHEME_META: Record<
  Scheme,
  { label: string; tones: [string, string, string] }
> = {
  aurora: { label: "Aurora", tones: ["#1a1a1a", "#3f6ff5", "#ebc478"] },
  seco: { label: "Grafite", tones: ["#000000", "#4c4c4c", "#fafafa"] },
  verde: { label: "Ouro", tones: ["#1a1a1a", "#ebc478", "#4c4c4c"] },
  rosa: { label: "Poente", tones: ["#1a1a1a", "#f472b6", "#c084fc"] },
  rubi: { label: "Brasa", tones: ["#1a1a1a", "#ef4444", "#fb923c"] },
  roxo: { label: "Nebulosa", tones: ["#1a1a1a", "#8b5cf6", "#22d3ee"] },
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function getMode(): Mode {
  const v = localStorage.getItem(MODE_KEY)
  return v === "light" || v === "dark" || v === "system" ? v : "system"
}

export function getScheme(): Scheme {
  const v = localStorage.getItem(SCHEME_KEY) as Scheme | null
  return v && SCHEMES.includes(v) ? v : "aurora"
}

export function getReduzirAnim(): boolean {
  return localStorage.getItem(REDUCE_KEY) === "1"
}

export function getFonte(): Fonte {
  const v = localStorage.getItem(FONTE_KEY) as Fonte | null
  return v === "sm" || v === "md" || v === "lg" ? v : "md"
}

export function resolvedTheme(mode: Mode = getMode()): "light" | "dark" {
  return mode === "system" ? (systemDark() ? "dark" : "light") : mode
}

function applyDom(): void {
  const theme = resolvedTheme()
  const html = document.documentElement
  html.dataset.theme = theme
  html.dataset.accent = getScheme()
  html.classList.toggle("dark", theme === "dark")
  if (getReduzirAnim()) html.dataset.reduceAnim = "1"
  else delete html.dataset.reduceAnim
  html.style.setProperty("--font-scale", FONT_SCALE[getFonte()])
}

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}

let animTimer: ReturnType<typeof setTimeout> | undefined

/** Aplica a mudança com crossfade de cor de ~1s (sem efeito visual extra). */
function applySmooth(mutate: () => void): void {
  const reduce =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    getReduzirAnim()
  const html = document.documentElement
  if (reduce) {
    mutate()
    emit()
    return
  }
  html.classList.add("theme-anim")
  mutate()
  emit()
  if (animTimer) clearTimeout(animTimer)
  animTimer = setTimeout(() => html.classList.remove("theme-anim"), 1050)
}

export function setMode(mode: Mode): void {
  localStorage.setItem(MODE_KEY, mode)
  applySmooth(applyDom)
}

export function setScheme(scheme: Scheme): void {
  localStorage.setItem(SCHEME_KEY, scheme)
  applySmooth(applyDom)
}

export function setReduzirAnim(v: boolean): void {
  localStorage.setItem(REDUCE_KEY, v ? "1" : "0")
  applyDom()
  emit()
}

export function setFonte(f: Fonte): void {
  localStorage.setItem(FONTE_KEY, f)
  applyDom()
  emit()
}

export function resetPrefs(): void {
  ;[MODE_KEY, SCHEME_KEY, REDUCE_KEY, FONTE_KEY].forEach((k) =>
    localStorage.removeItem(k),
  )
  applySmooth(applyDom)
}

export function initTheme(): void {
  applyDom()
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getMode() === "system") {
        applySmooth(applyDom)
      }
    })
}

export function getThemeState() {
  return {
    mode: getMode(),
    scheme: getScheme(),
    resolved: resolvedTheme(),
    reduzirAnim: getReduzirAnim(),
    fonte: getFonte(),
  }
}

/** Hook reativo: re-renderiza quando modo/esquema mudam. */
export function useThemeState() {
  const [, force] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    const cb = () => force()
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }, [])
  return getThemeState()
}
