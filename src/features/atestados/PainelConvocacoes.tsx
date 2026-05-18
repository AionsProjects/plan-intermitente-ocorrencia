import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"
import { AlertCircle, ArrowRight, CalendarRange, FileCheck2, Loader2 } from "lucide-react"

import { useConvocacoesEmpregado } from "./useAtestados"
import type { ConvocacaoResumida, EmpregadoRM } from "./types"

type Props = {
  empregado: EmpregadoRM
  onSelecionar: (convocacao: ConvocacaoResumida) => void
}

function mesAtualISO(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function statusConvocacaoCor(status: string): string {
  if (status === "Válida") return "text-emerald-300"
  if (status.toLowerCase().includes("parcial")) return "text-amber-300"
  if (status.toLowerCase().includes("cancel")) return "text-red-300"
  if (status.toLowerCase().includes("bloque")) return "text-red-300"
  return "text-white/65"
}

export function PainelConvocacoes({ empregado, onSelecionar }: Props) {
  const mes = mesAtualISO()
  const { data, isFetching, isError } = useConvocacoesEmpregado(
    empregado.chapa,
    mes,
  )
  const convocacoes = data ?? []

  function handleTiltMove(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleTiltLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">
        Convocações deste mês
      </p>
      <h1 className="text-display mt-3 text-4xl leading-[1.05] text-white">
        {empregado.nome}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/55">
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 backdrop-blur">
          Chapa {empregado.chapa || "—"}
        </span>
        {empregado.funcao && (
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 backdrop-blur">
            {empregado.funcao}
          </span>
        )}
      </div>

      <p className="mt-5 text-sm leading-relaxed text-white/65">
        Escolha a convocação onde o documento será aplicado. O cálculo de
        desconto considera apenas o período da convocação selecionada.
      </p>

      <div className="mt-7">
        {isFetching && (
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/65">
            <Loader2 className="size-4 animate-spin text-[#e8c275]" />
            Carregando convocações…
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-300/30 bg-rose-300/10 px-4 py-4 text-sm text-rose-100">
            <AlertCircle className="size-4 shrink-0" />
            Erro ao buscar convocações no monday. Tente novamente.
          </div>
        )}

        {!isFetching && !isError && convocacoes.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/65">
            Nenhuma convocação encontrada para este intermitente no mês atual.
          </div>
        )}

        {!isFetching && convocacoes.length > 0 && (
          <ul className="space-y-2.5">
            {convocacoes.map((conv, i) => {
              const qtdDocs = conv.documentosExistentes.length
              return (
                <li
                  key={conv.uuid || conv.itemEntradaId || i}
                  className="fade-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => onSelecionar(conv)}
                    onMouseMove={handleTiltMove}
                    onMouseLeave={handleTiltLeave}
                    className="glass-tile glass-tile-3d group relative flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="icon-3d-host flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8c275]/12 ring-1 ring-[#e8c275]/30">
                        <CalendarRange className="icon-3d-only size-4 text-[#e8c275]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium text-white/95">
                          {format(parseISO(conv.dataInicio), "dd 'de' MMM", {
                            locale: ptBR,
                          })}
                          {" — "}
                          {format(parseISO(conv.dataFim), "dd 'de' MMM", {
                            locale: ptBR,
                          })}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-white/55">
                          {conv.contrato || "Contrato n/d"}
                          {" · "}
                          <span
                            className={statusConvocacaoCor(conv.statusConvocacao)}
                          >
                            {conv.statusConvocacao}
                          </span>
                          {qtdDocs > 0 && (
                            <>
                              {" · "}
                              <span className="inline-flex items-center gap-1 text-amber-200/80">
                                <FileCheck2 className="size-3" />
                                {qtdDocs}{" "}
                                {qtdDocs === 1
                                  ? "doc lançado"
                                  : "docs lançados"}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-white/45 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
