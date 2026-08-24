// Monday do PONTUAL — Solicitação de Pagamento, débito do Controle Caju e o balãozinho
// de desconto. Builders puros; quem executa é o workflow.
import {
  beneficiosDaSolicitacao,
  montarValuesSolicitacao,
  type SolicitacaoMensalInput,
} from "../mensal/mondayEfeitos.js"
import type { BeneficioCaju } from "../clients/caju.js"
import type { PessoaPreviaMensal } from "../mensal/types.js"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

export const BOARD_DESCONTO_URL = "https://contato-serv.monday.com/boards/18400981023"

export interface SolicitacaoPontualInput extends SolicitacaoMensalInput {
  /** Item da convocação no Plano — o link de tratativa aponta pro PULSE, não pro board. */
  itemPlanoId: string
}

/**
 * Nome do item na Solicitação: `INTERMITENTE - {NOME} - {BENEFÍCIO}`.
 *
 * O sufixo entrou com o split de 08/2026 — o board passou a ter uma linha de VR e uma de VT por
 * pagamento, e sem ele o DP veria dois itens de nome idêntico.
 */
export function montarNomeSolicitacaoPontual(nome: string, beneficio: BeneficioCaju): string {
  return `INTERMITENTE - ${String(nome).trim().toUpperCase()} - ${beneficio}`
}

/** Benefícios que geram linha no board para este pagamento pontual. Mesma regra do mensal. */
export const beneficiosDaSolicitacaoPontual = beneficiosDaSolicitacao

/**
 * Values da Solicitação do pontual = values do mensal com 3 sobrescritas:
 * referência INTERMITENTE (é como o DP filtra pontual × mensal no board), resumo próprio e
 * link de tratativa apontando pro ITEM da convocação (o mensal aponta pro board inteiro).
 *
 * Reusar-e-sobrescrever em vez de duplicar: as colunas de dinheiro (PIX por benefício,
 * IDFINANCs, ids de pedido) têm regra de negócio própria no mensal (base PIX, formato "; ")
 * e é exatamente onde os dois fluxos NÃO podem divergir.
 */
export function montarValuesSolicitacaoPontual(
  inp: SolicitacaoPontualInput,
  beneficio: BeneficioCaju,
): Record<string, unknown> {
  const base = montarValuesSolicitacao(inp, beneficio)
  return {
    ...base,
    color_mkref5wt: { label: "INTERMITENTE" },
    link_mkre40qn: {
      url: `https://contato-serv.monday.com/boards/${inp.planBoardId}/pulses/${inp.itemPlanoId}`,
      text: "Tratativa",
    },
    long_text_mkre1qa0: { text: montarResumoSolicitacaoPontual(inp, beneficio) },
  }
}

export function montarResumoSolicitacaoPontual(
  inp: SolicitacaoPontualInput,
  beneficio: BeneficioCaju,
): string {
  const p = inp.pessoas[0]
  if (!p) return "PONTUAL — sem pessoa (bug: resumo requisitado sem dados)"
  return [
    `INTERMITENTE PONTUAL ${beneficio} - ${p.nome}`,
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

/** O que sobrou de uma dívida depois do abatimento — vem dos updates aplicados no board. */
export interface AbatimentoBalao {
  descontoMondayItemId: string
  vr: number
  vt: number
  /** Residual APÓS o abatimento. Ausente = não deu pra apurar (fifo pulado por idempotência). */
  residualVR?: number
  residualVT?: number
  status?: "PARCIAL" | "FINALIZADO"
}

const fmtBrl = (v: number): string => `R$ ${r2(v).toFixed(2).replace(".", ",")}`

/** Link do ITEM no board de Desconto — é onde a pessoa precisa chegar, não no board. */
export function linkItemDesconto(itemId: string): string {
  return `${BOARD_DESCONTO_URL}/pulses/${itemId}`
}

/**
 * O balãozinho (ponto 4 do brief do Isaac): update no item do Plano contando o desconto
 * abatido, com link do ITEM de cada dívida no board de Desconto.
 *
 * Só existe quando HOUVE desconto — balão dizendo "nada foi abatido" em toda convocação é
 * ruído que ensina o operacional a ignorar o canal, e aí o aviso que importa também passa.
 *
 * Link do pulse, não do board (pedido explícito): mandar alguém pro board com 500 itens pra
 * procurar a dívida da pessoa é o mesmo que não mandar link.
 */
export function montarTextoBalao(
  pessoa: Pick<PessoaPreviaMensal, "descontoVR" | "descontoVT" | "liquidoVR" | "liquidoVT">,
  abatimentos: AbatimentoBalao[],
): string | null {
  const totalVR = r2(pessoa.descontoVR || 0)
  const totalVT = r2(pessoa.descontoVT || 0)
  if (totalVR <= 0 && totalVT <= 0) return null

  const partes = [
    totalVR > 0 ? `VR ${fmtBrl(totalVR)}` : null,
    totalVT > 0 ? `VT ${fmtBrl(totalVT)}` : null,
  ].filter(Boolean)

  const linhas = [`Desconto de benefício abatido nesta convocação: ${partes.join(" e ")}.`, ""]

  const semSaldo = r2((pessoa.liquidoVR || 0) + (pessoa.liquidoVT || 0)) <= 0
  if (semSaldo) {
    linhas.push("O desconto consumiu o benefício inteiro — NADA a pagar nesta convocação.", "")
  }

  const usados = abatimentos.filter((a) => a.vr > 0 || a.vt > 0)
  if (usados.length) {
    linhas.push(usados.length === 1 ? "Dívida abatida:" : "Dívidas abatidas:")
    for (const a of usados) {
      const abatido = [a.vr > 0 ? `VR ${fmtBrl(a.vr)}` : null, a.vt > 0 ? `VT ${fmtBrl(a.vt)}` : null]
        .filter(Boolean).join(" + ")
      // O DESFECHO da dívida é o que o operacional precisa saber: quitou, ou ainda deve
      // quanto? Sem isso o balão informa que "abateu" e deixa a pergunta seguinte no ar.
      let desfecho = ""
      if (a.status === "FINALIZADO") desfecho = " — QUITADA"
      else if (a.status === "PARCIAL") {
        const resta = [
          (a.residualVR ?? 0) > 0 ? `VR ${fmtBrl(a.residualVR!)}` : null,
          (a.residualVT ?? 0) > 0 ? `VT ${fmtBrl(a.residualVT!)}` : null,
        ].filter(Boolean).join(" + ")
        desfecho = resta ? ` — ainda resta ${resta}` : " — quitada"
      }
      linhas.push(`• ${abatido}${desfecho}`)
      linhas.push(`  ${linkItemDesconto(a.descontoMondayItemId)}`)
    }
  } else {
    // Sem detalhe por item (fifo pulado): ainda vale o link do board pra conferência.
    linhas.push(`Detalhe no board de Desconto: ${BOARD_DESCONTO_URL}`)
  }
  return linhas.join("\n")
}
