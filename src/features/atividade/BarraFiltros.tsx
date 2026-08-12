import { Search, UserRound, X } from "lucide-react"

import { ComboboxFiltravel } from "@/components/ui/combobox-filtravel"
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
        <div className="glass-field flex h-10 min-w-[16rem] flex-1 items-center gap-2.5 py-0">
          <Search className="size-4 shrink-0 text-foreground/35" aria-hidden />
          <input
            type="search"
            value={filtros.busca}
            onChange={(e) => onMudar({ busca: e.target.value })}
            placeholder="nome, contrato, fase, erro, id…"
            aria-label="Buscar no histórico"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-foreground/35"
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
          <div className="seg-pill seg-pill--sm shrink-0">
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
              className="glass-chip h-8 shrink-0 px-3 text-[12px] disabled:opacity-40"
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
        <div className="seg-pill seg-pill--sm">
          {PERIODOS.map((p) => (
            <button key={p.v} type="button" data-on={filtros.periodo === p.v} onClick={() => onMudar({ periodo: p.v })}>
              {p.rotulo}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="glass-chip h-8 px-3 text-[12px]"
          data-on={filtros.soErro ? "true" : "false"}
          aria-pressed={filtros.soErro}
          onClick={() => onMudar({ soErro: !filtros.soErro })}
        >
          <span className="lamp lamp--red" aria-hidden /> só com erro
          {qtdErros > 0 && <span className="font-mono text-[10px] text-foreground/45">{qtdErros}</span>}
        </button>

        {/* Combobox da casa, não <select> nativo: o popup do sistema (branco, seleção
            azul do SO) quebrava o mundo de vidro — foi um dos "não se encaixa"
            apontados. Opções derivadas das linhas carregadas: /api/usuarios é
            admin-only, e um DP tomaria 403 tentando listar gente.

            Exibe o nome LIMPO e mapeia de volta pro bruto no onChange — é o bruto que
            casa com o dado das linhas. */}
        {filtros.todos && operadores.length > 1 && (
          <div className="w-full max-w-[16rem]">
            <ComboboxFiltravel
              valor={filtros.quem ? (nomeLimpo(filtros.quem) ?? filtros.quem) : ""}
              opcoes={["Todas as pessoas", ...operadores.map((o) => nomeLimpo(o) ?? o)]}
              onChange={(v) => {
                if (v === "Todas as pessoas") return onMudar({ quem: "" })
                const bruto = operadores.find((o) => (nomeLimpo(o) ?? o) === v)
                onMudar({ quem: bruto ?? v })
              }}
              placeholder="Quem executou"
              buscaPlaceholder="Buscar pessoa…"
              noMatchMessage="Ninguém com esse nome no período"
              iconeOpcao={UserRound}
              compacto
            />
          </div>
        )}

        {temFiltro && (
          <button type="button" onClick={onLimpar} className="pill-soft h-8 px-3 text-[12px]">
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  )
}
