// Cálculo do pré-pagamento pontual.
//
// NÃO é código de cálculo novo: `calcularMensal` já implementa "dias elegíveis estilo
// pontual" + FIFO de desconto + teto de crédito + os updates de coluna do Plano. Aqui é
// só o adaptador de UMA convocação, com o teto de crédito do pontual.
//
// Duas divergências históricas WF5 × mensal, ambas resolvidas por decisão de 12/08/2026 e
// registradas em docs/pontual/plano-migracao-vercel.md §Decisões FECHADAS:
//
//  1. FERIADO — o mensal filtra pela regra do board FERIADOS (NACIONAL bloqueia todos;
//     ESTADUAL/MUNICIPAL só a lista; SEDUC*/DETRAN RECEBEM). O WF5 não filtra. Fica a do
//     mensal, herdada de graça. ⚠️ Convocação que cruza feriado passa a pagar 1 dia MENOS
//     que o WF5 paga hoje — é mudança de valor, e o DP tem que saber antes do cutover.
//  2. TETO DO DIA 31 — as duas pontas concordam desde 07/08/2026 (o WF5 ganhou
//     `__vrForaDoTeto`). Nada a fazer.
//
// E uma que é decisão de negócio, não convergência: o CRÉDITO. Mensal = 3 dias VR / 0 VT
// (o DP credita os 3 primeiros dias à mão na Caju). Pontual = 2 VR + 2 VT (não há crédito
// manual). Por isso `TETO_CREDITO_PONTUAL` é passado explicitamente — herdar o do mensal
// em silêncio é erro de dinheiro em toda convocação.
import {
  calcularMensal, TETO_CREDITO_PONTUAL,
  type ConvocacaoMensal, type DescontoMensal, type FeriadoMensal,
  type PessoaCalculadaMensal, type PlanUpdateMensal, type RegraBeneficioMensal,
} from "../mensal/calculo.js"

export interface EntradaCalculoPontual {
  /** Item do Plano. `"novo"` quando o cálculo roda ANTES do createItem. */
  itemId: string
  nome: string
  chapa: string
  cpf: string
  contrato: string
  funcao: string
  interior: string
  inicio: string
  fim: string
  trabalhaSabado: boolean
  optanteVT: boolean
  vtSoVolta: boolean
  escala12x36?: "PAR" | "IMPAR" | null
}

export interface ReservaCalculada {
  /** `DescontoMensal.id` = item id do board de Desconto. É a chave que o mensal enxerga. */
  descontoMondayItemId: string
  vr: number
  vt: number
}

export interface ResultadoPontual {
  pessoa: PessoaCalculadaMensal
  planUpdate: PlanUpdateMensal
  /** O que reservar no FIFO. Derivado do delta de residual que o cálculo consumiu. */
  reservas: ReservaCalculada[]
  /**
   * `true` quando o desconto pendente consumiu o benefício INTEIRO (líquido zero).
   *
   * Não é erro: é o `If2#false` do WF5. A felipeta ainda grava o board e o desconto — pra
   * registrar para onde o benefício foi — e **pula Caju, RM e Solicitação**. Sem esta
   * distinção, a fase 2 tentaria criar pedido de R$ 0,00 na Caju.
   */
  semSaldo: boolean
  /** Entrada + saída, pra `pi.pontual_prepagamento.calculo` — auditoria sem reexecutar. */
  auditoria: Record<string, unknown>
}

/**
 * Erro de cálculo com motivo NOMEADO.
 *
 * `calcularMensal` lança `regra_beneficio_ausente` quando o board de Valores não tem regra
 * pro contrato/função. Isso NÃO pode derrubar a criação da convocação: convocar é ato
 * operacional, pagar é consequência. Quem recusa é a felipeta, com o motivo em mão.
 */
export class ErroCalculoPontual extends Error {
  motivo: string

  constructor(motivo: string, mensagem?: string) {
    super(mensagem ?? motivo)
    this.name = "ErroCalculoPontual"
    this.motivo = motivo
  }
}

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

/**
 * Calcula o pré-pagamento de UMA convocação.
 *
 * `descontos` tem que vir do MESMO lugar que o mensal lê (board `18400981023` via
 * `lerApoio`) e já LÍQUIDO de reservas vivas. Ler de outra fonte é como o número da tela
 * volta a divergir do pago.
 *
 * Lança `ErroCalculoPontual` — quem chama decide se isso vira `estado='invalido'` no
 * snapshot (é o que a rota faz) ou 4xx.
 */
export function calcularPontual(
  entrada: EntradaCalculoPontual,
  regras: RegraBeneficioMensal[],
  feriados: FeriadoMensal[],
  descontos: DescontoMensal[],
): ResultadoPontual {
  if (!entrada.chapa?.trim() && !entrada.cpf?.trim()) {
    throw new ErroCalculoPontual("sem_chapa_nem_cpf", "convocação sem chapa e sem CPF — o FIFO não tem como achar a pessoa")
  }
  if (!entrada.inicio || !entrada.fim) {
    throw new ErroCalculoPontual("periodo_invalido")
  }

  const convocacao: ConvocacaoMensal = { ...entrada }
  // Residual ANTES, por item de desconto. É o outro lado do delta que vira reserva.
  const antes = new Map(descontos.map((d) => [d.id, { vr: d.residualVR, vt: d.residualVT }]))

  let resultado
  try {
    resultado = calcularMensal([convocacao], regras, feriados, descontos, TETO_CREDITO_PONTUAL)
  } catch (e) {
    // `resolverRegra` lança com a mensagem `regra_beneficio_ausente: <contrato>/<funcao>`.
    const msg = e instanceof Error ? e.message : String(e)
    throw new ErroCalculoPontual(msg.split(":")[0]?.trim() || "erro_calculo", msg)
  }

  const contrato = resultado.contratos[0]
  const planUpdate = contrato?.planUpdates[0]
  // `pessoas` só traz quem TEM saldo; `pessoasSemSaldo` traz quem o FIFO zerou. Os dois são
  // desfecho válido, e distinguir importa: sem saldo a felipeta grava board + desconto e
  // NÃO chama Caju/RM (o `If2#false` do WF5); sem dias elegíveis não há nada a fazer.
  const pessoa = contrato?.pessoas[0] ?? contrato?.pessoasSemSaldo[0]
  if (!contrato || !pessoa || !planUpdate) {
    throw new ErroCalculoPontual("sem_dias_elegiveis", "o período não tem nenhum dia elegível (feriado ou fim de semana)")
  }
  // Os dois caem em `pessoasSemSaldo` (líquido zero), e o que os separa é ter tido DIAS.
  // Sem esta distinção, "a dívida comeu o benefício" e "não há benefício nenhum" chegariam
  // na felipeta com o mesmo rótulo — e o tratamento é oposto: no primeiro o board e o ledger
  // são gravados, no segundo não há nada a registrar.
  if (pessoa.diasVR === 0 && pessoa.diasVT === 0) {
    throw new ErroCalculoPontual(
      "sem_dias_elegiveis",
      "o período não tem nenhum dia elegível (feriado, fim de semana ou sábado não trabalhado)",
    )
  }

  // Reserva = o que o FIFO consumiu, por item de desconto. Sai do DELTA de residual, que é
  // o que de fato saiu do ledger e o único número que reconcilia com o board.
  //
  // ⚠️ A fonte é `contrato.descontoUpdates`, NÃO o array que entrou. `calcularMensal` faz
  // `descontosOriginais.map(d => ({...d}))` na primeira linha — ele muta a CÓPIA dele, não a
  // nossa. Comparar o array de entrada com ele mesmo daria reserva SEMPRE ZERO, e a reserva
  // não protegeria nada (o mensal abateria a mesma dívida de novo). `descontoUpdates` já é
  // a saída pública com os valores finais pós-consumo.
  const reservas: ReservaCalculada[] = []
  for (const u of contrato.descontoUpdates) {
    const orig = antes.get(u.id)
    if (!orig) continue
    const vr = r2(orig.vr - u.residualVR)
    const vt = r2(orig.vt - u.residualVT)
    if (vr > 0 || vt > 0) reservas.push({ descontoMondayItemId: u.id, vr, vt })
  }

  const semSaldo = contrato.pessoas.length === 0
  return {
    pessoa,
    planUpdate,
    reservas,
    semSaldo,
    auditoria: {
      entrada: convocacao,
      teto_credito: TETO_CREDITO_PONTUAL,
      regras_consideradas: regras.length,
      feriados_considerados: feriados.length,
      descontos_considerados: descontos.length,
      saida: pessoa,
      plan_update: planUpdate,
      reservas,
      sem_saldo: semSaldo,
    },
  }
}
