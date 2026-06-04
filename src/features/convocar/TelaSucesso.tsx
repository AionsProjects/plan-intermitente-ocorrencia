import { CheckCircle2, ExternalLink, RotateCcw } from "lucide-react"

type Props = {
  itemId: string
  itemUrl: string
  onNovaConvocacao: () => void
}

export function TelaSucesso({ itemId, itemUrl, onNovaConvocacao }: Props) {
  const ehMock = itemId.startsWith("mock-")
  return (
    <div className="text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-300/15 ring-1 ring-emerald-300/40">
        <CheckCircle2 className="size-8 text-emerald-700 dark:text-emerald-200" />
      </div>
      <h1 className="text-display mt-6 text-4xl leading-[1.05] text-foreground">
        Convocação <em className="italic text-[rgb(var(--accent-rgb))]">criada</em>
      </h1>
      <p className="mt-3 text-sm text-foreground/65">
        Convocação cadastrada. Ative a coluna{" "}
        <code className="text-[rgb(var(--accent-rgb))]">Ativar</code> no monday para gerar o
        link de preenchimento.
      </p>

      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.05)] px-4 py-2 text-xs text-foreground/70 backdrop-blur">
        Código da convocação:{" "}
        <code className="text-[rgb(var(--accent-rgb))]">{itemId}</code>
        {ehMock && (
          <span className="ml-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-200">
            teste
          </span>
        )}
      </div>

      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
        {!ehMock && itemUrl && (
          <a
            href={itemUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.05)] px-5 py-3 text-sm font-medium text-foreground/85 backdrop-blur transition hover:border-[rgb(var(--ink)/0.25)] hover:bg-[rgb(var(--ink)/0.1)]"
          >
            <ExternalLink className="size-4" />
            Abrir no monday
          </a>
        )}
        <button
          type="button"
          onClick={onNovaConvocacao}
          className="glow-gold inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-medium text-[#0a1224] transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background:
              "linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-rgb)) 55%, rgb(var(--surface-rgb)) 130%)",
            border: "1px solid rgba(255,236,194,0.5)",
          }}
        >
          <RotateCcw className="size-4" />
          Nova convocação
        </button>
      </div>
    </div>
  )
}
