import { Briefcase, Hammer, Sparkles } from "lucide-react"

import type { TipoTrabalhador } from "./types"

type Props = {
  onSelecionar: (tipo: TipoTrabalhador) => void
}

export function EscolhaTipoTrabalhador({ onSelecionar }: Props) {
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
      <p className="text-[11px] uppercase tracking-[0.32em] text-foreground/55">
        Aionscorp · Atestados e declarações
      </p>
      <h1 className="text-display mt-3 text-balance text-4xl leading-[1.05] text-foreground sm:text-5xl">
        Qual <em className="italic text-[rgb(var(--accent-rgb))]">tipo</em> de trabalhador?
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-foreground/65">
        Escolha o tipo de contratação para lançar um atestado médico ou
        declaração de comparecimento.
      </p>

      <div className="mt-8 grid gap-3 sm:gap-3.5">
        <button
          type="button"
          onClick={() => onSelecionar("intermitente")}
          onMouseMove={handleTiltMove}
          onMouseLeave={handleTiltLeave}
          className="glass-tile glass-tile-3d group relative flex min-h-[5.5rem] items-center justify-between rounded-2xl px-5 py-4 text-left"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.35)]">
              <Hammer className="icon-3d-only size-5 text-[rgb(var(--accent-rgb))]" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-medium leading-tight text-foreground/95">
                Intermitente
              </p>
              <p className="mt-1 text-sm leading-snug text-foreground/55">
                Vincular o atestado a uma convocação em andamento.
              </p>
            </div>
          </div>
          <Sparkles className="size-4 shrink-0 text-[rgb(var(--accent-rgb)/0.6)] transition-transform group-hover:scale-110" />
        </button>

        <button
          type="button"
          onClick={() => onSelecionar("clt")}
          onMouseMove={handleTiltMove}
          onMouseLeave={handleTiltLeave}
          className="glass-tile glass-tile-3d group relative flex min-h-[5.5rem] items-center justify-between rounded-2xl px-5 py-4 text-left"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="icon-3d-host flex size-11 shrink-0 items-center justify-center rounded-full bg-[#a78fff]/12 ring-1 ring-[#a78fff]/35">
              <Briefcase className="icon-3d-only size-5 text-[#b6a4ff]" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-medium leading-tight text-foreground/95">
                CLT
              </p>
              <p className="mt-1 text-sm leading-snug text-foreground/55">
                Funcionário CLT — busque pelo nome ou matrícula.
              </p>
            </div>
          </div>
          <Sparkles className="size-4 shrink-0 text-[#b6a4ff]/60 transition-transform group-hover:scale-110" />
        </button>
      </div>
    </div>
  )
}
