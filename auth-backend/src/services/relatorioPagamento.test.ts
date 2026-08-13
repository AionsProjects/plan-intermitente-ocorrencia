// Testes do relatório de pagamento em PDF. Puros — nada de banco, Monday ou Caju.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  fmtBrl,
  fmtDataIso,
  gerarRelatorioPagamentoPdf,
  montarPedidosRelatorio,
  nomeArquivoRelatorio,
  type DadosRelatorioPagamento,
} from "./relatorioPagamento.js"

const GERADO = new Date("2026-08-13T18:00:00Z")

const base = (over: Partial<DadosRelatorioPagamento> = {}): DadosRelatorioPagamento => ({
  origem: "PONTUAL",
  contrato: "SEMSA",
  periodoLabel: "01/08/2026 a 05/08/2026",
  dataInicio: "2026-08-01",
  dataFim: "2026-08-05",
  competenciaLabel: "AGOSTO/2026",
  regraAplicada: "padrao",
  pessoas: [{
    nome: "MARIA DA SILVA SAURO",
    chapa: "007104",
    cpf: "000.000.000-00",
    diasVR: 5, diasVT: 5, vrDia: 24.5, vtDia: 10,
    brutoVR: 122.5, brutoVT: 50,
    descontoVR: 24.5, descontoVT: 0,
    liquidoVR: 98, liquidoVT: 50,
    creditoVR: 49, creditoVT: 20,
    pixVR: 49, pixVT: 30,
  }],
  pedidos: [
    { natureza: "CRÉDITO", beneficio: "VR + VT", orderId: "4ad29f2f-cred", valor: 69, resumoUrl: "https://caju/cred" },
    { natureza: "BOLETO", beneficio: "VR + VT", orderId: "2ea22fb9-pix", valor: 79, resumoUrl: "https://caju/pix" },
  ],
  idfinancVR: "24278",
  idfinancVT: "24279",
  solicitacaoUrl: "https://contato-serv.monday.com/boards/18393673859/pulses/1",
  pastaDriveUrl: "https://drive.google.com/drive/folders/abc",
  dividas: [{ descontoMondayItemId: "12115464142", vr: 24.5, vt: 0, status: "FINALIZADO", url: "https://monday/divida" }],
  geradoPor: "automação (felipeta)",
  geradoEm: GERADO,
  ...over,
})

// O PDF é gerado sem compressão de propósito (clients/pdf.ts) — dá pra grepar o conteúdo.
const texto = (buf: Buffer): string => buf.toString("latin1")

test("formatadores", () => {
  assert.equal(fmtBrl(1234.5), "R$ 1.234,50")
  assert.equal(fmtBrl(null), "R$ 0,00")
  assert.equal(fmtDataIso("2026-08-05"), "05/08/2026")
  assert.equal(fmtDataIso(null), "—")
})

test("gera PDF válido com as seções e o nome da pessoa", () => {
  const pdf = gerarRelatorioPagamentoPdf(base())
  assert.ok(pdf.length > 1000)
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-")
  assert.ok(pdf.subarray(-6).toString("latin1").includes("%%EOF"))
  const t = texto(pdf)
  assert.match(t, /MARIA DA SILVA SAURO/)
  assert.match(t, /VALORES/)
  assert.match(t, /PEDIDOS NA CAJU/)
  assert.match(t, /RASTRO/)
  assert.match(t, /D.VIDAS ABATIDAS/) // Í sai como byte WinAnsi, não como "Í" utf-8
  assert.match(t, /24278/)
})

test("rodapé diz que NÃO é a nota de débito da Caju", () => {
  // Sem essa ressalva o documento passa por nota fiscal na mão de quem só bate o olho.
  const t = texto(gerarRelatorioPagamentoPdf(base()))
  assert.match(t, /n.o . a nota de d.bito da Caju/)
})

test("crédito sem nota configurada avisa que a nota sai do painel", () => {
  const t = texto(gerarRelatorioPagamentoPdf(base()))
  assert.match(t, /Nota de d.bito {2}dispon.vel no painel da Caju/)
})

test("crédito com nota configurada mostra o link", () => {
  const d = base()
  d.pedidos[0]!.notaUrl = "https://caju/nota/4ad29f2f"
  const t = texto(gerarRelatorioPagamentoPdf(d))
  assert.match(t, /https:\/\/caju\/nota\/4ad29f2f/)
})

test("pagamento sem boleto diz que não houve lançamento financeiro", () => {
  const t = texto(gerarRelatorioPagamentoPdf(base({ idfinancVR: null, idfinancVT: null })))
  assert.match(t, /sem lan.amento financeiro/)
})

test("sem pedido nenhum (semSaldo) não quebra e explica", () => {
  const t = texto(gerarRelatorioPagamentoPdf(base({ pedidos: [] })))
  assert.match(t, /Nenhum pedido gerado/)
})

test("mensal com N pessoas sai em paisagem e tabela por pessoa", () => {
  const pessoas = Array.from({ length: 40 }, (_, i) => ({
    nome: `INTERMITENTE NUMERO ${i + 1}`,
    chapa: String(1000 + i),
    cpf: null,
    liquidoVR: 100, liquidoVT: 50, descontoVR: 0, descontoVT: 0,
    creditoVR: 60, creditoVT: 0, pixVR: 40, pixVT: 50,
  }))
  const pdf = gerarRelatorioPagamentoPdf(base({ origem: "MENSAL", pessoas, periodoLabel: "AGOSTO/2026" }))
  const t = texto(pdf)
  assert.match(t, /MediaBox \[0 0 841\.89 595\.28\]/) // paisagem
  assert.match(t, /INTERMITENTE NUMERO 40/)           // paginou até o fim
  assert.match(t, /40 intermitentes/)
  // O "de N" tem de ser o número REAL de páginas — é o que as duas passadas garantem.
  const paginas = t.match(/\/Type \/Page[^s]/g)?.length ?? 0
  const total = Number(/p.gina 1 de (\d+)/.exec(t)?.[1] ?? 0)
  assert.ok(paginas > 1, "mensal de 40 pessoas tem de paginar")
  assert.equal(total, paginas)
})

test("uma pessoa sai em retrato", () => {
  assert.match(texto(gerarRelatorioPagamentoPdf(base())), /MediaBox \[0 0 595\.28 841\.89\]/)
})

test("nome do arquivo usa pessoa no pontual e contrato no mensal", () => {
  assert.equal(
    nomeArquivoRelatorio(base()),
    "relatorio-pagamento-pontual-MARIA-DA-SILVA-SAURO-2026-08-01.pdf",
  )
  assert.equal(
    nomeArquivoRelatorio(base({ origem: "MENSAL", pessoas: [] })),
    "relatorio-pagamento-mensal-SEMSA-2026-08-01.pdf",
  )
})

// ---------------------------------------------------------------------------
// montarPedidosRelatorio — os dois formatos que existem em produção
// ---------------------------------------------------------------------------

const valores = { creditoVR: 49, creditoVT: 20, pixVR: 49, pixVT: 30 }

test("pedido ÚNICO por natureza (formato atual do pontual) soma VR+VT numa linha", () => {
  const p = montarPedidosRelatorio(
    [
      { natureza: "CRÉDITO", beneficio: "VR", orderId: "cred-1" },
      { natureza: "BOLETO", beneficio: "VR", orderId: "pix-1" },
    ],
    valores,
  )
  assert.equal(p.length, 2)
  assert.deepEqual(
    p.map((x) => [x.natureza, x.beneficio, x.valor]),
    [["CRÉDITO", "VR + VT", 69], ["BOLETO", "VR + VT", 79]],
  )
})

test("pedido POR benefício (formato antigo / mensal) não dobra o valor", () => {
  // Regressão dos 5 primeiros pagamentos de 13/08: se as duas linhas levassem o total da
  // natureza, o relatório mostraria R$ 138 de crédito onde saíram R$ 69.
  const p = montarPedidosRelatorio(
    [
      { natureza: "CRÉDITO", beneficio: "VR", orderId: "cred-vr" },
      { natureza: "CRÉDITO", beneficio: "VT", orderId: "cred-vt" },
    ],
    valores,
  )
  assert.deepEqual(p.map((x) => [x.beneficio, x.valor]), [["VR", 49], ["VT", 20]])
  assert.equal(p.reduce((a, x) => a + x.valor, 0), 69)
})

test("id vazio não gera linha órfã", () => {
  assert.deepEqual(montarPedidosRelatorio([{ natureza: "BOLETO", beneficio: "VR", orderId: "" }], valores), [])
  assert.deepEqual(montarPedidosRelatorio([], valores), [])
})

test("linha do crédito carrega resumo da Caju", () => {
  const p = montarPedidosRelatorio([{ natureza: "CRÉDITO", beneficio: "VR", orderId: "abc-123" }], valores)
  assert.match(p[0]!.resumoUrl, /order\/abc-123\/summary/)
})
