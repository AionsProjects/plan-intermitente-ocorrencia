import { useEffect, useRef, useState } from "react"
import { format, parseISO } from "date-fns"
import { Loader2, Send, Trash2, X } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { ChoiceButton } from "./ChoiceButton"
import { rotuloDocumento, formatarBytes } from "./shared"
import type { DocumentoLancamento, SessaoLancamento } from "./types"

type Props = {
  sessao: SessaoLancamento
  enviando: boolean
  open: boolean
  erro?: string | null
  onAbrir: () => void
  onFechar: () => void
  onRemover: (id: string) => void
  onConcluir: () => void
}

export function ResumoSessao({
  sessao,
  enviando,
  open,
  erro,
  onAbrir,
  onFechar,
  onRemover,
  onConcluir,
}: Props) {
  const total = sessao.documentos.length

  // Pulso ao incrementar (compara contador anterior)
  const prevTotalRef = useRef(total)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (total > prevTotalRef.current) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 560)
      prevTotalRef.current = total
      return () => clearTimeout(t)
    }
    prevTotalRef.current = total
  }, [total])

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

  // Agrupa docs por chapa pra render
  const grupos = (() => {
    const map = new Map<string, { chapa: string; nome: string; docs: DocumentoLancamento[] }>()
    for (const d of sessao.documentos) {
      const key = d.chapa || d.empregadoNome
      if (!map.has(key)) {
        map.set(key, { chapa: d.chapa, nome: d.empregadoNome, docs: [] })
      }
      map.get(key)!.docs.push(d)
    }
    return [...map.values()]
  })()

  return (
    <>
      {total > 0 && (
        <div className="resumo-dock group fixed bottom-6 right-6 z-40">
          <div className="resumo-dock-preview">
            <div className="resumo-dock-preview-card">
              <p className="text-[9px] uppercase tracking-[0.28em] text-amber-100/65">
                Sessão · {total} {total === 1 ? "doc" : "docs"}
              </p>
              <ul className="mt-2 space-y-1.5">
                {grupos.slice(0, 4).map((g) => (
                  <li
                    key={g.chapa || g.nome}
                    className="flex items-center justify-between gap-3 text-xs text-white/85"
                  >
                    <span className="truncate">
                      {g.nome.split(" ").slice(0, 2).join(" ")}
                    </span>
                    <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                      {g.docs.length}
                    </span>
                  </li>
                ))}
                {grupos.length > 4 && (
                  <li className="text-[10px] text-white/45">
                    +{grupos.length - 4} pessoas
                  </li>
                )}
              </ul>
              <p className="mt-3 text-[9px] uppercase tracking-[0.22em] text-amber-100/55">
                Clique pra abrir
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onAbrir}
            onMouseMove={handleTiltMove}
            onMouseLeave={handleTiltLeave}
            className={`floating-resumo relative inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-[#0a1224]/85 px-5 py-3 text-sm font-medium text-amber-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl hover:border-amber-300/70 hover:bg-[#0a1224]/95 ${
              pulse ? "pulse-on-add" : ""
            }`}
          >
            <span
              className={`flex size-6 items-center justify-center rounded-full bg-amber-300/20 text-xs font-semibold text-amber-100 ${
                pulse ? "badge-bounce" : ""
              }`}
            >
              {total}
            </span>
            Resumo
            {sessao.ultimaPessoa && (
              <span className="ml-1 hidden text-xs text-amber-100/55 sm:inline">
                · última: {sessao.ultimaPessoa.nome.split(" ")[0]}
              </span>
            )}
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && onFechar()}>
        <DialogContent
          className="glass-modal border-0 bg-transparent p-8 text-white sm:max-w-lg"
          style={{
            backdropFilter: "blur(10px) saturate(140%) brightness(1.05)",
          }}
        >
          <DialogHeader>
            <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200/80">
              Resumo
            </p>
            <DialogTitle className="text-display text-3xl text-white">
              Documentos <em className="italic text-[#e8c275]">adicionados</em>
            </DialogTitle>
            <DialogDescription className="text-white/65">
              {total === 0
                ? "Nenhum documento na sessão."
                : "Revise antes de concluir. O envio só acontece em Concluir."}
            </DialogDescription>
          </DialogHeader>

          {total > 0 && (
            <ul className="mt-2 max-h-[55vh] space-y-3.5 overflow-y-auto pr-1">
              {grupos.map((g) => (
                <li key={g.chapa || g.nome} className="space-y-1.5">
                  {grupos.length > 1 && (
                    <p className="px-1 text-[10px] uppercase tracking-[0.28em] text-white/45">
                      {g.nome}
                      {g.chapa ? (
                        <span className="text-white/30"> · chapa {g.chapa}</span>
                      ) : null}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {g.docs.map((doc) => (
                      <ItemResumo key={doc.id} doc={doc} onRemover={onRemover} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {erro && (
            <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-3 text-center text-sm text-rose-100">
              {erro}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-2">
            <ChoiceButton
              variant="ghost"
              onClick={onFechar}
              disabled={enviando}
            >
              Continuar adicionando
            </ChoiceButton>
            <ChoiceButton
              variant="primary"
              onClick={onConcluir}
              disabled={total === 0 || enviando}
              className="inline-flex items-center justify-center gap-2"
            >
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Concluir e enviar
                </>
              )}
            </ChoiceButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ItemResumo({
  doc,
  onRemover,
}: {
  doc: DocumentoLancamento
  onRemover: (id: string) => void
}) {
  const rotulo = doc.tipoDocumentacaoLabel
    ? doc.tipoDocumentacaoLabel
    : rotuloDocumento(doc.tipoDocumento ?? "atestado", doc.periodos ?? [])
  const periodo =
    doc.dataInicio === doc.dataFim
      ? format(parseISO(doc.dataInicio), "dd/MM/yyyy")
      : `${format(parseISO(doc.dataInicio), "dd/MM")} a ${format(parseISO(doc.dataFim), "dd/MM/yyyy")}`

  const ehDeclaracao =
    doc.tipoDocumento === "declaracao" ||
    (doc.tipoDocumentacaoLabel ?? "").toLowerCase().startsWith("declaração")
  const ehCLT = doc.modalidadeContrato === "CELETISTA"
  const toneClass = ehCLT
    ? "preview-doc-tile tone-declaracao"
    : ehDeclaracao
      ? "preview-doc-tile tone-declaracao"
      : "preview-doc-tile tone-atestado"

  return (
    <li className={`${toneClass} rounded-2xl border border-white/12 bg-white/5 p-4 pl-6`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white/95">{rotulo}</p>
          <p className="mt-0.5 text-xs text-white/65">{doc.empregadoNome}</p>
          <p className="mt-2 text-xs text-white/55">{periodo}</p>
          <p className="mt-1 text-xs text-white/45">
            {doc.nomeArquivo} · {formatarBytes(doc.tamanhoArquivo)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemover(doc.id)}
          aria-label="Remover documento"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/55 transition hover:border-rose-300/50 hover:bg-rose-400/10 hover:text-rose-200"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  )
}

export { X }
