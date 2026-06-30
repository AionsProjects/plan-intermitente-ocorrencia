import { test } from "node:test"
import assert from "node:assert/strict"
import {
  resolverValores,
  calcularDesconto,
  jaConsumido,
  naoDesconta,
  type LinhaValores,
} from "./desconto.js"
import { diasUteis, diasCorridos } from "./diasUteis.js"

const LINHAS: LinhaValores[] = [
  { contrato: "PADRAO", regra: "", vrDia: 20, vtDia: 8 },
  { contrato: "CETAM", regra: "", vrDia: 30, vtDia: 10 },
  { contrato: "CETAM", regra: "MOTORISTA", vrDia: 30, vtDia: 15 },
]

test("resolverValores: contrato exato vence padrão", () => {
  const r = resolverValores(LINHAS, { contrato: "CETAM", funcao: "AUXILIAR" })
  assert.equal("vrDia" in r && r.vrDia, 30)
  assert.equal("vtDia" in r && r.vtDia, 10)
})

test("resolverValores: regra específica (função) vence contrato genérico", () => {
  const r = resolverValores(LINHAS, { contrato: "CETAM", funcao: "MOTORISTA DE ÔNIBUS" })
  assert.equal("vtDia" in r && r.vtDia, 15) // pega linha MOTORISTA
})

test("resolverValores: cai no PADRAO quando contrato não tem linha", () => {
  const r = resolverValores(LINHAS, { contrato: "SEMSA", funcao: "X" })
  assert.equal("vrDia" in r && r.vrDia, 20)
})

test("resolverValores: erro sem regra", () => {
  const r = resolverValores(
    [{ contrato: "CETAM", regra: "", vrDia: 1, vtDia: 1 }],
    { contrato: "OUTRO", funcao: "X" },
  )
  assert.equal("erro" in r && r.erro, "valores_beneficios_sem_regra")
})

test("calcularDesconto: VR integral + VT por dia", () => {
  const r = calcularDesconto({
    vrDia: 20, vtDia: 8, optanteVT: true, contrato: "CETAM",
    descontosPorDia: [
      { vr: true, vt: true, vr_tipo: "integral", vr_percentual: 100 },
      { vr: true, vt: true, vr_tipo: "integral", vr_percentual: 100 },
    ],
  })
  assert.equal(r.descontoVR, 40)
  assert.equal(r.descontoVT, 16)
})

test("calcularDesconto: atraso >=180min = VR integral; <180 proporcional /480", () => {
  const grande = calcularDesconto({
    vrDia: 24, vtDia: 0, optanteVT: false, contrato: "CETAM",
    descontosPorDia: [{ vr: true, vr_tipo: "atraso", minutos_atraso: 200 }],
  })
  assert.equal(grande.descontoVR, 24) // >=180 integral
  const pequeno = calcularDesconto({
    vrDia: 24, vtDia: 0, optanteVT: false, contrato: "CETAM",
    descontosPorDia: [{ vr: true, vr_tipo: "atraso", minutos_atraso: 120 }],
  })
  assert.equal(pequeno.descontoVR, 6) // 24 * 120/480 = 6
})

test("calcularDesconto: não-optante VT zera VT", () => {
  const r = calcularDesconto({
    vrDia: 20, vtDia: 8, optanteVT: false, contrato: "CETAM",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
  })
  assert.equal(r.descontoVT, 0)
  assert.equal(r.descontoVR, 20)
})

test("calcularDesconto: vtSoVolta corta VT pela metade", () => {
  const r = calcularDesconto({
    vrDia: 0, vtDia: 8, optanteVT: true, vtSoVolta: true, contrato: "CETAM",
    descontosPorDia: [{ vt: true }],
  })
  assert.equal(r.descontoVT, 4)
})

test("calcularDesconto: DETRAN/TRE PB nunca descontam", () => {
  assert.equal(naoDesconta("DETRAN"), true)
  assert.equal(naoDesconta("TRE PB"), true)
  assert.equal(naoDesconta("CETAM"), false)
  const r = calcularDesconto({
    vrDia: 20, vtDia: 8, optanteVT: true, contrato: "DETRAN",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
  })
  assert.equal(r.descontoVR, 0)
  assert.equal(r.descontoVT, 0)
})

test("calcularDesconto: cancelamento desconta DETRAN/TRE (aplicarRegraNaoDesconta=false)", () => {
  const r = calcularDesconto({
    vrDia: 20, vtDia: 8, optanteVT: true, contrato: "DETRAN",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
    aplicarRegraNaoDesconta: false, // cancelamento
  })
  assert.equal(r.descontoVR, 20)
  assert.equal(r.descontoVT, 8)
})

test("jaConsumido: bloqueia PARCIAL/FINALIZADO ou descontado>0", () => {
  assert.equal(jaConsumido(null), false)
  assert.equal(jaConsumido({ status: "PENDENTE" }), false)
  assert.equal(jaConsumido({ status: "PARCIAL" }), true)
  assert.equal(jaConsumido({ status: "FINALIZADO" }), true)
  assert.equal(jaConsumido({ status: "PENDENTE", descontadoVR: 5 }), true)
})

test("diasUteis: exclui dom, sáb (sem trabalha), feriado nacional", () => {
  // 2026-06-22 seg .. 2026-06-28 dom ; sáb=27 dom=28 ; sem feriado nessa semana
  const d = diasUteis("2026-06-22", "2026-06-28", false)
  assert.deepEqual(d, ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"])
})

test("diasUteis: inclui sábado se trabalhaSabado ou extra", () => {
  const comSab = diasUteis("2026-06-26", "2026-06-27", true)
  assert.deepEqual(comSab, ["2026-06-26", "2026-06-27"])
  const extra = diasUteis("2026-06-26", "2026-06-27", false, ["2026-06-27"])
  assert.deepEqual(extra, ["2026-06-26", "2026-06-27"])
})

test("diasUteis: pula feriado nacional (Natal 25/12/2026 = sexta)", () => {
  const d = diasUteis("2026-12-24", "2026-12-25", true)
  assert.deepEqual(d, ["2026-12-24"]) // 25 = Natal, excluído
})

test("diasCorridos: inclui sáb+dom, exclui feriado (VR DETRAN/TRE)", () => {
  const d = diasCorridos("2026-06-26", "2026-06-28")
  assert.deepEqual(d, ["2026-06-26", "2026-06-27", "2026-06-28"])
})
