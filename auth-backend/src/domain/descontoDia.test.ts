import { test } from "node:test"
import assert from "node:assert/strict"
import { derivarDescontosPorDia, agregados, jornadaMin } from "./descontoDia.js"
import { calcularDesconto } from "./desconto.js"

test("jornadaMin: dom/feriado=0, sáb=240, útil=480", () => {
  assert.equal(jornadaMin("2026-06-28"), 0) // domingo
  assert.equal(jornadaMin("2026-12-25"), 0) // Natal
  assert.equal(jornadaMin("2026-06-27"), 240) // sábado
  assert.equal(jornadaMin("2026-06-26"), 480) // sexta
})

test("derivar: falta = VR integral + VT", () => {
  const l = derivarDescontosPorDia({
    dataInicio: "2026-06-22", dataFim: "2026-06-26", trabalhaSabado: false,
    respostas: [{ data: "2026-06-24", tipo: "falta" }],
  })
  const e = l.find((x) => x.data === "2026-06-24")!
  assert.equal(e.vr, true)
  assert.equal(e.vt, true)
  assert.equal(e.vr_percentual, 100)
  assert.equal(e.vr_tipo, "integral")
  assert.deepEqual(e.origens, ["falta"])
})

test("derivar: atraso proporcional à jornada (240min/480 = 50%)", () => {
  const l = derivarDescontosPorDia({
    dataInicio: "2026-06-22", dataFim: "2026-06-26", trabalhaSabado: false,
    respostas: [{ data: "2026-06-24", tipo: "atraso", minutos_atraso: 240 }],
  })
  const e = l.find((x) => x.data === "2026-06-24")!
  assert.equal(e.vr, true)
  assert.equal(e.vt, false) // atraso não tira VT
  assert.equal(e.vr_tipo, "atraso")
  assert.equal(e.vr_percentual, 50)
  assert.equal(e.minutos_atraso, 240)
})

test("derivar: domingo/feriado nunca conta", () => {
  const l = derivarDescontosPorDia({
    dataInicio: "2026-06-22", dataFim: "2026-06-30", trabalhaSabado: false,
    respostas: [{ data: "2026-06-28", tipo: "falta" }], // domingo
  })
  assert.equal(l.find((x) => x.data === "2026-06-28"), undefined)
})

test("derivar: dia desativado = desconsiderado (VR+VT)", () => {
  const l = derivarDescontosPorDia({
    dataInicio: "2026-06-22", dataFim: "2026-06-26", trabalhaSabado: false,
    diasDesativados: ["2026-06-23"],
    respostas: [],
  })
  const e = l.find((x) => x.data === "2026-06-23")!
  assert.deepEqual(e.origens, ["desconsiderado"])
  assert.equal(e.vr && e.vt, true)
})

test("derivar -> calcularDesconto end-to-end (CETAM, 2 faltas)", () => {
  const ledger = derivarDescontosPorDia({
    dataInicio: "2026-06-22", dataFim: "2026-06-26", trabalhaSabado: false,
    respostas: [
      { data: "2026-06-23", tipo: "falta" },
      { data: "2026-06-24", tipo: "falta" },
    ],
  })
  const desc = calcularDesconto({
    vrDia: 24.5, vtDia: 10, optanteVT: true, contrato: "CETAM",
    descontosPorDia: ledger.map((e) => ({ vr: e.vr, vt: e.vt, vr_tipo: e.vr_tipo ?? undefined, vr_percentual: e.vr_percentual, minutos_atraso: e.minutos_atraso })),
  })
  assert.equal(desc.descontoVR, 49) // 2 * 24.5
  assert.equal(desc.descontoVT, 20) // 2 * 10
  const ag = agregados([{ data: "2026-06-23", tipo: "falta" }, { data: "2026-06-24", tipo: "falta" }], ledger)
  assert.equal(ag.qtd_faltas, 2)
  assert.equal(ag.dias_perde_vr, 2)
})
