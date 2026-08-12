/**
 * Copia texto pra área de transferência, com fallback.
 *
 * `navigator.clipboard` só existe em contexto seguro (HTTPS ou localhost). O padrão
 * estava inline em preencher/TelaObrigado.tsx, escrito quando o app era servido por
 * HTTP puro no IP da intranet; a VM morreu, mas o fallback continua barato e o
 * histórico é aberto no celular, onde WebView estranha acontece.
 *
 * Devolve `true` se copiou — quem chama decide o que mostrar.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto)
      return true
    } catch {
      /* cai no fallback */
    }
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = texto
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
