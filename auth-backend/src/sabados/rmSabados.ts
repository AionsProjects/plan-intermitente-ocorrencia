// Sábados extras — efeitos no RM, em builders PUROS.
//
// Porta do nó `Montar SOAP ZMDHSTBENFUNC` do WF `3TAyDuKFkWGvXTHT`. Reusa `montarXmlHistorico`
// do mensal em vez de repetir o XML: os dois gravam a MESMA tabela (ZMDHSTBENFUNC) e ter dois
// montadores garante que um deles fica velho.
//
// O `Payload WF6 (VT)` do WF (lançamento financeiro, evento 110) NÃO tem mais porta: desde
// 24/09/2026 o sábado é pago em CRÉDITO Caju, que sai do saldo da empresa e não vira conta a
// pagar — o mesmo "100% crédito → sem lançamento financeiro" do pontual.
import { montarXmlHistorico, chapa6, codSecaoBase } from "../mensal/rmEfeitos.js"
import type { PedidoSabados } from "./calculo.js"

/**
 * Registro de histórico do sábado extra: VT (CODBENEFICIO=2) com TPBEN=1.
 *
 * TPBEN=1 é a marca que o pontual usa no crédito — declara que este valor NÃO vira lançamento
 * financeiro (o boleto, TPBEN=0, vira). Até 24/09/2026 o sábado era boleto e gravava 0.
 *
 * ⚠️ Divergência conhecida com o WF: o XML do WF não manda `CODSECAO` nem `DATAIMPORT`, e
 * usa ANOREF/MESREF iguais ao ANOCOMP/MESCOMP. `montarXmlHistorico` manda os dois campos e
 * usa REF = competência anterior — a convenção validada em produção no mensal (6/6
 * contratos, 13/07). Não é campo de valor, mas muda o período de referência da linha; vale
 * conferir com o DP no primeiro lançamento.
 */
export function montarHistoricoSabados(
  p: PedidoSabados,
  ctx: { codSecao: string; dataImport: string },
): { chapa: string; valor: number; dadosXml: string } {
  const chapa = chapa6(p.chapa)
  return {
    chapa,
    valor: p.valorTotal,
    dadosXml: montarXmlHistorico({
      anoComp: p.anoComp,
      mesComp: p.mesComp,
      chapa,
      nome: p.nome,
      codSecao: codSecaoBase(ctx.codSecao),
      codBeneficio: 2,
      vlrTotal: p.valorTotal,
      dataImport: ctx.dataImport,
      tpben: 1,
    }),
  }
}

/**
 * Chave de idempotência do sábado extra.
 *
 * Por UUID + sábados, não por chapa+competência: uma correção pode adicionar um sábado à
 * mesma convocação, e isso é um pagamento NOVO — mas refinalizar sem mexer nos sábados não
 * pode pagar de novo. A lista ordenada no meio da chave dá exatamente isso.
 */
export type AlvoEfeitoSabados = "caju" | "controle_caju" | "balao" | "rm_historico"

export function chaveEfeitoSabados(p: PedidoSabados, alvo: AlvoEfeitoSabados): string {
  return `sabado_extra:${alvo}:${p.uuid ?? p.chapa}:${p.sabados.join("_")}`
}

/** Prefixo das chaves do pedido Caju dos sábados de UMA convocação. */
export function prefixoChaveCajuSabados(uuid: string): string {
  return `sabado_extra:caju:${uuid}:`
}

/**
 * Sábados já cobrados de uma convocação, lidos das chaves do pedido Caju no ledger.
 *
 * A chave leva a LISTA de sábados do pedido. Uma correção que acrescenta um sábado muda a
 * lista, muda a chave — e, sem esta leitura, o job pagava de novo os que já tinham sido pagos.
 * Quem chama cobra só a diferença.
 */
export function sabadosDasChaves(chaves: readonly string[], uuid: string): Set<string> {
  const prefixo = prefixoChaveCajuSabados(uuid)
  const out = new Set<string>()
  for (const c of chaves) {
    if (!c.startsWith(prefixo)) continue
    for (const d of c.slice(prefixo.length).split("_")) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.add(d)
  }
  return out
}

/**
 * Chave do modo SIMULADO: namespace próprio, por job — o mesmo desenho do `pontual-sim:`.
 *
 * Simular nunca pode confirmar a chave REAL. Se confirmasse, o sábado registrado com a flag
 * desligada ficaria "já pago" no ledger e, ao ligar a flag, refinalizar a mesma convocação
 * pularia o pagamento — o VT daquele sábado nunca sairia, calado.
 */
export function chaveEfeitoSabadosSimulado(jobId: string, alvo: AlvoEfeitoSabados): string {
  return `sabado_extra-sim:${jobId}:${alvo}`
}
