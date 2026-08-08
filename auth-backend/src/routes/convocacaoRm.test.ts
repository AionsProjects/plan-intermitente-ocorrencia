import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"

const { ehLabelGatilho, resolverColunas } = await import("./convocacaoRm.js")

test("ehLabelGatilho: acento não pode decidir se a automação roda", () => {
  // O bug: `normalizar()` tira a cedilha do label vindo do Monday ("LANÇAR" -> "LANCAR") e a
  // comparação era contra a constante ACENTUADA. Nunca casava, e a resposta era 200 —
  // gatilho morto em silêncio.
  assert.equal(ehLabelGatilho("LANÇAR"), true)
  assert.equal(ehLabelGatilho("LANCAR"), true)
  assert.equal(ehLabelGatilho("lançar"), true)
  assert.equal(ehLabelGatilho(" Lançar no RM "), true)
  assert.equal(ehLabelGatilho("AGUARDANDO"), false)
  assert.equal(ehLabelGatilho("CANCELADO"), false)
  // Sem label o evento passa: o filtro de coluna já garantiu que a mudança foi na coluna certa.
  assert.equal(ehLabelGatilho(undefined), true)
  assert.equal(ehLabelGatilho(""), true)
})

const COLS_2026_08 = new Map<string, string>([
  ["Op - Contrato", "color_mktcnxwn"],
  ["Funcionário", "texto"],
  ["OP - Data/Inicio", "date_mktayxhb"],
  ["OP - Data/Fim", "date_mktasnwq"],
  ["Admissão", "text_mkzh8jhn"],
  // Títulos REAIS do board de 2026-08 — derivaram das cópias anteriores.
  ["Status", "color_mm3a8ana"],
  ["inicio do cancelamento", "date_mm3b88ta"],
  ["Código Convocação RM", "text_mm618vv8"],
  ["Lançar no RM", "color_mm61abdf"],
])

test("resolverColunas: aceita os títulos derivados do board de 2026-08", () => {
  const { id, faltando } = resolverColunas(COLS_2026_08)
  assert.deepEqual(faltando, [])
  assert.equal(id("statusConvocacao"), "color_mm3a8ana")
  assert.equal(id("cancelamentoInicio"), "date_mm3b88ta")
  assert.equal(id("codRm"), "text_mm618vv8")
})

test("resolverColunas: aceita também os títulos antigos", () => {
  const antigos = new Map(COLS_2026_08)
  antigos.delete("Status")
  antigos.delete("inicio do cancelamento")
  antigos.set("Status Convocação", "color_velho")
  antigos.set("Cancelamento Início", "date_velho")
  const { id, faltando } = resolverColunas(antigos)
  assert.deepEqual(faltando, [])
  assert.equal(id("statusConvocacao"), "color_velho")
  assert.equal(id("cancelamentoInicio"), "date_velho")
})

test("resolverColunas: sem status ou sem cancelamento a rota TEM que falhar", () => {
  // Sem status, convocação cancelada vira convocação no RM. Sem a data do cancelamento, a
  // parcial vai com o período inteiro. Os dois gravam eSocial S-2260 que não devia existir.
  const semStatus = new Map(COLS_2026_08)
  semStatus.delete("Status")
  assert.equal(resolverColunas(semStatus).faltando.length, 1)
  assert.match(resolverColunas(semStatus).faltando[0], /statusConvocacao/)

  const semCancel = new Map(COLS_2026_08)
  semCancel.delete("inicio do cancelamento")
  assert.match(resolverColunas(semCancel).faltando[0], /cancelamentoInicio/)

  const semCodigo = new Map(COLS_2026_08)
  semCodigo.delete("Código Convocação RM")
  assert.match(resolverColunas(semCodigo).faltando[0], /codRm/)
})

test("resolverColunas: coluna opcional ausente não bloqueia", () => {
  const semAdmissao = new Map(COLS_2026_08)
  semAdmissao.delete("Admissão")
  const { id, faltando } = resolverColunas(semAdmissao)
  assert.deepEqual(faltando, [])
  assert.equal(id("admissao"), undefined)
})
