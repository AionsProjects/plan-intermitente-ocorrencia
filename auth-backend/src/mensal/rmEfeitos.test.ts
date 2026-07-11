import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"

const {
  montarXmlHistorico, montarRegistrosHistorico, lotesHistorico, chapasEventosPix,
  montarXmlFopRotinas, montarSoapExecuteProcess, montarXmlIntegrarBackOffices,
  rotularIdfinanc, chapa6, codSecaoBase,
} = await import("./rmEfeitos.js")

test("montarXmlHistorico: vírgula, mesRef, escape, TPBEN=1", () => {
  const xml = montarXmlHistorico({ anoComp: 2026, mesComp: 7, chapa: "006534", nome: "Ana & Bia <X>",
    codSecao: "01.01.0079", codBeneficio: 1, vlrTotal: 594, dataImport: "2026-07-11" })
  assert.ok(xml.includes("<ANOCOMP>2026</ANOCOMP>"))
  assert.ok(xml.includes("<MESCOMP>7</MESCOMP>"))
  assert.ok(xml.includes("<ANOREF>2026</ANOREF>"))
  assert.ok(xml.includes("<MESREF>6</MESREF>"))
  assert.ok(xml.includes("<VLRTOTAL>594,00</VLRTOTAL>"))
  assert.ok(xml.includes("<NOME>Ana &amp; Bia &lt;X&gt;</NOME>"))
  assert.ok(xml.includes("<TPBEN>1</TPBEN>"))
  assert.ok(xml.includes("<CODBENEFICIO>1</CODBENEFICIO>"))
})

test("mesRef vira dezembro do ano anterior em janeiro", () => {
  const xml = montarXmlHistorico({ anoComp: 2027, mesComp: 1, chapa: "1", nome: "N", codSecao: "s",
    codBeneficio: 2, vlrTotal: 10.5, dataImport: "2027-01-05" })
  assert.ok(xml.includes("<ANOREF>2026</ANOREF>"))
  assert.ok(xml.includes("<MESREF>12</MESREF>"))
  assert.ok(xml.includes("<VLRTOTAL>10,50</VLRTOTAL>"))
})

const pessoa = (extra: Record<string, unknown> = {}) => ({
  itemId: "1", nome: "Fulana", chapa: "6534", cpf: "1", contrato: "TRE PB", funcao: "F", unidade: "U",
  interior: "NAO", dataInicio: "2026-07-01", dataFim: "2026-07-31",
  pixVR: 594, pixVT: 218, creditoVR: 66, creditoVT: 32.7, ...extra,
}) as never

test("montarRegistrosHistorico pix vs credito + chapa 6 dígitos", () => {
  const ctx = { anoComp: 2026, mesComp: 7, codSecao: "01.01.0079", dataImport: "2026-07-11" }
  const pix = montarRegistrosHistorico([pessoa()], "pix", ctx)
  assert.equal(pix.length, 2)
  assert.deepEqual(pix.map((r) => r.tipo), ["HIST_PIX_VR", "HIST_PIX_VT"])
  assert.equal(pix[0]!.chapa, "006534")
  assert.equal(pix[0]!.valor, 594)
  assert.ok(pix[1]!.dadosXml.includes("<CODBENEFICIO>2</CODBENEFICIO>"))
  const cred = montarRegistrosHistorico([pessoa()], "credito", ctx)
  assert.deepEqual(cred.map((r) => r.valor), [66, 32.7])
  assert.ok(cred[1]!.dadosXml.includes("<VLRTOTAL>32,70</VLRTOTAL>"))
  // valor zero não gera registro; chapa vazia é pulada
  assert.equal(montarRegistrosHistorico([pessoa({ pixVR: 0, pixVT: 0 })], "pix", ctx).length, 0)
  assert.equal(montarRegistrosHistorico([pessoa({ chapa: "" })], "pix", ctx).length, 0)
})

test("lotesHistorico divide em 50", () => {
  const lotes = lotesHistorico(Array.from({ length: 120 }, (_, i) => i))
  assert.deepEqual(lotes.map((l) => l.length), [50, 50, 20])
  assert.deepEqual(lotesHistorico([]), [])
})

test("chapasEventosPix: eventos 101/111 e dedup de chapas", () => {
  const r = chapasEventosPix([pessoa(), pessoa({ itemId: "2" }), pessoa({ itemId: "3", chapa: "7", pixVR: 0, pixVT: 5 })])
  assert.deepEqual(r.chapas, ["006534", "000007"])
  assert.deepEqual(r.eventos, ["101", "111"])
  const soVr = chapasEventosPix([pessoa({ pixVT: 0 })])
  assert.deepEqual(soVr.eventos, ["101"])
  assert.deepEqual(chapasEventosPix([pessoa({ pixVR: 0, pixVT: 0 })]), { chapas: [], eventos: [] })
})

test("montarXmlFopRotinas carrega eventos, seleção e datas", () => {
  const xml = montarXmlFopRotinas({ coligada: 3, codSecao: "01.01.0079", chapas: ["006534", "000007"],
    eventos: ["101", "111"], anoComp: 2026, mesComp: 7, dataEmissao: "2026-07-11T00:00:00",
    dataVencimento: "2026-07-11T00:00:00", executionId: "exec-1", scheduleDateTime: "2026-07-11T10:00:00.0000000-04:00" })
  assert.ok(xml.includes("<a:string>101</a:string>"))
  assert.ok(xml.includes("<a:string>111</a:string>"))
  assert.ok(xml.includes("<a:string>006534</a:string>"))
  assert.ok(xml.includes("[CHAPA] = '006534' OR \n[CHAPA] = '000007'"))
  assert.ok(xml.includes("<MesComp>7</MesComp>"))
  assert.ok(xml.includes("<AnoComp>2026</AnoComp>"))
  assert.ok(xml.includes("<Coligada>3</Coligada>"))
  assert.ok(xml.includes("<DataEmissao>2026-07-11T00:00:00</DataEmissao>"))
  assert.ok(xml.includes("<ExecutionId xmlns=\"http://www.totvs.com/\">exec-1</ExecutionId>"))
  assert.ok(xml.includes("FopRotinasLancFinanceiroProcess"))
  assert.ok(xml.includes("<CodReceita>0561</CodReceita>"))
  // Contexto interno (Delphi) com prefixos a:/b: trocados
  assert.ok(xml.includes("<a:KeyValueOfanyTypeanyType><a:Key i:type=\"b:string\""))
  assert.ok(xml.includes("$DATASISTEMA"))
})

test("montarSoapExecuteProcess envelopa com CDATA e contexto", () => {
  const soap = montarSoapExecuteProcess("FopRotinasLancFinanceiroProcess", "<X>1</X>", 3)
  assert.ok(soap.includes("<tot:ProcessServerName>FopRotinasLancFinanceiroProcess</tot:ProcessServerName>"))
  assert.ok(soap.includes("<![CDATA[<X>1</X>]]>"))
  assert.ok(soap.includes("CODSISTEMA=P;CODCOLIGADA=3;CODUSUARIO=003080"))
})

test("montarXmlIntegrarBackOffices: PK PFINANCEIRO", () => {
  const xml = montarXmlIntegrarBackOffices({ idFinanc: 98765, coligada: 3, executionId: "e1",
    scheduleDateTime: "2026-07-11T10:00:00.0000000-04:00" })
  assert.ok(xml.includes("<a:anyType i:type=\"b:short\" xmlns:b=\"http://www.w3.org/2001/XMLSchema\">3</a:anyType>"))
  assert.ok(xml.includes("<a:anyType i:type=\"b:int\" xmlns:b=\"http://www.w3.org/2001/XMLSchema\">98765</a:anyType>"))
  assert.ok(xml.includes("<PrimaryKeyTableName xmlns=\"http://www.totvs.com/\">PFINANCEIRO</PrimaryKeyTableName>"))
  assert.ok(xml.includes("FopLancIntegraFinanceiroTerceiroProcess"))
  assert.ok(xml.includes("FopLancIntegraFinanceiroTerceiroAction"))
})

test("rotularIdfinanc: VR/VT/CESTA/OUTRO + ordena por id", () => {
  const rows = rotularIdfinanc([
    { IDFINANC: 30, HISTORICO: "PGTO CAJU VT JULHO" },
    { IDFINANC: 10, HISTORICO: "LANC CAJU VR JULHO" },
    { IDFINANC: 20, HISTORICO: "CESTA BASICA" },
    { IDFINANC: 40, HISTORICO: "OUTRA COISA" },
    { IDFINANC: 0, HISTORICO: "invalido" } as never,
  ])
  assert.deepEqual(rows.map((r) => [r.IDFINANC, r.tipoEvento]), [[10, "VR"], [20, "CESTA"], [30, "VT"], [40, "OUTRO"]])
})

test("chapa6 e codSecaoBase", () => {
  assert.equal(chapa6("65-34"), "006534")
  assert.equal(codSecaoBase("01.01.0079.01.0001"), "01.01.0079")
  assert.equal(codSecaoBase("01.01"), "01.01")
})
