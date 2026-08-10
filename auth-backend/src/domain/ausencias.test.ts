// Roda: node --import tsx --test src/domain/ausencias.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ausenciaQuebraConvocacao,
  cortesDaChapa,
  ehDiaCheio,
  mapearAtestados,
  mapearLinhaAtestado,
  type Ausencia,
  type LinhaAtestadoRm,
} from "./ausencias.js"
import { quebrarPeriodoPorAusencias } from "./convocacaoRm.js"

const linha = (p: Partial<LinhaAtestadoRm> = {}): LinhaAtestadoRm => ({
  CHAPA: "006824",
  DT_INICIO: "2026-08-10",
  DT_FINAL: "2026-08-11",
  COD_TIPO_ATESTADO: "1",
  TIPO_ATESTADO: "ATESTADO MEDICO",
  ...p,
})

test("mapeia a linha crua do RM", () => {
  const r = mapearLinhaAtestado(linha()) as Ausencia
  assert.equal(r.chapa, "006824")
  assert.equal(r.inicio, "2026-08-10")
  assert.equal(r.fim, "2026-08-11")
  assert.equal(r.diaCheio, true)
})

test("aceita o formato datetime do RM, não só a data", () => {
  // O RM devolve "2026-08-10T00:00:00-03:00" em vários pontos; `new Date()` aqui viraria o dia.
  const r = mapearLinhaAtestado(linha({ DT_INICIO: "2026-08-10T00:00:00-03:00" })) as Ausencia
  assert.equal(r.inicio, "2026-08-10")
})

test("DT_FINAL vazio cai pro início — atestado de 1 dia não pode sumir", () => {
  const r = mapearLinhaAtestado(linha({ DT_FINAL: "", FIM_INFORMADO: 0 })) as Ausencia
  assert.equal(r.fim, "2026-08-10")
})

test("linha ruim vira descarte COM MOTIVO, nunca some calada", () => {
  const { ausencias, descartadas } = mapearAtestados([
    linha(),
    linha({ CHAPA: "" }),
    linha({ DT_INICIO: "xx" }),
    linha({ DT_INICIO: "2026-08-20", DT_FINAL: "2026-08-10" }),
  ])
  assert.equal(ausencias.length, 1)
  assert.deepEqual(descartadas.map((d) => d.motivo), ["sem_chapa", "data_invalida", "periodo_invertido"])
})

test("dia cheio: sem hora é cheio; recorte de horas não é", () => {
  assert.equal(ehDiaCheio(null, null), true, "sem hora = atestado de dias corridos")
  assert.equal(ehDiaCheio(0, 0), true, "00:00-00:00 é o dia todo, não intervalo nulo")
  assert.equal(ehDiaCheio(0, 1439), true)
  assert.equal(ehDiaCheio(480, 720), false, "08:00-12:00 não tira o dia")
  assert.equal(ehDiaCheio(0, 720), false)
  assert.equal(ehDiaCheio(480, null), true, "metade informada não descreve recorte")
})

test("atestado de meio período NÃO quebra a convocação", () => {
  const a = mapearLinhaAtestado(linha({ HORA_INICIO_MIN: 480, HORA_FINAL_MIN: 720 })) as Ausencia
  assert.equal(ausenciaQuebraConvocacao(a), false)
})

test("tipo desconhecido QUEBRA — erra pro lado visível", () => {
  const a = mapearLinhaAtestado(linha({ COD_TIPO_ATESTADO: "999", TIPO_ATESTADO: "" })) as Ausencia
  assert.equal(ausenciaQuebraConvocacao(a), true)
})

test("cortesDaChapa compara sem zero à esquerda", () => {
  // O RM devolve '006824'; o Monday guarda '6824'. Comparar cru dá zero cortes — e zero corte é
  // o resultado perigoso: convoca por cima do atestado.
  const { ausencias } = mapearAtestados([linha({ CHAPA: "006824" })])
  assert.equal(cortesDaChapa(ausencias, "6824").length, 1)
  assert.equal(cortesDaChapa(ausencias, "9999").length, 0)
})

test("o caso do DP: 05→20 com atestado 10→11 vira 05→09 e 12→20", () => {
  const { ausencias } = mapearAtestados([linha({ DT_INICIO: "2026-08-10", DT_FINAL: "2026-08-11" })])
  const pedacos = quebrarPeriodoPorAusencias("2026-08-05", "2026-08-20", cortesDaChapa(ausencias, "006824"))
  assert.deepEqual(pedacos, [
    { inicio: "2026-08-05", fim: "2026-08-09" },
    { inicio: "2026-08-12", fim: "2026-08-20" },
  ])
})

test("atestado que cobre o período inteiro não deixa pedaço nenhum", () => {
  const { ausencias } = mapearAtestados([linha({ DT_INICIO: "2026-08-01", DT_FINAL: "2026-08-31" })])
  assert.deepEqual(quebrarPeriodoPorAusencias("2026-08-05", "2026-08-20", cortesDaChapa(ausencias, "006824")), [])
})

test("atestado que começa ANTES da janela apara só o começo", () => {
  // É o caso que a consulta base perdia: atestado 28/07→05/08 não "começa" em agosto.
  const { ausencias } = mapearAtestados([linha({ DT_INICIO: "2026-07-28", DT_FINAL: "2026-08-05" })])
  assert.deepEqual(quebrarPeriodoPorAusencias("2026-08-01", "2026-08-10", cortesDaChapa(ausencias, "006824")), [
    { inicio: "2026-08-06", fim: "2026-08-10" },
  ])
})
