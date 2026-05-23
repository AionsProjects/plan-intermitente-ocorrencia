import { Link, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  FlaskConical,
  KeyRound,
} from "lucide-react"

export function TestePage() {
  const navigate = useNavigate()
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
      uuid: "uuid-inexistente",
      titulo: "Link inválido",
      desc: "Estado 404 / não encontrado.",
    },
  ]

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong relative w-full max-w-xl p-10">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-white/55 transition hover:text-white/85"
        >
          <ArrowLeft className="size-3.5" />
          Voltar
        </button>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-amber-200">
          <FlaskConical className="size-3" />
          Área de teste
        </div>

        <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
          Aionscorp · Plano de intermitentes
        </p>
        <h1 className="text-display mt-3 text-5xl leading-[1.05] text-white">
          Chaves de <em className="italic text-[#e8c275]">teste</em>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/65">
          Nada do que for enviado aqui é registrado de verdade. Use pra
          inspecionar o fluxo end-to-end com dados falsos.
        </p>

        <div className="mt-6 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur">
          <span
            className={`size-1.5 rounded-full ${
              usandoMock
                ? "bg-emerald-300 shadow-[0_0_10px_2px_rgba(127,231,196,0.6)]"
                : "bg-[#e8c275] shadow-[0_0_10px_2px_rgba(232,194,117,0.55)]"
            }`}
          />
          {usandoMock ? (
            <>
              modo mock ativo · defina{" "}
              <code className="text-white/85">VITE_N8N_BASE_URL</code>
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
                <p className="text-[15px] font-medium text-white/95">
                  {ex.titulo}
                </p>
                <p className="mt-0.5 text-xs text-white/55">{ex.desc}</p>
              </div>
              <ArrowUpRight className="size-4 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-2.5 border-t border-white/10 pt-6">
          <Link
            to="/teste/ponto-facultativo"
            className="glass-tile group flex items-center justify-between rounded-2xl px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-emerald-300/12 ring-1 ring-emerald-300/30">
                <CalendarDays className="size-4 text-emerald-200" />
              </div>
              <div>
                <p className="text-[15px] font-medium text-white/95">
                  Mocks · ponto facultativo
                </p>
                <p className="mt-0.5 text-xs text-white/55">
                  Pula direto pra cada etapa (escolha, dia, benefícios, prévia, sucesso).
                </p>
              </div>
            </div>
            <ArrowUpRight className="size-4 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
          </Link>

          <Link
            to="/corrigir"
            className="glass-tile group flex items-center justify-between rounded-2xl px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-[#e8c275]/12 ring-1 ring-[#e8c275]/30">
                <KeyRound className="size-4 text-[#e8c275]" />
              </div>
              <div>
                <p className="text-[15px] font-medium text-white/95">
                  Corrigir um registro
                </p>
                <p className="mt-0.5 text-xs text-white/55">
                  Use o código de protocolo para reabrir e ajustar.
                </p>
              </div>
            </div>
            <ArrowUpRight className="size-4 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
          </Link>

          <p className="mt-3 px-1 text-[11px] leading-relaxed text-white/50">
            Protocolo de teste:{" "}
            <code className="text-[#e8c275]">PROT-DEMO-1234</code>
          </p>
        </div>
      </div>
    </div>
  )
}
