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
  aurora: { label: "Aurora", tones: ["#3f6ff5", "#7da7ff", "#d8aa53"] },
  seco: { label: "Seco", tones: ["#5b6675", "#828c9b", "#aab2bf"] },
  verde: { label: "Esmeralda", tones: ["#10b981", "#2dd4bf", "#0e7c66"] },
  rosa: { label: "Rosado", tones: ["#f472b6", "#c084fc", "#fb9aa6"] },
  rubi: { label: "Rubi", tones: ["#ef4444", "#f87171", "#b91c1c"] },
  roxo: { label: "Roxo", tones: ["#8b5cf6", "#a78bfa", "#6366f1"] },
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
