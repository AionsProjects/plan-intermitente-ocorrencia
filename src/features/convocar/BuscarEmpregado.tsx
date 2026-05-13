import { useMemo, useState } from "react"
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  UserSearch,
} from "lucide-react"

import { useBuscarEmpregado } from "./useConvocacao"
import type { EmpregadoRM } from "./types"

const VISIVEIS = 3

type Props = {
  onSelecionar: (empregado: EmpregadoRM) => void
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = semAcento(query.trim())
  if (!q) return <>{text}</>
  const normalizedText = semAcento(text)
  const parts: Array<{ text: string; match: boolean }> = []
  let i = 0
  while (i < text.length) {
    const idx = normalizedText.indexOf(q, i)
    if (idx === -1) {
      parts.push({ text: text.slice(i), match: false })
      break
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), match: false })
    parts.push({ text: text.slice(idx, idx + q.length), match: true })
    i = idx + q.length
  }
  return (
    <>
      {parts.map((p, j) =>
        p.match ? (
          <mark
            key={j}
            className="rounded-sm bg-[#e8c275]/30 px-0.5 text-[#ffe6b0]"
            style={{ backgroundColor: "transparent" }}
          >
            <span className="font-semibold text-[#ffe6b0] underline decoration-[#e8c275] decoration-2 underline-offset-[3px]">
              {p.text}
            </span>
          </mark>
        ) : (
          <span key={j}>{p.text}</span>
        ),
      )}
    </>
  )
}

export function BuscarEmpregado({ onSelecionar }: Props) {
  const [valor, setValor] = useState("")
  const [expandido, setExpandido] = useState(false)
  const { data, isFetching, isError, ativo } = useBuscarEmpregado(valor)
  const resultados = useMemo(() => data ?? [], [data])
  const visiveis = expandido ? resultados : resultados.slice(0, VISIVEIS)
  const ocultos = Math.max(0, resultados.length - VISIVEIS)

  function handleTiltMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleTiltLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
        Aionscorp · Convocar intermitente
      </p>
      <h1 className="text-display mt-3 text-5xl leading-[1.05] text-white">
        Buscar <em className="italic text-[#e8c275]">empregado</em>
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-white/65">
        Digite parte do nome para localizar o intermitente no RM. Selecione um
        resultado para preencher a convocação.
      </p>

      <div className="mt-8">
        <label className="text-[10px] uppercase tracking-[0.3em] text-white/55">
          Nome do empregado
        </label>
        <div className="mt-3 glass-tile flex items-center gap-3 rounded-2xl px-4">
          <Search className="size-4 shrink-0 text-[#e8c275]" />
          <input
            type="text"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setExpandido(false)
            }}
            placeholder="Comece a digitar (mín. 3 letras)"
            className="text-display flex-1 bg-transparent py-3 text-xl tracking-wider text-white placeholder:text-white/30 focus:outline-none"
            autoFocus
            spellCheck={false}
          />
          {isFetching && (
            <Loader2 className="size-4 shrink-0 animate-spin text-white/55" />
          )}
        </div>

        {!ativo && (
          <p className="mt-3 text-xs text-white/45">
            Digite ao menos 3 letras para buscar.
          </p>
        )}

        {isError && (
          <p className="mt-3 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-xs text-rose-200">
            Erro ao consultar o RM. Tente novamente em alguns segundos.
          </p>
        )}

        {ativo && !isFetching && resultados.length === 0 && !isError && (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60">
            Nenhum empregado encontrado para "{valor}".
          </p>
        )}

        {resultados.length > 0 && (
          <>
            <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-white/55">
              {resultados.length}{" "}
              {resultados.length === 1 ? "resultado" : "resultados"}
            </p>
            <ul className="mt-2 space-y-2">
              {visiveis.map((emp, i) => (
                <li
                  key={emp.chapa || emp.nome + i}
                  className="fade-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => onSelecionar(emp)}
                    onMouseMove={handleTiltMove}
                    onMouseLeave={handleTiltLeave}
                    className="glass-tile glass-tile-3d group relative flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8c275]/12 ring-1 ring-[#e8c275]/30">
                        <UserSearch className="size-4 text-[#e8c275]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium text-white/95">
                          <HighlightedText text={emp.nome} query={valor} />
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/55">
                          Chapa {emp.chapa || "—"} ·{" "}
                          {emp.funcao || "função n/d"}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-white/45 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
                  </button>
                </li>
              ))}
            </ul>

            {ocultos > 0 && (
              <button
                type="button"
                onClick={() => setExpandido((v) => !v)}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-white/60 backdrop-blur transition-all hover:border-white/20 hover:bg-white/[0.06] hover:text-white/90"
              >
                {expandido ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    Recolher
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
                    Ver todos ({ocultos} {ocultos === 1 ? "outro" : "outros"})
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
