/**
 * Helpers compartilhados pra busca filtrável de unidades.
 *
 * `normalizarBusca` — caixa alta/baixa ignorada, acentos removidos,
 * caracteres especiais convertidos em espaço, espaços duplicados colapsados.
 *
 * `filtrarPorBusca` — match por partes (split por espaço). Cada palavra
 * do termo precisa estar contida no alvo normalizado. Ex: digitar
 * "rayol sao jose" casa com "SEMSA - SAO JOSE DO RAYOL".
 */

export function normalizarBusca(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function filtrarPorBusca<T extends string>(
  itens: readonly T[] | T[],
  termo: string,
): T[] {
  const t = normalizarBusca(termo)
  if (!t) return [...itens]
  const partes = t.split(" ").filter(Boolean)
  return itens.filter((u) => {
    const alvo = normalizarBusca(u)
    return partes.every((p) => alvo.includes(p))
  })
}
