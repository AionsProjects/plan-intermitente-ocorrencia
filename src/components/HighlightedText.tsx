import { semAcento } from "@/lib/texto"

/**
 * Realça no texto o trecho que casou com a busca.
 *
 * Existia em duas cópias literais (convocar/BuscarEmpregado.tsx e
 * atestados/BuscarPessoa.tsx), cada uma com seu `semAcento` local. A página de
 * atividade seria a terceira, então virou componente.
 *
 * A comparação é sem acento e sem caixa, mas os índices apontam pro texto ORIGINAL —
 * é por isso que `semAcento` preserva pontuação e comprimento.
 */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = semAcento(query.trim())
  if (!q) return <>{text}</>
  const normalizado = semAcento(text)
  const partes: Array<{ text: string; match: boolean }> = []
  let i = 0
  while (i < text.length) {
    const idx = normalizado.indexOf(q, i)
    if (idx === -1) {
      partes.push({ text: text.slice(i), match: false })
      break
    }
    if (idx > i) partes.push({ text: text.slice(i, idx), match: false })
    partes.push({ text: text.slice(idx, idx + q.length), match: true })
    i = idx + q.length
  }
  return (
    <>
      {partes.map((p, j) =>
        p.match ? (
          <mark
            key={j}
            className="rounded-sm px-0.5"
            style={{ backgroundColor: "transparent" }}
          >
            <span className="font-semibold text-[rgb(var(--accent-rgb))] underline decoration-[rgb(var(--accent-rgb))] decoration-2 underline-offset-[3px]">
              {p.text}
            </span>
          </mark>
        ) : (
          <span key={j}>{p.text}</span>
        ),
      )}
    </>
  )
}
