import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import { useAuth } from "@/components/AuthContext"

interface Atividade {
  id: string
  acao: string
  uuid_alvo: string | null
  pessoa_nome: string | null
  contrato: string | null
  payload_resumo: unknown
  criado_em: string
  operador_email: string | null
  operador_nome: string | null
}

const LABEL_ACAO: Record<string, string> = {
  convocacao: "Convocação",
  registro: "Registro de ocorrência",
  cancelamento: "Cancelamento",
  split: "Divisão de convocação",
  atestado: "Atestado / Declaração",
  ponto_facultativo: "Ponto facultativo",
  desconto: "Registro de desconto",
}

const COR_ACAO: Record<string, string> = {
  convocacao: "text-sky-400",
  registro: "text-emerald-400",
  cancelamento: "text-red-400",
  split: "text-violet-400",
  atestado: "text-amber-400",
  ponto_facultativo: "text-cyan-400",
  desconto: "text-blue-400",
}

async function listar(todos: boolean): Promise<Atividade[]> {
  const res = await fetch(`/api/atividade${todos ? "?todos=1" : ""}`, {
    credentials: "same-origin",
  })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  const data = (await res.json()) as { atividades: Atividade[] }
  return data.atividades ?? []
}

function dataCurta(iso: string): string {
  try {
    return format(parseISO(iso), "dd/MM/yy HH:mm", { locale: ptBR })
  } catch {
    return iso
  }
}

export function AtividadeTab() {
  const { podeVer } = useAuth()
  const podeVerTodos = podeVer("dp") // DP + Admin
  const [todos, setTodos] = useState(false)

  const { data: atividades, isLoading, isError } = useQuery({
    queryKey: ["atividade", todos],
    queryFn: () => listar(todos && podeVerTodos),
    staleTime: 15_000,
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-foreground/55">
          {todos ? "Atividade de todos os usuários." : "Suas ações registradas."}
        </p>
        {podeVerTodos && (
          <button
            type="button"
            onClick={() => setTodos((v) => !v)}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              todos
                ? "bg-[rgb(var(--accent-rgb)/0.16)] text-foreground ring-1 ring-[rgb(var(--accent-rgb)/0.5)]"
                : "border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {todos ? "Vendo: todos" : "Ver todos"}
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-foreground/60">Carregando…</p>}
      {isError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Erro ao carregar atividade.
        </p>
      )}
      {atividades && atividades.length === 0 && (
        <p className="rounded-lg border border-border bg-[rgb(var(--ink)/0.04)] px-3 py-6 text-center text-sm text-foreground/50">
          Nenhuma atividade ainda. As ações aparecem aqui conforme acontecem.
        </p>
      )}

      <div className="space-y-2">
        {atividades?.map((a) => (
          <div
            key={a.id}
            className="rounded-xl border border-border bg-[rgb(var(--ink)/0.04)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-medium ${COR_ACAO[a.acao] ?? "text-foreground"}`}>
                {LABEL_ACAO[a.acao] ?? a.acao}
              </span>
              <span className="shrink-0 text-[11px] text-foreground/40">
                {dataCurta(a.criado_em)}
              </span>
            </div>
            {(a.pessoa_nome || a.contrato) && (
              <p className="mt-0.5 text-sm text-foreground/75">
                {a.pessoa_nome ?? "—"}
                {a.contrato && <span className="text-foreground/45"> · {a.contrato}</span>}
              </p>
            )}
            {todos && (
              <p className="mt-1 text-[11px] text-foreground/45">
                por {a.operador_nome ?? a.operador_email ?? "—"}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
