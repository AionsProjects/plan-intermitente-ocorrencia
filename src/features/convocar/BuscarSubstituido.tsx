import { useEffect, useRef, useState } from "react"
import { Loader2, Search, X } from "lucide-react"

import { useBuscarCeletista } from "@/features/atestados/useAtestados"
import type { EmpregadoRM as EmpregadoAtestado } from "@/features/atestados/types"

/**
 * Quem o intermitente está cobrindo, buscado no RM em vez de digitado.
 *
 * O campo continua aceitando texto livre: nem toda substituição é de um celetista que o RM
 * devolve (cobertura de outro intermitente, posto novo, nome grafado diferente). Escolher da
 * lista é o caminho bom; digitar continua valendo.
 *
 * O que a escolha traz de verdade: **unidade e função** da pessoa coberta — é o trabalho que o
 * intermitente vai fazer, e é isso que o operacional hoje redigita à mão.
 *
 * ⚠️ **Horário não vem.** Nenhuma das SQLs do RM disponíveis devolve jornada/escala: a `2313`
 * (celetista) tem Código, Nome, Chapa, CPF, Função, Admissão e Local/Unidade, e a `BEN 2`
 * (intermitente) tem Seção, Descrição Seção, Chapa, CPF, Admissão, Função e Vale Transporte.
 * Medido no RM em 18/09/2026. Trazer horário exige estender a SQL do lado do RM.
 */
export type PessoaCoberta = Pick<
  EmpregadoAtestado,
  "nome" | "chapa" | "funcao" | "localUnidade" | "contrato"
>

export function BuscarSubstituido({
  valor,
  onChange,
  onSelecionar,
  selecionado,
  onLimparSelecao,
}: {
  valor: string
  onChange: (v: string) => void
  onSelecionar: (p: PessoaCoberta) => void
  selecionado: PessoaCoberta | null
  onLimparSelecao: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const { data, isFetching, ativo } = useBuscarCeletista(selecionado ? "" : valor)
  const resultados = data ?? []

  // Clique fora fecha. Sem isto a lista cobre os campos seguintes do formulário.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto])

  return (
    <div className="space-y-2" ref={caixa}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-foreground/40" />
        <input
          type="text"
          value={valor}
          placeholder="Digite 3 letras do nome"
          onChange={(e) => {
            if (selecionado) onLimparSelecao()
            onChange(e.target.value)
            setAberto(true)
          }}
          onFocus={() => setAberto(true)}
          className="liquid-input w-full px-4 py-3 pl-11 text-sm"
        />
        {isFetching && (
          <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-foreground/40" />
        )}
      </div>

      {selecionado && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-foreground/80">
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] uppercase tracking-wider">
            RM
          </span>
          <span className="font-medium">{selecionado.chapa || "sem chapa"}</span>
          <span className="text-foreground/55">·</span>
          <span>{selecionado.funcao || "função não informada"}</span>
          {selecionado.localUnidade && (
            <>
              <span className="text-foreground/55">·</span>
              <span>{selecionado.localUnidade}</span>
            </>
          )}
          <button
            type="button"
            onClick={onLimparSelecao}
            className="ml-auto flex items-center gap-1 text-foreground/55 transition hover:text-foreground"
          >
            <X className="size-3" />
            trocar
          </button>
        </div>
      )}

      {aberto && ativo && !selecionado && (
        <div className="max-h-56 overflow-y-auto rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--panel))] p-1 shadow-lg">
          {resultados.length === 0 && !isFetching ? (
            <p className="px-3 py-2 text-xs text-foreground/55">
              Ninguém com esse nome no RM — o texto digitado continua valendo.
            </p>
          ) : (
            resultados.slice(0, 8).map((p) => (
              <button
                key={`${p.chapa}-${p.nome}`}
                type="button"
                onClick={() => {
                  onSelecionar(p)
                  setAberto(false)
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition hover:bg-[rgb(var(--ink)/0.06)]"
              >
                <span className="text-sm text-foreground">{p.nome}</span>
                <span className="text-[11px] text-foreground/55">
                  {[p.chapa, p.funcao, p.localUnidade].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
