import assert from "node:assert/strict"
import test from "node:test"

// config.ts valida env obrigatória no import; caju.ts importa config.
// Setamos as mínimas + sponsorId ANTES do import dinâmico.
process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"
process.env.CAJU_SPONSOR_ID ??= "sponsor-test"

const {
  centsCaju, categoriaVT, montarNomePedido, montarPedidoCaju,
  extrairOrderId, extrairQrBase64, extrairEmployeeId,
} = await import("./caju.js")

type Pessoa = Parameters<typeof montarPedidoCaju>[0][number]
const p = (extra: Partial<Pessoa> = {}): Pessoa => ({
  employeeId: "emp-1", contrato: "CETAM", interior: "NAO",
  creditoVR: 0, creditoVT: 0, pixVR: 0, pixVT: 0, ...extra,
})

test("centsCaju arredonda pra centavos", () => {
  assert.equal(centsCaju(12.34), 1234)
  assert.equal(centsCaju(0.1 + 0.2), 30)
  assert.equal(centsCaju(undefined), 0)
})

test("categoriaVT: mobilidade vs vale", () => {
  assert.equal(categoriaVT("CETAM", "NAO"), "TRANSPORTATION")
  assert.equal(categoriaVT("TRE PB", "NAO"), "TRANSPORTATION")
  assert.equal(categoriaVT("SEDUC INTERIOR", "NAO"), "TRANSPORTATION")
  assert.equal(categoriaVT("SEMSA", "NAO"), "TRANSPORTATION_VOUCHER")
  assert.equal(categoriaVT("SEMSA", "SIM"), "TRANSPORTATION") // interior força mobilidade
})

test("montarNomePedido monta e trunca em 100", () => {
  assert.equal(montarNomePedido("CETAM", 7, 2026, "3 DIAS CREDITO"), "INTERMITENTE-MENSAL-CETAM-07.26 3 DIAS CREDITO")
  const longo = montarNomePedido("A".repeat(200), 12, 2026, "DEBITO")
  assert.ok(longo.length <= 100)
  assert.ok(longo.startsWith("INTERMITENTE-MENSAL-"))
  assert.ok(longo.endsWith("-12.26 DEBITO"))
})

test("montarPedidoCaju crédito: categorias, centavos, paymentType, nome", () => {
  const r = montarPedidoCaju([p({ creditoVR: 90, creditoVT: 30 })], "credito", "CETAM", 7, 2026)
  assert.equal(r.tem, true)
  assert.equal(r.paymentType, "EXISTING_BALANCE")
  assert.equal(r.totalCentavos, 12000)
  assert.equal(r.name, "INTERMITENTE-MENSAL-CETAM-07.26 3 DIAS CREDITO")
  assert.deepEqual(r.payload!.allowances, [{ employeeId: "emp-1", amounts: [
    { category: "FOOD_AID", amount: 9000 }, { category: "TRANSPORTATION", amount: 3000 },
  ] }])
  assert.equal(r.payload!.sponsorId, "sponsor-test")
  assert.deepEqual(r.confirmPayload, { paymentStrategies: [{ paymentType: "EXISTING_BALANCE", amount: 12000 }] })
})

test("montarPedidoCaju boleto: usa pix* e PIX_CODE, sufixo DEBITO, VT vale p/ contrato fora da lista", () => {
  const r = montarPedidoCaju([p({ contrato: "SEMSA", pixVR: 100, pixVT: 40 })], "boleto", "SEMSA", 7, 2026)
  assert.equal(r.paymentType, "PIX_CODE")
  assert.equal(r.name.endsWith("DEBITO"), true)
  assert.deepEqual(r.payload!.allowances[0]!.amounts, [
    { category: "FOOD_AID", amount: 10000 }, { category: "TRANSPORTATION_VOUCHER", amount: 4000 },
  ])
})

test("montarPedidoCaju ignora sem employeeId e zera quando vazio", () => {
  const r = montarPedidoCaju([p({ employeeId: null, creditoVR: 50 })], "credito", "CETAM", 7, 2026)
  assert.equal(r.tem, false)
  assert.equal(r.payload, null)
  assert.equal(r.totalCentavos, 0)
})

test("montarPedidoCaju pula amount zero", () => {
  const r = montarPedidoCaju([p({ creditoVR: 90, creditoVT: 0 })], "credito", "CETAM", 7, 2026)
  assert.deepEqual(r.payload!.allowances[0]!.amounts, [{ category: "FOOD_AID", amount: 9000 }])
})

test("extrairOrderId cobre variantes", () => {
  assert.equal(extrairOrderId({ id: "a" }), "a")
  assert.equal(extrairOrderId({ allowanceOrderId: "b" }), "b")
  assert.equal(extrairOrderId({ data: { id: "c" } }), "c")
  assert.equal(extrairOrderId({ order: { id: "d" } }), "d")
  assert.equal(extrairOrderId(null), null)
})

test("extrairQrBase64 remove prefixo data-uri", () => {
  assert.equal(extrairQrBase64({ pixCode: { encodedImage: "data:image/png;base64,ABC" } }), "ABC")
  assert.equal(extrairQrBase64({ pixCode: { encodedImage: "XYZ" } }), "XYZ")
  assert.equal(extrairQrBase64({}), "")
})

test("extrairEmployeeId cobre items/data/content/self", () => {
  assert.equal(extrairEmployeeId({ items: [{ employeeId: "e1" }] }), "e1")
  assert.equal(extrairEmployeeId({ data: [{ id: "e2" }] }), "e2")
  assert.equal(extrairEmployeeId({ content: [{ personId: "e3" }] }), "e3")
  assert.equal(extrairEmployeeId({ employeeId: "e4" }), "e4")
  assert.equal(extrairEmployeeId(null), null)
})
