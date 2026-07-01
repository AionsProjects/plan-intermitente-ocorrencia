import { test } from "node:test"
import assert from "node:assert/strict"
import { aplicarFifo, ordenarDividasFifo, type Divida } from "./fifo.js"

test("ordenarDividasFifo: filtra status e ordena por dataInicio asc", () => {
  const ds: Divida[] = [
    { itemId: "b", dataInicio: "2026-05-10", residualVR: 5, residualVT: 0, status: "PARCIAL" },
    { itemId: "z", dataInicio: "2026-01-01", residualVR: 5, residualVT: 0, status: "FINALIZADO" },
    { itemId: "a", dataInicio: "2026-04-01", residualVR: 5, residualVT: 0, status: "PENDENTE" },
  ]
  const r = ordenarDividasFifo(ds)
  assert.deepEqual(r.map((d) => d.itemId), ["a", "b"]) // FINALIZADO removida, ordenado
})

test("aplicarFifo: abate dívida mais antiga primeiro, sobra líquido", () => {
  const dividas: Divida[] = [
    { itemId: "1", dataInicio: "2026-04-01", residualVR: 30, residualVT: 0, descontadoVR: 0 },
    { itemId: "2", dataInicio: "2026-05-01", residualVR: 30, residualVT: 0, descontadoVR: 0 },
  ]
  const r = aplicarFifo(50, 0, dividas)
  // 50 abate: 30 na dívida 1 (FINALIZADO) + 20 na dívida 2 (PARCIAL, residual 10)
  assert.equal(r.liquidoVR, 0)
  assert.equal(r.totalAplicadoVR, 50)
  assert.equal(r.updates.length, 2)
  assert.equal(r.updates[0]!.novoStatus, "FINALIZADO")
  assert.equal(r.updates[0]!.residualVR, 0)
  assert.equal(r.updates[1]!.novoStatus, "PARCIAL")
  assert.equal(r.updates[1]!.residualVR, 10)
  assert.equal(r.updates[1]!.descontadoVR, 20)
})

test("aplicarFifo: benefício maior que dívidas deixa líquido positivo", () => {
  const r = aplicarFifo(100, 20, [
    { itemId: "1", residualVR: 30, residualVT: 5 },
  ])
  assert.equal(r.liquidoVR, 70)
  assert.equal(r.liquidoVT, 15)
  assert.equal(r.updates[0]!.novoStatus, "FINALIZADO")
})

test("aplicarFifo: VR e VT independentes", () => {
  const r = aplicarFifo(10, 0, [
    { itemId: "1", residualVR: 4, residualVT: 8 }, // só VR abate (VT bruto=0)
  ])
  assert.equal(r.updates[0]!.aplicadoVR, 4)
  assert.equal(r.updates[0]!.aplicadoVT, 0)
  assert.equal(r.updates[0]!.residualVT, 8) // VT intacto
  assert.equal(r.updates[0]!.novoStatus, "PARCIAL") // residualVT>0
})

test("aplicarFifo: sem dívidas = tudo líquido, sem updates", () => {
  const r = aplicarFifo(40, 10, [])
  assert.equal(r.liquidoVR, 40)
  assert.equal(r.liquidoVT, 10)
  assert.equal(r.updates.length, 0)
})

test("aplicarFifo: não muta a dívida original", () => {
  const d: Divida = { itemId: "1", residualVR: 30, residualVT: 0 }
  aplicarFifo(50, 0, [d])
  assert.equal(d.residualVR, 30) // original intacto
})
