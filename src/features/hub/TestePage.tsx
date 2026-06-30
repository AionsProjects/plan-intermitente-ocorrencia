import { Link } from "react-router-dom"
import {
  ArrowUpRight,
  CalendarDays,
  FlaskConical,
  KeyRound,
} from "lucide-react"

export function TestePage() {
  const usandoMock = !import.meta.env.VITE_N8N_BASE_URL

  // UUIDs/protocolos com prefixos reservados que sempre resolvem mock
  // local mesmo com n8n real configurado (tratamento em features/preencher/api.ts).
  const exemplos = [
    {
      uuid: "mock-aguardando",
      titulo: "Aguardando preenchimento",
      desc: "Convocação com 6 dias úteis.",
    },
    {
      uuid: "mock-concluido",
      titulo: "Já concluído",
      desc: "Tela de agradecimento pós-envio. Protocolo PROT-DEMO-1234.",
    },
    {
      uuid: "mock-expirado",
      titulo: "Link expirado",
      desc: "Estado de erro por expiração.",
    },
    {
      uuid: "mock-sabados",
      titulo: "Com sábado extra pré-carregado",
      desc: "Convocação de abril inteiro c/ um sábado extra já marcado.",
    },
    {
      uuid: "mock-com-sabado",
      titulo: "Já trabalha sábado",
      desc: "Trabalha Sábado = SIM. Botão 'Adicionar sábados' fica oculto.",
    },
    {
      uuid: "mock-atestado",
      titulo: "Com atestado",
      desc: "Convocação com atestado pré-carregado para validar o destaque.",
    },
    {
      uuid: "mock-cancelado-parcial",
      titulo: "Cancelamento parcial",
      desc: "Convocação 25–29/05 com cancelamento a partir de 28/05. Dia 28 e 29 ficam bloqueados (tile cancelado).",
    },
    {
      uuid: "mock-corrigir-cancelado",
      titulo: "Concluído + cancelado (correção)",
      desc: "Convocação já finalizada COM cancelamento parcial — reproduz cenário do /corrigir em convocação cancelada.",
    },
    {
      uuid: "uuid-inexistente",
      titulo: "Link inválido",
      desc: "Estado 404 / não encontrado.",
    },
  ]

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong card-shimmer relative w-full max-w-xl p-10">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-amber-700 dark:text-amber-200">
            <FlaskConical className="size-3" />
            Área de teste
          </div>
        </div>

        <p className="text-[11px] uppercase tracking-[0.32em] text-foreground/55">
          Aionscorp · Plano de intermitentes
        </p>
        <h1 className="text-display mt-3 text-balance text-4xl leading-[1.05] text-foreground sm:text-5xl">
          Chaves de <em className="italic text-[rgb(var(--accent-rgb))]">teste</em>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-foreground/65">
          Nada do que for enviado aqui é registrado de verdade. Use pra
          inspecionar o fluxo end-to-end com dados falsos.
        </p>

        <div className="mt-6 flex w-fit items-center gap-2 rounded-full border border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.05)] px-3 py-1.5 text-[11px] text-foreground/65 backdrop-blur">
          <span
            className={`size-1.5 rounded-full ${
              usandoMock
                ? "bg-emerald-300 shadow-[0_0_10px_2px_rgba(127,231,196,0.6)]"
                : "bg-[rgb(var(--accent-rgb))] shadow-[0_0_10px_2px_rgb(var(--accent-rgb)/0.55)]"
            }`}
          />
          {usandoMock ? (
            <>
              modo mock ativo · defina{" "}
              <code className="text-foreground/85">VITE_N8N_BASE_URL</code>
            </>
          ) : (
            <>n8n real conectado · chaves de teste abaixo continuam funcionando</>
          )}
        </div>

        <div className="mt-8 grid gap-2.5">
          {exemplos.map((ex, i) => (
            <Link
              key={ex.uuid}
              to={`/preencher/${ex.uuid}`}
              className="glass-tile group flex items-center justify-between rounded-2xl px-5 py-4 fade-up"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <div>
                <p className="text-[15px] font-medium text-foreground/95">
                  {ex.titulo}
                </p>
                <p className="mt-0.5 text-xs text-foreground/55">{ex.desc}</p>
              </div>
              <ArrowUpRight className="size-4 text-foreground/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-2.5 border-t border-[rgb(var(--ink)/0.1)] pt-6">
          <Link
            to="/teste/ponto-facultativo"
            className="glass-tile group flex items-center justify-between rounded-2xl px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-emerald-300/12 ring-1 ring-emerald-300/30">
                <CalendarDays className="size-4 text-emerald-700 dark:text-emerald-200" />
              </div>
              <div>
                <p className="text-[15px] font-medium text-foreground/95">
                  Mocks · ponto facultativo
                </p>
                <p className="mt-0.5 text-xs text-foreground/55">
                  Pula direto pra cada etapa (escolha, dia, benefícios, prévia, sucesso).
                </p>
              </div>
            </div>
            <ArrowUpRight className="size-4 text-foreground/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>

          <Link
            to="/corrigir"
            className="glass-tile group flex items-center justify-between rounded-2xl px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.12)] ring-1 ring-[rgb(var(--accent-rgb)/0.3)]">
                <KeyRound className="size-4 text-[rgb(var(--accent-rgb))]" />
              </div>
              <div>
                <p className="text-[15px] font-medium text-foreground/95">
                  Corrigir um registro
                </p>
                <p className="mt-0.5 text-xs text-foreground/55">
                  Use o código de protocolo para reabrir e ajustar.
                </p>
              </div>
            </div>
            <ArrowUpRight className="size-4 text-foreground/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>

          <p className="mt-3 px-1 text-[11px] leading-relaxed text-foreground/50">
            Protocolo de teste:{" "}
            <code className="text-[rgb(var(--accent-rgb))]">PROT-DEMO-1234</code>
          </p>
        </div>
      </div>
    </div>
  )
}
