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
  juntarIdsCaju, juntarSummariesCaju, idsPedidoParaSolicitacao,
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
  assert.equal(categoriaVT("TRE PB", "NAO"), "TRANSPORTATION")
  assert.equal(categoriaVT("SEDUC INTERIOR", "NAO"), "TRANSPORTATION")
  assert.equal(categoriaVT("SEMSA", "NAO"), "TRANSPORTATION_VOUCHER")
  assert.equal(categoriaVT("SEMSA", "SIM"), "TRANSPORTATION") // interior força mobilidade
})

test("categoriaVT: CETAM decide pela coluna Interior, nao pelo contrato", () => {
  // chapa 007386 (JOSE MARCOS): CETAM + Interior=NÃO -> vale, nao mobilidade
  assert.equal(categoriaVT("CETAM", "NAO"), "TRANSPORTATION_VOUCHER")
  assert.equal(categoriaVT("CETAM", "NÃO"), "TRANSPORTATION_VOUCHER")
  assert.equal(categoriaVT("CETAM", ""), "TRANSPORTATION_VOUCHER")
  assert.equal(categoriaVT("CETAM", "SIM"), "TRANSPORTATION")
})

test("montarNomePedido monta e trunca em 100", () => {
  assert.equal(montarNomePedido("CETAM", 7, 2026, "3 DIAS CREDITO"), "INTERMITENTE-MENSAL-CETAM-07.26 3 DIAS CREDITO")
  const longo = montarNomePedido("A".repeat(200), 12, 2026, "DEBITO")
  assert.ok(longo.length <= 100)
  assert.ok(longo.startsWith("INTERMITENTE-MENSAL-"))
  assert.ok(longo.endsWith("-12.26 DEBITO"))
})

// Pedido SEPARADO por benefício (08/2026): o de VR leva só FOOD_AID, o de VT só transporte.
// A mesma pessoa com VR e VT aparece nos DOIS pedidos, nunca no mesmo `amounts[]`.
test("montarPedidoCaju crédito VR: só FOOD_AID, centavos, paymentType, nome", () => {
  const r = montarPedidoCaju([p({ creditoVR: 90, creditoVT: 30 })], "credito", "VR", "CETAM", 7, 2026)
  assert.equal(r.tem, true)
  assert.equal(r.beneficio, "VR")
  assert.equal(r.paymentType, "EXISTING_BALANCE")
  assert.equal(r.totalCentavos, 9000)
  assert.equal(r.name, "INTERMITENTE-MENSAL-CETAM-07.26 3 DIAS CREDITO VR")
  assert.deepEqual(r.payload!.allowances, [{ employeeId: "emp-1", amounts: [{ category: "FOOD_AID", amount: 9000 }] }])
  assert.equal(r.payload!.sponsorId, "sponsor-test")
  assert.deepEqual(r.confirmPayload, { paymentStrategies: [{ paymentType: "EXISTING_BALANCE", amount: 9000 }] })
})

test("montarPedidoCaju crédito VT: só transporte, sem FOOD_AID", () => {
  // fixture é CETAM + interior=NAO -> vale, não mobilidade
  const r = montarPedidoCaju([p({ creditoVR: 90, creditoVT: 30 })], "credito", "VT", "CETAM", 7, 2026)
  assert.equal(r.totalCentavos, 3000)
  assert.equal(r.name, "INTERMITENTE-MENSAL-CETAM-07.26 3 DIAS CREDITO VT")
  assert.deepEqual(r.payload!.allowances, [
    { employeeId: "emp-1", amounts: [{ category: "TRANSPORTATION_VOUCHER", amount: 3000 }] },
  ])
})

test("montarPedidoCaju crédito VT: CETAM com interior=SIM vira mobilidade", () => {
  const r = montarPedidoCaju([p({ interior: "SIM", creditoVT: 30 })], "credito", "VT", "CETAM", 7, 2026)
  assert.deepEqual(r.payload!.allowances, [
    { employeeId: "emp-1", amounts: [{ category: "TRANSPORTATION", amount: 3000 }] },
  ])
})

test("montarPedidoCaju boleto: usa pix* e PIX_CODE, sufixo DEBITO, VT vale p/ contrato fora da lista", () => {
  const pessoa = p({ contrato: "SEMSA", pixVR: 100, pixVT: 40 })
  const vr = montarPedidoCaju([pessoa], "boleto", "VR", "SEMSA", 7, 2026)
  const vt = montarPedidoCaju([pessoa], "boleto", "VT", "SEMSA", 7, 2026)
  assert.equal(vr.paymentType, "PIX_CODE")
  assert.equal(vr.name.endsWith("DEBITO VR"), true)
  assert.equal(vt.name.endsWith("DEBITO VT"), true)
  assert.deepEqual(vr.payload!.allowances[0]!.amounts, [{ category: "FOOD_AID", amount: 10000 }])
  assert.deepEqual(vt.payload!.allowances[0]!.amounts, [{ category: "TRANSPORTATION_VOUCHER", amount: 4000 }])
  // Nenhum centavo criado nem perdido pelo split.
  assert.equal(vr.totalCentavos + vt.totalCentavos, 14000)
})

test("pedido de VT mistura TRANSPORTATION e TRANSPORTATION_VOUCHER quando o contrato mistura interior", () => {
  const r = montarPedidoCaju([
    p({ employeeId: "emp-capital", contrato: "SEMSA", interior: "NAO", pixVT: 40 }),
    p({ employeeId: "emp-interior", contrato: "SEMSA", interior: "SIM", pixVT: 50 }),
  ], "boleto", "VT", "SEMSA", 7, 2026)
  assert.deepEqual(r.payload!.allowances, [
    { employeeId: "emp-capital", amounts: [{ category: "TRANSPORTATION_VOUCHER", amount: 4000 }] },
    { employeeId: "emp-interior", amounts: [{ category: "TRANSPORTATION", amount: 5000 }] },
  ])
})

test("montarPedidoCaju ignora sem employeeId e zera quando vazio", () => {
  const r = montarPedidoCaju([p({ employeeId: null, creditoVR: 50 })], "credito", "VR", "CETAM", 7, 2026)
  assert.equal(r.tem, false)
  assert.equal(r.payload, null)
  assert.equal(r.totalCentavos, 0)
})

// tetoVT=0 no crédito faz o pedido crédito×VT nascer vazio — é o que evita chamada à Caju.
test("montarPedidoCaju sem valor no benefício pedido devolve tem=false", () => {
  const r = montarPedidoCaju([p({ creditoVR: 90, creditoVT: 0 })], "credito", "VT", "CETAM", 7, 2026)
  assert.equal(r.tem, false)
  assert.equal(r.payload, null)
  assert.equal(r.totalCentavos, 0)
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

test("juntarIdsCaju usa \"; \" e descarta vazios sem deixar separador solto", () => {
  assert.equal(juntarIdsCaju(["a", "b"]), "a; b")
  assert.equal(juntarIdsCaju([null, "b"]), "b")
  assert.equal(juntarIdsCaju(["a", undefined]), "a")
  assert.equal(juntarIdsCaju([null, undefined, ""]), "")
})

test("juntarSummariesCaju preserva a ordem dos ids", () => {
  assert.equal(
    juntarSummariesCaju(["vr", null, "vt"]),
    "https://empresa.caju.com.br/classic/#/order/vr/summary; https://empresa.caju.com.br/classic/#/order/vt/summary",
  )
  assert.equal(juntarSummariesCaju([]), "")
})

test("idsPedidoParaSolicitacao leva só os pedidos de boleto, na ordem VR->VT", () => {
  assert.deepEqual(idsPedidoParaSolicitacao({
    pedidoCreditoVR: "c-vr", pedidoCreditoVT: "c-vt", pedidoPixVR: "p-vr", pedidoPixVT: "p-vt",
  }), ["p-vr", "p-vt"])
  // O crédito nasce Rascunho e não é confirmado — não vai pra coluna.
  assert.deepEqual(idsPedidoParaSolicitacao({ pedidoCreditoVR: "c-vr" }), [])
})

test("extrairEmployeeId cobre items/data/content/self", () => {
  assert.equal(extrairEmployeeId({ items: [{ employeeId: "e1" }] }), "e1")
  assert.equal(extrairEmployeeId({ data: [{ id: "e2" }] }), "e2")
  assert.equal(extrairEmployeeId({ content: [{ personId: "e3" }] }), "e3")
  assert.equal(extrairEmployeeId({ employeeId: "e4" }), "e4")
  assert.equal(extrairEmployeeId(null), null)
})
