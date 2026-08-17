// Sábados extras — efeitos no RM, em builders PUROS.
//
// Porta dos nós `Montar SOAP ZMDHSTBENFUNC` e `Payload WF6 (VT)` do WF
// `3TAyDuKFkWGvXTHT`. Reusa `montarXmlHistorico` do mensal em vez de repetir o XML: os
// dois gravam a MESMA tabela (ZMDHSTBENFUNC) e ter dois montadores garante que um deles
// fica velho.
import { montarXmlHistorico, chapa6, codSecaoBase } from "../mensal/rmEfeitos.js"
import { EVENTO_PONTUAL_VT } from "../pontual/rmPontual.js"
import type { PedidoSabados } from "./calculo.js"

/**
 * Registro de histórico do sábado extra: VT (CODBENEFICIO=2) com TPBEN=0.
 *
 * TPBEN=0 é a mesma marca que o pontual usa no boleto — declara que este valor PODE virar
 * lançamento financeiro, ao contrário do crédito (TPBEN=1), que não pode.
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
      tpben: 0,
    }),
  }
}

export interface LancamentoSabados {
  tipo: "Diario"
  coligada: 3
  anoComp: number
  mesComp: number
  contrato: string
  codSecao: string
  chapas: string[]
  /** Só 110 (VT). Sábado extra não paga VR. */
  eventos: string[]
}

/** Payload do lançamento financeiro — o que o WF6 recebia, só evento 110. */
export function montarLancamentoSabados(
  p: PedidoSabados,
  ctx: { codSecao: string },
): LancamentoSabados {
  return {
    tipo: "Diario",
    coligada: 3,
    anoComp: p.anoComp,
    mesComp: p.mesComp,
    contrato: p.contrato,
    codSecao: codSecaoBase(ctx.codSecao),
    chapas: [chapa6(p.chapa)],
    eventos: [EVENTO_PONTUAL_VT],
  }
}

/**
 * Chave de idempotência do sábado extra.
 *
 * Por UUID + sábados, não por chapa+competência: uma correção pode adicionar um sábado à
 * mesma convocação, e isso é um pagamento NOVO — mas refinalizar sem mexer nos sábados não
 * pode pagar de novo. A lista ordenada no meio da chave dá exatamente isso.
 */
export function chaveEfeitoSabados(p: PedidoSabados, alvo: "caju" | "rm_historico" | "rm_financeiro"): string {
  return `sabado_extra:${alvo}:${p.uuid ?? p.chapa}:${p.sabados.join("_")}`
}
