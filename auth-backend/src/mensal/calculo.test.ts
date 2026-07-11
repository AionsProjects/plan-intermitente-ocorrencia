import assert from "node:assert/strict"
import test from "node:test"
import { calcularMensal, type ConvocacaoMensal, type RegraBeneficioMensal } from "./calculo.js"

const pessoa = (extra: Partial<ConvocacaoMensal> = {}): ConvocacaoMensal => ({ itemId: "1", nome: "Teste", chapa: "1", cpf: "1",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO", inicio: "2026-07-01", fim: "2026-07-10",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false, ...extra })
const regra: RegraBeneficioMensal = { id: "r1", contrato: "CETAM", regra: "GERAL", vrDia: 20, vtDia: 10,
  vrMensal: 0, vtMensal: 0, prioridade: 0, escala12x36: false }

test("calcula dias, teto de 3 dias e restante PIX", () => {
  const r = calcularMensal([pessoa()], [regra], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 8); assert.equal(p.diasVT, 8)
  assert.deepEqual(r.contratos[0]!.totais, { vr: 160, vt: 80, credito: 90, pix: 150 })
})

test("VT de contrato fora da lista fica integralmente no PIX", () => {
  const r = calcularMensal([pessoa({ contrato: "SEMSA" })], [{ ...regra, contrato: "SEMSA" }], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.creditoVT, 0)
})

test("desconto FIFO reduz líquido e atualiza residual", () => {
  const r = calcularMensal([pessoa()], [regra], [], [{ id: "d1", pessoaKey: "1", inicio: "2026-01-01", residualVR: 50,
    residualVT: 20, descontadoVR: 0, descontadoVT: 0 }])
  assert.equal(r.contratos[0]!.pessoas[0]!.liquidoVR, 110)
  assert.equal(r.descontos[0]!.status, "FINALIZADO")
})

test("escala 12x36 usa paridade", () => {
  const r = calcularMensal([pessoa({ escala12x36: "IMPAR" })], [{ ...regra, escala12x36: true }], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.diasVR, 5)
})
