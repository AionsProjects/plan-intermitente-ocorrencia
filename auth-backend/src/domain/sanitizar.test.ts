import { test } from "node:test"
import assert from "node:assert/strict"
import { limparCpfEmTexto, limparMetadados, limparTexto } from "./sanitizar.js"

test("limparTexto redige Bearer", () => {
  assert.equal(
    limparTexto("falhou: Bearer eyJhbGci.abc-123_x~y+z/w"),
    "falhou: Bearer [redigido]",
  )
})

test("limparTexto redige par chave=valor e chave: valor", () => {
  assert.equal(limparTexto("token=abc123 fim"), "token=[redigido] fim")
  assert.equal(limparTexto("secret: s3nh4, outro"), "secret=[redigido], outro")
  assert.equal(limparTexto("apikey=xyz"), "apikey=[redigido]")
})

test("limparTexto corta no limite e trata nulo", () => {
  assert.equal(limparTexto("a".repeat(600))?.length, 500)
  assert.equal(limparTexto("a".repeat(600), 10)?.length, 10)
  assert.equal(limparTexto(null), null)
  assert.equal(limparTexto(undefined), null)
})

test("limparCpfEmTexto pega CPF com e sem máscara", () => {
  // Formatado: mascara sempre, a pontuação já declara o que é (mesmo com DV inválido).
  assert.equal(limparCpfEmTexto("cpf 123.456.789-01 aqui"), "cpf [cpf] aqui")
  // Cru: mascara CPF de verdade (DV confere).
  assert.equal(limparCpfEmTexto("12345678909"), "[cpf]")
  assert.equal(limparCpfEmTexto("pessoa 76236633215 sem cadastro"), "pessoa [cpf] sem cadastro")
})

// REGRESSÃO: item id do Monday tem 11 dígitos, e a regra "11 dígitos = CPF" transformava
// TODO id em "[cpf]" — o pagamento da MARCIA (13/08) gravou {"itemId":"[cpf]"} e o id do
// item de débito do Controle Caju foi perdido. Vale pro mensal também.
test("id numérico de 11 dígitos NÃO é confundido com CPF", () => {
  assert.equal(limparCpfEmTexto("12793710473"), "12793710473")
  assert.equal(limparCpfEmTexto("item 12792874220 criado"), "item 12792874220 criado")
  assert.deepEqual(
    limparMetadados({ itemId: "12793710473", debito: 34.5 }),
    { itemId: "12793710473", debito: 34.5 },
  )
})

test("chave proibida é descartada no primeiro nível", () => {
  const r = limparMetadados({ chapa: "007406", token: "abc", cpf: "12345678901" })
  assert.deepEqual(r, { chapa: "007406" })
})

// O BUG que esta versão conserta: a implementação rasa anterior deixava passar
// objeto e array aninhados intactos, e metadado de fase é aninhado por natureza.
test("chave proibida é descartada em objeto ANINHADO", () => {
  const r = limparMetadados({ pessoa: { nome: "MARIA", cpf: "12345678901" } })
  assert.deepEqual(r, { pessoa: { nome: "MARIA" } })
})

test("chave proibida é descartada dentro de ARRAY de objetos", () => {
  const r = limparMetadados({ pessoas: [{ nome: "A", cpf: "111" }, { nome: "B", token: "t" }] })
  assert.deepEqual(r, { pessoas: [{ nome: "A" }, { nome: "B" }] })
})

test("CPF solto em string aninhada é redigido (não casa chave=valor)", () => {
  const r = limparMetadados({ erro: { detalhe: "pessoa 123.456.789-01 sem cadastro" } })
  assert.deepEqual(r, { erro: { detalhe: "pessoa [cpf] sem cadastro" } })
})

test("Bearer em string aninhada é redigido", () => {
  const r = limparMetadados({ req: { headers: { auth: "Bearer abc.def" } } })
  assert.deepEqual(r, { req: { headers: { auth: "Bearer [redigido]" } } })
})

test("4 níveis de aninhamento passam inteiros (o teto é 4)", () => {
  const r = limparMetadados({ a: { b: { c: { d: { e: "fundo" } } } } })
  assert.deepEqual(r, { a: { b: { c: { d: { e: "fundo" } } } } })
})

test("além do teto vira marcador, não some calado", () => {
  const r = limparMetadados({ a: { b: { c: { d: { e: { f: "fundo demais" } } } } } })
  assert.deepEqual(r, { a: { b: { c: { d: { e: "[profundo]" } } } } })
})

test("chave proibida é descartada mesmo no último nível permitido", () => {
  const r = limparMetadados({ a: { b: { c: { d: { cpf: "12345678901", ok: 1 } } } } })
  assert.deepEqual(r, { a: { b: { c: { d: { ok: 1 } } } } })
})

test("ciclo não estoura a pilha", () => {
  const a: Record<string, unknown> = { nome: "x" }
  a.self = a
  assert.doesNotThrow(() => limparMetadados(a))
})

test("array longo é cortado com marcador de quantos sobraram", () => {
  const r = limparMetadados({ chapas: Array.from({ length: 50 }, (_, i) => `c${i}`) })
  const chapas = (r.chapas as unknown[])
  assert.equal(chapas.length, 21)
  assert.equal(chapas[20], "[+30 itens]")
})

test("tipos escalares sobrevivem sem virar string", () => {
  const r = limparMetadados({ n: 42, b: true, z: null })
  assert.deepEqual(r, { n: 42, b: true, z: null })
})

test("Date vira ISO em vez de {}", () => {
  const r = limparMetadados({ quando: new Date("2026-08-12T14:07:00.000Z") })
  assert.equal(r.quando, "2026-08-12T14:07:00.000Z")
})

test("undefined devolve objeto vazio (assinatura antiga preservada)", () => {
  assert.deepEqual(limparMetadados(undefined), {})
})

// Guarda de regressão do caso real: o metadado que o mensal passa em
// `referencias` tem pessoas aninhadas, e é ele que alimenta o corpo do alerta.
test("caso real: referencias do mensal saem sem CPF nem token", () => {
  const r = limparMetadados({
    contrato: "CETAM",
    pedidoPixVR: "0748a3d5",
    pessoas: [{ nome: "MISSILENE ALENCAR", chapa: "007406", cpf: "12345678901" }],
    auth: { authorization: "Bearer xyz" },
  })
  const serializado = JSON.stringify(r)
  assert.ok(!serializado.includes("12345678901"), "vazou CPF")
  assert.ok(!serializado.includes("xyz"), "vazou token")
  assert.ok(serializado.includes("0748a3d5"), "perdeu o id do pedido, que é o dado útil")
  assert.ok(serializado.includes("007406"), "perdeu a chapa, que é o dado útil")
})
