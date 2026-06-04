#!/usr/bin/env node
/**
 * Patcha WF5 PONTUAL FIFO (Bso4k6ddDNcRmU83) no n8n ANTIGO substituindo
 * 3 chamadas pra AIONS API por chamadas DIRETAS ao RM TOTVS.
 *
 * Espelha arquitetura do WF MESTRE (1Tpy2wTFu33NNTYf) — versão de produção
 * que ja roda direto contra RM ha tempos:
 *
 *   HTTP Request (consultar-rm "BEN 2")
 *     ANTES: POST AIONS /consultar-rm
 *     DEPOIS: GET RM /api/framework/v1/consultaSQLServer/RealizaConsulta/BEN%202/3/P/
 *             URL com inline basic auth 003080:<senha>  (mesmo modelo do mestre)
 *
 *   HTTP Request8/9 (enviar-rm boleto/credito)
 *     ANTES: POST AIONS /enviar-rm dados_xml
 *     DEPOIS: POST RM /wsDataServer/IwsDataServer SOAP SaveRecord
 *             cred "RM LABORE" (id ZfNj3Ojtg4cQvxhR) usada pelo mestre
 *
 * Mudancas adicionais espelhando mestre:
 *   - Code in JavaScript1: passa a montar urlRM e propaga em $json
 *   - Code in JavaScript9 (boleto): tambem produz soapBody completo (envelope)
 *   - Code in JavaScript11 (credito): tambem produz soapBody + TPBEN=1 (mensal)
 *     [mestre marca credito = TPBEN 1; boleto = TPBEN 0]
 *   - Contexto SOAP: "CODCOLIGADA=3; USUARIO=003080" (formato mestre)
 *
 * Uso: node scripts/patch_wf5_aions_to_rm.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/patch_wf5_aions_to_rm.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const WF_ID = "Bso4k6ddDNcRmU83"
const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"

const RM_HOST = "contatoservicos165112.rm.cloudtotvs.com.br:8051"
const RM_DATASERVER_URL = `https://${RM_HOST}/wsDataServer/IwsDataServer`

// Cred "rm mike" (WF8 usa esse no /convocar autocomplete e funciona).
// Mestre antigo usa inline auth 003080:senha — abandonado, prefere cred.
const RM_MIKE_CRED_ID = "S3pKAv6O75vlOFh8"
const RM_MIKE_CRED_NAME = "rm mike"

const RM_LABORE_CRED_ID = "ZfNj3Ojtg4cQvxhR"
const RM_LABORE_CRED_NAME = "RM LABORE"

// ---------- Code in JavaScript1 (days calc + adiciona urlRM) ----------
const CODE_JS1_NEW = `// =========================================================
// WF5 — Calcula diasVR / diasVT do periodo + monta urlRM
// (urlRM espelha o WF mestre 1Tpy2wTFu33NNTYf: inline basic auth,
//  endpoint RealizaConsulta BEN 2)
// =========================================================
const dados = $input.first().json;

const inicio = new Date(dados.dataInicio + 'T00:00:00');
const fim = new Date(dados.dataFim + 'T00:00:00');
let diasVR = 0;
let diasVT = 0;

const atual = new Date(inicio);
while (atual <= fim) {
  const diaSemana = atual.getDay();
  if (diaSemana >= 1 && diaSemana <= 5) {
    diasVR++;
    diasVT++;
  } else if (diaSemana === 6 && dados.trabalhaSabado) {
    diasVT++;
  }
  atual.setDate(atual.getDate() + 1);
}

if (!dados.optanteVT) diasVT = 0;

// urlRM IDENTICA ao mestre — inline basic auth 003080:.2099840340 (mestre devolve dados ok)
const nomeParaRM = encodeURIComponent(dados.nomeLike || \`%\${dados.nomeEmpregado}%\`);
const urlRM = \`https://003080:.2099840340@${RM_HOST}/api/framework/v1/consultaSQLServer/RealizaConsulta/BEN%202/3/P/?parameters=$CODCOLIGADA%3D3%3BNOME%3D\${nomeParaRM}\`;

return [{
  json: {
    ...dados,
    diasVR,
    diasVT,
    urlRM
  }
}];`

// ---------- Code in JavaScript9 (BOLETO — TPBEN=0 + soapBody) ----------
const CODE_JS9_NEW = `// =========================================================
// WF5 — Monta dadosXml + soapBody para BOLETO (TPBEN=0, diario)
// Espelha mestre: SaveRecord no DataServer RMSPRJ3230976Server
// =========================================================
const dados = $('Code in JavaScript8').first().json;
const hoje = new Date();
const anoComp = hoje.getFullYear();
const mesComp = hoje.getMonth() + 1;
const chapa = dados.chapaRM;
const nome = dados.nomeEmpregado;
const formatarValor = v => Number(v).toFixed(2).replace('.', ',');

function montarSoap(codBeneficio, vlrTotal, tpBen) {
  const valorRM = formatarValor(vlrTotal);
  const xml = \`<PRJ3230976>
              <ZMDHSTBENFUNC>
                <ID>-1</ID>
                <CODCOLIGADA>3</CODCOLIGADA>
                <ANOCOMP>\${anoComp}</ANOCOMP>
                <MESCOMP>\${mesComp}</MESCOMP>
                <ANOREF>\${anoComp}</ANOREF>
                <MESREF>\${mesComp}</MESREF>
                <CHAPA>\${chapa}</CHAPA>
                <NOME>\${nome}</NOME>
                <CODBENEFICIO>\${codBeneficio}</CODBENEFICIO>
                <VLRTOTAL>\${valorRM}</VLRTOTAL>
                <TPBEN>\${tpBen}</TPBEN>
                <CATFUN>1</CATFUN>
              </ZMDHSTBENFUNC>
            </PRJ3230976>\`;
  const soapBody = \`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:SaveRecord>
         <tot:DataServerName>RMSPRJ3230976Server</tot:DataServerName>
         <tot:XML><![CDATA[\${xml}]]></tot:XML>
         <tot:Contexto>CODCOLIGADA=3; USUARIO=003080</tot:Contexto>
      </tot:SaveRecord>
   </soapenv:Body>
</soapenv:Envelope>\`;
  return { dadosXml: xml, soapBody };
}

const registros = [];
if (dados.boletoVR > 0) {
  const { dadosXml, soapBody } = montarSoap(1, dados.boletoVR, 0);
  registros.push({ tipo: 'BOLETO_VR', dadosXml, soapBody, valor: dados.boletoVR });
}
if (dados.boletoVT > 0) {
  const { dadosXml, soapBody } = montarSoap(2, dados.boletoVT, 0);
  registros.push({ tipo: 'BOLETO_VT', dadosXml, soapBody, valor: dados.boletoVT });
}

return registros.map(r => ({ json: r }));`

// ---------- Code in JavaScript11 (CREDITO — TPBEN=1 + soapBody) ----------
const CODE_JS11_NEW = `// =========================================================
// WF5 — Monta dadosXml + soapBody para CREDITO (TPBEN=1, mensal)
// Espelha mestre: SaveRecord no DataServer RMSPRJ3230976Server.
// Importante: credito TPBEN=1 (mensal), boleto TPBEN=0 (diario).
// =========================================================
const dados = $('Code in JavaScript8').first().json;
const hoje = new Date();
const anoComp = hoje.getFullYear();
const mesComp = hoje.getMonth() + 1;
const chapa = dados.chapaRM;
const nome = dados.nomeEmpregado;
const formatarValor = v => Number(v).toFixed(2).replace('.', ',');

function montarSoap(codBeneficio, vlrTotal, tpBen) {
  const valorRM = formatarValor(vlrTotal);
  const xml = \`<PRJ3230976>
              <ZMDHSTBENFUNC>
                <ID>-1</ID>
                <CODCOLIGADA>3</CODCOLIGADA>
                <ANOCOMP>\${anoComp}</ANOCOMP>
                <MESCOMP>\${mesComp}</MESCOMP>
                <ANOREF>\${anoComp}</ANOREF>
                <MESREF>\${mesComp}</MESREF>
                <CHAPA>\${chapa}</CHAPA>
                <NOME>\${nome}</NOME>
                <CODBENEFICIO>\${codBeneficio}</CODBENEFICIO>
                <VLRTOTAL>\${valorRM}</VLRTOTAL>
                <TPBEN>\${tpBen}</TPBEN>
                <CATFUN>1</CATFUN>
              </ZMDHSTBENFUNC>
            </PRJ3230976>\`;
  const soapBody = \`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
   <soapenv:Header/>
   <soapenv:Body>
      <tot:SaveRecord>
         <tot:DataServerName>RMSPRJ3230976Server</tot:DataServerName>
         <tot:XML><![CDATA[\${xml}]]></tot:XML>
         <tot:Contexto>CODCOLIGADA=3; USUARIO=003080</tot:Contexto>
      </tot:SaveRecord>
   </soapenv:Body>
</soapenv:Envelope>\`;
  return { dadosXml: xml, soapBody };
}

const registros = [];
if (dados.creditoVR > 0) {
  const { dadosXml, soapBody } = montarSoap(1, dados.creditoVR, 1);
  registros.push({ tipo: 'CREDITO_VR', dadosXml, soapBody, valor: dados.creditoVR });
}
if (dados.creditoVT > 0) {
  const { dadosXml, soapBody } = montarSoap(2, dados.creditoVT, 1);
  registros.push({ tipo: 'CREDITO_VT', dadosXml, soapBody, valor: dados.creditoVT });
}

return registros.map(r => ({ json: r }));`

// ---------- Code "Filtrar e Normalizar Intermitente" ----------
// SQL BEN 2 nao filtra por NOME (WHERE so tem CODCOLIGADA + CODSITUACAO<>D),
// entao RM retorna TODOS funcionarios ativos. Esse Code filtra pelo nome
// do empregado da convocacao + remapeia colunas pro shape esperado downstream.
const CODE_FILTRAR_NEW = `// =========================================================
// WF5 — Filtra resposta BEN 2 pelo nome do empregado convocado
// e remapeia chaves pra shape esperado (Nome do Intermitente,
// Matricula/Chapa, Secao, Data de Admissao, Funcao, CPF).
// Espelha o WF8 "Moldar resposta".
// =========================================================
function nomeNorm(s) {
  return String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim().replace(/\\s+/g, ' ');
}
function onlyDigits(v) { return String(v || '').replace(/\\D+/g, ''); }
function pick(r, keys) {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return r[k];
  }
  return '';
}

const nomeAlvo = nomeNorm($('Code in JavaScript1').first().json.nomeEmpregado);
const todos = $input.all();

const matches = todos
  .map(it => it.json || {})
  .filter(r => nomeNorm(pick(r, ['Nome do Funcionario', 'Nome do Funcionário', 'Nome', 'nome'])) === nomeAlvo);

if (matches.length === 0) {
  throw new Error('Empregado nao encontrado no RM (BEN 2) com nome: ' + nomeAlvo);
}

// Pega 1a linha; BEN 2 pode duplicar por sessao/situacao
const r = matches[0];

return [{
  json: {
    'Nome do Intermitente': pick(r, ['Nome do Funcionario', 'Nome do Funcionário', 'Nome', 'nome']),
    'Matricula/Chapa': String(pick(r, ['Funcionario', 'Funcionário', 'Chapa', 'chapa', 'CHAPA'])).trim(),
    'Matrícula/Chapa': String(pick(r, ['Funcionario', 'Funcionário', 'Chapa', 'chapa', 'CHAPA'])).trim(),
    'CPF': onlyDigits(pick(r, ['CPF', 'Cpf', 'cpf'])),
    'Funcao': pick(r, ['Funcao', 'Função', 'funcao']),
    'Função': pick(r, ['Funcao', 'Função', 'funcao']),
    'Data de Admissao': pick(r, ['Admissao', 'Admissão', 'Data de Admissao', 'Data de Admissão', 'dataAdmissao']),
    'Data de Admissão': pick(r, ['Admissao', 'Admissão', 'Data de Admissao', 'Data de Admissão', 'dataAdmissao']),
    'Secao': pick(r, ['Codigo', 'Código', 'Secao', 'Seção', 'secao']),
    'Seção': pick(r, ['Codigo', 'Código', 'Secao', 'Seção', 'secao']),
    'Descricao Secao': pick(r, ['Local/Unidade', 'Descricao Secao', 'Descrição Seção', 'descricaoSecao']),
    'Descrição Seção': pick(r, ['Local/Unidade', 'Descricao Secao', 'Descrição Seção', 'descricaoSecao']),
    // raw row pra debug
    _raw: r
  }
}];`

// ---------- HTTP Request (consultar-rm) → MIRROR EXATO DO MESTRE ----------
// Mestre: sem authentication, sem cred — usa inline basic auth da URL.
function patchConsultarRm(node) {
  node.parameters = {
    url: "={{ $json.urlRM }}",
    options: { response: { response: { neverError: true } } },
  }
  delete node.credentials
}

// ---------- HTTP Request8/9 (enviar-rm) → POST SOAP SaveRecord ----------
function patchEnviarRm(node) {
  node.parameters = {
    method: "POST",
    url: RM_DATASERVER_URL,
    authentication: "genericCredentialType",
    genericAuthType: "httpBasicAuth",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Content-Type", value: "text/xml; charset=utf-8" },
        { name: "SOAPAction", value: '"http://www.totvs.com/IwsDataServer/SaveRecord"' },
      ],
    },
    sendBody: true,
    contentType: "raw",
    rawContentType: "text/xml",
    body: "={{ $json.soapBody }}",
    options: { response: { response: { neverError: true } } },
  }
  node.credentials = { httpBasicAuth: { id: RM_LABORE_CRED_ID, name: RM_LABORE_CRED_NAME } }
}

async function n8n(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-N8N-API-KEY": TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : {}
}

;(async () => {
  console.log("Fetching WF5...")
  const wf = await n8n("GET", `/workflows/${WF_ID}`)
  console.log(`  Nodes: ${wf.nodes.length}`)

  const findOrFail = (name) => {
    const n = wf.nodes.find((x) => x.name === name)
    if (!n) throw new Error(`Node "${name}" nao achado`)
    return n
  }

  const consultar = findOrFail("HTTP Request")
  const boleto = findOrFail("HTTP Request8")
  const credito = findOrFail("HTTP Request9")
  const code1 = findOrFail("Code in JavaScript1")
  const code9 = findOrFail("Code in JavaScript9")
  const code11 = findOrFail("Code in JavaScript11")
  const ifNode = findOrFail("If")

  // Insere/atualiza Code "Filtrar e Normalizar Intermitente"
  const FILTRAR_NAME = "Filtrar e Normalizar Intermitente"
  let filtrar = wf.nodes.find((n) => n.name === FILTRAR_NAME)
  if (!filtrar) {
    filtrar = {
      parameters: { jsCode: CODE_FILTRAR_NEW },
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [consultar.position[0] + 240, consultar.position[1]],
      id: "wf5-filtrar-intermitente",
      name: FILTRAR_NAME,
    }
    wf.nodes.push(filtrar)
    console.log('  Inserindo Code "' + FILTRAR_NAME + '"...')
  } else {
    filtrar.parameters.jsCode = CODE_FILTRAR_NEW
    console.log('  Atualizando Code "' + FILTRAR_NAME + '"...')
  }

  // Re-route: HTTP Request → Filtrar → If
  wf.connections = wf.connections || {}
  wf.connections["HTTP Request"] = {
    main: [[{ node: FILTRAR_NAME, type: "main", index: 0 }]],
  }
  wf.connections[FILTRAR_NAME] = {
    main: [[{ node: "If", type: "main", index: 0 }]],
  }

  // Redireciona downstream que referenciam $('HTTP Request') → Filtrar e Normalizar
  // (HTTP Request3 + Code in JavaScript2 leem CPF/colunas RM diretamente do output cru)
  const REDIRECT_NODES = ["HTTP Request3", "Code in JavaScript2"]
  for (const name of REDIRECT_NODES) {
    const node = wf.nodes.find((n) => n.name === name)
    if (!node) {
      console.warn('  AVISO: node "' + name + '" nao achado pra redirecionar refs')
      continue
    }
    const before = JSON.stringify(node.parameters)
    const after = before
      .split("$('HTTP Request')")
      .join("$('" + FILTRAR_NAME + "')")
      .split('$("HTTP Request")')
      .join('$("' + FILTRAR_NAME + '")')
    if (before !== after) {
      node.parameters = JSON.parse(after)
      console.log('  Refs "$(HTTP Request)" redirecionadas em "' + name + '"')
    }
  }

  console.log('  Patching "Code in JavaScript1" (adiciona urlRM)...')
  code1.parameters.jsCode = CODE_JS1_NEW

  console.log('  Patching "Code in JavaScript9" (boleto: dadosXml + soapBody, TPBEN=0)...')
  code9.parameters.jsCode = CODE_JS9_NEW

  console.log('  Patching "Code in JavaScript11" (credito: dadosXml + soapBody, TPBEN=1)...')
  code11.parameters.jsCode = CODE_JS11_NEW

  console.log('  Patching "HTTP Request" → GET RM RealizaConsulta...')
  patchConsultarRm(consultar)

  console.log('  Patching "HTTP Request8" → POST RM SaveRecord (boleto)...')
  patchEnviarRm(boleto)

  console.log('  Patching "HTTP Request9" → POST RM SaveRecord (credito)...')
  patchEnviarRm(credito)

  const cleanSettings = {}
  const allowed = [
    "executionOrder",
    "saveDataErrorExecution",
    "saveDataSuccessExecution",
    "saveManualExecutions",
    "saveExecutionProgress",
    "timezone",
  ]
  for (const k of allowed) {
    if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k]
  }

  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings,
    staticData: wf.staticData,
  }

  console.log("Subindo WF5 patched...")
  await n8n("PUT", `/workflows/${WF_ID}`, payload)
  console.log("✓ WF5 patched (AIONS → RM direto, espelhando mestre)")
  console.log("  Consultar BEN 2: GET  https://" + RM_HOST + "/api/framework/v1/consultaSQLServer/...")
  console.log("  Boleto/Credito:  POST " + RM_DATASERVER_URL + " (SOAP SaveRecord, cred RM LABORE)")
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
