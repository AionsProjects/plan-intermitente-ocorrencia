import { CheckCircle2, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

import type { LancarDocumentosResultado } from "./types"

type Props = {
  resultado: LancarDocumentosResultado
  totalEnviado: number
  onNovaSessao: () => void
}

export function TelaSucesso({ resultado, totalEnviado, onNovaSessao }: Props) {
  const okCount = resultado.resultados.filter((r) => !r.erro).length
  const errCount = resultado.resultados.length - okCount

  return (
    <div className="text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-300/12 ring-1 ring-emerald-300/35">
        <CheckCircle2 className="size-8 text-emerald-700 dark:text-emerald-300" />
      </div>
      <h1 className="text-display mt-6 text-4xl leading-[1.05] text-foreground">
        Documentos <em className="italic text-emerald-700 dark:text-emerald-300">enviados</em>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-foreground/65">
        {okCount} de {totalEnviado}{" "}
        {totalEnviado === 1 ? "documento processado" : "documentos processados"}
        {errCount > 0 && `, ${errCount} com erro`}.
      </p>

      {errCount > 0 && (
        <ul className="mt-5 space-y-1.5 rounded-2xl border border-rose-300/25 bg-rose-300/8 p-4 text-left text-xs text-rose-700 dark:text-rose-100">
          {resultado.resultados
            .filter((r) => r.erro)
            .map((r) => (
              <li key={r.id}>
                {r.id}: {r.erro}
              </li>
            ))}
        </ul>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <CtaNovaSessao onClick={onNovaSessao} />
        <Link
          to="/"
          className="text-xs text-foreground/55 transition hover:text-foreground/85"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  )
}

function CtaNovaSessao({ onClick }: { onClick: () => void }) {
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
    <button
      type="button"
      onClick={onClick}
      onMouseMove={handleTiltMove}
      onMouseLeave={handleTiltLeave}
      className="floating-resumo glass-strong glow-gold group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full px-8 text-sm font-medium tracking-wide text-[#0a1224]"
      style={{
        background:
          "linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-rgb)) 55%, #b6a4ff 130%)",
        border: "1px solid rgba(255,236,194,0.5)",
      }}
    >
      <Sparkles className="size-4" />
      Lançar mais documentos
    </button>
  )
}
