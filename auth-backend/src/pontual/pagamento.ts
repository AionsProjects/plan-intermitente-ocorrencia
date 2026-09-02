// Camada de dados da fase 2 (felipeta): adaptadores snapshot → tipos do mensal, recompose
// do FIFO e validação pura. Nenhuma função aqui faz efeito externo — quem faz é o workflow.
import type { PessoaPreviaMensal, DescontoUpdatePrevia } from "../mensal/types.js"
import type { PrePagamentoCompleto, ReservaDoSnapshot } from "./prepagamento.js"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

/** `calculo->entrada` guardado pela fase 1 — os campos que não têm coluna própria. */
interface EntradaSnapshot {
  funcao?: string
  interior?: string
  optanteVT?: boolean
  vtSoVolta?: boolean
  trabalhaSabado?: boolean
}

function entradaDoCalculo(s: PrePagamentoCompleto): EntradaSnapshot {
  const c = s.calculo as { entrada?: EntradaSnapshot } | null
  return c?.entrada ?? {}
}

/**
 * Snapshot → `PessoaPreviaMensal` — o formato que TODOS os efeitos do mensal consomem
 * (histórico RM, Solicitação, Drive). Um adaptador só, pra os quatro consumidores.
 *
 * Valores SEMPRE do snapshot: é o número que a tela mostrou na criação e que o DP conferiu.
 * Reler o board aqui reabriria a porta pro valor pago divergir do prometido.
 */
export function montarPessoaPagamento(s: PrePagamentoCompleto): PessoaPreviaMensal {
  const entrada = entradaDoCalculo(s)
  return {
    itemId: s.item_origem_id,
    nome: s.nome ?? "",
    chapa: s.chapa,
    cpf: (s.cpf ?? "").replace(/\D/g, ""),
    contrato: s.contrato ?? "",
    funcao: entrada.funcao ?? "",
    unidade: "",
    interior: entrada.interior ?? "NAO",
    dataInicio: s.data_inicio,
    dataFim: s.data_fim,
    diasVR: Number(s.dias_vr) || 0,
    diasVT: Number(s.dias_vt) || 0,
    vrDia: Number(s.vr_dia) || 0,
    vtDia: Number(s.vt_dia) || 0,
    brutoVR: Number(s.bruto_vr) || 0,
    brutoVT: Number(s.bruto_vt) || 0,
    descontoVR: Number(s.desconto_vr) || 0,
    descontoVT: Number(s.desconto_vt) || 0,
    liquidoVR: Number(s.liquido_vr) || 0,
    liquidoVT: Number(s.liquido_vt) || 0,
    creditoVR: Number(s.credito_vr) || 0,
    creditoVT: Number(s.credito_vt) || 0,
    pixVR: Number(s.pix_vr) || 0,
    pixVT: Number(s.pix_vt) || 0,
    regraAplicada: s.regra_aplicada ?? undefined,
  }
}

/** O que a felipeta precisa ler do item de desconto no board, na hora do consumo. */
export interface ItemDescontoAtual {
  id: string
  residualVR: number
  residualVT: number
  descontadoVR: number
  descontadoVT: number
}

/**
 * Recompõe os updates do board Desconto a partir das reservas (deltas) + estado ATUAL do board.
 *
 * Ler o board na hora — em vez de congelar residual/descontado na fase 1 — é decisão de
 * robustez a corrida: entre a criação e a felipeta, o MENSAL pode ter consumido parte do
 * mesmo item (a reserva protege o RESIDUAL de ser prometido duas vezes, mas o descontado
 * acumulado muda). O delta é nosso; a base é a do board no instante do consumo.
 *
 * Reserva apontando pra item que sumiu do board → erro nomeado (não silêncio): consumir
 * "no ar" pagaria a pessoa sem quitar a dívida em lugar nenhum.
 */
export function montarDescontoUpdatesPontual(
  reservas: ReservaDoSnapshot[],
  itensBoard: ItemDescontoAtual[],
): DescontoUpdatePrevia[] {
  const porId = new Map(itensBoard.map((i) => [i.id, i]))
  const out: DescontoUpdatePrevia[] = []
  for (const r of reservas) {
    if (r.vr <= 0 && r.vt <= 0) continue
    const item = porId.get(r.descontoMondayItemId)
    if (!item) {
      throw new Error(`desconto_reservado_sumiu_do_board: item ${r.descontoMondayItemId}`)
    }
    const residualVR = r2(Math.max(0, item.residualVR - r.vr))
    const residualVT = r2(Math.max(0, item.residualVT - r.vt))
    out.push({
      id: r.descontoMondayItemId,
      residualVR,
      residualVT,
      descontadoVR: r2(item.descontadoVR + r.vr),
      descontadoVT: r2(item.descontadoVT + r.vt),
      status: residualVR <= 0 && residualVT <= 0 ? "FINALIZADO" : "PARCIAL",
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Validação — pura, roda no step 1 do workflow ANTES de qualquer efeito.
// ---------------------------------------------------------------------------

/** O que a validação enxerga do ITEM no board (lido por nome via registry). */
export interface ItemBoardValidacao {
  statusConvocacao: string
  dataInicio: string
  dataFim: string
  chapa: string
  cancelamentoInicio: string
}

export type VeredictoValidacao =
  | { acao: "pagar"; semSaldo: boolean }
  | { acao: "ja_pago" }
  | { acao: "recalcular"; motivo: string }
  | { acao: "recusar"; motivo: string }

const normV = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

/**
 * Decide o destino da felipeta. Ordem das checagens importa: cancelamento recusa ANTES de
 * qualquer recálculo (recalcular uma convocação cancelada re-reservaria a dívida de uma
 * convocação que não vai pagar).
 */
export function validarPagamento(
  snapshot: PrePagamentoCompleto | null,
  item: ItemBoardValidacao,
  /** Retomada manual de admin — ver o comentário do `consumido` abaixo. */
  retomadaManual = false,
): VeredictoValidacao {
  const status = normV(item.statusConvocacao)
  const canceladaTotal = status.includes("CANCELADA") && !status.includes("PARCIAL")
  if (canceladaTotal) return { acao: "recusar", motivo: "convocacao_cancelada" }

  // `consumido` diz que o snapshot foi LIDO pelo step do FIFO, não que o dinheiro saiu. No
  // webhook é o sinal certo (re-marcar SIM na coluna não paga de novo). Na retomada manual de um
  // run que morreu no meio é o que impede a recuperação — e só apagar a checagem seria pior: a
  // linha de baixo jogaria no RECÁLCULO, que re-reserva desconto de um pagamento cujas reservas
  // o consumo já apagou. Na retomada o snapshot consumido vale COMO ESTÁ.
  if (snapshot?.estado === "consumido" && !retomadaManual) return { acao: "ja_pago" }

  // Período EFETIVO do board: cancelamento parcial trunca o fim (mesma regra da antifraude).
  let fimEfetivo = item.dataFim
  if (status.includes("PARCIAL") && item.cancelamentoInicio) {
    const d = new Date(item.cancelamentoInicio + "T00:00:00Z")
    d.setUTCDate(d.getUTCDate() - 1)
    fimEfetivo = d.toISOString().slice(0, 10)
  }

  if (!snapshot) return { acao: "recalcular", motivo: "snapshot_ausente" }
  const estadoUtil = snapshot.estado === "reservado" || (retomadaManual && snapshot.estado === "consumido")
  if (!estadoUtil) {
    return { acao: "recalcular", motivo: `snapshot_${snapshot.estado}` }
  }
  if (item.dataInicio && snapshot.data_inicio !== item.dataInicio) {
    return { acao: "recalcular", motivo: "data_inicio_divergente" }
  }
  if (fimEfetivo && snapshot.data_fim !== fimEfetivo) {
    return { acao: "recalcular", motivo: "data_fim_divergente" }
  }
  if (item.chapa && normV(item.chapa) !== normV(snapshot.chapa)) {
    return { acao: "recalcular", motivo: "chapa_divergente" }
  }

  const liquido = (Number(snapshot.liquido_vr) || 0) + (Number(snapshot.liquido_vt) || 0)
  return { acao: "pagar", semSaldo: liquido <= 0 }
}

/**
 * Checagens que RECUSAM depois que o snapshot está resolvido (pós-recálculo inclusive).
 * Devolve a lista de motivos — vazia = pode pagar.
 */
export function motivosRecusa(s: PrePagamentoCompleto): string[] {
  const out: string[] = []
  const liquido = (Number(s.liquido_vr) || 0) + (Number(s.liquido_vt) || 0)
  const chapa = String(s.chapa || "").replace(/\D/g, "").padStart(6, "0")
  if (liquido > 0) {
    if (!chapa || chapa === "000000") out.push("chapa_invalida")
    if (!(s.cpf ?? "").replace(/\D/g, "")) out.push("cpf_ausente")
    if (!(s.cod_secao ?? "").trim()) out.push("codsecao_ausente")
  }
  return out
}
