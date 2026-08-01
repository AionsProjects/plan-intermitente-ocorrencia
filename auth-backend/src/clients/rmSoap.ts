// Transporte SOAP direto ao RM TOTVS (wsDataServer / wsProcess), Basic Auth — sem a ponte AIONS.
// Só transporte e parsing: os XMLs de negócio continuam em mensal/rmEfeitos.ts.
//
// Contrato conferido em 01/08/2026 contra este mesmo RM:
//  - WSDL /wsDataServer/MEX?wsdl e /wsProcess/MEX?wsdl respondem 200 com a credencial RM_DIRETO_*;
//  - CheckServiceActivity no DataServer devolveu `true` (chamada SOAP autenticada, não só WSDL);
//  - o SOAPAction vai ENTRE ASPAS e sai do WSDL — com o valor errado o RM responde
//    `HTTP 500 ContractFilter mismatch`, que parece erro de credencial e não é;
//  - o formato bate com o que WFs legados do n8n já usaram contra este host
//    (ex. "GERAR LANCAMENTO FINANCEIRO BENEFICIOS": POST /wsProcess/IwsProcess,
//     Content-Type text/xml; charset=utf-8, SOAPAction "…/IwsProcess/ExecuteWithXmlParams").
import { config } from "../config.js"

export interface RmSoapError extends Error {
  rmSoap: true
  status?: number
  fault?: string
  /**
   * true = a chamada PODE ter executado no RM (timeout, 5xx, resposta sem o campo esperado).
   * Quem chama NÃO pode reenviar nem cair pra ponte: reenviar duplicaria a escrita.
   */
  indeterminado?: boolean
  trecho?: string
}

const PATH_DATASERVER = "/wsDataServer/IwsDataServer"
const PATH_PROCESS = "/wsProcess/IwsProcess"
const ACTION_SAVE = "http://www.totvs.com/IwsDataServer/SaveRecord"
const ACTION_READ = "http://www.totvs.com/IwsDataServer/ReadRecord"
const ACTION_CHECK = "http://www.totvs.com/IRMSServer/CheckServiceActivity"
const ACTION_DELETE_KEY = "http://www.totvs.com/IwsDataServer/DeleteRecordByKey"
const ACTION_READ_VIEW = "http://www.totvs.com/IwsDataServer/ReadView"
const ACTION_EXEC_XML = "http://www.totvs.com/IwsProcess/ExecuteWithXmlParams"

export function temRmSoap(): boolean {
  return !!(config.rmDiretoUrl && config.rmDiretoUser && config.rmDiretoPass)
}

function erro(msg: string, extra: Partial<RmSoapError> = {}): RmSoapError {
  const e = new Error(msg) as RmSoapError
  e.rmSoap = true
  Object.assign(e, extra)
  return e
}

/** Conteúdo de uma tag, ignorando prefixo de namespace e desembrulhando CDATA. Nunca lança. */
export function extrairTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>)`)
  const m = re.exec(xml)
  if (!m) return null
  return (m[1] ?? "").replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
}

/** faultstring (SOAP 1.1) ou Text (1.2) — o RM devolve 500 + Fault nos erros de negócio. */
export function extrairFault(xml: string): string | null {
  return extrairTag(xml, "faultstring") ?? extrairTag(xml, "Text")
}

/**
 * POST SOAP cru. SEM retry de propósito: escrita não se repete sozinha — um timeout aqui não
 * cancela nada do lado do RM, então repetir cegamente duplicaria o registro.
 */
async function postSoap(caminho: string, action: string, envelope: string, timeoutMs: number): Promise<string> {
  const url = config.rmDiretoUrl.replace(/\/$/, "") + caminho
  const auth = Buffer.from(`${config.rmDiretoUser}:${config.rmDiretoPass}`).toString("base64")
  let r: Response
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${action}"`, // aspas literais — é assim que o RM espera
        Authorization: `Basic ${auth}`,
      },
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // Falha antes de qualquer byte de resposta. Timeout é o caso perigoso: pode ter executado.
    const nome = (e as Error).name
    const indeterminado = nome === "TimeoutError" || nome === "AbortError"
    throw erro(`RM SOAP ${caminho} transporte: ${(e as Error).message}`, { indeterminado })
  }
  const txt = await r.text()
  if (!r.ok) {
    const fault = extrairFault(txt)
    // 401/403/404 = nem chegou na regra de negócio -> seguro tentar a ponte.
    const preVoo = r.status === 401 || r.status === 403 || r.status === 404
    throw erro(`RM SOAP ${caminho} HTTP ${r.status}${fault ? `: ${fault}` : ""}`, {
      status: r.status,
      fault: fault ?? undefined,
      indeterminado: !preVoo,
      trecho: txt.slice(0, 400),
    })
  }
  return txt
}

/** Envelope do SaveRecord. Contexto no dialeto do DataServer: "CODCOLIGADA=3; USUARIO=003080". */
export function envelopeSaveRecord(dataServerName: string, dadosXml: string, contexto: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:SaveRecord>
         <tot:DataServerName>${dataServerName}</tot:DataServerName>
         <tot:XML><![CDATA[${dadosXml}]]></tot:XML>
         <tot:Contexto>${contexto}</tot:Contexto>
      </tot:SaveRecord>
   </soapenv:Body>
</soapenv:Envelope>`
}

export function contextoDataServer(coligada = 3): string {
  return `CODCOLIGADA=${coligada}; USUARIO=${config.rmCodUsuario}`
}

/** SaveRecord direto. Devolve a chave do registro gravado (vira ref_externa no ledger). */
export async function saveRecordDireto(
  dataServerName: string,
  dadosXml: string,
  contexto: string,
): Promise<{ chave: string; xml: string }> {
  const xml = await postSoap(PATH_DATASERVER, ACTION_SAVE,
    envelopeSaveRecord(dataServerName, dadosXml, contexto), config.rmSoapTimeoutMs)
  const res = extrairTag(xml, "SaveRecordResult")
  // Sem o campo esperado não dá pra afirmar que NÃO gravou -> indeterminado, nunca repetir.
  if (res == null) throw erro("RM SOAP SaveRecord sem SaveRecordResult", { indeterminado: true, trecho: xml.slice(0, 400) })
  return { chave: res.trim(), xml }
}

/** ExecuteWithXmlParams — o envelope já vem pronto de rmEfeitos (passthrough, igual à ponte). */
export async function executeWithXmlParamsDireto(envelope: string): Promise<{ resultado: string; xml: string }> {
  const xml = await postSoap(PATH_PROCESS, ACTION_EXEC_XML, envelope, config.rmSoapTimeoutProcessoMs)
  const res = extrairTag(xml, "ExecuteWithXmlParamsResult")
  if (res == null) throw erro("RM SOAP ExecuteWithXmlParams sem resultado", { indeterminado: true, trecho: xml.slice(0, 400) })
  return { resultado: res.trim(), xml }
}

// --- READ-ONLY: verificação/diagnóstico. Nunca no caminho de escrita. --------

export async function checkServiceActivity(servico: "dataserver" | "process" = "dataserver"): Promise<boolean> {
  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body><tot:CheckServiceActivity/></soapenv:Body>
</soapenv:Envelope>`
  const xml = await postSoap(
    servico === "dataserver" ? PATH_DATASERVER : PATH_PROCESS,
    ACTION_CHECK, envelope, config.rmSoapTimeoutMs,
  )
  return (extrairTag(xml, "CheckServiceActivityResult") ?? "").trim() === "true"
}

/**
 * DeleteRecordByKey — DESTRUTIVO. Existe para desfazer teste controlado e para conciliação
 * (ex.: linha de histórico gravada em duplicidade). Nunca é chamado pelo fluxo do mensal.
 */
export async function deleteRecordByKeyDireto(
  dataServerName: string,
  chave: string,
  contexto: string,
): Promise<string> {
  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:DeleteRecordByKey>
         <tot:DataServerName>${dataServerName}</tot:DataServerName>
         <tot:PrimaryKey>${chave}</tot:PrimaryKey>
         <tot:Contexto>${contexto}</tot:Contexto>
      </tot:DeleteRecordByKey>
   </soapenv:Body>
</soapenv:Envelope>`
  const xml = await postSoap(PATH_DATASERVER, ACTION_DELETE_KEY, envelope, config.rmSoapTimeoutMs)
  return extrairTag(xml, "DeleteRecordByKeyResult") ?? ""
}

/**
 * ReadView — lista registros que casam com um filtro SQL do DataServer.
 *
 * Existe porque o ledger `pi.efeitos_externos` guarda a CONTAGEM do lote
 * (`rm:hist:pix:l0:50`), não as PKs de cada SaveRecord. Sem isso não há caminho de volta:
 * pra desfazer um run é preciso redescobrir os registros pelo filtro.
 *
 * READ-ONLY. O filtro vai cru no XML — só passe literais montados aqui, nunca entrada externa.
 */
export async function readViewDireto(
  dataServerName: string,
  filtro: string,
  contexto: string,
  timeoutMs = config.rmSoapTimeoutProcessoMs,
): Promise<string> {
  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:ReadView>
         <tot:DataServerName>${dataServerName}</tot:DataServerName>
         <tot:Filtro><![CDATA[${filtro}]]></tot:Filtro>
         <tot:Contexto>${contexto}</tot:Contexto>
      </tot:ReadView>
   </soapenv:Body>
</soapenv:Envelope>`
  const xml = await postSoap(PATH_DATASERVER, ACTION_READ_VIEW, envelope, timeoutMs)
  return extrairTag(xml, "ReadViewResult") ?? ""
}

/** Desescapa XML devolvido HTML-escapado (`&lt;ID&gt;`) — ReadRecord/ReadView fazem isso. */
export function desescaparXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xD;/g, "")
    .replace(/&amp;/g, "&")
}

/** ReadRecord de um registro existente — prova DataServerName/Contexto/permissão sem gravar. */
export async function readRecordDireto(dataServerName: string, chave: string, contexto: string): Promise<string> {
  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:ReadRecord>
         <tot:DataServerName>${dataServerName}</tot:DataServerName>
         <tot:PrimaryKey>${chave}</tot:PrimaryKey>
         <tot:Contexto>${contexto}</tot:Contexto>
      </tot:ReadRecord>
   </soapenv:Body>
</soapenv:Envelope>`
  const xml = await postSoap(PATH_DATASERVER, ACTION_READ, envelope, config.rmSoapTimeoutMs)
  return extrairTag(xml, "ReadRecordResult") ?? ""
}
