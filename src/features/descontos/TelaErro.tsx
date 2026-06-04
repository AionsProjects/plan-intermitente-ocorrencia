import { AlertTriangle } from "lucide-react"
import { Link } from "react-router-dom"

type Props = {
  titulo: string
  mensagem: string
}

export function TelaErro({ titulo, mensagem }: Props) {
  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8">
      <div className="glass-strong w-full max-w-md p-10 text-center">
        <div className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-rose-300/12 ring-1 ring-rose-300/30">
          <AlertTriangle className="size-5 text-rose-700 dark:text-rose-300" />
        </div>
        <h1 className="text-display mt-5 text-3xl leading-tight text-foreground">
          {titulo}
        </h1>
        <p className="mt-3 text-sm text-foreground/65">{mensagem}</p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-1.5 text-xs text-foreground/55 transition hover:text-foreground/85"
        >
          ← Voltar ao Hub
        </Link>
      </div>
    </main>
  )
}
