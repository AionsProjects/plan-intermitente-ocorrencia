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

/** `INTERMITENTE-PONTUAL-{NOME}-{CHAPA}-{dd.mm} CREDITO|BOLETO VR|VT` — cap 100 (regra Caju). */
export function montarNomePedidoPontual(
  nome: string,
  chapa: string,
  dataInicio: string,
  tipo: TipoPedidoCaju,
  beneficio: BeneficioCaju,
): string {
  const [, mm, dd] = String(dataInicio).split("-")
  const sufixo = `${dd}.${mm} ${tipo === "credito" ? "CREDITO" : "BOLETO"} ${beneficio}`
  const base = `INTERMITENTE-PONTUAL-${String(nome).trim().toUpperCase()}-${chapa}-${sufixo}`
  return base.length <= 100 ? base : base.slice(0, 100)
}

/**
 * Monta UM pedido (1 pessoa, 1 benefício, 1 tipo). `tem:false` quando o valor é zero —
 * legítimo (ex.: sem crédito de VT). Valor>0 SEM employeeId lança: é o conserto do descarte
 * silencioso de caju.ts:114 que, com 1 pessoa, termina "ok" sem pagar ninguém.
 */
export function montarPedidoCajuPontual(
  pessoa: PessoaPreviaMensal & { employeeId?: string | null },
  tipo: TipoPedidoCaju,
  beneficio: BeneficioCaju,
): PedidoMontadoCaju {
  const valor = tipo === "credito"
    ? (beneficio === "VR" ? pessoa.creditoVR : pessoa.creditoVT)
    : (beneficio === "VR" ? pessoa.pixVR : pessoa.pixVT)
  const centavos = centsCaju(valor)
  const paymentType: PaymentTypeCaju = tipo === "credito" ? "EXISTING_BALANCE" : "PIX_CODE"
  const name = montarNomePedidoPontual(pessoa.nome, pessoa.chapa, pessoa.dataInicio, tipo, beneficio)

  if (centavos <= 0) {
    return { tipoPedido: tipo, beneficio, tem: false, paymentType, totalCentavos: 0, name,
      payload: null, confirmPayload: { paymentStrategies: [{ paymentType, amount: 0 }] } }
  }
  if (!pessoa.employeeId) {
    throw new Error(`pessoa_nao_cadastrada_na_caju: chapa=${pessoa.chapa} nome=${pessoa.nome}`)
  }

  const category = beneficio === "VR" ? "FOOD_AID" : categoriaVT(pessoa.contrato, pessoa.interior)
  const allowances: AllowanceCaju[] = [{ employeeId: pessoa.employeeId, amounts: [{ category, amount: centavos }] }]
  return {
    tipoPedido: tipo,
    beneficio,
    tem: true,
    paymentType,
    totalCentavos: centavos,
    name,
    payload: { sponsorId: config.caju.sponsorId, name, allowances },
    confirmPayload: { paymentStrategies: [{ paymentType, amount: centavos }] },
  }
}
