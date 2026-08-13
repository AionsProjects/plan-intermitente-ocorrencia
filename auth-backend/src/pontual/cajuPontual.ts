// Pedidos Caju do PONTUAL — variante 1-pessoa do montarPedidoCaju do mensal.
//
// Duas diferenças que justificam o arquivo: o NOME do pedido segue o formato do WF5
// (INTERMITENTE-PONTUAL-{NOME}-{CHAPA}-{dd.mm} …), não o do mensal (-MENSAL-{CONTRATO}-MM.YY);
// e a guarda de pessoa-sem-employeeId LANÇA em vez de descartar a allowance calada — no
// mensal isso é caso de borda entre N pessoas, no pontual é o pagamento inteiro sumindo.
import {
  centsCaju,
  categoriaVT,
  type AllowanceCaju,
  type BeneficioCaju,
  type PaymentTypeCaju,
  type PedidoMontadoCaju,
  type TipoPedidoCaju,
} from "../clients/caju.js"
import { config } from "../config.js"
import type { PessoaPreviaMensal } from "../mensal/types.js"

/**
 * `INTERMITENTE-PONTUAL-{NOME}-{CHAPA}-{dd.mm} CREDITO|BOLETO` — cap 100 (regra Caju).
 *
 * Sem sufixo de benefício: no pontual VR e VT vão no MESMO pedido (decisão do Isaac,
 * 13/08), então o nome não tem o que distinguir. O mensal segue com pedido por benefício
 * e nome próprio (`montarNomePedido` em clients/caju.ts).
 */
export function montarNomePedidoPontual(
  nome: string,
  chapa: string,
  dataInicio: string,
  tipo: TipoPedidoCaju,
): string {
  const [, mm, dd] = String(dataInicio).split("-")
  const sufixo = `${dd}.${mm} ${tipo === "credito" ? "CREDITO" : "BOLETO"}`
  const base = `INTERMITENTE-PONTUAL-${String(nome).trim().toUpperCase()}-${chapa}-${sufixo}`
  return base.length <= 100 ? base : base.slice(0, 100)
}

/**
 * Monta UM pedido com VR e VT juntos (1 pessoa, 1 tipo, dois `amounts` no mesmo allowance).
 *
 * É o formato do WF5, retomado por decisão do Isaac (13/08) — só pro PONTUAL. O mensal
 * continua com um pedido por benefício (split de 08/2026), porque lá VR e VT têm boletos e
 * conferências separadas por contrato.
 *
 * `tem:false` quando os dois valores são zero — legítimo (ex.: pagamento 100% crédito não
 * tem boleto). Valor>0 SEM employeeId lança: é o conserto do descarte silencioso de
 * caju.ts:114 que, com 1 pessoa, termina "ok" sem pagar ninguém.
 */
export function montarPedidoCajuPontual(
  pessoa: PessoaPreviaMensal & { employeeId?: string | null },
  tipo: TipoPedidoCaju,
): PedidoMontadoCaju {
  const centavosVR = centsCaju(tipo === "credito" ? pessoa.creditoVR : pessoa.pixVR)
  const centavosVT = centsCaju(tipo === "credito" ? pessoa.creditoVT : pessoa.pixVT)
  const total = centavosVR + centavosVT
  const paymentType: PaymentTypeCaju = tipo === "credito" ? "EXISTING_BALANCE" : "PIX_CODE"
  const name = montarNomePedidoPontual(pessoa.nome, pessoa.chapa, pessoa.dataInicio, tipo)
  // `beneficio` fica no tipo por compatibilidade com PedidoMontadoCaju (o mensal usa), mas
  // aqui o pedido carrega os dois: "VR+VT" documenta isso em log e em artefato.
  const beneficio = "VR" as BeneficioCaju

  if (total <= 0) {
    return { tipoPedido: tipo, beneficio, tem: false, paymentType, totalCentavos: 0, name,
      payload: null, confirmPayload: { paymentStrategies: [{ paymentType, amount: 0 }] } }
  }
  if (!pessoa.employeeId) {
    throw new Error(`pessoa_nao_cadastrada_na_caju: chapa=${pessoa.chapa} nome=${pessoa.nome}`)
  }

  // Ordem VR depois VT, igual ao WF5 (FOOD_AID primeiro) — a Caju não exige, mas o pedido
  // fica idêntico ao histórico e a conferência lado a lado no painel não estranha.
  const amounts: AllowanceCaju["amounts"] = []
  if (centavosVR > 0) amounts.push({ category: "FOOD_AID", amount: centavosVR })
  if (centavosVT > 0) amounts.push({ category: categoriaVT(pessoa.contrato, pessoa.interior), amount: centavosVT })

  const allowances: AllowanceCaju[] = [{ employeeId: pessoa.employeeId, amounts }]
  return {
    tipoPedido: tipo,
    beneficio,
    tem: true,
    paymentType,
    totalCentavos: total,
    name,
    payload: { sponsorId: config.caju.sponsorId, name, allowances },
    confirmPayload: { paymentStrategies: [{ paymentType, amount: total }] },
  }
}
