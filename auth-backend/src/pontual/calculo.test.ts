import assert from "node:assert/strict"
import test from "node:test"

import { calcularMensal, type DescontoMensal, type FeriadoMensal, type RegraBeneficioMensal } from "../mensal/calculo.js"
import { calcularPontual, ErroCalculoPontual, type EntradaCalculoPontual } from "./calculo.js"

const entrada = (extra: Partial<EntradaCalculoPontual> = {}): EntradaCalculoPontual => ({
  itemId: "novo", nome: "MISSILENE ALENCAR", chapa: "007406", cpf: "12345678901",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO",
  inicio: "2026-07-01", fim: "2026-07-10",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false, ...extra,
})
const regra: RegraBeneficioMensal = {
  id: "r1", contrato: "CETAM", regra: "GERAL", vrDia: 20, vtDia: 10,
  vrMensal: 0, vtMensal: 0, prioridade: 0, escala12x36: false,
}
const desconto = (extra: Partial<DescontoMensal> = {}): DescontoMensal => ({
  id: "9001", pessoaKey: "12345678901", inicio: "2026-06-01",
  residualVR: 100, residualVT: 50, descontadoVR: 0, descontadoVT: 0, ...extra,
})

// ── A decisão de dinheiro que este módulo existe pra garantir ────────────────
// Mensal = 3 dias VR / 0 VT. Pontual = 2 VR + 2 VT. Herdar o do mensal em silêncio
// seria erro de dinheiro em TODA convocação, e contamina o PIX (que deriva do crédito).
test("credito do pontual e 2 dias de VR + 2 de VT, nao os 3/0 do mensal", () => {
  const r = calcularPontual(entrada(), [regra], [], [])
  // 8 dias úteis: bruto VR 160, bruto VT 80.
  assert.equal(r.pessoa.diasVR, 8)
  assert.equal(r.pessoa.creditoVR, 40) // 2 × 20
  assert.equal(r.pessoa.creditoVT, 20) // 2 × 10  — no mensal isto seria 0
  assert.equal(r.pessoa.pixVR, 120)    // 160 − 40
  assert.equal(r.pessoa.pixVT, 60)     // 80 − 20
})

test("o mensal NAO foi afetado — segue 3 VR / 0 VT", () => {
  const m = calcularMensal([{ ...entrada(), itemId: "1" }], [regra], [], [])
  const p = m.contratos[0]!.pessoas[0]!
  assert.equal(p.creditoVR, 60) // 3 × 20
  assert.equal(p.creditoVT, 0)
})

test("credito e TETO, nao valor fixo: quem tem menos dias leva o que tem direito", () => {
  // 1 dia útil só (01/07/2026 é quarta): bruto VR 20 < teto de 2 dias (40).
  const r = calcularPontual(entrada({ inicio: "2026-07-01", fim: "2026-07-01" }), [regra], [], [])
  assert.equal(r.pessoa.diasVR, 1)
  assert.equal(r.pessoa.creditoVR, 20) // o bruto, não os 40 do teto
  assert.equal(r.pessoa.pixVR, 0)
})

// ── Feriado: a divergência que muda valor, decidida em 12/08 ─────────────────
test("feriado NACIONAL sai do calculo (regra do mensal, herdada)", () => {
  const feriados: FeriadoMensal[] = [{ data: "2026-07-09", tipo: "NACIONAL", contratos: [] } as FeriadoMensal]
  const semFeriado = calcularPontual(entrada(), [regra], [], [])
  const comFeriado = calcularPontual(entrada(), [regra], feriados, [])
  // 09/07/2026 é quinta — sai dos dias úteis. É 1 dia MENOS que o WF5 paga hoje.
  assert.equal(semFeriado.pessoa.diasVR, 8)
  assert.equal(comFeriado.pessoa.diasVR, 7)
  assert.equal(comFeriado.pessoa.brutoVR, 140)
})

test("SEDUC e DETRAN RECEBEM no feriado (nao bloqueiam)", () => {
  const feriados: FeriadoMensal[] = [{ data: "2026-07-09", tipo: "NACIONAL", contratos: [] } as FeriadoMensal]
  const regraDetran: RegraBeneficioMensal = { ...regra, contrato: "DETRAN" }
  const r = calcularPontual(entrada({ contrato: "DETRAN" }), [regraDetran], feriados, [])
  assert.equal(r.pessoa.diasVR, 8, "DETRAN perdeu o dia de feriado")
})

// ── Reserva: o número que protege o FIFO ─────────────────────────────────────
test("reserva sai do DELTA de residual, por item do Monday", () => {
  const r = calcularPontual(entrada(), [regra], [], [desconto()])
  // Bruto 160 VR / 80 VT contra dívida de 100 VR / 50 VT: consome tudo.
  assert.equal(r.reservas.length, 1)
  assert.equal(r.reservas[0]!.descontoMondayItemId, "9001")
  assert.equal(r.reservas[0]!.vr, 100)
  assert.equal(r.reservas[0]!.vt, 50)
  assert.equal(r.pessoa.descontoVR, 100)
  assert.equal(r.pessoa.liquidoVR, 60)
})

// Guarda de regressão do bug que custou a primeira versão: `calcularMensal` copia o array
// de descontos na primeira linha e muta a CÓPIA dele. Derivar a reserva comparando o array
// de entrada com ele mesmo dava SEMPRE zero — reserva que não protege nada. A fonte tem
// que ser `descontoUpdates`, a saída pública. Este teste fixa as duas pontas: o array do
// chamador fica intacto E a reserva sai preenchida.
test("o array de descontos do CHAMADOR nao e mutado", () => {
  const d = desconto()
  const original = { ...d }
  const r = calcularPontual(entrada(), [regra], [], [d])
  assert.equal(d.residualVR, original.residualVR, "mutou o residual do chamador")
  assert.equal(d.residualVT, original.residualVT)
  // E, com o array intacto, a reserva ainda tem que sair — é o par do teste acima.
  assert.equal(r.reservas.length, 1, "reserva saiu vazia: o delta esta olhando a fonte errada")
})

// O caso que quase virou bug: `calcularMensal` DESCARTA de `pessoas` quem tem líquido zero
// (`pessoas.filter(liquido > 0)`), porque pro mensal não há o que pagar. No pontual isso é
// desfecho válido e conhecido — o `If2#false` do WF5 — e precisa sair com `semSaldo`, não
// com exceção: a felipeta ainda grava board e desconto, e só pula Caju/RM.
test("desconto que come o beneficio inteiro: semSaldo, nao excecao", () => {
  const r = calcularPontual(entrada({ inicio: "2026-07-01", fim: "2026-07-01" }), [regra], [], [desconto()])
  // 1 dia: bruto 20 VR / 10 VT contra dívida de 100/50 — consome tudo.
  assert.equal(r.semSaldo, true)
  assert.equal(r.pessoa.liquidoVR, 0)
  assert.equal(r.pessoa.liquidoVT, 0)
  assert.equal(r.pessoa.descontoVR, 20)
  assert.equal(r.pessoa.descontoVT, 10)
  // A reserva sai mesmo sem saldo: a dívida FOI consumida e tem que ficar presa.
  assert.equal(r.reservas[0]!.vr, 20)
  assert.equal(r.reservas[0]!.vt, 10)
  // E o board ainda recebe os dias e o unitário — é o registro de para onde o benefício foi.
  assert.equal(r.planUpdate.diasVR, 1)
  assert.equal(r.planUpdate.vrDia, 20)
})

test("com saldo, semSaldo e false", () => {
  const r = calcularPontual(entrada(), [regra], [], [desconto()])
  assert.equal(r.semSaldo, false)
  assert.ok(r.pessoa.liquidoVR > 0)
})

test("sem desconto pendente, nao ha reserva", () => {
  const r = calcularPontual(entrada(), [regra], [], [])
  assert.deepEqual(r.reservas, [])
})

test("desconto de OUTRA pessoa nao entra", () => {
  const r = calcularPontual(entrada(), [regra], [], [desconto({ pessoaKey: "99999999999" })])
  assert.deepEqual(r.reservas, [])
  assert.equal(r.pessoa.descontoVR, 0)
})

test("FIFO: divida mais antiga primeiro", () => {
  const velha = desconto({ id: "8001", inicio: "2026-05-01", residualVR: 60, residualVT: 0 })
  const nova = desconto({ id: "8002", inicio: "2026-06-01", residualVR: 200, residualVT: 0 })
  const r = calcularPontual(entrada(), [regra], [], [nova, velha])
  const porId = new Map(r.reservas.map((x) => [x.descontoMondayItemId, x]))
  assert.equal(porId.get("8001")!.vr, 60, "nao consumiu a divida velha primeiro")
  assert.equal(porId.get("8002")!.vr, 100, "resto do bruto (160-60) foi pra divida nova")
})

// ── Erros nomeados: a felipeta precisa do motivo, não de um 502 ──────────────
test("regra de valor ausente vira ErroCalculoPontual com motivo nomeado", () => {
  try {
    calcularPontual(entrada({ contrato: "CONTRATO_INEXISTENTE" }), [regra], [], [])
    assert.fail("deveria ter lancado")
  } catch (e) {
    assert.ok(e instanceof ErroCalculoPontual)
    assert.equal((e as ErroCalculoPontual).motivo, "regra_beneficio_ausente")
  }
})

test("sem chapa e sem CPF e recusado antes de calcular", () => {
  assert.throws(
    () => calcularPontual(entrada({ chapa: "", cpf: "" }), [regra], [], []),
    (e: unknown) => e instanceof ErroCalculoPontual && e.motivo === "sem_chapa_nem_cpf",
  )
})

test("periodo sem nenhum dia elegivel vira motivo nomeado, nao crash", () => {
  // 04-05/07/2026 = sábado e domingo, e não trabalha sábado.
  assert.throws(
    () => calcularPontual(entrada({ inicio: "2026-07-04", fim: "2026-07-05" }), [regra], [], []),
    (e: unknown) => e instanceof ErroCalculoPontual && e.motivo === "sem_dias_elegiveis",
  )
})

// ── Auditoria: responder "por que pagou isso?" sem reexecutar ───────────────
test("auditoria guarda entrada, saida, teto e reservas", () => {
  const r = calcularPontual(entrada(), [regra], [], [desconto()])
  assert.deepEqual(r.auditoria.teto_credito, { vr: 2, vt: 2 })
  assert.ok(r.auditoria.entrada)
  assert.ok(r.auditoria.saida)
  assert.deepEqual(r.auditoria.reservas, r.reservas)
})

// ── Paridade com o pontual de hoje nos casos que o DP confere ────────────────
test("nao-optante de VT: zero dias e zero credito de VT", () => {
  const r = calcularPontual(entrada({ optanteVT: false }), [regra], [], [])
  assert.equal(r.pessoa.diasVT, 0)
  assert.equal(r.pessoa.vtDia, 0)
  assert.equal(r.pessoa.creditoVT, 0)
  assert.equal(r.pessoa.brutoVT, 0)
})

test("SIM* (VT so volta): meio VT por dia", () => {
  const r = calcularPontual(entrada({ vtSoVolta: true }), [regra], [], [])
  assert.equal(r.pessoa.vtDia, 5) // metade de 10
  assert.equal(r.pessoa.creditoVT, 10) // 2 × 5
})

test("VR MENSAL conta dias CORRIDOS e o planUpdate limpa o unitario", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  const r = calcularPontual(entrada(), [rMensal], [], [])
  assert.equal(r.pessoa.vrDia, 19.6)
  assert.equal(r.pessoa.diasVR, 10, "VR mensal tem que contar corridos, nao uteis")
  assert.equal(r.planUpdate.vrDia, null, "regra mensal limpa a celula do unitario")
  assert.equal(r.planUpdate.vrMensal, 196)
})

test("planUpdate carrega os 7 valores que vao pro item do Plano", () => {
  const r = calcularPontual(entrada(), [regra], [], [])
  assert.equal(r.planUpdate.itemId, "novo")
  assert.equal(r.planUpdate.vtDia, 10)
  assert.equal(r.planUpdate.vrDia, 20)
  assert.equal(r.planUpdate.diasVR, 8)
  assert.equal(r.planUpdate.diasVT, 8)
  assert.equal(r.planUpdate.creditoVR, 40)
  assert.equal(r.planUpdate.creditoVT, 20)
})
