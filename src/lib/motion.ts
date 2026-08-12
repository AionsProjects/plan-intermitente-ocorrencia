/**
 * O usuário quer menos movimento?
 *
 * Checa as DUAS fontes: a preferência do sistema operacional e o toggle "Reduzir
 * animações" do app (que grava `data-reduce-anim="1"` no <html> via lib/theme.ts).
 *
 * ⚠️ Use isto só pro que é IMPERATIVO — `scrollIntoView({behavior})`, timer de
 * destaque, animação por JS. Pra CSS não precisa: `[data-reduce-anim] *`
 * (index.css) e os blocos `@media (prefers-reduced-motion: reduce)` já zeram
 * animação e transição sozinhos. Escrever guarda em JS pra CSS é duplicar a regra em
 * dois lugares que vão divergir.
 */
export function reduzirMotion(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reduceAnim === "1"
  )
}
