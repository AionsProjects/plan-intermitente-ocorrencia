// Corte do split por benefício — decisão do Isaac em 31/08/2026.
//
// Até a gaveta de **agosto/2026** um pagamento de intermitente é UMA coisa só: uma linha na
// Solicitação de Pagamento com VR e VT juntos e, no pontual, UM pedido/boleto na Caju com os dois
// benefícios no mesmo `allowance`. De **setembro/2026** em diante cada benefício tem a sua linha e
// o seu pedido.
//
// O corte existe porque o passado NÃO se reescreve: agosto já foi pago e conferido no formato
// junto, e retomar um item daquele mês no formato novo colocaria o mesmo pagamento em dois
// formatos dentro da mesma gaveta do board — o DP confere por gaveta.
//
// A gaveta (não a data de execução) é quem decide: no pontual ela é o mês da DATA_INICIO da
// convocação, no mensal é o mês de caixa do pagamento. Pontual de agosto pago com atraso em
// setembro continua saindo junto, porque é na gaveta de AGOSTO/26 que ele vai aparecer.
import type { BeneficioCaju } from "../clients/caju.js"

/** Primeira gaveta (YYYY-MM) que sai com uma linha e um pedido por benefício. */
export const SPLIT_BENEFICIO_A_PARTIR_DE = "2026-09"

/** Gaveta efetiva: a explícita quando existe, senão o mês de `dataIso` (mesma queda do grupo). */
export function caixaEfetiva(caixa: string | undefined | null, dataIso: string): string {
  const c = String(caixa ?? "").slice(0, 7)
  return /^\d{4}-\d{2}$/.test(c) ? c : String(dataIso ?? "").slice(0, 7)
}

/** true = uma linha (e um pedido) por benefício. Gaveta ilegível ESTOURA: escolher o formato
 *  errado num #dinheiro-real é pior que parar o run. */
export function splitPorBeneficio(caixa: string): boolean {
  const c = String(caixa ?? "").slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(c)) throw new Error(`caixa_invalida_para_split:${caixa}`)
  return c >= SPLIT_BENEFICIO_A_PARTIR_DE
}

/**
 * Os grupos de benefício de UM pagamento: `[["VR","VT"]]` antes do corte (tudo junto),
 * `[["VR"],["VT"]]` a partir dele. Quem consome itera — o formato antigo é o caso de um grupo só.
 */
export function gruposBeneficio(caixa: string): BeneficioCaju[][] {
  return splitPorBeneficio(caixa) ? [["VR"], ["VT"]] : [["VR", "VT"]]
}

/** Sufixo de nome/etapa de um grupo: "VR", "VT" ou "" quando o grupo é o par junto. */
export function sufixoGrupo(grupo: BeneficioCaju[]): string {
  return grupo.length === 1 ? grupo[0]! : ""
}
