import { Loader2 } from "lucide-react"

export function TelaCarregando() {
  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center px-4 py-8">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-sky-700 dark:text-sky-300" />
        <p className="text-xs uppercase tracking-[0.28em] text-foreground/55">
          Carregando desconto
        </p>
      </div>
    </main>
  )
}
