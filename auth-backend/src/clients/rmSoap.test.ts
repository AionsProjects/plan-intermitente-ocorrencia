import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ??= "postgres://test"
process.env.GOOGLE_CLIENT_ID ??= "test"
process.env.GOOGLE_CLIENT_SECRET ??= "test"
process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"
process.env.RM_DIRETO_URL ??= "http://rm.teste:8051"
process.env.RM_DIRETO_USER ??= "u"
process.env.RM_DIRETO_PASS ??= "p"

const { saveRecordDireto, extrairFault, extrairTag, desescaparXml, chaveDeRegistroPlausivel } =
  await import("./rmSoap.js")

const fetchOriginal = globalThis.fetch

function responderCom(corpo: string, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(corpo, { status, headers: { "content-type": "text/xml" } })) as typeof fetch
}

test.afterEach(() => {
  globalThis.fetch = fetchOriginal
})

const FAULT_200 = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>` +
  `<faultcode>a:InternalServiceFault</faultcode>` +
  `<faultstring xml:lang="pt-BR">Data da convocação inferior ao permitido.</faultstring>` +
  `</s:Fault></s:Body></s:Envelope>`

test("SaveRecord: Fault com HTTP 200 vira erro COM a mensagem do RM, não 'sem SaveRecordResult'", async () => {
  // O RM devolve Fault em 200 (comprovado: GetSchema de DataServer inválido). Sem tratar, a
  // mensagem real — onde o RM explica a recusa — se perde atrás de um erro genérico.
  responderCom(FAULT_200, 200)
  await assert.rejects(
    () => saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3"),
    (e: Error & { fault?: string; indeterminado?: boolean }) => {
      assert.match(e.message, /Data da convocação inferior ao permitido/)
      assert.equal(e.fault, "Data da convocação inferior ao permitido.")
      // Fault = o RM respondeu e recusou (rollback). Não é o caso perigoso do timeout.
      assert.equal(e.indeterminado, false)
      return true
    },
  )
})

test("SaveRecord: timeout continua INDETERMINADO — pode ter gravado, nunca reenviar", async () => {
  globalThis.fetch = (async () => {
    const e = new Error("timed out")
    e.name = "TimeoutError"
    throw e
  }) as typeof fetch
  await assert.rejects(
    () => saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3"),
    (e: Error & { indeterminado?: boolean }) => {
      assert.equal(e.indeterminado, true)
      return true
    },
  )
})

test("SaveRecord: 500 sem Fault segue indeterminado; 403 é pré-voo (seguro cair pra ponte)", async () => {
  responderCom("<html>erro</html>", 500)
  await assert.rejects(
    () => saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3"),
    (e: Error & { indeterminado?: boolean }) => e.indeterminado === true,
  )
  responderCom("<html>no</html>", 403)
  await assert.rejects(
    () => saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3"),
    (e: Error & { indeterminado?: boolean; status?: number }) =>
      e.indeterminado === false && e.status === 403,
  )
})

test("SaveRecord: resposta boa devolve a chave gravada", async () => {
  responderCom(
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
      `<SaveRecordResponse xmlns="http://www.totvs.com/"><SaveRecordResult>3;003330;C03S003753</SaveRecordResult>` +
      `</SaveRecordResponse></s:Body></s:Envelope>`,
  )
  const r = await saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3")
  assert.equal(r.chave, "3;003330;C03S003753")
})

test("SaveRecord: 200 sem resultado e sem Fault é INDETERMINADO (não afirmar que não gravou)", async () => {
  responderCom(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>`)
  await assert.rejects(
    () => saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3"),
    (e: Error & { indeterminado?: boolean }) => e.indeterminado === true,
  )
})

// Texto real devolvido pelo RM em 08/08/2026 dentro do <SaveRecordResult>, com HTTP 200 e sem Fault.
const ERRO_NO_RESULT =
  `Column 'CODCONVOCACAO' does not belong to table PFCONVOCACAO.\r\n` +
  `=======================================\r\n` +
  `   at System.Data.DataRow.GetDataColumn(String columnName)\r\n` +
  `   at RM.Con.Conector.ConWSDataServer.ReadRowPrimaryKey(DataRow row, DataTable tablePK)`

test("SaveRecord: mensagem de erro DENTRO do SaveRecordResult não passa por chave", async () => {
  // Sem isso o chamador grava um stack trace como ref_externa no ledger e perde o caminho de volta.
  responderCom(
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
      `<SaveRecordResponse xmlns="http://www.totvs.com/"><SaveRecordResult>${ERRO_NO_RESULT}` +
      `</SaveRecordResult></SaveRecordResponse></s:Body></s:Envelope>`,
  )
  await assert.rejects(
    () => saveRecordDireto("FopConvocacaoData", "<x/>", "CODCOLIGADA=3"),
    (e: Error & { fault?: string; indeterminado?: boolean }) => {
      assert.match(e.message, /devolveu mensagem no lugar da chave/)
      assert.equal(e.fault, "Column 'CODCONVOCACAO' does not belong to table PFCONVOCACAO.")
      // Não se sabe se a exceção veio antes ou depois de persistir -> conferir lendo, nunca repetir.
      assert.equal(e.indeterminado, true)
      return true
    },
  )
})

test("chaveDeRegistroPlausivel: chave curta de uma linha sim, stack trace não", () => {
  assert.equal(chaveDeRegistroPlausivel("74886"), true)
  assert.equal(chaveDeRegistroPlausivel("3;003330;C03S003328"), true)
  assert.equal(chaveDeRegistroPlausivel(ERRO_NO_RESULT), false)
  assert.equal(chaveDeRegistroPlausivel("   at RM.Con.Conector.ConWSDataServer.SaveRecord(String x)"), false)
  assert.equal(chaveDeRegistroPlausivel("x".repeat(201)), false)
  assert.equal(chaveDeRegistroPlausivel(""), false)
})

test("extrairFault: faultstring (SOAP 1.1) e Text (1.2)", () => {
  assert.equal(extrairFault(FAULT_200), "Data da convocação inferior ao permitido.")
  assert.equal(extrairFault("<Fault><Reason><Text>ruim</Text></Reason></Fault>"), "ruim")
  assert.equal(extrairFault("<ok/>"), null)
})

test("extrairTag: ignora prefixo de namespace, desembrulha CDATA, tag vazia não é null", () => {
  assert.equal(extrairTag("<a:ID>7</a:ID>", "ID"), "7")
  assert.equal(extrairTag("<X><![CDATA[<b/>]]></X>", "X"), "<b/>")
  assert.equal(extrairTag("<X/>", "X"), "")
  assert.equal(extrairTag("<Y>1</Y>", "X"), null)
})

test("desescaparXml: ReadView/ReadRecord vêm escapados", () => {
  assert.equal(desescaparXml("&lt;ID&gt;7&lt;/ID&gt;&#xD;"), "<ID>7</ID>")
  assert.equal(desescaparXml("a &amp;lt; b"), "a &lt; b")
})
