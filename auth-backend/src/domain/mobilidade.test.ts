import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseCodigoContrato,
  ehMobilidade,
  categoriaVT,
  montarAmountsCaju,
} from "./mobilidade.js"

test("parseCodigoContrato: base/composto/nome", () => {
  assert.deepEqual(parseCodigoContrato("01.01.0004.01.0001"), {
    base: "04", composto: "04.01", nomeContrato: "04-DETRAN",
  })
  // SEDUC INTERIOR via composto 11.02
  const seducInt = parseCodigoContrato("01.01.0011.02.0003")
  assert.equal(seducInt.composto, "11.02")
  assert.equal(seducInt.nomeContrato, "11.02-SEDUC INTERIOR")
  // TRE PB base 79
  assert.equal(parseCodigoContrato("01.01.0079.01.0001").nomeContrato, "79-TRE PB")
})

test("ehMobilidade: TRE PB(79)/Barco(15)/SEDUC INTERIOR(11.02) sempre mobilidade", () => {
  assert.equal(ehMobilidade("01.01.0079.01.0001"), true) // TRE PB
  assert.equal(ehMobilidade("01.01.0015.01.0001"), true) // Barco
  assert.equal(ehMobilidade("01.01.0011.02.0001"), true) // SEDUC INTERIOR composto
})

test("ehMobilidade: Interior=SIM força mobilidade mesmo em contrato comum", () => {
  assert.equal(ehMobilidade("01.01.0074.01.0001", "SIM"), true) // CETAM + interior
  assert.equal(ehMobilidade("01.01.0074.01.0001", "NAO"), false)
  assert.equal(ehMobilidade("01.01.0074.01.0001"), false)
  assert.equal(ehMobilidade("01.01.0074.01.0001", true), true)
})

test("categoriaVT", () => {
  assert.equal(categoriaVT(true), "TRANSPORTATION")
  assert.equal(categoriaVT(false), "TRANSPORTATION_VOUCHER")
})

test("montarAmountsCaju: VR=FOOD_AID, VT por mobilidade, em centavos, ignora <=0", () => {
  // não-mobilidade
  assert.deepEqual(montarAmountsCaju(10.5, 8, false), [
    { category: "FOOD_AID", amount: 1050 },
    { category: "TRANSPORTATION_VOUCHER", amount: 800 },
  ])
  // mobilidade
  assert.deepEqual(montarAmountsCaju(0, 8, true), [
    { category: "TRANSPORTATION", amount: 800 },
  ])
  // tudo zero
  assert.deepEqual(montarAmountsCaju(0, 0, false), [])
})
