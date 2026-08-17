// Split: a partição é onde o dinheiro se separa — cada metade tem contrato (e VR/VT) próprio.
// Um dia caindo do lado errado paga com o valor do outro contrato.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  particionarSplit, nomeSubitem, colunasSubitem, acharSubitemExistente, splitValido, COL_SUB,
} from "./subitems.js"

const SPLIT = { data_inicio_parte2: "2026-08-10", contrato_parte1: "SEDUC SEDE", contrato_parte2: "DETRAN" }

const BASE = {
  dataInicio: "2026-08-03",
  dataFim: "2026-08-14",
  split: SPLIT,
  respostas: [
    { data: "2026-08-04", tipo: "falta" },
    { data: "2026-08-09", tipo: "atraso", minutos_atraso: 30 },
    { data: "2026-08-10", tipo: "falta" }, // o dia do CORTE pertence à parte 2
    { data: "2026-08-12", tipo: "atraso", minutos_atraso: 45 },
  ],
  diasExtras: ["2026-08-05", "2026-08-11"],
  diasDesativados: ["2026-08-06"],
  sabadosExtras: ["2026-08-08", "2026-08-15"],
}

test("periodos: parte 1 termina no dia ANTERIOR ao corte, sem furo nem sobreposicao", () => {
  const [p1, p2] = particionarSplit(BASE)
  assert.equal(p1.inicio, "2026-08-03")
  assert.equal(p1.fim, "2026-08-09") // corte - 1
  assert.equal(p2.inicio, "2026-08-10")
  assert.equal(p2.fim, "2026-08-14")
  assert.equal(p1.contrato, "SEDUC SEDE")
  assert.equal(p2.contrato, "DETRAN")
})

test("o dia do CORTE cai na parte 2", () => {
  const [p1, p2] = particionarSplit(BASE)
  assert.ok(!p1.respostas.some((r) => r.data === "2026-08-10"))
  assert.ok(p2.respostas.some((r) => r.data === "2026-08-10"))
})

test("respostas e agregados por metade, sem vazar de um lado pro outro", () => {
  const [p1, p2] = particionarSplit(BASE)
  assert.equal(p1.respostas.length, 2)
  assert.equal(p1.qtdFaltas, 1)
  assert.equal(p1.qtdAtrasos, 1)
  assert.equal(p1.totalMin, 30)

  assert.equal(p2.respostas.length, 2)
  assert.equal(p2.qtdFaltas, 1)
  assert.equal(p2.qtdAtrasos, 1)
  assert.equal(p2.totalMin, 45)

  // Nenhuma resposta se perdeu na partição.
  assert.equal(p1.respostas.length + p2.respostas.length, BASE.respostas.length)
})

test("dias extras / desativados / sabados tambem sao particionados", () => {
  const [p1, p2] = particionarSplit(BASE)
  assert.deepEqual(p1.diasExtras, ["2026-08-05"])
  assert.deepEqual(p2.diasExtras, ["2026-08-11"])
  assert.deepEqual(p1.diasDesativados, ["2026-08-06"])
  assert.deepEqual(p2.diasDesativados, [])
  assert.deepEqual(p1.sabadosExtras, ["2026-08-08"])
  assert.deepEqual(p2.sabadosExtras, ["2026-08-15"])
})

test("colunas: status Concluido e propagacao do pai so quando tem valor", () => {
  const [p1] = particionarSplit(BASE)
  const semPai = colunasSubitem(p1)
  assert.deepEqual(semPai[COL_SUB.status], { label: "Concluido" })
  assert.deepEqual(semPai[COL_SUB.dataFim], { date: "2026-08-09" })
  // Ausente, não vazio: mandar "" APAGARIA o que já está no subitem.
  assert.ok(!(COL_SUB.empregadoSubstituido in semPai))
  assert.ok(!(COL_SUB.insalubridade in semPai))

  const comPai = colunasSubitem(p1, { empregadoSubstituido: "JOAO", insalubridade: "SIM" })
  assert.deepEqual(comPai[COL_SUB.empregadoSubstituido], { text: "JOAO" })
  assert.deepEqual(comPai[COL_SUB.insalubridade], { label: "SIM" })

  // Respostas vão como JSON em long_text.
  assert.equal(JSON.parse(String((semPai[COL_SUB.respostas] as { text: string }).text)).length, 2)
})

test("nome do subitem e 'Parte N - CONTRATO'", () => {
  const [p1, p2] = particionarSplit(BASE)
  assert.equal(nomeSubitem(p1), "Parte 1 - SEDUC SEDE")
  assert.equal(nomeSubitem(p2), "Parte 2 - DETRAN")
})

test("casa subitem existente por PREFIXO — correcao que troca contrato atualiza, nao duplica", () => {
  const subitems = [
    { id: "1", name: "Parte 1 - SEDUC SEDE", board: { id: 999 } },
    { id: "2", name: "Parte 2 - CETAM", board: { id: 999 } }, // contrato ANTIGO no nome
  ]
  const a1 = acharSubitemExistente(subitems, 1)
  const a2 = acharSubitemExistente(subitems, 2)
  assert.deepEqual(a1, { id: "1", boardId: "999" })
  // Achou apesar do contrato ter mudado de CETAM pra DETRAN — senão viraria um 3o subitem.
  assert.deepEqual(a2, { id: "2", boardId: "999" })
  assert.equal(acharSubitemExistente([], 1), null)
})

test("splitValido recusa o que faria subitem sem sentido", () => {
  assert.ok(splitValido(SPLIT))
  assert.ok(!splitValido(null))
  assert.ok(!splitValido({ ...SPLIT, data_inicio_parte2: "10/08/2026" }))
  assert.ok(!splitValido({ ...SPLIT, contrato_parte2: "  " }))
})
