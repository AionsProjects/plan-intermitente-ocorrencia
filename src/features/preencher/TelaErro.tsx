import { AlertTriangle } from "lucide-react"

type Props = {
  titulo: string
  mensagem: string
}

export function TelaErro({ titulo, mensagem }: Props) {
  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong w-full max-w-md p-10 text-center fade-up">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-yellow-300/10 ring-1 ring-yellow-300/40 backdrop-blur">
          <AlertTriangle className="size-6 text-yellow-300" strokeWidth={1.6} />
        </div>
        <p className="mt-6 text-[11px] uppercase tracking-[0.32em] text-white/55">
          Atenção
        </p>
        <h1 className="text-display mt-2 text-4xl leading-tight text-white">
          {titulo}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          {mensagem}
        </p>
        <p className="mt-8 text-xs text-white/45">
          Em caso de dúvida, procure o time responsável pela convocação.
        </p>
      </div>
    </div>
  )
}
