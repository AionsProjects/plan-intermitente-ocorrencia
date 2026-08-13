// Monday do PONTUAL — Solicitação de Pagamento, débito do Controle Caju e o balãozinho
// de desconto. Builders puros; quem executa é o workflow.
import {
  montarValuesSolicitacao,
  type SolicitacaoMensalInput,
} from "../mensal/mondayEfeitos.js"
import type { PessoaPreviaMensal } from "../mensal/types.js"
import type { ReservaDoSnapshot } from "./prepagamento.js"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

export const BOARD_DESCONTO_URL = "https://contato-serv.monday.com/boards/18400981023"

export interface SolicitacaoPontualInput extends SolicitacaoMensalInput {
  /** Item da convocação no Plano — o link de tratativa aponta pro PULSE, não pro board. */
  itemPlanoId: string
}

/** Nome do item na Solicitação — WF5-fiel: `INTERMITENTE - {NOME}`. */
export function montarNomeSolicitacaoPontual(nome: string): string {
  return `INTERMITENTE - ${String(nome).trim().toUpperCase()}`
}

/**
 * Values da Solicitação do pontual = values do mensal com 3 sobrescritas:
 * referência INTERMITENTE (é como o DP filtra pontual × mensal no board), resumo próprio e
 * link de tratativa apontando pro ITEM da convocação (o mensal aponta pro board inteiro).
 *
 * Reusar-e-sobrescrever em vez de duplicar: as colunas de dinheiro (PIX por benefício,
 * IDFINANCs, ids de pedido) têm regra de negócio própria no mensal (base PIX, formato "; ")
 * e é exatamente onde os dois fluxos NÃO podem divergir.
 */
export function montarValuesSolicitacaoPontual(inp: SolicitacaoPontualInput): Record<string, unknown> {
  const base = montarValuesSolicitacao(inp)
  return {
    ...base,
    color_mkref5wt: { label: "INTERMITENTE" },
    link_mkre40qn: {
      url: `https://contato-serv.monday.com/boards/${inp.planBoardId}/pulses/${inp.itemPlanoId}`,
      text: "Tratativa",
    },
    long_text_mkre1qa0: { text: montarResumoSolicitacaoPontual(inp) },
  }
}

export function montarResumoSolicitacaoPontual(inp: SolicitacaoPontualInput): string {
  const p = inp.pessoas[0]
  if (!p) return "PONTUAL — sem pessoa (bug: resumo requisitado sem dados)"
  return [
    `INTERMITENTE PONTUAL - ${p.nome}`,
    `Chapa: ${p.chapa || "-"} | CPF: ${p.cpf || "-"} | Contrato: ${p.contrato}`,
    `Período: ${p.dataInicio} a ${p.dataFim}`,
    `VR: R$ ${r2(p.liquidoVR || 0)} | VT: R$ ${r2(p.liquidoVT || 0)}`,
    `Crédito Caju: R$ ${r2((p.creditoVR || 0) + (p.creditoVT || 0))}`,
    `Boleto PIX: R$ ${r2((p.pixVR || 0) + (p.pixVT || 0))}`,
    `Desconto abatido: VR R$ ${r2(p.descontoVR || 0)} | VT R$ ${r2(p.descontoVT || 0)}`,
    `Pedido Crédito VR: ${inp.pedidoCreditoVR || "-"} | VT: ${inp.pedidoCreditoVT || "-"}`,
    `Pedido PIX VR: ${inp.pedidoPixVR || "-"} | VT: ${inp.pedidoPixVT || "-"}`,
    `RM idVR: ${inp.idVR || "-"} | idVT: ${inp.idVT || "-"}`,
  ].join("\n")
}

/** Nome do item de débito no Controle Caju — WF5-fiel: `INTERMITENTE - {nome} ({data})`. */
export function montarNomeDebitoPontual(nome: string, dataIso: string): string {
  return `INTERMITENTE - ${String(nome).trim().toUpperCase()} (${dataIso})`
}

/**
 * O balãozinho (ponto 4 do brief): update no item do Plano contando o desconto abatido,
 * com link pro board de Desconto. Só existe quando HOUVE desconto — balão dizendo "nada
 * foi abatido" é ruído que ensina o operacional a ignorar o canal.
 */
export function montarTextoBalao(
  pessoa: Pick<PessoaPreviaMensal, "descontoVR" | "descontoVT" | "liquidoVR" | "liquidoVT">,
  reservas: ReservaDoSnapshot[],
): string | null {
  const totalVR = r2(pessoa.descontoVR || 0)
  const totalVT = r2(pessoa.descontoVT || 0)
  if (totalVR <= 0 && totalVT <= 0) return null
  const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`
  const linhas = [
    `💰 Desconto de benefício abatido nesta convocação: VR ${fmt(totalVR)} | VT ${fmt(totalVT)}.`,
  ]
  const semSaldo = r2((pessoa.liquidoVR || 0) + (pessoa.liquidoVT || 0)) <= 0
  if (semSaldo) {
    linhas.push(`⚠️ O desconto consumiu o benefício inteiro — NADA a pagar nesta convocação.`)
  }
  if (reservas.length) {
    linhas.push(
      `Dívidas quitadas/abatidas: ` +
        reservas
          .filter((rr) => rr.vr > 0 || rr.vt > 0)
          .map((rr) => `item ${rr.descontoMondayItemId} (VR ${fmt(r2(rr.vr))}, VT ${fmt(r2(rr.vt))})`)
          .join("; "),
    )
  }
  linhas.push(`Detalhe no board de Desconto: ${BOARD_DESCONTO_URL}`)
  return linhas.join("\n")
}
