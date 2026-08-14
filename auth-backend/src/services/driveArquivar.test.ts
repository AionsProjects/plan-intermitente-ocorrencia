// Regra das pastas do Drive. Pura — sem Drive, sem Monday.
//
// Pedido do Isaac (13/08): TRÊS pastas dentro da pasta do período, e só três.
//   CAJU        — boleto (TXT + QR) e comprovante técnico
//   CONFERENCIA — planilha de conferência
//   OUTROS      — lado do crédito (nota de débito, Relatório-de-pedidos da Caju), o relatório da
//                 automação e os termos
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"

const { subpastaDoTipo } = await import("./driveArquivar.js")

test("boleto e comprovante caem em CAJU (sem subpasta por dentro)", () => {
  // Antes eram CAJU/BOLETOS e CAJU/COMPROVANTES. Achatado — as antigas param de receber, mas
  // ninguém move o que já está lá.
  assert.equal(subpastaDoTipo("caju_boleto"), "CAJU")
  assert.equal(subpastaDoTipo("caju_comprovante"), "CAJU")
})

test("relatório da automação e termos vão pra OUTROS, junto do crédito", () => {
  assert.equal(subpastaDoTipo("relatorio"), "OUTROS")
  assert.equal(subpastaDoTipo("termo"), "OUTROS")
  assert.equal(subpastaDoTipo("outro"), "OUTROS")
})

test("NADA fica solto na raiz do período", () => {
  // `/convocar` manda `tipo: "convocacao"` nos termos; antes eles caíam ao lado das pastas.
  assert.equal(subpastaDoTipo("convocacao"), "OUTROS")
  assert.equal(subpastaDoTipo(""), "OUTROS")
  assert.equal(subpastaDoTipo(null), "OUTROS")
  assert.equal(subpastaDoTipo(undefined), "OUTROS")
  assert.equal(subpastaDoTipo("tipo_que_ninguem_criou_ainda"), "OUTROS")
})

test("atestado é o ÚNICO que não mora no período — pendura na pessoa", () => {
  // Atestado cobre dias, não um período de convocação: pendurar num período seria escolher
  // arbitrariamente uma das convocações que ele atravessa.
  assert.equal(subpastaDoTipo("atestado"), null)
})

test("tipo casa ignorando acento, caixa e espaço", () => {
  assert.equal(subpastaDoTipo("CAJU_BOLETO"), "CAJU")
  assert.equal(subpastaDoTipo(" Relatorio "), "OUTROS")
  assert.equal(subpastaDoTipo("RELATÓRIO"), "OUTROS")
  assert.equal(subpastaDoTipo("Atestado"), null)
})
