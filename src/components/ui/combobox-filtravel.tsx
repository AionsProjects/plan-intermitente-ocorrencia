import { useEffect, useMemo, useRef, useState } from "react"
import { Building2, Check, ChevronDown, Search, X } from "lucide-react"

import { filtrarPorBusca } from "@/lib/buscaUnidade"

export type ComboboxFiltravelProps = {
  /** Texto exibido sobre o trigger (`<label>`). Opcional — quando ausente o
   *  combobox renderiza só o botão. */
  label?: string
  /** Valor selecionado (string vazia = nenhum). */
  valor: string
  /** Opções disponíveis. Pode ser readonly. */
  opcoes: readonly string[] | string[]
  /** Disparado ao escolher uma opção. */
  onChange: (v: string) => void
  /** Placeholder do trigger. */
  placeholder?: string
  /** Placeholder do input de busca. */
  buscaPlaceholder?: string
  /** Mensagem quando `opcoes` é vazio. */
  emptyMessage?: string
  /** Mensagem quando há opções mas a busca não casa nada. */
  noMatchMessage?: string
  /** Quando true, desabilita o trigger e mostra opacidade reduzida. */
  disabled?: boolean
  /** Acento de cor (hex). Default âmbar (rgb(var(--accent-rgb))). */
  accent?: string
  /** Ícone à esquerda de cada opção. Default Building2. */
  iconeOpcao?: typeof Building2
  /** Texto extra abaixo do contador (ex.: "X cadastradas no RM"). */
  extraInfo?: string
}

/**
 * Combobox filtrável reutilizável. Dropdown aberto inclui input de busca,
 * contador "N encontradas" e mensagens de vazio/sem-resultado.
 *
 * Filtragem via `filtrarPorBusca` (case/acento/partial agnostic).
 *
 * Usado em /convocar, /atestados e — opcionalmente — /ponto-facultativo.
 */
export function ComboboxFiltravel({
  label,
  valor,
  opcoes,
  onChange,
  placeholder = "Selecione...",
  buscaPlaceholder = "Buscar...",
  emptyMessage = "Nenhuma opção disponível.",
  noMatchMessage = "Nenhuma unidade encontrada para esse termo",
  disabled = false,
  accent = "rgb(var(--accent-rgb))",
  iconeOpcao: IconeOpcao = Building2,
  extraInfo,
}: ComboboxFiltravelProps) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const filtradas = useMemo(
    () => filtrarPorBusca([...opcoes], busca),
    [opcoes, busca],
  )

  const semOpcoes = opcoes.length === 0
  const semResultado = !semOpcoes && filtradas.length === 0

  useEffect(() => {
    if (!aberto) {
      setBusca("")
      return
    }
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [aberto])

  // Fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [aberto])

  function escolher(opt: string) {
    if (disabled) return
    onChange(opt)
    setAberto(false)
  }

  const accentBgSoft = `${accent}1f` // ~12% opaco
  const accentBorder = `${accent}73` // ~45%
  const accentText = accent

  return (
    <div className="relative" ref={wrapperRef}>
      {label && (
        <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-foreground/55">
          {label}
        </label>
      )}

      <button
        type="button"
        onClick={() => {
          if (!disabled) setAberto((v) => !v)
        }}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-3 rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-left text-sm transition hover:border-[rgb(var(--ink)/0.22)] hover:bg-[rgb(var(--ink)/0.06)] ${
          aberto ? "border-[rgb(var(--ink)/0.3)] bg-[rgb(var(--ink)/0.08)]" : ""
        } ${disabled ? "cursor-not-allowed opacity-55 hover:border-[rgb(var(--ink)/0.12)] hover:bg-[rgb(var(--ink)/0.04)]" : ""}`}
        style={
          aberto && valor
            ? { borderColor: accentBorder }
            : undefined
        }
      >
        <span className={`truncate ${valor ? "text-foreground" : "text-foreground/40"}`}>
          {valor || placeholder}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-foreground/55 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>

      {aberto && (
        <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-card/96 shadow-[0_22px_46px_-16px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          {!semOpcoes && (
            <div className="flex items-center gap-2 border-b border-[rgb(var(--ink)/0.1)] px-3 py-2.5">
              <Search className="size-3.5 shrink-0 text-foreground/55" />
              <input
                ref={inputRef}
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={buscaPlaceholder}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/30 focus:outline-none"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  className="inline-flex size-6 items-center justify-center rounded-full text-foreground/45 transition hover:bg-[rgb(var(--ink)/0.08)] hover:text-foreground/85"
                  aria-label="Limpar busca"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          )}

          {!semOpcoes && (
            <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--ink)/0.06)] px-4 py-1.5 text-[10px] uppercase tracking-wider text-foreground/45">
              <span>
                {filtradas.length} {filtradas.length === 1 ? "encontrada" : "encontradas"}
              </span>
              {extraInfo && <span>{extraInfo}</span>}
            </div>
          )}

          {semOpcoes ? (
            <p className="px-5 py-6 text-center text-sm text-foreground/55">
              {emptyMessage}
            </p>
          ) : semResultado ? (
            <p className="px-5 py-6 text-center text-sm text-foreground/55">
              {noMatchMessage}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {filtradas.map((o) => {
                const sel = o === valor
                return (
                  <li key={o}>
                    <button
                      type="button"
                      onClick={() => escolher(o)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-[rgb(var(--ink)/0.06)]"
                      style={
                        sel
                          ? {
                              backgroundColor: accentBgSoft,
                              color: accentText,
                            }
                          : { color: "rgba(255,255,255,0.85)" }
                      }
                    >
                      <IconeOpcao
                        className="size-3.5 shrink-0"
                        style={{ color: sel ? accentText : "rgba(255,255,255,0.45)" }}
                      />
                      <span className="flex-1 truncate">{o}</span>
                      {sel && (
                        <Check
                          className="size-3.5 shrink-0"
                          style={{ color: accentText }}
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
