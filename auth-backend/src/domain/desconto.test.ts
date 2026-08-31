import { test } from "node:test"
import assert from "node:assert/strict"
import {
  resolverValores,
  calcularDesconto,
  jaConsumido,
  naoDesconta,
  naoDescontaPontoFacultativo,
  type LinhaValores,
} from "./desconto.js"
import { diasUteis, diasCorridos } from "./diasUteis.js"

const LINHAS: LinhaValores[] = [
  { contrato: "PADRAO", regra: "", vrDia: 20, vtDia: 8 },
  { contrato: "CETAM", regra: "", vrDia: 30, vtDia: 10 },
  { contrato: "CETAM", regra: "MOTORISTA", vrDia: 30, vtDia: 15 },
  // Regras de VR MENSAL — espelham o board real (12/08/2026): coluna VR diária VAZIA.
  { contrato: "DETRAN", regra: "AGENTE DE PORTARIA", vrDia: 0, vtDia: 10, vrMensal: 514.5 },
  { contrato: "DETRAN", regra: "TECNICO DE NIVEL MEDIO", vrDia: 0, vtDia: 10, vrMensal: 588 },
  { contrato: "TRE PB", regra: "", vrDia: 0, vtDia: 10.9, vrMensal: 660 },
]

// A fórmula do desconto DETRAN/TRE PB: (VR Mensal / 30) por dia não trabalhado.
// 514,50/30 = 17,15 · 588/30 = 19,60 · 660/30 = 22,00. Sem a derivação, essas linhas
// (VR diário vazio) devolviam vrDia 0 — e o desconto sumia calado.
test("resolverValores: VR Mensal vira valor-dia (mensal/30)", () => {
  const portaria = resolverValores(LINHAS, { contrato: "DETRAN", funcao: "AGENTE DE PORTARIA" })
  assert.equal("vrDia" in portaria && portaria.vrDia, 17.15)
  const tecnico = resolverValores(LINHAS, { contrato: "DETRAN", funcao: "TECNICO DE NIVEL MEDIO" })
  assert.equal("vrDia" in tecnico && tecnico.vrDia, 19.6)
  const tre = resolverValores(LINHAS, { contrato: "TRE PB", funcao: "AUXILIAR" })
  assert.equal("vrDia" in tre && tre.vrDia, 22)
  assert.ok("regraAplicada" in tre && tre.regraAplicada.includes("VR mensal (660/30)"))
})

test("resolverValores: linha só com VR Mensal não é 'sem valor'", () => {
  const r = resolverValores(
    [{ contrato: "TRE PB", regra: "", vrDia: 0, vtDia: 0, vrMensal: 660 }],
    { contrato: "TRE PB", funcao: "X" },
  )
  assert.equal("vrDia" in r && r.vrDia, 22)
})

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

// Decisão do Isaac, 12/08/2026: DETRAN/TRE PB VOLTARAM a descontar — dia não trabalhado
// tira (VR Mensal/30) por dia. A regra de "nunca desconta" ficou só pro SEDUC.
test("calcularDesconto: TRE PB desconta por falta (12/08/2026)", () => {
  assert.equal(naoDesconta("TRE PB"), false)
  assert.equal(naoDesconta("CETAM"), false)
  const r = calcularDesconto({
    // 22,00 = 660,00/30 — o valor-dia que resolverValores deriva do VR Mensal.
    vrDia: 22, vtDia: 10, optanteVT: true, contrato: "TRE PB",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
  })
  assert.equal(r.descontoVR, 22)
  assert.equal(r.descontoVT, 10)
})

test("calcularDesconto: DETRAN não desconta por falta/atestado (v56 do celetista, 31/08/2026)", () => {
  assert.equal(naoDesconta("DETRAN"), true)
  assert.equal(naoDesconta("detran"), true) // normalização
  const r = calcularDesconto({
    vrDia: 17.15, vtDia: 10, optanteVT: true, contrato: "DETRAN",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
  })
  assert.equal(r.descontoVR, 0)
  assert.equal(r.descontoVT, 0)
})

test("calcularDesconto: cancelamento ainda desconta no DETRAN (não é falta, é dia inexistente)", () => {
  const r = calcularDesconto({
    vrDia: 17.15, vtDia: 10, optanteVT: true, contrato: "DETRAN",
    aplicarRegraNaoDesconta: false,
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
  })
  assert.equal(r.descontoVR, 17.15)
  assert.equal(r.descontoVT, 10)
})

test("calcularDesconto: SEDUC volta a descontar falta e atraso (31/08/2026)", () => {
  assert.equal(naoDesconta("SEDUC ESCOLA"), false)
  assert.equal(naoDesconta("SEDUC SEDE"), false)
  assert.equal(naoDesconta("SEDUC INTERIOR"), false)
  assert.equal(naoDesconta("seduc escola"), false) // normalização
  assert.equal(naoDesconta("SEMSA"), false)
  const falta = calcularDesconto({
    vrDia: 24.5, vtDia: 10, optanteVT: true, contrato: "SEDUC SEDE",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
  })
  assert.equal(falta.descontoVR, 24.5)
  assert.equal(falta.descontoVT, 10)
  // Atraso: VR proporcional, VT intacto (o ledger só marca vt no dia cheio).
  const atraso = calcularDesconto({
    vrDia: 24.5, vtDia: 10, optanteVT: true, contrato: "SEDUC INTERIOR",
    descontosPorDia: [{ vr: true, vt: false, vr_tipo: "atraso", minutos_atraso: 60 }],
  })
  assert.equal(atraso.descontoVR, 3.06)
  assert.equal(atraso.descontoVT, 0)
})

test("SEDUC não perde benefício por decisão de calendário — ponto facultativo segue isento", () => {
  // Lista separada de propósito: o SEDUC saiu de `naoDesconta` sem sair desta.
  assert.equal(naoDescontaPontoFacultativo("SEDUC SEDE"), true)
  assert.equal(naoDescontaPontoFacultativo("SEDUC INTERIOR"), true)
  assert.equal(naoDescontaPontoFacultativo("DETRAN"), true)
  assert.equal(naoDescontaPontoFacultativo("SEMSA"), false)
  assert.equal(naoDescontaPontoFacultativo("TRE PB"), false)
})

test("calcularDesconto: cancelamento desconta SEDUC (aplicarRegraNaoDesconta=false)", () => {
  const r = calcularDesconto({
    vrDia: 20, vtDia: 8, optanteVT: true, contrato: "SEDUC ESCOLA",
    descontosPorDia: [{ vr: true, vt: true, vr_percentual: 100 }],
    aplicarRegraNaoDesconta: false, // cancelamento total/parcial
  })
  assert.equal(r.descontoVR, 20)
  assert.equal(r.descontoVT, 8)
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
