// Efeitos RM do mensal — porta do WF "INTEGRAR FINANCEIRO - MENSAL INTERMITENTE"
// (KxysRgnlmi9bkCJM) + nós de histórico do principal (krRj3mXCM3F1CCYN):
//   histórico ZMDHSTBENFUNC (SaveRecord via /enviar-rm, lotes de 50)
//   FopRotinasLancFinanceiroProcess (ExecuteWithXmlParams via /executar-processo-rm)
//   consulta IDFNAN (/consultar-rm) + rotulagem VR/VT
//   FopLancIntegraFinanceiroTerceiroProcess por IDFINANC (série)
// Builders puros exportados p/ teste. Executores GATED: só via workflow (producao+ledger).
// AIONS V5: aceita `ambiente` ("producao"|"teste") e `dry_run` — homologação futura usa teste.
import { consultarSqlBruto, enviarRm, executarProcesso } from "../clients/rm.js"
import { contextoDataServer, desescaparXml, readViewDireto } from "../clients/rmSoap.js"
import { config } from "../config.js"
import type { ContratoPreviaMensal, PessoaPreviaMensal } from "./types.js"

export const RM_COLIGADA = 3
export const RM_COD_USUARIO = "003080"
export const RM_DATA_SERVER_HISTORICO = "RMSPRJ3230976Server"
const LOTE_HISTORICO = 50

// Divergências DELIBERADAS vs n8n (decisão do DP em 13/07/2026):
// 1. IntegrarBackOffices roda SÍNCRONO (SyncExecution=true) — o legado usava job
//    assíncrono e o lançamento ficava "Pendente" na tela até o job processar.
// 2. A integração varre TODAS as seções de intermitentes (lista abaixo) — o RM agrupa
//    lançamentos pela seção REAL da pessoa (ex: lotados em ADMINISTRATIVO), então um
//    contrato pode gerar lançamentos fora da sua seção-base; o legado só integrava a base.
export const SECOES_INTERMITENTES = [
  "01.01.0004", // DETRAN
  "01.01.0007", // ADMINISTRATIVO (pessoas de vários contratos lotadas aqui)
  "01.01.0010", // SEDUC SEDE
  "01.01.0011", // SEDUC ESCOLA/INTERIOR
  "01.01.0074", // CETAM
  "01.01.0079", // TRE PB
  "01.01.0085", // SEMSA
] as const

const fmtVirgula = (v: number): string => Number(v || 0).toFixed(2).replace(".", ",")
const escapeXml = (s: string): string =>
  String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)

export function uuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function scheduleDateTimeAgora(agora = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const dataIso = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`
  const tz = -agora.getTimezoneOffset()
  const tzSign = tz >= 0 ? "+" : "-"
  const tzHH = pad(Math.floor(Math.abs(tz) / 60))
  const tzMM = pad(Math.abs(tz) % 60)
  return `${dataIso}T${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}.0000000${tzSign}${tzHH}:${tzMM}`
}

// ---------------------------------------------------------------------------
// Histórico ZMDHSTBENFUNC (PIX e CRÉDITO) — nós "Gerar XMLs Historico * RM".
// ---------------------------------------------------------------------------

export interface RegistroHistoricoRm {
  tipo: string // HIST_PIX_VR | HIST_PIX_VT | HIST_CREDITO_VR | HIST_CREDITO_VT
  chapa: string
  nome: string
  valor: number
  codBeneficio: 1 | 2 // 1=VR, 2=VT
  dadosXml: string
}

export function montarXmlHistorico(p: {
  anoComp: number
  mesComp: number
  chapa: string
  nome: string
  codSecao: string
  codBeneficio: 1 | 2
  vlrTotal: number
  dataImport: string // YYYY-MM-DD
  /**
   * 1 = mensal (default — o fluxo mensal grava TUDO com TPBEN=1, validado 6/6 em produção).
   * 0 = diário — usado pelo PONTUAL no histórico do BOLETO (paridade com o WF5: TPBEN=0 no
   * boleto e 1 no crédito é metade da trava que impede lançamento financeiro sobre o crédito;
   * a outra metade é a ordem, crédito só DEPOIS do FopRotinas).
   */
  tpben?: 0 | 1
}): string {
  let mesRef = p.mesComp - 1
  let anoRef = p.anoComp
  if (mesRef < 1) { mesRef = 12; anoRef -= 1 }
  return `<PRJ3230976>
  <ZMDHSTBENFUNC>
    <ID>-1</ID>
    <CODCOLIGADA>${RM_COLIGADA}</CODCOLIGADA>
    <ANOCOMP>${p.anoComp}</ANOCOMP>
    <MESCOMP>${p.mesComp}</MESCOMP>
    <ANOREF>${anoRef}</ANOREF>
    <MESREF>${mesRef}</MESREF>
    <CHAPA>${p.chapa}</CHAPA>
    <NOME>${escapeXml(p.nome)}</NOME>
    <CODSECAO>${p.codSecao}</CODSECAO>
    <CODBENEFICIO>${p.codBeneficio}</CODBENEFICIO>
    <VLRTOTAL>${fmtVirgula(p.vlrTotal)}</VLRTOTAL>
    <TPBEN>${p.tpben ?? 1}</TPBEN>
    <CATFUN>1</CATFUN>
    <DATAIMPORT>${p.dataImport}</DATAIMPORT>
  </ZMDHSTBENFUNC>
</PRJ3230976>`
}

export function chapa6(chapa: string): string {
  return String(chapa || "").replace(/\D/g, "").padStart(6, "0")
}

/** Base do código de seção: 3 primeiros octetos (ex 01.01.0079). */
export function codSecaoBase(v: string): string {
  const partes = String(v || "").trim().split(".").filter(Boolean)
  return partes.length >= 3 ? partes.slice(0, 3).join(".") : String(v || "").trim()
}

export function montarRegistrosHistorico(
  pessoas: PessoaPreviaMensal[],
  tipo: "pix" | "credito",
  contexto: { anoComp: number; mesComp: number; codSecao: string; dataImport: string },
): RegistroHistoricoRm[] {
  const label = tipo === "pix" ? "PIX" : "CREDITO"
  const out: RegistroHistoricoRm[] = []
  for (const p of pessoas) {
    const chapa = chapa6(p.chapa)
    if (!chapa || chapa === "000000") continue
    const vr = Number((tipo === "pix" ? p.pixVR : p.creditoVR) || 0)
    const vt = Number((tipo === "pix" ? p.pixVT : p.creditoVT) || 0)
    if (vr > 0) out.push({
      tipo: `HIST_${label}_VR`, chapa, nome: p.nome, valor: vr, codBeneficio: 1,
      dadosXml: montarXmlHistorico({ ...contexto, chapa, nome: p.nome, codBeneficio: 1, vlrTotal: vr }),
    })
    if (vt > 0) out.push({
      tipo: `HIST_${label}_VT`, chapa, nome: p.nome, valor: vt, codBeneficio: 2,
      dadosXml: montarXmlHistorico({ ...contexto, chapa, nome: p.nome, codBeneficio: 2, vlrTotal: vt }),
    })
  }
  return out
}

/** Divide os registros em lotes de 50 (limite operacional da ponte — igual ao n8n). */
export function lotesHistorico<T>(registros: T[], tamanho = LOTE_HISTORICO): T[][] {
  const out: T[][] = []
  for (let i = 0; i < registros.length; i += tamanho) out.push(registros.slice(i, i + tamanho))
  return out
}

// ---------------------------------------------------------------------------
// FopRotinas (Geração de Lançamentos Financeiros) — só pessoas com PIX.
// ---------------------------------------------------------------------------

/** chapas (6 dígitos, dedup) e eventos (101=VR PIX, 111=VT PIX) — nó "Mensal Init Loop". */
export function chapasEventosPix(pessoas: PessoaPreviaMensal[]): { chapas: string[]; eventos: string[] } {
  const comBoleto = pessoas.filter((p) => (Number(p.pixVR) || 0) > 0 || (Number(p.pixVT) || 0) > 0)
  const chapas = [...new Set(comBoleto.map((p) => chapa6(p.chapa)).filter((s) => s && s !== "000000"))]
  const eventos: string[] = []
  if (comBoleto.some((p) => (Number(p.pixVR) || 0) > 0)) eventos.push("101")
  if (comBoleto.some((p) => (Number(p.pixVT) || 0) > 0)) eventos.push("111")
  return { chapas, eventos }
}

const paramsContexto = (coligada: number, extras = ""): string => `
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EXERCICIOFISCAL</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODLOCPRT</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODTIPOCURSO</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EDUTIPOUSR</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUNIDADEBIB</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${coligada}</b:Value></b:KeyValueOfanyTypeanyType>${extras}
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$RHTIPOUSR</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODIGOEXTERNO</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">P</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIOSERVICO</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema" /></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">${RM_COD_USUARIO}</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$IDPRJ</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CHAPAFUNCIONARIO</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value></b:KeyValueOfanyTypeanyType>`

export interface FopRotinasParams {
  coligada: number
  codSecao: string
  chapas: string[]
  eventos: string[]
  anoComp: number
  mesComp: number
  dataEmissao: string // YYYY-MM-DDT00:00:00
  dataVencimento: string // YYYY-MM-DDT00:00:00
  executionId: string
  scheduleDateTime: string
}

export function montarXmlFopRotinas(d: FopRotinasParams): string {
  const eventosXml = d.eventos.map((ev) => `<a:string>${ev}</a:string>`).join("\n    ")
  const chapasXmlSelecao = d.chapas.map((c) => `<a:string>${c}</a:string>`).join("\n      ")
  const filtroChapas = d.chapas.map((c) => `[CHAPA] = '${c}'`).join(" OR \n")
  return `<?xml version="1.0" encoding="utf-16"?>
<FopParamsRotinasLancFinanceiro z:Id="i1" xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
  <ActionModule xmlns="http://www.totvs.com/">P</ActionModule>
  <ActionName xmlns="http://www.totvs.com/">FopRotinasLancFinanceiroAction</ActionName>
  <CanParallelize xmlns="http://www.totvs.com/">true</CanParallelize>
  <CanSendMail xmlns="http://www.totvs.com/">false</CanSendMail>
  <CanWaitSchedule xmlns="http://www.totvs.com/">false</CanWaitSchedule>
  <CodUsuario xmlns="http://www.totvs.com/">${RM_COD_USUARIO}</CodUsuario>
  <ConnectionId i:nil="true" xmlns="http://www.totvs.com/" />
  <ConnectionString i:nil="true" xmlns="http://www.totvs.com/" />
  <Context z:Id="i2" xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${paramsContexto(d.coligada)}
    </a:_params>
    <a:Environment>DotNet</a:Environment>
  </Context>
  <CustomData i:nil="true" xmlns="http://www.totvs.com/" />
  <DisableIsolateProcess xmlns="http://www.totvs.com/">false</DisableIsolateProcess>
  <DriverType i:nil="true" xmlns="http://www.totvs.com/" />
  <ExecutionId xmlns="http://www.totvs.com/">${d.executionId}</ExecutionId>
  <FailureMessage xmlns="http://www.totvs.com/">Falha na execução do processo</FailureMessage>
  <FriendlyLogs i:nil="true" xmlns="http://www.totvs.com/" />
  <HideProgressDialog xmlns="http://www.totvs.com/">false</HideProgressDialog>
  <HostName xmlns="http://www.totvs.com/">165112-go-global-N-RM-P-CZHJVP-1-f3aa98375WIN-CE01</HostName>
  <Initialized xmlns="http://www.totvs.com/">true</Initialized>
  <Ip xmlns="http://www.totvs.com/">10.0.1.7</Ip>
  <IsolateProcess xmlns="http://www.totvs.com/">false</IsolateProcess>
  <JobID xmlns="http://www.totvs.com/">
    <Children />
    <ExecID>1</ExecID>
    <ID>1</ID>
    <IsPriorityJob>false</IsPriorityJob>
  </JobID>
  <JobServerHostName xmlns="http://www.totvs.com/">165112-core-instance-N-RM-P-CZHJVP-1-6e186WIN-CE01</JobServerHostName>
  <MasterActionName i:nil="true" xmlns="http://www.totvs.com/" />
  <MaximumQuantityOfPrimaryKeysPerProcess xmlns="http://www.totvs.com/">1000</MaximumQuantityOfPrimaryKeysPerProcess>
  <MinimumQuantityOfPrimaryKeysPerProcess xmlns="http://www.totvs.com/">1</MinimumQuantityOfPrimaryKeysPerProcess>
  <NetworkUser xmlns="http://www.totvs.com/">n8n</NetworkUser>
  <NotifyEmail xmlns="http://www.totvs.com/">false</NotifyEmail>
  <NotifyEmailList i:nil="true" xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
  <NotifyFluig xmlns="http://www.totvs.com/">false</NotifyFluig>
  <OnlineMode xmlns="http://www.totvs.com/">false</OnlineMode>
  <PrimaryKeyList xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
  <PrimaryKeyNames i:nil="true" xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
  <PrimaryKeyTableName i:nil="true" xmlns="http://www.totvs.com/" />
  <ProcessName xmlns="http://www.totvs.com/">Geração de Lançamentos Financeiros</ProcessName>
  <QuantityOfSplits xmlns="http://www.totvs.com/">0</QuantityOfSplits>
  <SaveLogInDatabase xmlns="http://www.totvs.com/">true</SaveLogInDatabase>
  <SaveParamsExecution xmlns="http://www.totvs.com/">false</SaveParamsExecution>
  <ScheduleDateTime xmlns="http://www.totvs.com/">${d.scheduleDateTime}</ScheduleDateTime>
  <Scheduler xmlns="http://www.totvs.com/">JobMonitor</Scheduler>
  <SendMail xmlns="http://www.totvs.com/">false</SendMail>
  <ServerName xmlns="http://www.totvs.com/">FopRotinasLancFinanceiroProcess</ServerName>
  <ServiceInterface i:nil="true" xmlns="http://www.totvs.com/" xmlns:a="http://schemas.datacontract.org/2004/07/System" />
  <ShouldParallelize xmlns="http://www.totvs.com/">false</ShouldParallelize>
  <ShowReExecuteButton xmlns="http://www.totvs.com/">true</ShowReExecuteButton>
  <StatusMessage i:nil="true" xmlns="http://www.totvs.com/" />
  <SuccessMessage xmlns="http://www.totvs.com/">Processo executado com sucesso</SuccessMessage>
  <SyncExecution xmlns="http://www.totvs.com/">false</SyncExecution>
  <UseJobMonitor xmlns="http://www.totvs.com/">true</UseJobMonitor>
  <UserName xmlns="http://www.totvs.com/">${RM_COD_USUARIO}</UserName>
  <WaitSchedule xmlns="http://www.totvs.com/">false</WaitSchedule>
  <EnableJobErrorProgressbar xmlns="http://www.totvs.com/">false</EnableJobErrorProgressbar>
  <EnableTracing xmlns="http://www.totvs.com/">false</EnableTracing>
  <LocalOnlyExecutor xmlns="http://www.totvs.com/">RMSJobData</LocalOnlyExecutor>
  <RMSJobIds i:nil="true" xmlns="http://www.totvs.com/" />
  <SlicesCount xmlns="http://www.totvs.com/">0</SlicesCount>
  <AnoComp>${d.anoComp}</AnoComp>
  <AnoCompAnteriorIRRF i:nil="true" />
  <AnoCompAtual>${d.anoComp}</AnoCompAtual>
  <AnoCompAtualIRRF i:nil="true" />
  <AnoCompSeguinteIRRF i:nil="true" />
  <CarregaMovimentoMesIRRFAnterior>false</CarregaMovimentoMesIRRFAnterior>
  <CarregaMovimentoMesIRRFAtual>true</CarregaMovimentoMesIRRFAtual>
  <CarregaMovimentoMesIRRFProximo>true</CarregaMovimentoMesIRRFProximo>
  <ChapaAte i:nil="true" />
  <ChapaDe i:nil="true" />
  <Chapas i:nil="true" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
  <CodReceita>0561</CodReceita>
  <CodUsuario>${RM_COD_USUARIO}</CodUsuario>
  <CodigosLanctoAtivos xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
    ${eventosXml}
  </CodigosLanctoAtivos>
  <Coligada>${d.coligada}</Coligada>
  <ConsideraApenasUltimoPeriodoGozoFerias>false</ConsideraApenasUltimoPeriodoGozoFerias>
  <ContaCaixa />
  <DataEmissao>${d.dataEmissao}</DataEmissao>
  <DataFinalIR>2024-01-31T00:00:00</DataFinalIR>
  <DataInicialIR>2024-01-01T00:00:00</DataInicialIR>
  <DataPgtoFinalGerLancFer>0001-01-01T00:00:00</DataPgtoFinalGerLancFer>
  <DataPgtoInicialGerLancFer>0001-01-01T00:00:00</DataPgtoInicialGerLancFer>
  <DataPrevBaixa>${d.dataEmissao}</DataPrevBaixa>
  <DataVencimento>${d.dataVencimento}</DataVencimento>
  <DesconsiderarIRRFPLR>false</DesconsiderarIRRFPLR>
  <FiltrarEventosLanctoIRRF>false</FiltrarEventosLanctoIRRF>
  <FiltrarLanctoFerias>false</FiltrarLanctoFerias>
  <ForcarInclusaoLancFinancSemelhante>false</ForcarInclusaoLancFinancSemelhante>
  <Fracionado>false</Fracionado>
  <GeraLanctoBloqueado>false</GeraLanctoBloqueado>
  <GeraLanctoRateadoCentroCusto>false</GeraLanctoRateadoCentroCusto>
  <GeraLanctoRateadoDepartamento>false</GeraLanctoRateadoDepartamento>
  <Global>false</Global>
  <LoteLanctoFinanc i:nil="true" />
  <MesComp>${d.mesComp}</MesComp>
  <MesCompAnteriorIRRF i:nil="true" />
  <MesCompAtual>${d.mesComp}</MesCompAtual>
  <MesCompAtualIRRF i:nil="true" />
  <MesCompSeguinteIRRF i:nil="true" />
  <NumeroLoteFinanceiro>0</NumeroLoteFinanceiro>
  <OpcaoAgrupamento>Secao</OpcaoAgrupamento>
  <OpcaoOrdenacao>Nenhuma</OpcaoOrdenacao>
  <Periodo />
  <PeriodoCompAnteriorIRRF i:nil="true" />
  <PeriodoCompAtualIRRF i:nil="true" />
  <PeriodoCompSeguinteIRRF i:nil="true" />
  <QtdeSlice>0</QtdeSlice>
  <QuebraSecao>??.??.????</QuebraSecao>
  <ReformaTrabalhistaAtiva>true</ReformaTrabalhistaAtiva>
  <SelecaoFuncionario>
    <Chapa xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
      ${chapasXmlSelecao}
    </Chapa>
    <CodRecebimento>DHMOPQST</CodRecebimento>
    <CodSituacao>ACDEFGIKLMNOPQRSTUVWYZ</CodSituacao>
    <CodTipo>ABCDEFIMNOPRSTUVWXZ</CodTipo>
    <Contexto z:Id="i3">
      <_params xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${paramsContexto(d.coligada, `
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$DATASISTEMA</b:Key><b:Value i:type="c:dateTime" xmlns:c="http://www.w3.org/2001/XMLSchema">${d.dataEmissao}</b:Value></b:KeyValueOfanyTypeanyType>`).replace(/<b:/g, "<a:").replace(/<\/b:/g, "</a:").replace(/xmlns:c=/g, "xmlns:b=").replace(/"c:/g, '"b:')}
      </_params>
      <Environment>Delphi</Environment>
    </Contexto>
    <DataFimCompetencia>0001-01-01T00:00:00</DataFimCompetencia>
    <ExibeSituacaoAdmissaoProxMes>false</ExibeSituacaoAdmissaoProxMes>
    <FiltroGlobais z:Id="i4"><FiltroID>0</FiltroID><NomeFiltro>Temporário</NomeFiltro><Parametros>&lt;dsParams&gt;&lt;xs:schema id="dsParams" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"&gt;&lt;xs:element name="dsParams" msdata:IsDataSet="true" msdata:UseCurrentLocale="true"&gt;&lt;xs:complexType&gt;&lt;xs:choice minOccurs="0" maxOccurs="unbounded"&gt;&lt;xs:element name="params"&gt;&lt;xs:complexType&gt;&lt;xs:sequence&gt;&lt;xs:element name="name" type="xs:string" /&gt;&lt;xs:element name="value" msdata:DataType="System.Object, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089" type="xs:anyType" minOccurs="0" /&gt;&lt;/xs:sequence&gt;&lt;/xs:complexType&gt;&lt;/xs:element&gt;&lt;/xs:choice&gt;&lt;/xs:complexType&gt;&lt;xs:unique name="Constraint1" msdata:PrimaryKey="true"&gt;&lt;xs:selector xpath=".//params" /&gt;&lt;xs:field xpath="name" /&gt;&lt;/xs:unique&gt;&lt;/xs:element&gt;&lt;/xs:schema&gt;&lt;/dsParams&gt;</Parametros></FiltroGlobais>
    <FiltroGlobaisTemporario>${filtroChapas}</FiltroGlobaisTemporario>
    <FiltroPerfil />
    <FormulaSelecao />
    <NaoPermiteCodSituacao i:nil="true" />
    <NaoUsaCodReceb>false</NaoUsaCodReceb>
    <NaoUsaSituacao>false</NaoUsaSituacao>
    <NaoUsaTipoFunc>false</NaoUsaTipoFunc>
    <SkipSecurity>false</SkipSecurity>
    <UsaHstSituacao>false</UsaHstSituacao>
  </SelecaoFuncionario>
  <SlicedFilter i:nil="true" />
  <TabOp01 /><TabOp02 /><TabOp03 /><TabOp04 /><TabOp05 />
  <UsaCentroCusto>false</UsaCentroCusto>
  <UsaContaClienteFornec>false</UsaContaClienteFornec>
  <UsaFilialContabil>false</UsaFilialContabil>
  <UsaFornecFunc>false</UsaFornecFunc>
  <UsaNaturezaFinanceiraEvento>false</UsaNaturezaFinanceiraEvento>
  <UsaPametrosTabOp01>false</UsaPametrosTabOp01>
  <UsaPametrosTabOp02>false</UsaPametrosTabOp02>
  <UsaPametrosTabOp03>false</UsaPametrosTabOp03>
  <UsaPametrosTabOp04>false</UsaPametrosTabOp04>
  <UsaPametrosTabOp05>false</UsaPametrosTabOp05>
  <UsaRateioFixoValor>false</UsaRateioFixoValor>
  <UsaTomadorServico>true</UsaTomadorServico>
</FopParamsRotinasLancFinanceiro>`
}

export function montarSoapExecuteProcess(processServerName: string, xmlInner: string, coligada: number): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:ExecuteWithXmlParams>
         <tot:ProcessServerName>${processServerName}</tot:ProcessServerName>
         <tot:strXmlParams><![CDATA[${xmlInner}]]></tot:strXmlParams>
         <tot:Contexto>CODSISTEMA=P;CODCOLIGADA=${coligada};CODUSUARIO=${RM_COD_USUARIO}</tot:Contexto>
      </tot:ExecuteWithXmlParams>
   </soapenv:Body>
</soapenv:Envelope>`
}

// ---------------------------------------------------------------------------
// IntegrarBackOffices — 1 SOAP por IDFINANC (PFINANCEIRO, PK CODCOLIGADA+IDFINANC).
// ---------------------------------------------------------------------------

export function montarXmlIntegrarBackOffices(d: {
  idFinanc: number | string
  coligada: number
  executionId: string
  scheduleDateTime: string
}): string {
  return `<?xml version="1.0" encoding="utf-16"?>
<FopLancIntegraTerceiroParms z:Id="i1" xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
  <ActionModule xmlns="http://www.totvs.com/">P</ActionModule>
  <ActionName xmlns="http://www.totvs.com/">FopLancIntegraFinanceiroTerceiroAction</ActionName>
  <CanParallelize xmlns="http://www.totvs.com/">true</CanParallelize>
  <CanSendMail xmlns="http://www.totvs.com/">false</CanSendMail>
  <CanWaitSchedule xmlns="http://www.totvs.com/">false</CanWaitSchedule>
  <CodUsuario xmlns="http://www.totvs.com/">${RM_COD_USUARIO}</CodUsuario>
  <ConnectionId i:nil="true" xmlns="http://www.totvs.com/" />
  <ConnectionString i:nil="true" xmlns="http://www.totvs.com/" />
  <Context z:Id="i2" xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${paramsContexto(d.coligada)}
    </a:_params>
    <a:Environment>DotNet</a:Environment>
  </Context>
  <CustomData i:nil="true" xmlns="http://www.totvs.com/" />
  <DisableIsolateProcess xmlns="http://www.totvs.com/">false</DisableIsolateProcess>
  <DriverType i:nil="true" xmlns="http://www.totvs.com/" />
  <ExecutionId xmlns="http://www.totvs.com/">${d.executionId}</ExecutionId>
  <FailureMessage xmlns="http://www.totvs.com/">Falha na execução do processo</FailureMessage>
  <FriendlyLogs i:nil="true" xmlns="http://www.totvs.com/" />
  <HideProgressDialog xmlns="http://www.totvs.com/">false</HideProgressDialog>
  <HostName xmlns="http://www.totvs.com/">n8n-integration</HostName>
  <Initialized xmlns="http://www.totvs.com/">true</Initialized>
  <Ip xmlns="http://www.totvs.com/">10.0.1.7</Ip>
  <IsolateProcess xmlns="http://www.totvs.com/">false</IsolateProcess>
  <JobID xmlns="http://www.totvs.com/">
    <Children />
    <ExecID>1</ExecID>
    <ID>1</ID>
    <IsPriorityJob>false</IsPriorityJob>
  </JobID>
  <JobServerHostName xmlns="http://www.totvs.com/">165112-core-instance-N-RM-P-CZHJVP-1-6e186WIN-CE01</JobServerHostName>
  <MasterActionName xmlns="http://www.totvs.com/">FopLancFinanceiroAction</MasterActionName>
  <MaximumQuantityOfPrimaryKeysPerProcess xmlns="http://www.totvs.com/">1000</MaximumQuantityOfPrimaryKeysPerProcess>
  <MinimumQuantityOfPrimaryKeysPerProcess xmlns="http://www.totvs.com/">1</MinimumQuantityOfPrimaryKeysPerProcess>
  <NetworkUser xmlns="http://www.totvs.com/">n8n</NetworkUser>
  <NotifyEmail xmlns="http://www.totvs.com/">false</NotifyEmail>
  <NotifyEmailList i:nil="true" xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
  <NotifyFluig xmlns="http://www.totvs.com/">false</NotifyFluig>
  <OnlineMode xmlns="http://www.totvs.com/">false</OnlineMode>
  <PrimaryKeyList xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
    <a:ArrayOfanyType>
      <a:anyType i:type="b:short" xmlns:b="http://www.w3.org/2001/XMLSchema">${d.coligada}</a:anyType>
      <a:anyType i:type="b:int" xmlns:b="http://www.w3.org/2001/XMLSchema">${d.idFinanc}</a:anyType>
    </a:ArrayOfanyType>
  </PrimaryKeyList>
  <PrimaryKeyNames xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
    <a:string>CODCOLIGADA</a:string>
    <a:string>IDFINANC</a:string>
  </PrimaryKeyNames>
  <PrimaryKeyTableName xmlns="http://www.totvs.com/">PFINANCEIRO</PrimaryKeyTableName>
  <ProcessName xmlns="http://www.totvs.com/">Integração financeira com outros Backoffices</ProcessName>
  <QuantityOfSplits xmlns="http://www.totvs.com/">0</QuantityOfSplits>
  <SaveLogInDatabase xmlns="http://www.totvs.com/">true</SaveLogInDatabase>
  <SaveParamsExecution xmlns="http://www.totvs.com/">false</SaveParamsExecution>
  <ScheduleDateTime xmlns="http://www.totvs.com/">${d.scheduleDateTime}</ScheduleDateTime>
  <Scheduler xmlns="http://www.totvs.com/">JobMonitor</Scheduler>
  <SendMail xmlns="http://www.totvs.com/">false</SendMail>
  <ServerName xmlns="http://www.totvs.com/">FopLancIntegraFinanceiroTerceiroProcess</ServerName>
  <ServiceInterface i:nil="true" xmlns="http://www.totvs.com/" xmlns:a="http://schemas.datacontract.org/2004/07/System" />
  <ShouldParallelize xmlns="http://www.totvs.com/">false</ShouldParallelize>
  <ShowReExecuteButton xmlns="http://www.totvs.com/">true</ShowReExecuteButton>
  <StatusMessage i:nil="true" xmlns="http://www.totvs.com/" />
  <SuccessMessage xmlns="http://www.totvs.com/">Processo executado com sucesso</SuccessMessage>
  <SyncExecution xmlns="http://www.totvs.com/">true</SyncExecution>
  <UseJobMonitor xmlns="http://www.totvs.com/">false</UseJobMonitor>
  <UserName xmlns="http://www.totvs.com/">${RM_COD_USUARIO}</UserName>
  <WaitSchedule xmlns="http://www.totvs.com/">false</WaitSchedule>
  <Coligada>${d.coligada}</Coligada>
</FopLancIntegraTerceiroParms>`
}

// ---------------------------------------------------------------------------
// IDFNAN — rotulagem VR/VT (nó "Pegar IDFINANCs").
// ---------------------------------------------------------------------------

export interface RowIdfinanc {
  IDFINANC: number
  HISTORICO?: string
  VALORORIGINAL?: number
}

export interface IdfinancRotulado extends RowIdfinanc {
  tipoEvento: "VR" | "VT" | "CESTA" | "OUTRO"
}

export function rotularIdfinanc(rows: RowIdfinanc[]): IdfinancRotulado[] {
  return rows
    .filter((r) => r && r.IDFINANC)
    .map((r) => {
      const h = String(r.HISTORICO || "").toUpperCase()
      let tipoEvento: IdfinancRotulado["tipoEvento"] = "OUTRO"
      if (h.includes(" VR ") || h.includes("CAJU VR")) tipoEvento = "VR"
      else if (h.includes(" VT ") || h.includes("CAJU VT")) tipoEvento = "VT"
      else if (h.includes("CESTA")) tipoEvento = "CESTA"
      return { ...r, tipoEvento }
    })
    .sort((a, b) => a.IDFINANC - b.IDFINANC)
}

// ---------------------------------------------------------------------------
// Executores (ESCRITA REAL no RM — GATED no workflow). `ambiente` explícito.
// ---------------------------------------------------------------------------

export interface OpcoesRm { ambiente?: "producao" | "teste"; dryRun?: boolean }

/** Resultado de uma escrita RM. `chave` = PK do registro — só o caminho DIRETO devolve. */
export interface EscritaRm {
  via: "direto" | "ponte"
  chave?: string
}

/**
 * Grava 1 registro de histórico ZMDHSTBENFUNC (SaveRecord /enviar-rm).
 *
 * Devolve a PK pra quem chama poder registrá-la no ledger. A ponte AIONS NÃO devolve chave
 * (o payload de resposta dela não tem o campo), então `chave` vem undefined quando cai pra lá —
 * e nesse caso o run continua sem caminho de volta pelo ledger. É mais um motivo pra escrita
 * ficar no direto.
 */
export async function enviarHistoricoRm(registro: RegistroHistoricoRm, opts: OpcoesRm = {}): Promise<EscritaRm> {
  const r = (await enviarRm(registro.dadosXml, {
    solicitante: "backend-pi-mensal-historico",
    dataServer: RM_DATA_SERVER_HISTORICO,
    ambiente: opts.ambiente ?? "producao",
  })) as Record<string, unknown> | null
  const chave = typeof r?.chave === "string" && r.chave.trim() ? r.chave.trim() : undefined
  return { via: r?.via === "direto" ? "direto" : "ponte", chave }
}

/**
 * Trava por FATO: quem já tem histórico desta competência no RM.
 *
 * A idempotência do ledger é por MOTOR (`mensal:<comp>:<CONTRATO>:<etapa>`) — ela não vê o que
 * OUTRO sistema gravou. Em 26/08 e 31/08 de 2026 dois motores processaram a competência 09 e o
 * RM ficou com 532 benefícios contados em dobro (R$ 185.031,50); em 08/2026 foram 1.443. Cada
 * ledger dizia, corretamente, "eu nunca fiz isso".
 *
 * O RM é a única fonte que sabe o fato. Devolve `chapa|codBeneficio` do que já está lá.
 *
 * READ-ONLY. Só para fluxo MENSAL: no pontual um registro por convocação paga é o normal
 * (medido: MICHELE GALVAO, chapa 007425, teve 7 pagamentos em 08/2026 e 7 registros legítimos).
 */
export async function chapasComHistoricoNoRm(p: {
  coligada: number
  anoComp: number
  mesComp: number
}): Promise<Set<string>> {
  const xml = desescaparXml(
    await readViewDireto(
      RM_DATA_SERVER_HISTORICO,
      `ZMDHSTBENFUNC.CODCOLIGADA=${p.coligada} AND ZMDHSTBENFUNC.ANOCOMP=${p.anoComp} AND ZMDHSTBENFUNC.MESCOMP=${p.mesComp}`,
      contextoDataServer(p.coligada),
      config.rmSoapTimeoutProcessoMs,
    ),
  )
  const achados = new Set<string>()
  for (const bloco of xml.split("<ZMDHSTBENFUNC>").slice(1)) {
    const corpo = bloco.split("</ZMDHSTBENFUNC>")[0] ?? ""
    const chapa = /<CHAPA>([^<]*)<\/CHAPA>/.exec(corpo)?.[1]?.trim()
    const ben = /<CODBENEFICIO>([^<]*)<\/CODBENEFICIO>/.exec(corpo)?.[1]?.trim()
    if (chapa && ben) achados.add(`${chapa6(chapa)}|${ben}`)
  }
  return achados
}

/**
 * Tira do lote quem o RM já tem. Puro, pra ficar provado em teste em vez de comentado.
 *
 * O que fica de fora NÃO é erro: é a prova de que outro motor já pagou aquele benefício naquela
 * competência. Quem chama registra os pulados — silêncio aqui esconderia pagamento faltando.
 */
export function filtrarJaGravados(
  registros: RegistroHistoricoRm[],
  existentes: Set<string>,
): { enviar: RegistroHistoricoRm[]; pulados: string[] } {
  const enviar: RegistroHistoricoRm[] = []
  const pulados: string[] = []
  for (const r of registros) {
    const k = `${chapa6(r.chapa)}|${r.codBeneficio}`
    if (existentes.has(k)) pulados.push(k)
    else enviar.push(r)
  }
  return { enviar, pulados }
}

/** Dispara FopRotinas (Geração de Lançamentos Financeiros) do contrato. */
export async function executarFopRotinas(
  p: Omit<FopRotinasParams, "executionId" | "scheduleDateTime">,
  opts: OpcoesRm = {},
): Promise<unknown> {
  const xml = montarXmlFopRotinas({ ...p, executionId: uuidV4(), scheduleDateTime: scheduleDateTimeAgora() })
  return executarProcesso({
    ambiente: opts.ambiente ?? "producao",
    solicitante: "backend-pi-mensal-foprotinas",
    codigo_sistema: "P",
    codigo_coligada: p.coligada,
    soap_xml: montarSoapExecuteProcess("FopRotinasLancFinanceiroProcess", xml, p.coligada),
    ...(opts.dryRun ? { dry_run: true } : {}),
  })
}

/** Consulta IDFNAN por seção+data de emissão. READ-ONLY. */
export async function consultarIdfinanc(
  p: { coligada: number; codSecao: string; dataEmissao: string },
  opts: OpcoesRm = {},
): Promise<IdfinancRotulado[]> {
  const rows = await consultarSqlBruto<RowIdfinanc>({
    codigoSql: "IDFNAN",
    solicitante: "backend-pi-mensal-idfnan",
    codigoColigada: p.coligada,
    ambiente: opts.ambiente ?? "producao",
    parametros: { CODCOLIGADA: p.coligada, CODSECAO: p.codSecao, DATAEMISSAO: p.dataEmissao },
  })
  return rotularIdfinanc(rows)
}

/** Integra 1 IDFINANC no backoffice financeiro. */
export async function integrarIdfinanc(
  idFinanc: number | string,
  coligada: number,
  opts: OpcoesRm = {},
): Promise<unknown> {
  const xml = montarXmlIntegrarBackOffices({
    idFinanc, coligada, executionId: uuidV4(), scheduleDateTime: scheduleDateTimeAgora(),
  })
  return executarProcesso({
    ambiente: opts.ambiente ?? "producao",
    solicitante: "backend-pi-mensal-integrar",
    codigo_sistema: "P",
    codigo_coligada: coligada,
    soap_xml: montarSoapExecuteProcess("FopLancIntegraFinanceiroTerceiroProcess", xml, coligada),
    ...(opts.dryRun ? { dry_run: true } : {}),
  })
}

export type { ContratoPreviaMensal }
