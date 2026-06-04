import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, ArrowRight, Check, Copy, FlaskConical, Pencil } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import type { ProcessamentoDados } from "./types"

type Props = {
  dados: ProcessamentoDados
  ehCorrecao?: boolean
  ehTeste?: boolean
}

export function TelaObrigado({ dados, ehCorrecao, ehTeste }: Props) {
  const [copiado, setCopiado] = useState(false)

  // Tilt 3D no botão "Fazer outra correção": mesma técnica do .choice-btn
  function handleTiltMove(e: React.MouseEvent<HTMLAnchorElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * 100
    const my = ((e.clientY - r.top) / r.height) * 100
    e.currentTarget.style.setProperty("--mx", String(mx))
    e.currentTarget.style.setProperty("--my", String(my))
  }
  function handleTiltLeave(e: React.MouseEvent<HTMLAnchorElement>) {
    e.currentTarget.style.setProperty("--mx", "50")
    e.currentTarget.style.setProperty("--my", "50")
  }

  const concluidoTexto = dados.concluidoEm
    ? format(parseISO(dados.concluidoEm), "dd/MM/yyyy 'às' HH:mm", {
        locale: ptBR,
      })
    : null

  const editadoTexto =
    dados.editado && dados.editadoEm
      ? format(parseISO(dados.editadoEm), "dd/MM/yyyy 'às' HH:mm", {
          locale: ptBR,
        })
      : null

  async function copiar() {
    if (!dados.protocolo) return
    const texto = dados.protocolo
    // navigator.clipboard só existe em contextos seguros (HTTPS ou localhost).
    // Em HTTP puro (acesso por IP intranet) caímos no fallback execCommand.
    const viaClipboardApi = async () => {
      if (!navigator.clipboard?.writeText) return false
      try {
        await navigator.clipboard.writeText(texto)
        return true
      } catch {
        return false
      }
    }
    const viaExecCommand = () => {
      try {
        const ta = document.createElement("textarea")
        ta.value = texto
        ta.setAttribute("readonly", "")
        ta.style.position = "fixed"
        ta.style.top = "-1000px"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, texto.length)
        const ok = document.execCommand("copy")
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }
    const ok = (await viaClipboardApi()) || viaExecCommand()
    if (ok) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    }
  }

  return (
    <div className="relative z-10 flex min-h-svh flex-col">
      {ehTeste && (
        <div className="sticky top-0 z-30 w-full border-b border-amber-300/20 bg-amber-500/[0.08] px-4 py-2.5 backdrop-blur-md fade-up">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FlaskConical className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="truncate text-xs leading-relaxed text-amber-700/85 dark:text-amber-100/85">
                <span className="font-semibold">Quadro de teste</span>
                <span className="text-amber-700/60 dark:text-amber-100/60"> · nada do que for enviado aqui é registrado de verdade.</span>
              </p>
            </div>
            <Link
              to="/corrigir"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/[0.08] px-3 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-300/15"
            >
              <ArrowLeft className="size-3" />
              Sair do teste
            </Link>
          </div>
        </div>
      )}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="glass-strong w-full max-w-md p-10 text-center fade-up">
        {dados.editado && (
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.1)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[rgb(var(--accent-rgb))]">
            <Pencil className="size-3" />
            Item editado
          </div>
        )}

        <div
          className="mx-auto flex size-16 items-center justify-center rounded-full text-[#06180e] shadow-[0_15px_40px_-10px_rgba(74,222,128,0.55)] ring-1 ring-emerald-200/50"
          style={{
            background:
              "linear-gradient(135deg, #86efac 0%, #4ade80 55%, #22c55e 100%)",
          }}
        >
          <Check className="size-7" strokeWidth={2.4} />
        </div>

        <p className="mt-6 text-[11px] uppercase tracking-[0.32em] text-foreground/55">
          Tudo certo
        </p>
        <h1 className="text-display mt-2 text-4xl leading-tight text-foreground">
          Obrigado pelo <em className="italic text-[rgb(var(--accent-rgb))]">preenchimento</em>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground/70">
          As informações de <span className="text-foreground">{dados.nome}</span>{" "}
          foram registradas com sucesso.
        </p>

        {dados.protocolo && (
          <div className="mt-7 rounded-2xl border border-[rgb(var(--ink)/0.12)] bg-[rgb(var(--ink)/0.05)] p-5 text-left backdrop-blur">
            <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/55">
              Protocolo
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p
                className="text-display text-2xl text-foreground tracking-wide select-all"
                onClick={(e) => {
                  const range = document.createRange()
                  range.selectNodeContents(e.currentTarget)
                  const sel = window.getSelection()
                  sel?.removeAllRanges()
                  sel?.addRange(range)
                }}
              >
                {dados.protocolo}
              </p>
              <button
                type="button"
                onClick={copiar}
                className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--ink)/0.15)] bg-[rgb(var(--ink)/0.05)] px-3 py-1.5 text-xs text-foreground/80 transition-all hover:bg-[rgb(var(--ink)/0.1)] hover:text-foreground"
              >
                {copiado ? (
                  <>
                    <Check className="size-3.5 text-emerald-700 dark:text-emerald-300" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    Copiar
                  </>
                )}
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-foreground/55">
              Guarde este código. Ele permite editar este registro caso seja
              necessário corrigir alguma informação. Também fica registrado
              no monday, na coluna <span className="text-foreground/75">Protocolo</span>.
            </p>
          </div>
        )}

        <div className="mt-5 space-y-1.5">
          {concluidoTexto && (
            <p className="text-xs text-foreground/55">
              Finalizado em {concluidoTexto}
            </p>
          )}
          {editadoTexto && (
            <p className="text-xs text-[rgb(var(--accent-rgb)/0.8)]">
              Editado em {editadoTexto}
            </p>
          )}
        </div>

        {ehCorrecao && (
          <Link
            to="/corrigir"
            onMouseMove={handleTiltMove}
            onMouseLeave={handleTiltLeave}
            className="choice-btn choice-btn--primary mt-8 w-full"
          >
            <span className="inline-flex items-center gap-2">
              Fazer outra correção
              <ArrowRight className="size-4" />
            </span>
          </Link>
        )}

        <p className="mt-8 text-xs text-foreground/45">
          {ehCorrecao
            ? "Ou simplesmente feche esta aba."
            : "Você já pode fechar esta aba."}
        </p>
      </div>
      </div>
    </div>
  )
}
