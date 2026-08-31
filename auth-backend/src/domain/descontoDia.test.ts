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

// O número que vai pro board Histórico e pra Base de Desconto. Contar "dias com vr=true"
// diria 2 dias perdidos onde o desconto em reais é de 1,5 — e o DP leria a linha como
// erro da automação. Fiel ao WF3 (backup rlxTk4VZ de 2026-08-13).
test("agregados: dias_perde_vr é FRACIONÁRIO — atraso não custa um dia inteiro", () => {
  const respostas = [
    { data: "2026-06-23", tipo: "falta" },
    { data: "2026-06-24", tipo: "atraso", minutos_atraso: 240 }, // metade de uma jornada de 480
  ]
  const ledger = derivarDescontosPorDia({
    dataInicio: "2026-06-22", dataFim: "2026-06-26", trabalhaSabado: false, respostas,
  })
  const ag = agregados(respostas, ledger)
  assert.equal(ag.qtd_faltas, 1)
  assert.equal(ag.qtd_atrasos, 1)
  assert.equal(ag.dias_perde_vr, 1.5) // 100% + 50%
  assert.equal(ag.total_minutos, 240)
  // Minutos que de fato geraram desconto — aqui coincide com o lançado porque nenhum dia
  // está coberto por atestado/feriado/cancelamento.
  assert.equal(ag.total_min_devidos, 240)
  // VT é por DIA, não proporcional: o atraso não tira VT, só a falta.
  assert.equal(ag.dias_perde_vt, 1)
})

// Regra do SEDUC de 31/08/2026: desconta falta e atraso, NÃO desconta feriado. A segunda metade
// não mora em `naoDesconta` — mora aqui, e vale para todo contrato: dia de feriado nem entra no
// ledger, então falta lançada em cima de feriado não vira desconto de ninguém.
test("feriado não entra no ledger — nem com falta lançada em cima", () => {
  const respostas = [
    { data: "2026-09-07", tipo: "falta" }, // Independência, segunda-feira
    { data: "2026-09-08", tipo: "falta" },
  ]
  const ledger = derivarDescontosPorDia({
    dataInicio: "2026-09-07", dataFim: "2026-09-11", trabalhaSabado: false, respostas,
  })
  assert.deepEqual(ledger.map((e) => e.data), ["2026-09-08"], "o feriado ficou de fora")

  // E o dinheiro segue o ledger: um dia de VR/VT, não dois.
  const seduc = calcularDesconto({
    vrDia: 24.5, vtDia: 10, optanteVT: true, contrato: "SEDUC ESCOLA",
    descontosPorDia: ledger,
  })
  assert.equal(seduc.descontoVR, 24.5)
  assert.equal(seduc.descontoVT, 10)
})
