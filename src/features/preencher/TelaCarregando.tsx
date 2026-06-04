export function TelaCarregando() {
  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4">
      <div className="glass flex items-center gap-4 px-7 py-5 fade-up">
        <div className="relative size-5">
          <span className="absolute inset-0 animate-ping rounded-full bg-[rgb(var(--ink)/0.4)]" />
          <span className="absolute inset-1 rounded-full bg-white" />
        </div>
        <p className="text-sm text-foreground/80">
          Carregando dados do intermitente…
        </p>
      </div>
    </div>
  )
}
