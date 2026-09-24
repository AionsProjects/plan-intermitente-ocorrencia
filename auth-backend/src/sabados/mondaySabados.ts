// Monday do SÁBADO EXTRA — nome do débito no Controle Caju e o balãozinho no item do Plano.
// Builders puros; quem executa é o job (jobs/sabadoExtra.ts).
import type { PedidoSabados } from "./calculo.js"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100
const fmtBrl = (v: number): string => `R$ ${r2(v).toFixed(2).replace(".", ",")}`
/** ISO puro → dd/mm/aaaa sem passar por Date: data seca não tem fuso. */
const fmtData = (iso: string): string => {
  const [aaaa, mm, dd] = String(iso).slice(0, 10).split("-")
  return `${dd}/${mm}/${aaaa}`
}

/**
 * Item de débito no Controle Caju. O formato do pontual (`INTERMITENTE - {nome} ({data})`) com
 * `SÁBADO EXTRA` no meio: é crédito da mesma pessoa no mesmo saldo, e o DP precisa separar um do
 * outro na conciliação.
 */
export function montarNomeDebitoSabados(nome: string, dataIso: string): string {
  return `INTERMITENTE - ${String(nome).trim().toUpperCase()} - SÁBADO EXTRA (${String(dataIso).slice(0, 10)})`
}

/**
 * Balãozinho no item do Plano: o registro, na própria convocação, de que houve sábado extra, de
 * quanto foi e de qual pedido pagou. É onde o operacional olha — o Histórico não é.
 *
 * `summaryUrl` vem pronto de quem chama: montar o link aqui puxaria o cliente da Caju (e o env)
 * para um builder que tem de rodar sem nada.
 */
export function montarTextoBalaoSabados(
  p: Pick<PedidoSabados, "sabados" | "qtdSabados" | "vtDia" | "valorTotal">,
  pedido: { orderId: string | null; summaryUrl?: string },
): string {
  const datas = p.sabados.map(fmtData)
  const lista = datas.length > 1 ? `${datas.slice(0, -1).join(", ")} e ${datas[datas.length - 1]}` : (datas[0] ?? "")
  const qtd = `${p.qtdSabados} ${p.qtdSabados === 1 ? "sábado" : "sábados"}`
  const linhas = [
    `Sábado extra nesta convocação: ${lista} (${qtd}).`,
    `VT do sábado: ${fmtBrl(p.vtDia)} por dia, total ${fmtBrl(p.valorTotal)}, pago em crédito Caju.`,
  ]
  if (pedido.orderId) {
    linhas.push(`Pedido Caju ${pedido.orderId} (confirmado)${pedido.summaryUrl ? `: ${pedido.summaryUrl}` : ""}`)
  }
  return linhas.join("\n")
}
