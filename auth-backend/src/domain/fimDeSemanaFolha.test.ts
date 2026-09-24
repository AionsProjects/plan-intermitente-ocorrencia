// Fim de semana só pra folha: quais dias o link oferece e o que o finalize aceita.
import { test } from "node:test"
import assert from "node:assert/strict"
import { finsDeSemanaDisponiveis, validarFinsDeSemanaFolha } from "./fimDeSemanaFolha.js"

test("convocacao que termina na sexta: o sabado e o domingo seguintes", () => {
  assert.deepEqual(finsDeSemanaDisponiveis("2026-09-25"), ["2026-09-26", "2026-09-27"])
})

test("termina na quarta: o fim de semana seguinte, e so ele", () => {
  assert.deepEqual(finsDeSemanaDisponiveis("2026-09-16"), ["2026-09-19", "2026-09-20"])
})

test("termina no sabado: so o domingo; termina no domingo: o fim de semana da outra semana", () => {
  assert.deepEqual(finsDeSemanaDisponiveis("2026-09-19"), ["2026-09-20"])
  assert.deepEqual(finsDeSemanaDisponiveis("2026-09-13"), ["2026-09-19", "2026-09-20"])
})

test("nao passa do mes: 30/09 (quarta) nao oferece 03-04/10", () => {
  assert.deepEqual(finsDeSemanaDisponiveis("2026-09-30"), [])
  // sexta 28/08 -> sabado 29 e domingo 30 ainda sao agosto
  assert.deepEqual(finsDeSemanaDisponiveis("2026-08-28"), ["2026-08-29", "2026-08-30"])
})

test("valida: so o fim de semana colado entra; o resto vai pro log", () => {
  const r = validarFinsDeSemanaFolha(["2026-09-27", "2026-09-26", "2026-09-20", "2026-10-03", "xx"], {
    dataFim: "2026-09-25", cancelada: false,
  })
  assert.deepEqual(r.validos, ["2026-09-26", "2026-09-27"])
  assert.deepEqual(r.descartados, ["2026-09-20", "2026-10-03", "xx"])
  assert.equal(r.novoFim, "2026-09-27")
})

test("so o domingo: o novo fim no RM e o domingo (estender cobre o sabado junto)", () => {
  const r = validarFinsDeSemanaFolha(["2026-09-27"], { dataFim: "2026-09-25", cancelada: false })
  assert.equal(r.novoFim, "2026-09-27")
})

test("convocacao cancelada nao estende nada", () => {
  const r = validarFinsDeSemanaFolha(["2026-09-26"], { dataFim: "2026-09-25", cancelada: true })
  assert.deepEqual(r.validos, [])
  assert.deepEqual(r.descartados, ["2026-09-26"])
  assert.equal(r.novoFim, null)
})

test("gravado nao sai: corpo sem o dia ja estendido mantem o dia", () => {
  const r = validarFinsDeSemanaFolha([], { dataFim: "2026-09-25", cancelada: false, jaGravados: ["2026-09-26"] })
  assert.deepEqual(r.validos, ["2026-09-26"])
  assert.equal(r.novoFim, "2026-09-26")
})

test("balao no Plano: o que entrou, sem beneficio, e ate onde o RM foi", async () => {
  const { montarTextoBalaoFolha } = await import("./fimDeSemanaFolha.js")
  assert.equal(
    montarTextoBalaoFolha(["2026-09-27", "2026-09-26"], { codConvocacao: "C03S004076", de: "2026-09-25", ate: "2026-09-27" }),
    [
      "Fim de semana para a folha: 26/09/2026 e 27/09/2026 (sem VR/VT).",
      "Convocação no RM C03S004076 estendida de 25/09/2026 até 27/09/2026.",
    ].join("\n"),
  )
})
