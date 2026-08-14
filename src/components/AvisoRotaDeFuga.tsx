import { useSyncExternalStore } from "react"
import { AlertTriangle } from "lucide-react"

import { assinarDegradado, sessaoDegradada } from "@/lib/http"

/**
 * Aviso de sessão degradada — alguma chamada saiu do caminho normal.
 *
 * Existe porque fuga silenciosa é pior que fuga nenhuma: no modo `escape` a LEITURA cai
 * pro n8n sozinha, e sem sinal o operador conclui a tarefa achando que veio de onde
 * sempre vem. Pior no caso oposto — escrita que falhou no backend e NÃO foi repetida
 * (de propósito, pra não duplicar desconto/pagamento): sem aviso, "deu erro, vou tentar
 * de novo depois" vira lançamento perdido.
 *
 * Só aparece; não some. Uma vez degradada, a sessão continua suspeita até recarregar —
 * o que já é o gesto certo depois de uma queda.
 */
export function AvisoRotaDeFuga() {
  const degradada = useSyncExternalStore(assinarDegradado, sessaoDegradada, () => false)
  if (!degradada) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4"
    >
      <div
        className="pill-soft pointer-events-auto max-w-[min(92vw,34rem)] px-4 py-2 text-xs"
        style={{
          background: "rgb(245 158 11 / 0.16)",
          boxShadow: "inset 0 1px 0 0 rgb(245 158 11 / 0.35)",
          color: "rgb(252 211 77)",
        }}
        title="Uma ou mais chamadas não seguiram o caminho normal nesta sessão."
      >
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span className="text-left leading-snug">
          Rota de fuga acionada — confira o resultado antes de seguir. Recarregue a página
          quando o sistema voltar ao normal.
        </span>
      </div>
    </div>
  )
}
