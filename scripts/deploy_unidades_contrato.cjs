const fs = require("node:fs")

const OLD_N8N_URL = process.env.N8N_OLD_API_URL || "https://antigoaionscorp-n8n.cloudfy.live"
const OLD_N8N_KEY = process.env.N8N_OLD_API_KEY

if (!OLD_N8N_KEY) {
  console.error("Defina N8N_OLD_API_KEY antes de rodar.")
  process.exit(1)
}

const BOARD_ENTRADA = 18408773953
const COL_ENTRADA_TEXTO_UNIDADE = "texto75"
const TITULO_UNIDADE_ENTRADA = "OP - Local/Unidade"
const RM_BASIC_CRED = { id: "S3pKAv6O75vlOFh8", name: "rm mike" }
const MONDAY_CRED_OLD = { id: "QuX90go84pJaRueJ", name: "Monday.com account isaac" }
const CONTRATOS = ["SEMSA", "SEDUC ESCOLA", "SEDUC SEDE", "SEDUC INTERIOR", "DETRAN", "TRE PB", "CETAM"]

function normalize(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s]+/g, " ")
    .trim()
}

function n8nClient(baseUrl, key) {
  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": key,
        ...(options.headers || {}),
      },
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${options.method || "GET"} ${path}: ${res.status} ${text}`)
    if (!text) return null
    let data = JSON.parse(text)
    if (typeof data === "string") data = JSON.parse(data)
    return data
  }

  async function allWorkflows() {
    const out = []
    let cursor
    do {
      const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100"
      const page = await request(`/api/v1/workflows${qs}`)
      out.push(...(page.data || []))
      cursor = page.nextCursor
    } while (cursor)
    return out
  }

  async function getWorkflow(id) {
    return request(`/api/v1/workflows/${id}`)
  }

  async function updateWorkflow(workflow) {
    const wasActive = workflow.active
    if (wasActive) await request(`/api/v1/workflows/${workflow.id}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
    await request(`/api/v1/workflows/${workflow.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: { executionOrder: workflow.settings?.executionOrder || "v1" },
      }),
    })
    if (wasActive) await request(`/api/v1/workflows/${workflow.id}/activate`, { method: "POST", body: "{}" }).catch(() => null)
  }

  async function upsertWorkflow(workflow, active = true) {
    const existing = (await allWorkflows()).find((w) => w.name === workflow.name)
    const body = {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings || { executionOrder: "v1" },
    }
    if (!existing) {
      const created = await request("/api/v1/workflows", { method: "POST", body: JSON.stringify(body) })
      if (active) await request(`/api/v1/workflows/${created.id}/activate`, { method: "POST", body: "{}" }).catch(() => null)
      return created.id
    }
    if (existing.active) await request(`/api/v1/workflows/${existing.id}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
    await request(`/api/v1/workflows/${existing.id}`, { method: "PUT", body: JSON.stringify(body) })
    if (active) await request(`/api/v1/workflows/${existing.id}/activate`, { method: "POST", body: "{}" }).catch(() => null)
    return existing.id
  }

  return { request, allWorkflows, getWorkflow, updateWorkflow, upsertWorkflow, baseUrl }
}

function webhookNode(id, name, path, x, y, method = "POST") {
  return {
    parameters: { httpMethod: method, path, responseMode: "responseNode", options: {} },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [x, y],
    id,
    name,
    webhookId: `${path}-wh`,
  }
}

function codeNode(id, name, jsCode, x, y) {
  return { parameters: { jsCode }, type: "n8n-nodes-base.code", typeVersion: 2, position: [x, y], id, name }
}

function mondayHttpNode(id, name, jsonBodyExpr, x, y) {
  return {
    parameters: {
      method: "POST",
      url: "https://api.monday.com/v2",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "mondayComApi",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: jsonBodyExpr,
      options: { response: { response: { neverError: true } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [x, y],
    id,
    name,
    credentials: { mondayComApi: MONDAY_CRED_OLD },
  }
}

function httpGetNode(id, name, urlExpr, x, y, options = {}) {
  return {
    parameters: {
      url: urlExpr,
      ...(options.authentication || {}),
      options: { response: { response: { neverError: true } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [x, y],
    id,
    name,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  }
}

function respondNode(id, name, bodyExpr, x, y) {
  return {
    parameters: {
      respondWith: "json",
      responseBody: bodyExpr,
      options: {
        responseCode: "={{ $json._statusCode || 200 }}",
        responseHeaders: {
          entries: [
            { name: "Access-Control-Allow-Origin", value: "*" },
            { name: "Content-Type", value: "application/json" },
          ],
        },
      },
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [x, y],
    id,
    name,
  }
}

function mergeNode(id, name, x, y) {
  return {
    parameters: { mode: "combine", combineBy: "combineAll", options: {} },
    type: "n8n-nodes-base.merge",
    typeVersion: 3,
    position: [x, y],
    id,
    name,
  }
}

const moldarUnidadesRmCode = `const CONTRATOS = ['SEMSA','SEDUC ESCOLA','SEDUC SEDE','SEDUC INTERIOR','DETRAN','TRE PB','CETAM'];
function norm(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().replace(/\\s+/g,' ').trim();}
function normKey(v){return norm(v).replace(/[^A-Z0-9]/g,'');}
function field(row, candidatos) {
  const alvo = candidatos.map(normKey);
  for (const [k, v] of Object.entries(row || {})) {
    if (alvo.includes(normKey(k))) return v;
  }
  return '';
}
function contratoPorCodigo(codigo) {
  const c = String(codigo || '').trim();
  if (c.startsWith('01.01.0004')) return 'DETRAN';
  if (c.startsWith('01.01.0010')) return 'SEDUC SEDE';
  if (c.startsWith('01.01.0011.01')) return 'SEDUC ESCOLA';
  if (c.startsWith('01.01.0011.02')) return 'SEDUC INTERIOR';
  if (c.startsWith('01.01.0074')) return 'CETAM';
  if (c.startsWith('01.01.0079')) return 'TRE PB';
  if (c.startsWith('01.01.0085')) return 'SEMSA';
  return null;
}
function extrairLinhas(item) {
  const j = item?.json;
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.body)) return j.body;
  if (Array.isArray(j.value)) return j.value;
  if (Array.isArray(j.data)) return j.data;
  if (field(j, ['Código','Codigo','CODIGO']) || field(j, ['Local/Unidade','LOCAL/UNIDADE','Local Unidade'])) return [j];
  return [];
}
const rows = $input.all().flatMap(extrairLinhas);
const unidadesPorContrato = Object.fromEntries(CONTRATOS.map(c => [c, []]));
const vistos = Object.fromEntries(CONTRATOS.map(c => [c, new Set()]));
const unidades = [];
const fora_escopo = [];
for (const r of rows) {
  const codigo = String(field(r, ['Código','Codigo','CODIGO']) ?? '').trim();
  const unidade = String(field(r, ['Local/Unidade','LOCAL/UNIDADE','Local Unidade','Unidade']) ?? '').trim();
  if (!codigo || !unidade) continue;
  const contrato = contratoPorCodigo(codigo);
  if (!contrato) {
    fora_escopo.push({ codigo, unidade });
    continue;
  }
  const key = norm(unidade);
  if (!vistos[contrato].has(key)) {
    vistos[contrato].add(key);
    unidadesPorContrato[contrato].push(unidade);
    unidades.push({ codigo, contrato, unidade });
  }
}
for (const c of CONTRATOS) unidadesPorContrato[c].sort((a,b)=>a.localeCompare(b,'pt-BR'));
unidades.sort((a,b)=>a.contrato.localeCompare(b.contrato,'pt-BR') || a.unidade.localeCompare(b.unidade,'pt-BR'));
const contagens = Object.fromEntries(CONTRATOS.map(c => [c, unidadesPorContrato[c].length]));
return [{ json: { _statusCode: 200, ok: true, fonte: 'rm:UNIDADES', sql_name: '231375', unidade_column_id: 'dropdown_mm3mcnmn', contagens, unidades_por_contrato: unidadesPorContrato, unidades, fora_escopo_count: fora_escopo.length } }];`

function workflowUnidadesRm() {
  const prepararUrl = `const SQL_NAME = encodeURIComponent('231375');
const urlRM = 'https://contatoservicos165112.rm.cloudtotvs.com.br:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/' + SQL_NAME + '/3/P/?parameters=$CODCOLIGADA%3D3';
return [{ json: { urlRM } }];`
  return {
    name: "Intermitente — Unidades RM",
    nodes: [
      webhookNode("unidades-rm-webhook", "Webhook", "intermitente-unidades-rm", 0, 0, "GET"),
      codeNode("unidades-rm-preparar", "Preparar URL", prepararUrl, 220, 0),
      httpGetNode("unidades-rm-consultar", "Consultar RM", "={{ $json.urlRM }}", 440, 0, {
        authentication: { authentication: "genericCredentialType", genericAuthType: "httpBasicAuth" },
        credentials: { httpBasicAuth: RM_BASIC_CRED },
      }),
      codeNode("unidades-rm-moldar", "Moldar resposta", moldarUnidadesRmCode, 660, 0),
      respondNode("unidades-rm-responder", "Responder", "={{ JSON.stringify($json) }}", 880, 0),
    ],
    connections: {
      Webhook: { main: [[{ node: "Preparar URL", type: "main", index: 0 }]] },
      "Preparar URL": { main: [[{ node: "Consultar RM", type: "main", index: 0 }]] },
      "Consultar RM": { main: [[{ node: "Moldar resposta", type: "main", index: 0 }]] },
      "Moldar resposta": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

function workflowMondayExec() {
  const preparar = `const query = $json.body?.query || $json.query;
if (!query) return [{ json: { _statusCode: 400, errors: [{ message: 'query ausente' }] } }];
return [{ json: { query } }];`
  return {
    name: "__TEMP Ã¢â‚¬â€ Monday Exec Unidades Contrato",
    nodes: [
      webhookNode("temp-monday-webhook", "Webhook", "unidades-contrato-monday-exec", 0, 0, "POST"),
      codeNode("temp-monday-preparar", "Preparar", preparar, 220, 0),
      mondayHttpNode("temp-monday-exec", "Executar Monday", "={{ JSON.stringify({ query: $json.query }) }}", 440, 0),
      respondNode("temp-monday-responder", "Responder", "={{ JSON.stringify($json) }}", 660, 0),
    ],
    connections: {
      Webhook: { main: [[{ node: "Preparar", type: "main", index: 0 }]] },
      Preparar: { main: [[{ node: "Executar Monday", type: "main", index: 0 }]] },
      "Executar Monday": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

async function createMondayExecutor(oldClient) {
  const id = await oldClient.upsertWorkflow(workflowMondayExec(), true)
  const endpoint = `${OLD_N8N_URL}/webhook/unidades-contrato-monday-exec`
  async function mondayRequest(query) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Monday via n8n HTTP ${res.status}: ${text}`)
    const data = JSON.parse(text)
    if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join(" | "))
    return data
  }
  async function cleanup() {
    await oldClient.request(`/api/v1/workflows/${id}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
  }
  return { id, mondayRequest, cleanup }
}

async function mondayRequestDirectDisabled() {
  throw new Error("Use createMondayExecutor(oldClient).mondayRequest para executar GraphQL com credencial do n8n.")
}

async function mondayRequest(query) {
  return mondayRequestDirectDisabled(query)
}

function esc(values) {
  return JSON.stringify(JSON.stringify(values))
}

async function findOrCreateDropdownColumn(mondayRequest, unidades) {
  const queryCols = `query { boards(ids: [${BOARD_ENTRADA}]) { columns { id title type } groups { id title } } }`
  const data = await mondayRequest(queryCols)
  const board = data.data.boards[0]
  let col = board.columns.find((c) => normalize(c.title) === normalize(TITULO_UNIDADE_ENTRADA))
  if (!col) {
    const defaults = JSON.stringify({ labels: unidades.slice(0, 200) })
    const created = await mondayRequest(`mutation { create_column(board_id: ${BOARD_ENTRADA}, title: ${JSON.stringify(TITULO_UNIDADE_ENTRADA)}, column_type: dropdown, defaults: ${JSON.stringify(defaults)}) { id title type } }`)
    col = created.data.create_column
  }
  return { columnId: col.id, firstGroupId: board.groups[0]?.id || "topics" }
}

async function syncDropdownLabels(mondayRequest, columnId, groupId, unidades) {
  const create = await mondayRequest(`mutation { create_item(board_id: ${BOARD_ENTRADA}, group_id: ${JSON.stringify(groupId)}, item_name: "__SYNC_UNIDADES_RM__", create_labels_if_missing: true) { id } }`)
  const itemId = create.data.create_item.id
  try {
    for (let i = 0; i < unidades.length; i += 40) {
      const labels = unidades.slice(i, i + 40)
      const values = { [columnId]: { labels } }
      await mondayRequest(`mutation { change_multiple_column_values(board_id: ${BOARD_ENTRADA}, item_id: ${itemId}, column_values: ${esc(values)}, create_labels_if_missing: true) { id } }`)
    }
  } finally {
    await mondayRequest(`mutation { archive_item(item_id: ${itemId}) { id } }`).catch(() => null)
  }
}

/*
async function mondayRequestOld(query) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_KEY || "",
    },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Monday HTTP ${res.status}: ${text}`)
  const data = JSON.parse(text)
  if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join(" | "))
  return data
}

function esc(values) {
  return JSON.stringify(JSON.stringify(values))
}

async function findOrCreateDropdownColumn(unidades) {
  const queryCols = `query { boards(ids: [${BOARD_ENTRADA}]) { columns { id title type } groups { id title } } }`
  const data = await mondayRequest(queryCols)
  const board = data.data.boards[0]
  let col = board.columns.find((c) => normalize(c.title) === normalize(TITULO_UNIDADE_ENTRADA))
  if (!col) {
    const defaults = JSON.stringify({ labels: unidades.slice(0, 200) })
    const created = await mondayRequest(`mutation { create_column(board_id: ${BOARD_ENTRADA}, title: ${JSON.stringify(TITULO_UNIDADE_ENTRADA)}, column_type: dropdown, defaults: ${JSON.stringify(defaults)}) { id title type } }`)
    col = created.data.create_column
  }
  return { columnId: col.id, firstGroupId: board.groups[0]?.id || "topics" }
}

async function syncDropdownLabels(columnId, groupId, unidades) {
  const create = await mondayRequest(`mutation { create_item(board_id: ${BOARD_ENTRADA}, group_id: ${JSON.stringify(groupId)}, item_name: "__SYNC_UNIDADES_RM__", create_labels_if_missing: true) { id } }`)
  const itemId = create.data.create_item.id
  try {
    for (let i = 0; i < unidades.length; i += 40) {
      const labels = unidades.slice(i, i + 40)
      const values = { [columnId]: { labels } }
      await mondayRequest(`mutation { change_multiple_column_values(board_id: ${BOARD_ENTRADA}, item_id: ${itemId}, column_values: ${esc(values)}, create_labels_if_missing: true) { id } }`)
    }
  } finally {
    await mondayRequest(`mutation { archive_item(item_id: ${itemId}) { id } }`).catch(() => null)
  }
}
*/

function opcoesWorkflow(unidadesEndpointUrl) {
  const moldar = `const monday = $('Buscar colunas monday').first().json || {};
const rm = $('Buscar unidades RM').first().json || {};
if (Array.isArray(monday.errors) && monday.errors.length > 0) {
  return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday_opcoes', mensagem: monday.errors.map(e => e.message).join(' | '), errors: monday.errors } }];
}
const COL = { SOLICITANTE: 'color_mktc9q29', CONTRATO: 'color_mktcnxwn', SABADO: 'color_mktaavmp', INSALUBRIDADE: 'color_mktq63xa', INTERIOR: 'color__1', JUSTIFICATIVA: 'color_mktarrgs' };
const contratos = ['SEMSA','SEDUC ESCOLA','SEDUC SEDE','SEDUC INTERIOR','DETRAN','TRE PB','CETAM'];
const fallback = { solicitantes: ['OPERACIONAL','RH'], contratos, sabados: ['SIM','NÃƒO'], insalubridades: ['SIM','NÃƒO','NÃƒO INFORMADO'], interiores: ['SIM','NÃƒO'], justificativas: ['AFASTAMENTO','ATESTADO','FÃ‰RIAS','FALTA','SUSPENSÃƒO','NÃƒO INICIADO','DESLIGAMENTO','LICENÃ‡A MATERNIDADE','SEM CONVOCAÃ‡ÃƒO','MOP P/ CLT','POSTO VAGO','APOIO','DEMITIDO'] };
const columns = monday.data?.boards?.[0]?.columns || [];
const byId = Object.fromEntries(columns.map(c => [c.id, c]));
function unique(values) { const out = []; const seen = new Set(); for (const v of values || []) { const label = String(v || '').trim(); if (!label || seen.has(label)) continue; seen.add(label); out.push(label); } return out; }
function labelsFromColumn(columnId, fallbackValues) {
  const col = byId[columnId];
  if (!col?.settings_str) return fallbackValues;
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const labels = settings.labels || {};
    if (Array.isArray(labels)) return unique(labels.map(l => typeof l === 'string' ? l : l?.name || l?.label)).length ? unique(labels.map(l => typeof l === 'string' ? l : l?.name || l?.label)) : fallbackValues;
    const parsed = unique(Object.entries(labels).sort(([a], [b]) => Number(a) - Number(b)).map(([, value]) => value));
    return parsed.length ? parsed : fallbackValues;
  } catch { return fallbackValues; }
}
const unidadesPorContrato = rm?.ok && rm.unidades_por_contrato ? rm.unidades_por_contrato : Object.fromEntries(contratos.map(c => [c, []]));
return [{ json: { _statusCode: 200, ok: true, fonte: rm?.ok ? 'monday.settings_str+rm:UNIDADES' : 'monday.settings_str+rm_falhou', atualizado_em: new Date().toISOString(), opcoes: { solicitantes: labelsFromColumn(COL.SOLICITANTE, fallback.solicitantes), contratos: fallback.contratos, sabados: labelsFromColumn(COL.SABADO, fallback.sabados), insalubridades: labelsFromColumn(COL.INSALUBRIDADE, fallback.insalubridades), interiores: labelsFromColumn(COL.INTERIOR, fallback.interiores), justificativas: labelsFromColumn(COL.JUSTIFICATIVA, fallback.justificativas), unidades_por_contrato: unidadesPorContrato, unidade_column_id: 'dropdown_mm3mcnmn' } } }];`
  return {
    name: "Intermitente â€” 9. Convocar opcoes",
    nodes: [
      webhookNode("wf9-webhook", "Webhook", "intermitente-convocar-opcoes", 0, 0, "GET"),
      mondayHttpNode("wf9-monday", "Buscar colunas monday", "={{ JSON.stringify({ query: `query { boards(ids: [18408773953]) { columns(ids: [\"color_mktc9q29\", \"color_mktcnxwn\", \"color_mktaavmp\", \"color_mktq63xa\", \"color__1\", \"color_mktarrgs\"]) { id title type settings_str } } }` }) }}", 260, -120),
      httpGetNode("wf9-rm", "Buscar unidades RM", unidadesEndpointUrl, 260, 120),
      mergeNode("wf9-merge", "Aguardar Opcoes", 520, 0),
      codeNode("wf9-moldar", "Moldar opcoes", moldar, 760, 0),
      respondNode("wf9-responder", "Responder", "={{ JSON.stringify($json) }}", 1000, 0),
    ],
    connections: {
      Webhook: { main: [[{ node: "Buscar colunas monday", type: "main", index: 0 }, { node: "Buscar unidades RM", type: "main", index: 0 }]] },
      "Buscar colunas monday": { main: [[{ node: "Aguardar Opcoes", type: "main", index: 0 }]] },
      "Buscar unidades RM": { main: [[{ node: "Aguardar Opcoes", type: "main", index: 1 }]] },
      "Aguardar Opcoes": { main: [[{ node: "Moldar opcoes", type: "main", index: 0 }]] },
      "Moldar opcoes": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

function patchWf7Code(code, columnId, unidadesPorContrato) {
  let out = code
  if (out.includes("LOCAL_UNIDADE_DROPDOWN")) {
    out = out.replace(/LOCAL_UNIDADE_DROPDOWN:\s*'[^']*'/, `LOCAL_UNIDADE_DROPDOWN: '${columnId}'`)
  } else {
    out = out.replace(
      "LOCAL_UNIDADE:        'texto75',            // text",
      `LOCAL_UNIDADE:        'texto75',            // text legado\n  LOCAL_UNIDADE_DROPDOWN: '${columnId}', // dropdown global`,
    )
  }
  out = out.replace(/\nconst UNIDADES_POR_CONTRATO = [\s\S]*?\n\n(?=\/\/ Verifica bin)/, "\n")
  const validation = `
const UNIDADES_POR_CONTRATO = ${JSON.stringify(unidadesPorContrato)};
function normLabel(v) { return String(v || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().replace(/[\\.,;:/\\\\|_()\\[\\]{}-]+/g, ' ').replace(/\\s+/g, ' ').trim(); }
function tokens(v) { return normLabel(v).split(' ').filter(t => t.length > 2); }
function unidadeValida(contrato, unidade) {
  const lista = UNIDADES_POR_CONTRATO[contrato] || [];
  const alvo = normLabel(unidade);
  if (lista.some(u => normLabel(u) === alvo)) return true;
  const alvoTokens = tokens(unidade);
  return lista.some(u => {
    const cand = normLabel(u);
    if (cand.includes(alvo) || alvo.includes(cand)) return true;
    const candTokens = tokens(u);
    const common = alvoTokens.filter(t => candTokens.includes(t)).length;
    return alvoTokens.length > 0 && common / alvoTokens.length >= 0.75;
  });
}
if (!unidadeValida(payload.contrato, payload.localUnidade)) {
  return [{ json: { _statusCode: 400, ok: false, erro: 'unidade_invalida', mensagem: 'Local/Unidade nao pertence ao contrato selecionado.' } }];
}
`
  if (!out.includes("const UNIDADES_POR_CONTRATO =")) {
    const next = out.replace(/\/\/ Verifica bin[^\n]*/, `${validation}\n$&`)
    if (next === out) throw new Error("Nao encontrei o ponto de insercao da validacao de unidade no WF7.")
    out = next
  }
  if (!out.includes("[COL.LOCAL_UNIDADE_DROPDOWN]")) {
    out = out.replace(
      "[COL.LOCAL_UNIDADE]:       payload.localUnidade,",
      "[COL.LOCAL_UNIDADE]:       payload.localUnidade,\n  [COL.LOCAL_UNIDADE_DROPDOWN]: { labels: [payload.localUnidade] },",
    )
  }
  if (!out.includes("localUnidade: payload.localUnidade,")) {
    out = out.replace("dataFim: payload.dataFim,", "dataFim: payload.dataFim,\n    localUnidade: payload.localUnidade,")
  }
  return out
}

async function main() {
  const oldClient = n8nClient(OLD_N8N_URL, OLD_N8N_KEY)
  const unidadesWorkflowId = await oldClient.upsertWorkflow(workflowUnidadesRm(), true)
  const endpoint = `${OLD_N8N_URL}/webhook/intermitente-unidades-rm`
  const unidadesResp = await fetch(endpoint)
  const unidadesJson = await unidadesResp.json()
  if (!unidadesResp.ok || !unidadesJson.ok) throw new Error("Falha ao consultar unidades RM: " + JSON.stringify(unidadesJson))

  const unidadesOficiais = [...new Set(unidadesJson.unidades.map((u) => u.unidade))].sort((a, b) => a.localeCompare(b, "pt-BR"))
  const mondayExec = await createMondayExecutor(oldClient)
  let columnId
  try {
    const found = await findOrCreateDropdownColumn(mondayExec.mondayRequest, unidadesOficiais)
    columnId = found.columnId
    await syncDropdownLabels(mondayExec.mondayRequest, columnId, found.firstGroupId, unidadesOficiais)
  } finally {
    await mondayExec.cleanup()
  }

  const wf9 = await oldClient.getWorkflow("fBlqA5MUBpJS1kYl")
  const wf9New = opcoesWorkflow(endpoint)
  wf9.nodes = wf9New.nodes
  wf9.connections = wf9New.connections
  wf9.settings = wf9New.settings
  await oldClient.updateWorkflow(wf9)

  const wf7 = await oldClient.getWorkflow("VX7JNdxIuhA9yZsZ")
  const validar = wf7.nodes.find((n) => n.name === "Validar e preparar")
  if (!validar) throw new Error("Node Validar e preparar nao encontrado no WF7.")
  validar.parameters.jsCode = patchWf7Code(validar.parameters.jsCode, columnId, unidadesJson.unidades_por_contrato)
  await oldClient.updateWorkflow(wf7)

  const output = {
    updated_at: new Date().toISOString(),
    fonte: "rm:UNIDADES",
    rm_workflow_id: unidadesWorkflowId,
    endpoint,
    entrada: {
      board_id: BOARD_ENTRADA,
      column_id: columnId,
      title: TITULO_UNIDADE_ENTRADA,
      labels_synced: unidadesOficiais.length,
    },
    contagens: unidadesJson.contagens,
    unidades_por_contrato: unidadesJson.unidades_por_contrato,
    unidades_fora_escopo_count: unidadesJson.fora_escopo_count,
  }
  fs.mkdirSync("docs/n8n", { recursive: true })
  fs.writeFileSync("docs/n8n/unidades-contrato-columns.json", JSON.stringify(output, null, 2), "utf8")
  console.log(JSON.stringify(output, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

