import { Search, X } from "lucide-react"

import { nomeLimpo } from "@/lib/texto"
import { ACOES_FILTRAVEIS, rotuloAcao } from "./types"

export type Periodo = "hoje" | "7d" | "30d" | "tudo"

export interface Filtros {
  busca: string
  tipos: string[]
  quem: string
  periodo: Periodo
  soErro: boolean
  todos: boolean
}

const PERIODOS: Array<{ v: Periodo; rotulo: string }> = [
  { v: "hoje", rotulo: "Hoje" },
  { v: "7d", rotulo: "7 dias" },
  { v: "30d", rotulo: "30 dias" },
  { v: "tudo", rotulo: "Tudo" },
]

export function BarraFiltros({
  filtros,
  contagemPorTipo,
  operadores,
  qtdErros,
  podeVerTodos,
  onMudar,
  onLimpar,
}: {
  filtros: Filtros
  /** Contagem no conjunto carregado — dá noção de volume antes de clicar. */
  contagemPorTipo: Record<string, number>
  operadores: string[]
  qtdErros: number
  podeVerTodos: boolean
  onMudar: (parcial: Partial<Filtros>) => void
  onLimpar: () => void
}) {
  const temFiltro =
    !!filtros.busca || filtros.tipos.length > 0 || !!filtros.quem ||
    filtros.periodo !== "tudo" || filtros.soErro

  const alternarTipo = (t: string) => {
    onMudar({
      tipos: filtros.tipos.includes(t)
        ? filtros.tipos.filter((x) => x !== t)
        : [...filtros.tipos, t],
    })
  }

  return (
    <div className="space-y-3">
      {/* Busca + escopo */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="glass-field flex min-w-[16rem] flex-1 items-center gap-2.5">
          <Search className="size-4 shrink-0 text-foreground/35" aria-hidden />
          <input
            type="search"
            value={filtros.busca}
            onChange={(e) => onMudar({ busca: e.target.value })}
            placeholder="nome, contrato, fase, erro, id…"
            aria-label="Buscar no histórico"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground/30"
          />
          {filtros.busca && (
            <button
              type="button"
              onClick={() => onMudar({ busca: "" })}
              aria-label="Limpar busca"
              className="shrink-0 text-foreground/35 hover:text-foreground/70"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Escopo é binário e mutuamente exclusivo — é o que o seg-pill faz.
            Só DP/Admin: o backend só honra ?todos=1 pra eles, e insinuar
            permissão que o operador não tem é pior que não mostrar nada. */}
        {podeVerTodos && (
          <div className="seg-pill shrink-0">
            <button type="button" data-on={!filtros.todos} onClick={() => onMudar({ todos: false, quem: "" })}>
              Minhas
            </button>
            <button type="button" data-on={filtros.todos} onClick={() => onMudar({ todos: true })}>
              Todas
            </button>
          </div>
        )}
      </div>

      {/* Tipo de execução — multi-seleção. Nada marcado = todos (sem chip "Todos",
          que é estado redundante e precisa de lógica de exclusão). */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible [scrollbar-width:none]">
        {ACOES_FILTRAVEIS.map((t) => {
          const n = contagemPorTipo[t] ?? 0
          const on = filtros.tipos.includes(t)
          return (
            <button
              key={t}
              type="button"
              // O padding default do .glass-chip é 10px/20px — grande demais pra
              // oito chips. Utilities vencem @layer components.
              className="glass-chip shrink-0 px-3 py-1.5 text-[12px] disabled:opacity-40"
              data-on={on ? "true" : "false"}
              aria-pressed={on}
              disabled={n === 0 && !on}
              onClick={() => alternarTipo(t)}
            >
              {rotuloAcao(t)}
              {n > 0 && <span className="font-mono text-[10px] text-foreground/45">{n}</span>}
            </button>
          )
        })}
      </div>

      {/* Período, só-erro, executora, limpar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="seg-pill">
          {PERIODOS.map((p) => (
            <button key={p.v} type="button" data-on={filtros.periodo === p.v} onClick={() => onMudar({ periodo: p.v })}>
              {p.rotulo}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="glass-chip px-3 py-1.5 text-[12px]"
          data-on={filtros.soErro ? "true" : "false"}
          aria-pressed={filtros.soErro}
          onClick={() => onMudar({ soErro: !filtros.soErro })}
        >
          <span className="lamp lamp--red" aria-hidden /> só com erro
          {qtdErros > 0 && <span className="font-mono text-[10px] text-foreground/45">{qtdErros}</span>}
        </button>

        {/* Opções derivadas das linhas carregadas: /api/usuarios é admin-only, então
            um DP tomaria 403 tentando listar gente.

            `min-w-0 max-w-full` no LABEL, não só no select: o select nativo se
            dimensiona pela opção mais longa ("KARINE ROMASKEVIS DE OLIVEIRA" dava
            303px), e como o label é o flex item, sem isso ele não encolhia e estourava
            o painel em 375px — a página não rolava, então o conteúdo era cortado, que
            é pior. */}
        {filtros.todos && operadores.length > 1 && (
          <label className="glass-field flex min-w-0 max-w-full items-center gap-2 py-1.5 text-[12px]">
            <span className="shrink-0 text-foreground/45">Quem</span>
            <select
              value={filtros.quem}
              onChange={(e) => onMudar({ quem: e.target.value })}
              className="min-w-0 flex-1 truncate bg-transparent text-[12px] outline-none"
            >
              <option value="">todas as pessoas</option>
              {operadores.map((o) => (
                // `value` é o nome BRUTO (é o que casa com o dado); só o rótulo é limpo.
                <option key={o} value={o}>{nomeLimpo(o) ?? o}</option>
              ))}
            </select>
          </label>
        )}

        {temFiltro && (
          <button type="button" onClick={onLimpar} className="pill-soft px-3 py-1.5 text-[12px]">
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  )
}
