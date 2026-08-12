import { Link } from "react-router-dom"
import { Compass } from "lucide-react"

/**
 * Rota coringa. Antes disto, URL inexistente renderizava a área em branco — e, pior,
 * SEM redirect de login, porque `RequireAuth` só vale em rota declarada. Um link de
 * alerta antigo ou cortado pelo WhatsApp parecia app quebrado.
 */
export function NaoEncontradaPage() {
  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <section className="glass-panel fade-up w-full max-w-[460px] px-6 py-9 text-center sm:px-9">
        <span className="icon-orb icon-orb--neutral mx-auto flex size-12 items-center justify-center">
          <Compass className="size-5 text-foreground/60" aria-hidden />
        </span>
        <h1 className="text-display mt-4 text-3xl leading-tight text-foreground">
          Esta página não existe
        </h1>
        <p className="mt-2 text-sm text-foreground/55">
          O endereço pode ter sido cortado ao ser copiado, ou apontar pra uma tela que
          já não está aqui.
        </p>
        <Link to="/" className="glass-cta mt-6 inline-flex">
          Ir para o início
        </Link>
      </section>
    </div>
  )
}
