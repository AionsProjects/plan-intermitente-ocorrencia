// O residual entregue ao `calcularMensal` tem que vir LÍQUIDO de reserva.
//
// Este é o teste que prova a promessa da bifurcação. `pontual/repo.test.ts` prova que a
// query soma certo; aqui se prova que o número somado é de fato SUBTRAÍDO — sem isso a
// reserva é decorativa e a mesma dívida é abatida duas vezes (uma pelo mensal, outra pela
// felipeta de uma convocação já calculada), e um dos dois pagamentos sai menor do que devia.
import { test } from "node:test"
import assert from "node:assert/strict"
import { calcularMensal, type ConvocacaoMensal, type RegraBeneficioMensal } from "./calculo.js"
import { desconto } from "./previa.js"
import type { ReservasVivas } from "../pontual/repo.js"

/** Item cru do board de Desconto, no formato que o Monday devolve. */
const itemDesconto = (over: { id?: string; vr?: string; vt?: string } = {}) => ({
  id: over.id ?? "d-1",
  name: "MISSILENE ALENCAR",
  column_values: [
    { id: "cpf", text: "12345678901", column: { title: "CPF" } },
    { id: "mat", text: "007406", column: { title: "Matrícula" } },
    { id: "ini", text: "2026-06-01", column: { title: "Data Início" } },
    { id: "rvr", text: over.vr ?? "100", column: { title: "VR - Valor Residual" } },
    { id: "rvt", text: over.vt ?? "50", column: { title: "VT - Valor Residual" } },
    { id: "dvr", text: "0", column: { title: "VR - Valor Descontado" } },
    { id: "dvt", text: "0", column: { title: "VT - Valor Descontado" } },
  ],
})

test("sem reserva, o residual e o do board", () => {
  const d = desconto(itemDesconto())!
  assert.equal(d.residualVR, 100)
  assert.equal(d.residualVT, 50)
})

test("com reserva, o residual chega LIQUIDO", () => {
  const reservas: ReservasVivas = new Map([["d-1", { vr: 60, vt: 30 }]])
  const d = desconto(itemDesconto(), reservas)!
  assert.equal(d.residualVR, 40)
  assert.equal(d.residualVT, 20)
})

test("reserva de OUTRO item nao afeta este", () => {
  const reservas: ReservasVivas = new Map([["d-outro", { vr: 999, vt: 999 }]])
  const d = desconto(itemDesconto(), reservas)!
  assert.equal(d.residualVR, 100)
})

// Nunca residual negativo: viraria um desconto NEGATIVO no cálculo, ou seja, dinheiro A MAIS
// pra pessoa. "Não há nada a abater" é o único desfecho aceitável aqui.
test("reserva maior que o residual vira ZERO, nunca negativo", () => {
  const reservas: ReservasVivas = new Map([["d-1", { vr: 500, vt: 500 }]])
  const d = desconto(itemDesconto(), reservas)!
  assert.equal(d.residualVR, 0)
  assert.equal(d.residualVT, 0)
})

test("residual arredonda em 2 casas (centavo, nao ruido de float)", () => {
  const reservas: ReservasVivas = new Map([["d-1", { vr: 33.33, vt: 0 }]])
  const d = desconto(itemDesconto({ vr: "100" }), reservas)!
  assert.equal(d.residualVR, 66.67)
})

test("valor com virgula e R$ do board e parseado antes de subtrair", () => {
  const reservas: ReservasVivas = new Map([["d-1", { vr: 100, vt: 0 }]])
  const d = desconto(itemDesconto({ vr: "R$ 1.234,50" }), reservas)!
  assert.equal(d.residualVR, 1134.5)
})

// ── A ponta que importa: o CÁLCULO enxerga o líquido ────────────────────────
const pessoa: ConvocacaoMensal = {
  itemId: "1", nome: "MISSILENE", chapa: "007406", cpf: "12345678901",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO",
  inicio: "2026-07-01", fim: "2026-07-10",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false,
}
const regra: RegraBeneficioMensal = {
  id: "r1", contrato: "CETAM", regra: "GERAL", vrDia: 20, vtDia: 10,
  vrMensal: 0, vtMensal: 0, prioridade: 0, escala12x36: false,
}

test("o mensal abate SO o que nao esta reservado", () => {
  const semReserva = calcularMensal([pessoa], [regra], [], [desconto(itemDesconto())!])
  const comReserva = calcularMensal([pessoa], [regra], [], [
    desconto(itemDesconto(), new Map([["d-1", { vr: 60, vt: 30 }]]))!,
  ])
  // Bruto 160 VR / 80 VT.
  assert.equal(semReserva.contratos[0]!.pessoas[0]!.descontoVR, 100)
  assert.equal(comReserva.contratos[0]!.pessoas[0]!.descontoVR, 40, "abateu divida ja reservada")
  // E o líquido sobe exatamente os 60 reservados — que é o dinheiro que a felipeta vai usar.
  assert.equal(semReserva.contratos[0]!.pessoas[0]!.liquidoVR, 60)
  assert.equal(comReserva.contratos[0]!.pessoas[0]!.liquidoVR, 120)
})

// O cenário completo, ponta a ponta: a segunda convocação não pode ver o que a primeira
// já prometeu. É o "duas convocações no mesmo dia" que motivou a reserva.
test("divida INTEIRA reservada: o mensal nao abate nada dela", () => {
  const r = calcularMensal([pessoa], [regra], [], [
    desconto(itemDesconto(), new Map([["d-1", { vr: 100, vt: 50 }]]))!,
  ])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.descontoVR, 0)
  assert.equal(p.descontoVT, 0)
  assert.equal(p.liquidoVR, 160, "o beneficio saiu cheio, como devia")
  // E nenhum update de desconto é gerado — não houve o que tocar no board.
  assert.deepEqual(r.contratos[0]!.descontoUpdates, [])
})
