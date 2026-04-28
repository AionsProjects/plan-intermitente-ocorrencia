import { Check } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import type { ProcessamentoDados } from "./types"

export function TelaObrigado({ dados }: { dados: ProcessamentoDados }) {
  const concluidoTexto = dados.concluidoEm
    ? format(parseISO(dados.concluidoEm), "dd/MM/yyyy 'às' HH:mm", {
        locale: ptBR,
      })
    : null

  return (
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong w-full max-w-md p-10 text-center fade-up">
        <div
          className="mx-auto flex size-16 items-center justify-center rounded-full text-[#06180e] shadow-[0_15px_40px_-10px_rgba(74,222,128,0.55)] ring-1 ring-emerald-200/50"
          style={{
            background:
              "linear-gradient(135deg, #86efac 0%, #4ade80 55%, #22c55e 100%)",
          }}
        >
          <Check className="size-7" strokeWidth={2.4} />
        </div>

        <p className="mt-6 text-[11px] uppercase tracking-[0.32em] text-white/55">
          Tudo certo
        </p>
        <h1 className="text-display mt-2 text-4xl leading-tight text-white">
          Obrigado pelo <em className="italic text-[#e8c275]">preenchimento</em>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          As informações de <span className="text-white">{dados.nome}</span>{" "}
          foram registradas com sucesso.
        </p>

        {concluidoTexto ? (
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 backdrop-blur">
            Finalizado em {concluidoTexto}
          </div>
        ) : null}

        <p className="mt-8 text-xs text-white/45">
          Você já pode fechar esta aba.
        </p>
      </div>
    </div>
  )
}
