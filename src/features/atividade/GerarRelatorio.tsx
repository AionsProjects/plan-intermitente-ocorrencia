import { useState } from "react"
import { Download, Loader2 } from "lucide-react"

import { baixarRelatorio, AtividadeApiError, type PeriodoRelatorio } from "./api"

const PERIODOS: Array<{ v: PeriodoRelatorio; rotulo: string }> = [
  { v: "diario", rotulo: "Diário" },
  { v: "semanal", rotulo: "Semanal" },
  { v: "mensal", rotulo: "Mensal" },
  { v: "personalizado", rotulo: "Personalizado" },
]

const ERROS: Record<string, string> = {
  datas_invalidas: "Preencha as duas datas.",
  de_maior_que_ate: "A data inicial não pode ser depois da final.",
  periodo_maior_que_um_ano: "O período máximo é de um ano.",
}

/**
 * Gera o relatório PDF do histórico.
 *
 * Estado local, não URL: escolher período de relatório não é navegação — F5 não
 * precisa lembrar, e voltar do celular não deve desfazer.
 *
 * O escopo segue o toggle Minhas|Todas da página (`todos`); pro OP o servidor ignora
 * o `todos` de qualquer jeito — o gate real nunca é a tela.
 */
export function GerarRelatorio({ todos }: { todos: boolean }) {
  const [periodo, setPeriodo] = useState<PeriodoRelatorio>("diario")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const personalizado = periodo === "personalizado"
  const pronto = !personalizado || (!!de && !!ate)

  async function gerar() {
    setErro(null)
    setBaixando(true)
    try {
      await baixarRelatorio({ periodo, de, ate, todos })
    } catch (e) {
      setErro(
        e instanceof AtividadeApiError
          ? (ERROS[e.erro] ?? "Não foi possível gerar o relatório.")
          : "Não foi possível gerar o relatório.",
      )
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="mt-5 rounded-[16px] px-4 py-3.5" style={{ background: "var(--glass-inset)", boxShadow: "inset 0 1px 3px rgb(var(--shadow) / 0.3)" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="eyebrow mr-1">Relatório</p>

        <div className="seg-pill seg-pill--sm">
          {PERIODOS.map((p) => (
            <button key={p.v} type="button" data-on={periodo === p.v} onClick={() => setPeriodo(p.v)}>
              {p.rotulo}
            </button>
          ))}
        </div>

        {personalizado && (
          <span className="flex items-center gap-2 text-[12px] text-foreground/55">
            <label className="glass-field flex h-8 items-center gap-1.5 py-0 text-[12px]">
              <span className="text-foreground/45">de</span>
              <input
                type="date"
                value={de}
                max={ate || undefined}
                onChange={(e) => setDe(e.target.value)}
                aria-label="Data inicial do relatório"
                className="bg-transparent text-[12px] outline-none"
              />
            </label>
            <label className="glass-field flex h-8 items-center gap-1.5 py-0 text-[12px]">
              <span className="text-foreground/45">até</span>
              <input
                type="date"
                value={ate}
                min={de || undefined}
                onChange={(e) => setAte(e.target.value)}
                aria-label="Data final do relatório"
                className="bg-transparent text-[12px] outline-none"
              />
            </label>
          </span>
        )}

        <button
          type="button"
          onClick={gerar}
          disabled={baixando || !pronto}
          className="pill-soft inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] disabled:opacity-40"
        >
          {baixando ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
          {baixando ? "Gerando…" : "Baixar PDF"}
        </button>

        <span className="text-[11px] text-foreground/35">
          {todos ? "todas as pessoas" : "só as suas execuções"}
        </span>
      </div>
      {erro && (
        <p className="mt-2 text-[12px] text-[var(--status-red)]" role="alert">{erro}</p>
      )}
    </div>
  )
}
