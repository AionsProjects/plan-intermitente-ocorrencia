import { Link, Route, Routes } from "react-router-dom"
import { ArrowUpRight } from "lucide-react"

import { AuroraBackground } from "@/components/AuroraBackground"
import { PreencherPage } from "@/features/preencher/PreencherPage"

function DevIndex() {
  const usandoMock = !import.meta.env.VITE_N8N_BASE_URL

  const exemplos = [
    { uuid: "mock-aguardando", titulo: "Aguardando preenchimento", desc: "Convocação com 6 dias úteis." },
    { uuid: "mock-concluido", titulo: "Já concluído", desc: "Tela de agradecimento pós-envio." },
    { uuid: "mock-expirado", titulo: "Link expirado", desc: "Estado de erro por expiração." },
    { uuid: "uuid-inexistente", titulo: "Link inválido", desc: "Estado 404 / não encontrado." },
  ]

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong w-full max-w-xl p-10 fade-up">
        <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
          Aionscorp · Plano de intermitentes
        </p>
        <h1 className="text-display mt-3 text-5xl leading-[1.05] text-white">
          Registro de <em className="italic text-[#e8c275]">ocorrências</em>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/65">
          Este app é acessado via link único gerado a partir do board no monday.
          Use os atalhos abaixo para testar o fluxo com dados mockados.
        </p>

        {usandoMock ? (
          <div className="mt-6 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur w-fit">
            <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_2px_rgba(127,231,196,0.6)]" />
            modo mock ativo · defina <code className="text-white/85">VITE_N8N_BASE_URL</code>
          </div>
        ) : null}

        <div className="mt-8 grid gap-2.5">
          {exemplos.map((ex, i) => (
            <Link
              key={ex.uuid}
              to={`/preencher/${ex.uuid}`}
              className="glass-tile group flex items-center justify-between rounded-2xl px-5 py-4 fade-up"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <div>
                <p className="text-[15px] font-medium text-white/95">{ex.titulo}</p>
                <p className="mt-0.5 text-xs text-white/55">{ex.desc}</p>
              </div>
              <ArrowUpRight className="size-4 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <>
      <AuroraBackground />
      <Routes>
        <Route path="/" element={<DevIndex />} />
        <Route path="/preencher/:uuid" element={<PreencherPage />} />
      </Routes>
    </>
  )
}

export default App
