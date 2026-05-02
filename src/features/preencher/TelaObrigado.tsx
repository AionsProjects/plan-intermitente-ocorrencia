import { useState } from "react"
import { Check, Copy, Pencil } from "lucide-react"
import { format, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

import type { ProcessamentoDados } from "./types"

export function TelaObrigado({ dados }: { dados: ProcessamentoDados }) {
  const [copiado, setCopiado] = useState(false)

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
    <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12">
      <div className="glass-strong w-full max-w-md p-10 text-center fade-up">
        {dados.editado && (
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-[#e8c275]/30 bg-[#e8c275]/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[#e8c275]">
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

        {dados.protocolo && (
          <div className="mt-7 rounded-2xl border border-white/12 bg-white/5 p-5 text-left backdrop-blur">
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">
              Protocolo
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p
                className="text-display text-2xl text-white tracking-wide select-all"
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
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition-all hover:bg-white/10 hover:text-white"
              >
                {copiado ? (
                  <>
                    <Check className="size-3.5 text-emerald-300" />
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
            <p className="mt-3 text-[11px] leading-relaxed text-white/55">
              Guarde este código. Ele permite editar este registro caso seja
              necessário corrigir alguma informação. Também fica registrado
              no monday, na coluna <span className="text-white/75">Protocolo</span>.
            </p>
          </div>
        )}

        <div className="mt-5 space-y-1.5">
          {concluidoTexto && (
            <p className="text-xs text-white/55">
              Finalizado em {concluidoTexto}
            </p>
          )}
          {editadoTexto && (
            <p className="text-xs text-[#e8c275]/80">
              Editado em {editadoTexto}
            </p>
          )}
        </div>

        <p className="mt-8 text-xs text-white/45">
          Você já pode fechar esta aba.
        </p>
      </div>
    </div>
  )
}
