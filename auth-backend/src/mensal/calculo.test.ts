import assert from "node:assert/strict"
import test from "node:test"
import { calcularMensal, type ConvocacaoMensal, type RegraBeneficioMensal } from "./calculo.js"

const pessoa = (extra: Partial<ConvocacaoMensal> = {}): ConvocacaoMensal => ({ itemId: "1", nome: "Teste", chapa: "1", cpf: "1",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO", inicio: "2026-07-01", fim: "2026-07-10",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false, ...extra })
const regra: RegraBeneficioMensal = { id: "r1", contrato: "CETAM", regra: "GERAL", vrDia: 20, vtDia: 10,
  vrMensal: 0, vtMensal: 0, prioridade: 0, escala12x36: false }

test("estilo pontual: dias seg-sex, crédito de 2 dias (VR e VT), resto PIX", () => {
  const r = calcularMensal([pessoa()], [regra], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 8); assert.equal(p.diasVT, 8)
  // brutoVR 160 / brutoVT 80; crédito = 2 dias: VR 40 + VT 20 = 60; PIX 180
  assert.deepEqual(r.contratos[0]!.totais, { vr: 160, vt: 80, credito: 60, pix: 180 })
})

test("regra VR Mensal vira valor-dia (mensal/30) x dias trabalhados — estilo pontual", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  const r = calcularMensal([pessoa()], [rMensal], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.vrDia, 19.6) // 588/30
  assert.equal(p.brutoVR, 156.8) // 19.6 x 8 dias (NÃO proporcional por janela)
  assert.equal(p.creditoVR, 39.2) // 2 dias
  assert.equal(p.pixVR, 117.6)
})

test("matching de função ignora preposições (EM vs DE)", () => {
  const especifica: RegraBeneficioMensal = { ...regra, id: "esp", regra: "TECNICO DE NIVEL MEDIO", vrDia: 99 }
  const padrao: RegraBeneficioMensal = { ...regra, id: "pad", regra: "PADRAO", vrDia: 20 }
  const r = calcularMensal([pessoa({ funcao: "TECNICO EM NIVEL MEDIO" })], [padrao, especifica], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.regraAplicada, "esp")
})

test("crédito de VT vale pra TODOS os contratos (2 dias) — estilo pontual", () => {
  const r = calcularMensal([pessoa({ contrato: "SEMSA" })], [{ ...regra, contrato: "SEMSA" }], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.creditoVT, 20)
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

test("emite planUpdates por linha com crédito alocado na ordem", () => {
  // 2 convocações da mesma pessoa: crédito (2 primeiros dias = 40) vai todo pra 1ª linha.
  const r = calcularMensal([
    pessoa({ itemId: "A", inicio: "2026-07-01", fim: "2026-07-03" }), // qua-sex: 3 dias
    pessoa({ itemId: "B", inicio: "2026-07-06", fim: "2026-07-10" }), // seg-sex: 5 dias
  ], [regra], [], [])
  const ups = r.contratos[0]!.planUpdates
  assert.equal(ups.length, 2)
  const a = ups.find((u) => u.itemId === "A")!, b = ups.find((u) => u.itemId === "B")!
  assert.equal(a.diasVR, 3); assert.equal(b.diasVR, 5)
  assert.equal(a.creditoVR, 40); assert.equal(b.creditoVR, 0) // teto 2 dias × 20 na 1ª linha
  assert.equal(a.creditoVT, 20); assert.equal(b.creditoVT, 0) // crédito VT (2 dias) em todo contrato
  assert.equal(a.vrDia, 20); assert.equal(a.vrMensal, 0)
})

test("emite descontoUpdates com residual/status finais", () => {
  const r = calcularMensal([pessoa()], [regra], [], [{ id: "d1", pessoaKey: "1", inicio: "2026-01-01",
    residualVR: 50, residualVT: 20, descontadoVR: 10, descontadoVT: 0 }])
  const ups = r.contratos[0]!.descontoUpdates
  assert.equal(ups.length, 1)
  assert.deepEqual(ups[0], { id: "d1", residualVR: 0, residualVT: 0, descontadoVR: 60, descontadoVT: 20, status: "FINALIZADO" })
})
