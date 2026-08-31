// O que este arquivo trava: o PDF sai VÁLIDO e com as seções pedidas, inclusive as vazias.
// Seção vazia sumir do documento é o modo de falha que importa — "não teve nada" e "esqueci de
// olhar" viram a mesma página em branco, e quem recebe o relatório não tem como distinguir.
import { test } from "node:test"
import assert from "node:assert/strict"
import { gerarRelatorioPeriodo, LARGURA_UTIL, type SecaoRelatorio } from "./relatorioPeriodo.js"
import { instante, quem } from "./janelaManaus.js"

const secao = (titulo: string, linhas: string[][]): SecaoRelatorio => ({
  titulo,
  fonte: "teste",
  colunas: [{ titulo: "A", w: 200 }, { titulo: "B", w: LARGURA_UTIL - 200 }],
  linhas: linhas.map((l) => l.map((texto) => ({ texto }))),
  vazio: "Nada aqui.",
})

const base = {
  titulo: "Relatório de alterações",
  subtitulo: "teste",
  periodoLabel: "31/08, 14:00 a 31/08, 23:59",
  geradoPor: "teste",
  resumo: [{ rotulo: "execuções", n: 2 }],
}

test("gera PDF válido com todas as seções, inclusive a vazia", () => {
  const buf = gerarRelatorioPeriodo({
    ...base,
    secoes: [secao("Execuções", [["10:00", "convocação"], ["11:00", "registro"]]), secao("Retroativas", [])],
  })
  assert.ok(buf.length > 1000, "PDF pequeno demais para ter conteúdo")
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-", "não é PDF")
  const txt = buf.toString("latin1")
  assert.match(txt, /EXECU/, "seção com linhas sumiu")
  assert.match(txt, /RETROATIVAS/, "seção VAZIA sumiu — ausência tem de aparecer")
  assert.match(txt, /Nada aqui/, "o texto de vazio não foi impresso")
  assert.match(txt, /convoca/, "conteúdo da linha não foi impresso")
})

test("muitas linhas quebram em várias páginas, e o rodapé numera todas", () => {
  const muitas = Array.from({ length: 120 }, (_, i) => [`${i}`, `linha ${i}`])
  const buf = gerarRelatorioPeriodo({ ...base, secoes: [secao("Grande", muitas)] })
  const txt = buf.toString("latin1")
  const paginas = (txt.match(/\/Type \/Page[^s]/g) ?? []).length
  assert.ok(paginas >= 3, `esperava várias páginas, veio ${paginas}`)
  assert.match(txt, /p\341gina 1 de /, "faltou a numeração de página")
})

test("instante lê a entrada como hora de MANAUS, não como UTC", () => {
  // 14:00 em Manaus (UTC-4) é 18:00Z. Ler como UTC jogaria o corte 4h para trás e o
  // relatório traria a tarde inteira que o usuário não pediu.
  assert.equal(instante("2026-08-31T14:00").toISOString(), "2026-08-31T18:00:00.000Z")
  assert.equal(instante("2026-08-31").toISOString(), "2026-08-31T04:00:00.000Z")
  assert.equal(instante("2026-08-31", true).toISOString(), "2026-09-01T03:59:59.999Z")
  assert.throws(() => instante("31/08/2026"), /data invalida/)
})

test("quem: nome quando existe, senão o usuário do e-mail, senão automação", () => {
  assert.equal(quem("THIFANY CASTRO DE SOUZA Souza", "t@x.com"), "THIFANY CASTRO DE")
  assert.equal(quem(null, "estefany.beatriz@contatoserv.com.br"), "estefany.beatriz")
  assert.equal(quem("  ", null), "automação")
})
