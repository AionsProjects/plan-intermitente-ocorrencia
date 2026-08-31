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
 * `INTERMITENTE-PONTUAL-{NOME}-{CHAPA}-{dd.mm} CREDITO|BOLETO [VR|VT]` — cap 100 (regra Caju).
 *
 * O sufixo de benefício entra da gaveta de 09/2026 em diante, quando o pontual passou a ter um
 * pedido por benefício. Até 08/2026 VR e VT iam no MESMO pedido (decisão do Isaac de 13/08) e o
 * nome não tinha o que distinguir — pagamento daquele mês continua saindo assim.
 */
export function montarNomePedidoPontual(
  nome: string,
  chapa: string,
  dataInicio: string,
  tipo: TipoPedidoCaju,
  beneficios: BeneficioCaju[] = [],
): string {
  const [, mm, dd] = String(dataInicio).split("-")
  const rotulo = beneficios.length === 1 ? ` ${beneficios[0]}` : ""
  const sufixo = `${dd}.${mm} ${tipo === "credito" ? "CREDITO" : "BOLETO"}${rotulo}`
  const base = `INTERMITENTE-PONTUAL-${String(nome).trim().toUpperCase()}-${chapa}-${sufixo}`
  return base.length <= 100 ? base : base.slice(0, 100)
}

/**
 * Monta o pedido de UM grupo de benefício (1 pessoa, 1 tipo).
 *
 * `beneficios = ["VR","VT"]` é o formato do WF5 (dois `amounts` no mesmo allowance, um boleto
 * só), que valeu até a gaveta de 08/2026 por decisão do Isaac de 13/08. Da gaveta de 09/2026 em
 * diante o workflow chama duas vezes, `["VR"]` e `["VT"]`, e cada benefício tem pedido, boleto e
 * conferência próprios — igual ao mensal. Ver `domain/splitBeneficio.ts`.
 *
 * `tem:false` quando o grupo soma zero — legítimo (ex.: pagamento 100% crédito não tem boleto,
 * ou o VT desta pessoa é zero). Valor>0 SEM employeeId lança: é o conserto do descarte
 * silencioso de caju.ts:114 que, com 1 pessoa, termina "ok" sem pagar ninguém.
 */
export function montarPedidoCajuPontual(
  pessoa: PessoaPreviaMensal & { employeeId?: string | null },
  tipo: TipoPedidoCaju,
  beneficios: BeneficioCaju[] = ["VR", "VT"],
): PedidoMontadoCaju {
  const leva = (b: BeneficioCaju): boolean => beneficios.includes(b)
  const centavosVR = leva("VR") ? centsCaju(tipo === "credito" ? pessoa.creditoVR : pessoa.pixVR) : 0
  const centavosVT = leva("VT") ? centsCaju(tipo === "credito" ? pessoa.creditoVT : pessoa.pixVT) : 0
  const total = centavosVR + centavosVT
  const paymentType: PaymentTypeCaju = tipo === "credito" ? "EXISTING_BALANCE" : "PIX_CODE"
  const name = montarNomePedidoPontual(pessoa.nome, pessoa.chapa, pessoa.dataInicio, tipo, beneficios)
  // No grupo junto o pedido carrega os dois e `beneficio` fica em "VR" só por compatibilidade
  // com PedidoMontadoCaju; no grupo separado ele é o benefício de verdade.
  const beneficio = (beneficios.length === 1 ? beneficios[0]! : "VR") as BeneficioCaju

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
