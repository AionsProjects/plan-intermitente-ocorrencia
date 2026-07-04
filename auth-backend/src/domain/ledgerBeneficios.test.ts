import { test } from "node:test"
import assert from "node:assert/strict"
import {
  reconstruirLedger,
  diasCancelaveis,
  aplicarCancelamento,
  rangeCancelamento,
  percentualDescontado,
  type Ledger,
} from "./ledgerBeneficios.js"

// Semana útil de referência: 2026-07-06 (seg) a 2026-07-11 (sáb). Sem feriados.

test("diasCancelaveis: exclui domingo e sábado sem trabalho; inclui sábado extra", () => {
  const semSab = diasCancelaveis("2026-07-06", "2026-07-12", false, [])
  assert.deepEqual(semSab, ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"])
  const comExtra = diasCancelaveis("2026-07-06", "2026-07-12", false, ["2026-07-11"])
  assert.ok(comExtra.includes("2026-07-11"))
  assert.ok(!comExtra.includes("2026-07-12")) // domingo nunca
})

test("diasCancelaveis: feriado nacional sai (7 de setembro)", () => {
  const dias = diasCancelaveis("2026-09-07", "2026-09-08", false, [])
  assert.deepEqual(dias, ["2026-09-08"])
})

test("reconstruirLedger: falta desconta VR+VT; atraso desconta VR proporcional", () => {
  const led = reconstruirLedger({
    respostas: [
      { data: "2026-07-06", tipo: "falta" },
      { data: "2026-07-07", tipo: "atraso", minutos_atraso: 120 },
    ],
    diasDesativados: [],
    atestados: [],
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  assert.equal(led["2026-07-06"].vr, true)
  assert.equal(led["2026-07-06"].vt, true)
  assert.equal(led["2026-07-06"].vr_percentual, 1)
  assert.equal(led["2026-07-07"].vr_percentual, 120 / 480) // 25%
  assert.equal(led["2026-07-07"].vt, false) // atraso não perde VT
})

test("reconstruirLedger: atestado — 1º dia sem trabalhar desconta cheio, demais dias cheios", () => {
  const led = reconstruirLedger({
    respostas: [],
    diasDesativados: [],
    atestados: [
      { id: "a1", data_inicio: "2026-07-06", data_fim: "2026-07-08", primeiro_dia_foi_trabalhar: false },
    ],
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  for (const d of ["2026-07-06", "2026-07-07", "2026-07-08"]) {
    assert.equal(led[d].vr_percentual, 1, d)
    assert.equal(led[d].vt_percentual, 1, d)
  }
})

test("aplicarCancelamento: desconta só o percentual FALTANTE (dedupe com atraso)", () => {
  // Dia 07 já tem 25% de VR descontado por atraso → cancelamento cobra 75%.
  const ledger: Ledger = {
    "2026-07-07": { vr: true, vt: false, vr_percentual: 0.25, origens: ["atraso:120min"] },
  }
  const r = aplicarCancelamento({
    ledger,
    diasCancelados: ["2026-07-06", "2026-07-07"],
    tipo: "total",
    vrDia: 20,
    vtDia: 8,
    optanteVT: true,
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  // VR: dia 06 = 20 (100%), dia 07 = 15 (75%) → 35
  assert.equal(r.descontoVR, 35)
  // VT: 2 dias × 8 = 16 (dia 07 não tinha VT)
  assert.equal(r.descontoVT, 16)
  assert.equal(percentualDescontado(r.ledger, "2026-07-07", "vr"), 1)
})

test("aplicarCancelamento: dia 100% descontado é ignorado (duplicidade)", () => {
  const ledger: Ledger = {
    "2026-07-06": { vr: true, vt: true, vr_percentual: 1, vt_percentual: 1, origens: ["falta"] },
  }
  const r = aplicarCancelamento({
    ledger,
    diasCancelados: ["2026-07-06"],
    tipo: "total",
    vrDia: 20,
    vtDia: 8,
    optanteVT: true,
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  assert.equal(r.descontoVR, 0)
  assert.equal(r.descontoVT, 0)
  assert.equal(r.diasIgnoradosDuplicidade.length, 2) // vr + vt
})

test("aplicarCancelamento: sábado extra pago cobra VT de volta e não desconta VR", () => {
  const r = aplicarCancelamento({
    ledger: {},
    diasCancelados: ["2026-07-11"], // sábado extra
    tipo: "total",
    vrDia: 20,
    vtDia: 8,
    optanteVT: true,
    trabalhaSabado: false,
    sabadosExtras: ["2026-07-11"],
    })
  assert.equal(r.descontoVR, 0)
  assert.equal(r.descontoVT, 8)
  assert.equal(r.ledger["2026-07-11"].cobrar_vt_pago_antecipadamente, true)
})

test("aplicarCancelamento: não-optante zera VT", () => {
  const r = aplicarCancelamento({
    ledger: {},
    diasCancelados: ["2026-07-06"],
    tipo: "parcial",
    vrDia: 20,
    vtDia: 0,
    optanteVT: false,
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  assert.equal(r.descontoVT, 0)
  assert.equal(r.descontoVR, 20)
})

test("rangeCancelamento: total-sobre-parcial pega só os dias não cancelados", () => {
  // Parcial anterior cancelou 09-10 (origens cancelamento:parcial no ledger).
  const ledger: Ledger = {
    "2026-07-09": { vr: true, vt: true, vr_percentual: 1, vt_percentual: 1, origens: ["cancelamento:parcial"] },
    "2026-07-10": { vr: true, vt: true, vr_percentual: 1, vt_percentual: 1, origens: ["cancelamento:parcial"] },
  }
  const r = rangeCancelamento({
    tipo: "total",
    eraParcial: true,
    ledger,
    dataInicio: "2026-07-06",
    dataFim: "2026-07-10",
    dataCancel: null,
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  assert.deepEqual(r.dias, ["2026-07-06", "2026-07-07", "2026-07-08"])
  assert.equal(r.inicio, "2026-07-06")
  assert.equal(r.fim, "2026-07-08")
})

test("rangeCancelamento: parcial usa dataCancel até o fim", () => {
  const r = rangeCancelamento({
    tipo: "parcial",
    eraParcial: false,
    ledger: {},
    dataInicio: "2026-07-06",
    dataFim: "2026-07-10",
    dataCancel: "2026-07-08",
    trabalhaSabado: false,
    sabadosExtras: [],
  })
  assert.deepEqual(r.dias, ["2026-07-08", "2026-07-09", "2026-07-10"])
})
