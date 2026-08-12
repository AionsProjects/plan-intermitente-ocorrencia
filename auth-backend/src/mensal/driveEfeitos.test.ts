import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"

const { montarArquivosDriveMensal, safeNomeArquivo, ultimoDiaMes } = await import("./driveEfeitos.js")

const contrato = {
  contrato: "SEDUC INTERIOR", ordem: 1, bloqueado: false, motivoBloqueio: null,
  totais: { vr: 392, vt: 80, credito: 177, pix: 295 }, efeitosPrevistos: [],
  pessoas: [{ itemId: "1", nome: "Fulana", chapa: "007174", cpf: "123", contrato: "SEDUC INTERIOR",
    funcao: "F", unidade: "U", interior: "SIM", dataInicio: "2026-07-01", dataFim: "2026-07-31",
    liquidoVR: 196, liquidoVT: 40, creditoVR: 60, creditoVT: 28.5, pixVR: 136, pixVT: 11.5 }],
} as never

test("safeNomeArquivo remove acento/espacos e trunca", () => {
  assert.equal(safeNomeArquivo("SEDUC INTERIOR"), "SEDUC-INTERIOR")
  assert.equal(safeNomeArquivo("Ção & Cia!"), "Cao-Cia")
  assert.equal(safeNomeArquivo("-x-"), "x")
})

test("ultimoDiaMes cobre fevereiro bissexto e dezembro", () => {
  assert.equal(ultimoDiaMes(2026, 7), "2026-07-31")
  assert.equal(ultimoDiaMes(2028, 2), "2028-02-29")
  assert.equal(ultimoDiaMes(2026, 12), "2026-12-31")
})

test("montarArquivosDriveMensal: 2 TXT + datas do mês", () => {
  const r = montarArquivosDriveMensal(contrato, "2026-07", "JULHO", {
    pedidoCreditoVR: "ord-cvr", pedidoPixVR: "ord-pvr", pedidoPixVT: "ord-pvt",
    idVR: "555", resumoSolicitacao: "RESUMO X",
  })
  assert.equal(r.dataInicio, "2026-07-01")
  assert.equal(r.dataFim, "2026-07-31")
  assert.equal(r.arquivos.length, 2)
  assert.deepEqual(r.arquivos.map((a) => a.tipo), ["caju_boleto", "caju_comprovante"])
  assert.equal(r.arquivos[0]!.nome_arquivo, "boleto-caju-mensal-SEDUC-INTERIOR-2026-07.txt")
  const boleto = Buffer.from(r.arquivos[0]!.conteudoBase64, "base64").toString("utf8")
  assert.ok(boleto.includes("Pedido mensal Caju - SEDUC INTERIOR"))
  assert.ok(boleto.includes("Competencia: JULHO/2026"))
  assert.ok(boleto.includes("Pedido Credito VR: ord-cvr"))
  assert.ok(boleto.includes("Pedido PIX VR: ord-pvr"))
  assert.ok(boleto.includes("Pedido PIX VT: ord-pvt"))
  assert.ok(boleto.includes("Summary PIX VT: https://empresa.caju.com.br/classic/#/order/ord-pvt/summary"))
  assert.ok(boleto.includes("Total VR: 392"))
  assert.ok(boleto.includes("01. Fulana | Chapa: 007174"))
  assert.ok(boleto.includes("Crédito: 88.50 | PIX: 147.50"))
  const comprovante = Buffer.from(r.arquivos[1]!.conteudoBase64, "base64").toString("utf8")
  assert.ok(comprovante.includes("Comprovante tecnico mensal - SEDUC INTERIOR"))
  assert.ok(comprovante.includes("RESUMO X"))
  assert.ok(comprovante.includes("RM idVR: 555"))
})

test("QR base64 vira terceiro arquivo (PNG em caju_boleto)", () => {
  const r = montarArquivosDriveMensal(contrato, "2026-07", "JULHO", { qrBoletoVRBase64: "QUJD" })
  assert.equal(r.arquivos.length, 3)
  const qr = r.arquivos[2]!
  assert.equal(qr.tipo, "caju_boleto")
  assert.equal(qr.mime, "image/png")
  assert.equal(qr.nome_arquivo, "boleto-pix-qr-vr-SEDUC-INTERIOR-2026-07.png")
  assert.equal(qr.conteudoBase64, "QUJD")
})

test("dois boletos = dois PNGs com nomes distintos", () => {
  const r = montarArquivosDriveMensal(contrato, "2026-07", "JULHO", { qrBoletoVRBase64: "QUJD", qrBoletoVTBase64: "WFla" })
  assert.equal(r.arquivos.length, 4)
  assert.deepEqual(r.arquivos.slice(2).map((a) => a.nome_arquivo), [
    "boleto-pix-qr-vr-SEDUC-INTERIOR-2026-07.png",
    "boleto-pix-qr-vt-SEDUC-INTERIOR-2026-07.png",
  ])
  assert.equal(r.arquivos[3]!.conteudoBase64, "WFla")
})
