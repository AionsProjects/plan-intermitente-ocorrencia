import { Link, Route, Routes } from "react-router-dom"
import { ArrowUpRight, KeyRound } from "lucide-react"

import { AuroraBackground } from "@/components/AuroraBackground"
import { CorrecaoPage } from "@/features/correcao/CorrecaoPage"
import { PreencherPage } from "@/features/preencher/PreencherPage"

function DevIndex() {
  const usandoMock = !import.meta.env.VITE_N8N_BASE_URL

  // Estes UUIDs/protocolos têm tratamento especial no api.ts: sempre
  // resolvem pra mock local, mesmo com n8n real configurado. Isso permite
  // testar telas a qualquer momento, sem mexer em .env.
  const exemplos = [
    { uuid: "mock-aguardando", titulo: "Aguardando preenchimento", desc: "Convocação com 6 dias úteis." },
    { uuid: "mock-concluido", titulo: "Já concluído", desc: "Tela de agradecimento pós-envio." },
    { uuid: "mock-correcao", titulo: "Concluído (rico, p/ correção)", desc: "Faltas, atrasos e dia extra. Protocolo PROT-TEST-DEMO." },
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

        <div className="mt-6 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur w-fit">
          <span
            className={`size-1.5 rounded-full ${
              usandoMock
                ? "bg-emerald-300 shadow-[0_0_10px_2px_rgba(127,231,196,0.6)]"
                : "bg-[#e8c275] shadow-[0_0_10px_2px_rgba(232,194,117,0.55)]"
            }`}
          />
          {usandoMock ? (
            <>modo mock ativo · defina <code className="text-white/85">VITE_N8N_BASE_URL</code></>
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
                <p className="text-[15px] font-medium text-white/95">{ex.titulo}</p>
                <p className="mt-0.5 text-xs text-white/55">{ex.desc}</p>
              </div>
              <ArrowUpRight className="size-4 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
            </Link>
          ))}
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
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
            Protocolos de teste:{" "}
            <code className="text-[#e8c275]">PROT-TEST-DEMO</code> ·{" "}
            <code className="text-[#e8c275]">PROT-DEMO-1234</code>
          </p>
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
        <Route path="/corrigir" element={<CorrecaoPage />} />
      </Routes>
    </>
  )
}

export default App
