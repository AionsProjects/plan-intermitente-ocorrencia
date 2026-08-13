// Dados do relatório de pagamento do MENSAL — mesmo documento do pontual, um por CONTRATO.
//
// O mensal paga o contrato inteiro num pedido por benefício, então o relatório tem tabela por
// pessoa e a lista de pedidos sai com quatro linhas (crédito VR/VT + boleto VR/VT). O builder é
// o mesmo do pontual (`montarPedidosRelatorio`) justamente porque a diferença entre "um pedido
// com dois benefícios" e "dois pedidos" é dele, não de quem monta o relatório.
import {
  montarPedidosRelatorio,
  type DadosRelatorioPagamento,
  type DividaRelatorioPagamento,
  type EntradaPedidoRelatorio,
  type PessoaRelatorioPagamento,
} from "../services/relatorioPagamento.js"
import { BOARD_DESCONTO_URL } from "../pontual/mondayPontual.js"
import { ultimoDiaMes, type RefsDriveMensal } from "./driveEfeitos.js"
import type { ContratoPreviaMensal } from "./types.js"

const num = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100

function entradasDeRefs(refs: RefsDriveMensal): EntradaPedidoRelatorio[] {
  const e: EntradaPedidoRelatorio[] = []
  if (refs.pedidoCreditoVR) e.push({ natureza: "CRÉDITO", beneficio: "VR", orderId: refs.pedidoCreditoVR })
  if (refs.pedidoCreditoVT) e.push({ natureza: "CRÉDITO", beneficio: "VT", orderId: refs.pedidoCreditoVT })
  if (refs.pedidoPixVR) e.push({ natureza: "BOLETO", beneficio: "VR", orderId: refs.pedidoPixVR })
  if (refs.pedidoPixVT) e.push({ natureza: "BOLETO", beneficio: "VT", orderId: refs.pedidoPixVT })
  return e
}

function pessoas(contrato: ContratoPreviaMensal): PessoaRelatorioPagamento[] {
  return contrato.pessoas.map((p) => ({
    nome: p.nome,
    chapa: p.chapa,
    cpf: p.cpf,
    brutoVR: p.brutoVR,
    brutoVT: p.brutoVT,
    descontoVR: p.descontoVR,
    descontoVT: p.descontoVT,
    liquidoVR: p.liquidoVR,
    liquidoVT: p.liquidoVT,
    creditoVR: p.creditoVR,
    creditoVT: p.creditoVT,
    pixVR: p.pixVR,
    pixVT: p.pixVT,
  }))
}

/**
 * Dívidas abatidas do contrato — vêm dos `descontoUpdates`, que é a lista por contrato.
 *
 * `abatidoVR/VT` é o DELTA desta rodada (não o `descontadoVR` acumulado do board): uma dívida que
 * já vinha parcialmente abatida de meses anteriores apareceria com valor inflado.
 */
function dividas(contrato: ContratoPreviaMensal): DividaRelatorioPagamento[] {
  return (contrato.descontoUpdates ?? [])
    .filter((u) => num(u.abatidoVR) > 0 || num(u.abatidoVT) > 0)
    .map((u) => ({
      descontoMondayItemId: u.id,
      vr: num(u.abatidoVR),
      vt: num(u.abatidoVT),
      status: u.status,
      residualVR: num(u.residualVR),
      residualVT: num(u.residualVT),
      url: `${BOARD_DESCONTO_URL}/pulses/${u.id}`,
    }))
}

export function montarDadosRelatorioMensal(inp: {
  contrato: ContratoPreviaMensal
  /** "YYYY-MM" */
  competencia: string
  competenciaLabel: string
  refs: RefsDriveMensal & { solicitacaoId?: string | null }
  pastaDriveUrl?: string | null
  geradoPor: string
  geradoEm: Date
}): DadosRelatorioPagamento {
  const [ano, mes] = inp.competencia.split("-").map(Number)
  const dataInicio = `${ano}-${String(mes).padStart(2, "0")}-01`
  const ps = pessoas(inp.contrato)
  const soma = (k: keyof PessoaRelatorioPagamento): number =>
    num(ps.reduce((a, p) => a + (Number(p[k]) || 0), 0))
  return {
    origem: "MENSAL",
    contrato: inp.contrato.contrato,
    periodoLabel: `${inp.competenciaLabel}/${ano}`,
    dataInicio,
    dataFim: ultimoDiaMes(ano!, mes!),
    competenciaLabel: `${inp.competenciaLabel}/${ano}`,
    pessoas: ps,
    pedidos: montarPedidosRelatorio(entradasDeRefs(inp.refs), {
      creditoVR: soma("creditoVR"),
      creditoVT: soma("creditoVT"),
      pixVR: soma("pixVR"),
      pixVT: soma("pixVT"),
    }),
    idfinancVR: inp.refs.idVR ?? null,
    idfinancVT: inp.refs.idVT ?? null,
    solicitacaoUrl: inp.refs.solicitacaoId
      ? `https://contato-serv.monday.com/boards/18393673859/pulses/${inp.refs.solicitacaoId}`
      : null,
    pastaDriveUrl: inp.pastaDriveUrl ?? null,
    dividas: dividas(inp.contrato),
    geradoPor: inp.geradoPor,
    geradoEm: inp.geradoEm,
  }
}
