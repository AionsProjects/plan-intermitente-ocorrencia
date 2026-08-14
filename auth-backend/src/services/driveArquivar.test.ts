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

const { nomePastaContrato, subpastaDoTipo } = await import("./driveArquivar.js")
const { escolherPasta, sanitizeName, variantesNome } = await import("../clients/drive.js")

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

// ---------------------------------------------------------------------------
// Nome de pasta — o que o trim resolve e o que ele arrisca
// ---------------------------------------------------------------------------

test("sanitizeName tira espaço do fim — origem da pasta duplicada", () => {
  // O n8n criou `INTERMITENTE - MENSAL ` (com espaço). `ensureFolder` acha por nome EXATO e o
  // nosso nome vai trimado: sem alinhar os dois, o código cria uma SEGUNDA pasta e os arquivos
  // do mês racham entre as duas.
  assert.equal(sanitizeName("INTERMITENTE - MENSAL "), "INTERMITENTE - MENSAL")
  assert.equal(sanitizeName("3 DIAS CREDITO "), "3 DIAS CREDITO")
  assert.equal(sanitizeName(" MENSAL "), "MENSAL")
})

test("sanitizeName troca a barra da data por espaço", () => {
  // É por isso que a pasta do período se chama `13 A 19 08 2026` e não `13 A 19/08/2026`.
  assert.equal(sanitizeName("13 A 19/08/2026"), "13 A 19 08 2026")
})

// ---------------------------------------------------------------------------
// findFolder tolerante — a duplicata de julho/26 nasceu daqui
// ---------------------------------------------------------------------------

test("variantesNome cobre o espaço no fim e no começo", () => {
  assert.deepEqual(variantesNome("07 - JULHO"), ["07 - JULHO", "07 - JULHO ", " 07 - JULHO"])
  // Nome já sujo entra pelo trim e gera as mesmas variantes — chamar com um ou com outro dá igual.
  assert.deepEqual(variantesNome("07 - JULHO "), variantesNome("07 - JULHO"))
})

test("nome limpo vence a variante com espaço", () => {
  const achados = [
    { id: "com-espaco", name: "07 - JULHO " },
    { id: "limpo", name: "07 - JULHO" },
  ]
  assert.equal(escolherPasta(achados, "07 - JULHO")?.id, "limpo")
})

test("só a variante com espaço existe → usa ela em vez de criar outra", () => {
  // Este é o caso de `01 - JANEIRO ` e `INTERMITENTE - MENSAL `: antes o código não achava e
  // criava uma segunda pasta, rachando os arquivos do mês.
  const achados = [{ id: "so-com-espaco", name: "01 - JANEIRO " }]
  assert.equal(escolherPasta(achados, "01 - JANEIRO")?.id, "so-com-espaco")
})

test("irmãos de MESMO nome → a mais antiga, sempre a mesma", () => {
  // Existem dois `04 - DETRAN` dentro de `07 - JULHO/CONTATO`. Com pageSize 1 o destino do
  // arquivo era o que a API devolvesse primeiro — sorteio. A query pede orderBy createdTime,
  // então o primeiro do grupo é o mais antigo, e a escolha para de variar entre chamadas.
  const achados = [
    { id: "antiga-24-06", name: "04 - DETRAN" },
    { id: "nova-13-07", name: "04 - DETRAN" },
  ]
  assert.equal(escolherPasta(achados, "04 - DETRAN")?.id, "antiga-24-06")
  assert.equal(escolherPasta(achados, "04 - DETRAN")?.id, "antiga-24-06")
})

test("nada achado → null (quem chama cria)", () => {
  assert.equal(escolherPasta([], "08 - AGOSTO"), null)
})

// ---------------------------------------------------------------------------
// Nome da pasta de contrato — conferido contra a arvore real em 14/08
// ---------------------------------------------------------------------------

test("contrato leva o prefixo numérico que existe no Drive", () => {
  // DETRAN e SEDUC SEDE estavam SEM prefixo e isso rachou producao: em 12/08 o codigo criou
  // `CONTATO/DETRAN` ao lado do `CONTATO/04 - DETRAN` que existe desde marco.
  assert.equal(nomePastaContrato("DETRAN"), "04 - DETRAN")
  assert.equal(nomePastaContrato("SEDUC SEDE"), "10 - SEDUC SEDE")
  assert.equal(nomePastaContrato("SEMSA"), "85 - SEMSA")
  assert.equal(nomePastaContrato("SEDUC INTERIOR"), "11.02 - SEDUC INTERIOR")
  assert.equal(nomePastaContrato("SEDUC ESCOLA"), "11.01 - SEDUC ESCOLA")
  assert.equal(nomePastaContrato("TRE PB"), "79 - TRE PB")
  assert.equal(nomePastaContrato("CETAM"), "74 - CETAM")
  assert.equal(nomePastaContrato("BARCO CONTATO"), "15 - BARCO CONTATO")
  assert.equal(nomePastaContrato("ADMINISTRATIVO"), "ADMINISTRATIVO")
})

test("casa ignorando acento e caixa", () => {
  assert.equal(nomePastaContrato("detran"), "04 - DETRAN")
  assert.equal(nomePastaContrato(" Seduc  Sede "), "10 - SEDUC SEDE")
})

test("contrato fora do mapa cai no nome normalizado", () => {
  // URUGUAIANA nao esta no mapa — mesmo risco de pasta nova. Conferir no Drive antes de ligar.
  assert.equal(nomePastaContrato("URUGUAIANA"), "URUGUAIANA")
})
