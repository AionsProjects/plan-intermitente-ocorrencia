const fs = require("node:fs")

const OLD_N8N_URL = process.env.N8N_OLD_API_URL || "https://antigoaionscorp-n8n.cloudfy.live"
const OLD_N8N_KEY = process.env.N8N_OLD_API_KEY

if (!OLD_N8N_KEY) {
  console.error("Defina N8N_OLD_API_KEY antes de rodar.")
  process.exit(1)
}

const MONDAY_CRED_OLD = { id: "QuX90go84pJaRueJ", name: "Monday.com account isaac" }

const BOARD_ENTRADA = 18408773953
const COL_ENTRADA_TEXTO_UNIDADE = "texto75"
const TITULO_UNIDADE_ENTRADA = "OP - Local/Unidade"

const UNIDADES_POR_CONTRATO = {
  CETAM: [
    "CETAM - ALVARAES",
    "CETAM - AUTAZES",
    "CETAM - BORBA",
    "CETAM - CAAPIRANGA",
    "CETAM - CARAUARI",
    "CETAM - CAREIRO CASTANHO",
    "CETAM - CODAJAS",
    "CETAM - GASTRONOMIA",
    "CETAM - INTERMITENTE",
    "CETAM - IRANDUBA",
    "CETAM - MANACAPURU",
    "CETAM - PARINTINS",
    "CETAM - PRES. FIGUEIREDO",
    "CETAM - RIO PRETO DA EVA",
    "CETAM - TABATINGA",
  ],
  DETRAN: ["DETRAN - INTERMITENTE"],
  "SEDUC SEDE": ["SEDUC - MANAUS"],
  "SEDUC ESCOLA": [
    "SEDUC - DEPOSITO V8",
    "SEDUC ESCOLA - CMPM V",
    "SEDUC ESCOLA - IRMÃ GABRIELLE",
    "SEDUC ESCOLA - MAYARA REDMAN",
    "SEDUC ESCOLA - PROF. JACIRA CABOCLO",
  ],
  "SEDUC INTERIOR": [
    "SEDUC INTERIOR - CETI AURISTELIO S DE OL",
    "SEDUC INTERIOR - CETI BENEDITA BARBOSA D",
    "SEDUC INTERIOR - CETI CALIXTO RIBEIRO",
    "SEDUC INTERIOR - CETI NEUZA ALVES",
    "SEDUC INTERIOR - E. E. ANTONIO FERREIRA",
    "SEDUC INTERIOR - E. E. DESMB. JOAO REBEL",
    "SEDUC INTERIOR - E. E. DOM BOSCO",
    "SEDUC INTERIOR - E. E. EDUARDO RIBEIRO",
    "SEDUC INTERIOR - E. E. I MANUEL JOAQUIM",
    "SEDUC INTERIOR - E. E. I PROFª ROSA CRUZ",
    "SEDUC INTERIOR - E. E. IZAURA TORRES",
    "SEDUC INTERIOR - E. E. JOSE CARLOS MARTI",
    "SEDUC INTERIOR - E. E. NOVO CEU",
    "SEDUC INTERIOR - E. E. PRESIDENTE VARGAS",
    "SEDUC INTERIOR - E. E. PROF JOHANNES PET",
    "SEDUC INTERIOR - E. E. ROMERITO BRITO",
    "SEDUC INTERIOR - E. E. SÃO JOSÉ",
    "SEDUC INTERIOR - E. E. VIDAL DE MELO",
    "SEDUC INTERIOR - E.E. DEUZALINA P. RIBEIRO",
    "SEDUC INTERIOR - SEDE DA COORDENADORIA",
  ],
  SEMSA: ["SEMSA - INTERMITENTE"],
  "TRE PB": ["TRE PB - INTERMITENTE"],
}

const UNIDADES_OFICIAIS = [...new Set(Object.values(UNIDADES_POR_CONTRATO).flat())]

function normalize(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
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

  async function deactivate(id) {
    await request(`/api/v1/workflows/${id}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
  }

  return { request, allWorkflows, getWorkflow, updateWorkflow, upsertWorkflow, deactivate, baseUrl }
}

function webhookNode(id, path) {
  return {
    parameters: { httpMethod: "POST", path, responseMode: "responseNode", options: {} },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [0, 0],
    id,
    name: "Webhook",
    webhookId: `${path}-wh`,
  }
}

function codeNode(id, name, jsCode, x, y) {
  return { parameters: { jsCode }, type: "n8n-nodes-base.code", typeVersion: 2, position: [x, y], id, name }
}

function mondayHttpNode(id, name, jsonBodyExpr, x, y, mondayCred = MONDAY_CRED_OLD) {
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
    credentials: { mondayComApi: mondayCred },
  }
}

function ifNode(id, name, expr, x, y) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id, leftValue: expr, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [x, y],
    id,
    name,
  }
}

function respondNode(id, name, bodyExpr, x, y) {
  return {
    parameters: {
      respondWith: "json",
      responseBody: bodyExpr,
      options: {
        responseCode: "={{ $json._statusCode || 200 }}",
        responseHeaders: { entries: [{ name: "Content-Type", value: "application/json" }] },
      },
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [x, y],
    id,
    name,
  }
}

function setupWorkflow({ name, path, boardId, title, oldTextColumnId, doBackfill, mondayCred = MONDAY_CRED_OLD }) {
  const constants = {
    boardId,
    title,
    oldTextColumnId: oldTextColumnId || "",
    doBackfill: !!doBackfill,
    labels: UNIDADES_OFICIAIS,
  }
  const prepare = `const constants = ${JSON.stringify(constants)};\nconst query = 'query { boards(ids: [' + constants.boardId + ']) { columns { id title type settings_str } } }';\nreturn [{ json: { ...constants, query } }];`
  const decide = `const state = $('Preparar').first().json;\nconst response = $json || {};\nif (Array.isArray(response.errors) && response.errors.length) return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday_colunas', errors: response.errors } }];\nconst cols = response.data?.boards?.[0]?.columns || [];\nfunction norm(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim();}\nconst found = cols.find(c => norm(c.title) === norm(state.title));\nif (found) return [{ json: { ...state, columnId: found.id, created: false, needsCreate: false } }];\nconst defaults = JSON.stringify({ labels: state.labels });\nconst query = 'mutation { create_column(board_id: ' + state.boardId + ', title: ' + JSON.stringify(state.title) + ', column_type: dropdown, defaults: ' + JSON.stringify(defaults) + ') { id title type } }';\nreturn [{ json: { ...state, query, created: true, needsCreate: true } }];`
  const prepareItems = `let state = { ...$json };\nconst createdId = $json?.data?.create_column?.id;\nif (createdId) state = { ...$('Decidir Coluna').first().json, columnId: createdId, created: true, needsCreate: false };\nif (!state.columnId) return [{ json: { ...state, _statusCode: 500, ok: false, erro: 'coluna_sem_id' } }];\nif (!state.doBackfill || !state.oldTextColumnId) return [{ json: { ...state, skipBackfill: true, backfilled: 0, notMapped: [] } }];\nconst query = 'query { boards(ids: [' + state.boardId + ']) { items_page(limit: 500) { items { id name column_values(ids: [' + JSON.stringify(state.oldTextColumnId) + ', ' + JSON.stringify(state.columnId) + ']) { id text value } } } } }';\nreturn [{ json: { ...state, queryItems: query } }];`
  let backfill = `const state = $('Preparar Query Itens').first().json;\nif (state.skipBackfill) return [{ json: { ...state, hasBackfill: false } }];\nconst response = $json || {};\nif (Array.isArray(response.errors) && response.errors.length) return [{ json: { ...state, _statusCode: 500, ok: false, erro: 'erro_monday_itens', errors: response.errors } }];\nconst items = response.data?.boards?.[0]?.items_page?.items || [];\nconst updates = [];\nconst notMapped = [];\nfor (const item of items) {\n  const cols = Object.fromEntries((item.column_values || []).map(c => [c.id, c]));\n  const oldText = String(cols[state.oldTextColumnId]?.text || '').trim();\n  const currentText = String(cols[state.columnId]?.text || '').trim();\n  if (!oldText || currentText) continue;\n  updates.push({ item_id: String(item.id), label: oldText });\n}\nif (updates.length === 0) return [{ json: { ...state, hasBackfill: false, backfilled: 0, notMapped } }];\nconst parts = updates.map((u, i) => {\n  const cv = {}; cv[state.columnId] = { labels: [u.label] };\n  return 'u' + i + ': change_multiple_column_values(board_id: ' + state.boardId + ', item_id: ' + u.item_id + ', column_values: ' + JSON.stringify(JSON.stringify(cv)) + ', create_labels_if_missing: true) { id }';\n});\nreturn [{ json: { ...state, hasBackfill: true, backfilled: updates.length, notMapped, queryBackfill: 'mutation { ' + parts.join(' ') + ' }' } }];`
  backfill = backfill.replace(
    /if \(updates\.length === 0\)[\s\S]*?return \[\{ json: \{ \.\.\.state, hasBackfill: true, backfilled: updates\.length, notMapped, queryBackfill: 'mutation \{ ' \+ parts\.join\(' '\) \+ ' \}' \} \}\];/,
    `if (updates.length === 0) return [{ json: { ...state, hasBackfill: false, backfilled: 0, remainingBackfill: 0, notMapped } }];\nconst batch = updates.slice(0, 25);\nconst parts = batch.map((u, i) => {\n  const cv = {}; cv[state.columnId] = { labels: [u.label] };\n  return 'u' + i + ': change_multiple_column_values(board_id: ' + state.boardId + ', item_id: ' + u.item_id + ', column_values: ' + JSON.stringify(JSON.stringify(cv)) + ', create_labels_if_missing: true) { id }';\n});\nreturn [{ json: { ...state, hasBackfill: true, backfilled: batch.length, remainingBackfill: updates.length - batch.length, notMapped, queryBackfill: 'mutation { ' + parts.join(' ') + ' }' } }];`,
  )
  const final = `let state = $json || {};\ntry { state = { ...state, ...$('Preparar Backfill').first().json }; } catch {}\ntry { state = { ...$('Preparar Query Itens').first().json, ...state }; } catch {}\ntry { state = { ...$('Decidir Coluna').first().json, ...state }; } catch {}\nconst errors = $json?.errors || [];\nreturn [{ json: { ok: errors.length === 0 && !state.erro, _statusCode: errors.length || state.erro ? (state._statusCode || 500) : 200, board_id: state.boardId, column_id: state.columnId, title: state.title, created: !!state.created, backfilled: state.backfilled || 0, remaining_backfill: state.remainingBackfill || 0, not_mapped: state.notMapped || [], errors } }];`

  return {
    name,
    nodes: [
      webhookNode("setup-webhook", path),
      codeNode("setup-preparar", "Preparar", prepare, 220, 0),
      mondayHttpNode("setup-buscar-colunas", "Buscar Colunas", "={{ JSON.stringify({ query: $json.query }) }}", 440, 0, mondayCred),
      codeNode("setup-decidir", "Decidir Coluna", decide, 660, 0),
      ifNode("setup-if-create", "Precisa Criar?", "={{ $json.needsCreate }}", 880, 0),
      mondayHttpNode("setup-criar-coluna", "Criar Coluna", "={{ JSON.stringify({ query: $json.query }) }}", 1100, 120, mondayCred),
      codeNode("setup-preparar-itens", "Preparar Query Itens", prepareItems, 1320, 0),
      ifNode("setup-if-skip", "Pular Backfill?", "={{ $json.skipBackfill }}", 1540, 0),
      mondayHttpNode("setup-buscar-itens", "Buscar Itens", "={{ JSON.stringify({ query: $json.queryItems }) }}", 1760, 120, mondayCred),
      codeNode("setup-backfill", "Preparar Backfill", backfill, 1980, 120),
      ifNode("setup-if-backfill", "Tem Backfill?", "={{ $json.hasBackfill }}", 2200, 120),
      mondayHttpNode("setup-executar-backfill", "Executar Backfill", "={{ JSON.stringify({ query: $json.queryBackfill }) }}", 2420, 200, mondayCred),
      codeNode("setup-final", "Finalizar", final, 2640, 120),
      respondNode("setup-responder", "Responder", "={{ JSON.stringify($json) }}", 2860, 120),
    ],
    connections: {
      Webhook: { main: [[{ node: "Preparar", type: "main", index: 0 }]] },
      Preparar: { main: [[{ node: "Buscar Colunas", type: "main", index: 0 }]] },
      "Buscar Colunas": { main: [[{ node: "Decidir Coluna", type: "main", index: 0 }]] },
      "Decidir Coluna": { main: [[{ node: "Precisa Criar?", type: "main", index: 0 }]] },
      "Precisa Criar?": {
        main: [
          [{ node: "Criar Coluna", type: "main", index: 0 }],
          [{ node: "Preparar Query Itens", type: "main", index: 0 }],
        ],
      },
      "Criar Coluna": { main: [[{ node: "Preparar Query Itens", type: "main", index: 0 }]] },
      "Preparar Query Itens": { main: [[{ node: "Pular Backfill?", type: "main", index: 0 }]] },
      "Pular Backfill?": {
        main: [
          [{ node: "Finalizar", type: "main", index: 0 }],
          [{ node: "Buscar Itens", type: "main", index: 0 }],
        ],
      },
      "Buscar Itens": { main: [[{ node: "Preparar Backfill", type: "main", index: 0 }]] },
      "Preparar Backfill": { main: [[{ node: "Tem Backfill?", type: "main", index: 0 }]] },
      "Tem Backfill?": {
        main: [
          [{ node: "Executar Backfill", type: "main", index: 0 }],
          [{ node: "Finalizar", type: "main", index: 0 }],
        ],
      },
      "Executar Backfill": { main: [[{ node: "Finalizar", type: "main", index: 0 }]] },
      Finalizar: { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

function opcoesCode(unidadeColumnId) {
  return `// ==============================================================
// WF9 - Opcoes dinamicas da convocacao
// Le settings_str das colunas de status e devolve unidades por contrato.
// ==============================================================

const response = $input.first().json || {};
if (Array.isArray(response.errors) && response.errors.length > 0) {
  return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday_opcoes', mensagem: response.errors.map(e => e.message).join(' | '), errors: response.errors } }];
}

const COL = {
  SOLICITANTE: 'color_mktc9q29',
  CONTRATO: 'color_mktcnxwn',
  SABADO: 'color_mktaavmp',
  INSALUBRIDADE: 'color_mktq63xa',
  INTERIOR: 'color__1',
  JUSTIFICATIVA: 'color_mktarrgs'
};
const UNIDADES_POR_CONTRATO = ${JSON.stringify(UNIDADES_POR_CONTRATO)};
const fallback = {
  solicitantes: ['OPERACIONAL','RH'],
  contratos: Object.keys(UNIDADES_POR_CONTRATO),
  sabados: ['SIM','NÃO'],
  insalubridades: ['SIM','NÃO','NÃO INFORMADO'],
  interiores: ['SIM','NÃO'],
  justificativas: ['AFASTAMENTO','ATESTADO','FÉRIAS','FALTA','SUSPENSÃO','NÃO INICIADO','DESLIGAMENTO','LICENÇA MATERNIDADE','SEM CONVOCAÇÃO','MOP P/ CLT','POSTO VAGO','APOIO','DEMITIDO']
};

const columns = response.data?.boards?.[0]?.columns || [];
const byId = Object.fromEntries(columns.map(c => [c.id, c]));
function unique(values) {
  const out = [];
  const seen = new Set();
  for (const v of values || []) {
    const label = String(v || '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
function labelsFromColumn(columnId, fallbackValues) {
  const col = byId[columnId];
  if (!col?.settings_str) return fallbackValues;
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const labels = settings.labels || {};
    if (Array.isArray(labels)) {
      const parsedArray = labels.map(l => typeof l === 'string' ? l : l?.name || l?.label).filter(Boolean);
      return unique(parsedArray).length ? unique(parsedArray) : fallbackValues;
    }
    const parsedObject = Object.entries(labels)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, value]) => value);
    const parsed = unique(parsedObject);
    return parsed.length ? parsed : fallbackValues;
  } catch {
    return fallbackValues;
  }
}

return [{
  json: {
    _statusCode: 200,
    ok: true,
    fonte: 'monday.settings_str+unidadesContrato',
    atualizado_em: new Date().toISOString(),
    opcoes: {
      solicitantes: labelsFromColumn(COL.SOLICITANTE, fallback.solicitantes),
      contratos: fallback.contratos,
      sabados: labelsFromColumn(COL.SABADO, fallback.sabados),
      insalubridades: labelsFromColumn(COL.INSALUBRIDADE, fallback.insalubridades),
      interiores: labelsFromColumn(COL.INTERIOR, fallback.interiores),
      justificativas: labelsFromColumn(COL.JUSTIFICATIVA, fallback.justificativas),
      unidades_por_contrato: UNIDADES_POR_CONTRATO,
      unidade_column_id: ${JSON.stringify(unidadeColumnId)}
    }
  }
}];`
  return `// ==============================================================\\n// WF9 - Opcoes dinamicas da convocacao\\n// Le settings_str das colunas de status e devolve unidades por contrato.\\n// ==============================================================\\n\\nconst response = $input.first().json || {};\\nif (Array.isArray(response.errors) && response.errors.length > 0) {\\n  return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday_opcoes', mensagem: response.errors.map(e => e.message).join(' | '), errors: response.errors } }];\\n}\\nconst COL = { SOLICITANTE: 'color_mktc9q29', CONTRATO: 'color_mktcnxwn', SABADO: 'color_mktaavmp', INSALUBRIDADE: 'color_mktq63xa', INTERIOR: 'color__1', JUSTIFICATIVA: 'color_mktarrgs' };\\nconst UNIDADES_POR_CONTRATO = ${JSON.stringify(UNIDADES_POR_CONTRATO)};\\nconst fallback = { solicitantes: ['OPERACIONAL','RH'], contratos: Object.keys(UNIDADES_POR_CONTRATO), sabados: ['SIM','NÃO'], insalubridades: ['SIM','NÃO','NÃO INFORMADO'], interiores: ['SIM','NÃO'], justificativas: ['AFASTAMENTO','ATESTADO','FÉRIAS','FALTA','SUSPENSÃO','NÃO INICIADO','DESLIGAMENTO','LICENÇA MATERNIDADE','SEM CONVOCAÇÃO','MOP P/ CLT','POSTO VAGO','APOIO','DEMITIDO'] };\\nconst columns = response.data?.boards?.[0]?.columns || [];\\nconst byId = Object.fromEntries(columns.map(c => [c.id, c]));\\nfunction unique(values) { const out = []; const seen = new Set(); for (const v of values || []) { const label = String(v || '').trim(); if (!label || seen.has(label)) continue; seen.add(label); out.push(label); } return out; }\\nfunction labelsFromColumn(columnId, fallbackValues) { const col = byId[columnId]; if (!col?.settings_str) return fallbackValues; try { const settings = JSON.parse(col.settings_str || '{}'); const labels = settings.labels || {}; if (Array.isArray(labels)) { const parsedArray = labels.map(l => typeof l === 'string' ? l : l?.name || l?.label).filter(Boolean); return unique(parsedArray).length ? unique(parsedArray) : fallbackValues; } const parsedObject = Object.entries(labels).sort(([a], [b]) => Number(a) - Number(b)).map(([, value]) => value); const parsed = unique(parsedObject); return parsed.length ? parsed : fallbackValues; } catch { return fallbackValues; } }\\nreturn [{ json: { _statusCode: 200, ok: true, fonte: 'monday.settings_str+unidadesContrato', atualizado_em: new Date().toISOString(), opcoes: { solicitantes: labelsFromColumn(COL.SOLICITANTE, fallback.solicitantes), contratos: fallback.contratos, sabados: labelsFromColumn(COL.SABADO, fallback.sabados), insalubridades: labelsFromColumn(COL.INSALUBRIDADE, fallback.insalubridades), interiores: labelsFromColumn(COL.INTERIOR, fallback.interiores), justificativas: labelsFromColumn(COL.JUSTIFICATIVA, fallback.justificativas), unidades_por_contrato: UNIDADES_POR_CONTRATO, unidade_column_id: ${JSON.stringify(unidadeColumnId)} } } }];`
}

function patchWf7Code(code, unidadeColumnId) {
  {
    let out = code
    out = out.replace(
      /LOCAL_UNIDADE:\s*'texto75',\s*\/\/ text legado\\n\s*LOCAL_UNIDADE_DROPDOWN:\s*'[^']*',\s*\/\/ dropdown global/,
      `LOCAL_UNIDADE:        'texto75',            // text legado\n  LOCAL_UNIDADE_DROPDOWN: '${unidadeColumnId}', // dropdown global`,
    )
    out = out.replace(/\\nconst UNIDADES_POR_CONTRATO = [\s\S]*?\\n\\n(?=\/\/ Verifica bin)/, "")
    if (out.includes("LOCAL_UNIDADE_DROPDOWN")) {
      out = out.replace(/LOCAL_UNIDADE_DROPDOWN:\s*'[^']*'/, `LOCAL_UNIDADE_DROPDOWN: '${unidadeColumnId}'`)
    } else {
      out = out.replace(
        "LOCAL_UNIDADE:        'texto75',            // text",
        `LOCAL_UNIDADE:        'texto75',            // text legado\n  LOCAL_UNIDADE_DROPDOWN: '${unidadeColumnId}', // dropdown global`,
      )
    }
    const validation = `
const UNIDADES_POR_CONTRATO = ${JSON.stringify(UNIDADES_POR_CONTRATO)};
function normLabel(v) { return String(v || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim(); }
function unidadeValida(contrato, unidade) {
  const lista = UNIDADES_POR_CONTRATO[contrato] || [];
  const alvo = normLabel(unidade);
  return lista.some(u => normLabel(u) === alvo);
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
  {
    let out = code
    if (out.includes("LOCAL_UNIDADE_DROPDOWN")) {
      out = out.replace(/LOCAL_UNIDADE_DROPDOWN:\s*'[^']*'/, `LOCAL_UNIDADE_DROPDOWN: '${unidadeColumnId}'`)
    } else {
      out = out.replace(
        "LOCAL_UNIDADE:        'texto75',            // text",
        `LOCAL_UNIDADE:        'texto75',            // text legado\\n  LOCAL_UNIDADE_DROPDOWN: '${unidadeColumnId}', // dropdown global`,
      )
    }
    const validation = `\\nconst UNIDADES_POR_CONTRATO = ${JSON.stringify(UNIDADES_POR_CONTRATO)};\\nfunction normLabel(v) { return String(v || '').normalize('NFD').replace(/[\\\\u0300-\\\\u036f]/g, '').toUpperCase().trim(); }\\nfunction unidadeValida(contrato, unidade) {\\n  const lista = UNIDADES_POR_CONTRATO[contrato] || [];\\n  const alvo = normLabel(unidade);\\n  return lista.some(u => normLabel(u) === alvo);\\n}\\nif (!unidadeValida(payload.contrato, payload.localUnidade)) {\\n  return [{ json: { _statusCode: 400, ok: false, erro: 'unidade_invalida', mensagem: 'Local/Unidade nao pertence ao contrato selecionado.' } }];\\n}\\n`
    if (!out.includes("const UNIDADES_POR_CONTRATO =")) {
      const next = out.replace(/\/\/ Verifica bin[^\n]*/, `${validation}\\n$&`)
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
  let out = code
  out = out.replace(
    "LOCAL_UNIDADE:        'texto75',            // text",
    `LOCAL_UNIDADE:        'texto75',            // text legado\\n  LOCAL_UNIDADE_DROPDOWN: '${unidadeColumnId}', // dropdown global`,
  )
  const validation = `\\nconst UNIDADES_POR_CONTRATO = ${JSON.stringify(UNIDADES_POR_CONTRATO)};\\nfunction normLabel(v) { return String(v || '').normalize('NFD').replace(/[\\\\u0300-\\\\u036f]/g, '').toUpperCase().trim(); }\\nfunction unidadeValida(contrato, unidade) {\\n  const lista = UNIDADES_POR_CONTRATO[contrato] || [];\\n  const alvo = normLabel(unidade);\\n  return lista.some(u => normLabel(u) === alvo);\\n}\\nif (!unidadeValida(payload.contrato, payload.localUnidade)) {\\n  return [{ json: { _statusCode: 400, ok: false, erro: 'unidade_invalida', mensagem: 'Local/Unidade nao pertence ao contrato selecionado.' } }];\\n}\\n`
  out = out.replace("// Verifica binÃ¡rios (termos)", `${validation}\\n// Verifica binÃ¡rios (termos)`)
  out = out.replace(
    "[COL.LOCAL_UNIDADE]:       payload.localUnidade,",
    "[COL.LOCAL_UNIDADE]:       payload.localUnidade,\n  [COL.LOCAL_UNIDADE_DROPDOWN]: { labels: [payload.localUnidade] },",
  )
  out = out.replace("dataFim: payload.dataFim,", "dataFim: payload.dataFim,\n    localUnidade: payload.localUnidade,")
  return out
}

async function runSetup(client, workflow, webhookPath) {
  const id = await client.upsertWorkflow(workflow, true)
  const res = await fetch(`${client.baseUrl}/webhook/${webhookPath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  const text = await res.text()
  await client.deactivate(id)
  if (!res.ok) throw new Error(`Webhook setup ${webhookPath}: ${res.status} ${text}`)
  if (text) return JSON.parse(text)

  const executions = await client.request(`/api/v1/executions?workflowId=${id}&limit=1&includeData=true`)
  const runData = executions?.data?.[0]?.data?.resultData?.runData || {}
  for (const nodeName of ["Finalizar", "Responder"]) {
    const runs = runData[nodeName] || []
    const json = runs.at(-1)?.data?.main?.[0]?.[0]?.json
    if (json) return json
  }
  return null
}

async function main() {
  const oldClient = n8nClient(OLD_N8N_URL, OLD_N8N_KEY)

  let entradaSetup
  for (let tentativa = 0; tentativa < 12; tentativa += 1) {
    entradaSetup = await runSetup(
      oldClient,
      setupWorkflow({
        name: "Unidades Contrato - Setup Entrada",
        path: "unidades-contrato-setup-entrada",
        boardId: BOARD_ENTRADA,
        title: TITULO_UNIDADE_ENTRADA,
        oldTextColumnId: COL_ENTRADA_TEXTO_UNIDADE,
        doBackfill: true,
        mondayCred: MONDAY_CRED_OLD,
      }),
      "unidades-contrato-setup-entrada",
    )
    if (!entradaSetup?.remaining_backfill) break
  }
  const entradaColumnId = entradaSetup.column_id
  if (!entradaColumnId) throw new Error("Setup nao retornou column_id.")

  const wf9 = await oldClient.getWorkflow("fBlqA5MUBpJS1kYl")
  const moldar = wf9.nodes.find((n) => n.name === "Moldar opcoes")
  moldar.parameters.jsCode = opcoesCode(entradaColumnId)
  await oldClient.updateWorkflow(wf9)

  const wf7 = await oldClient.getWorkflow("VX7JNdxIuhA9yZsZ")
  const validar = wf7.nodes.find((n) => n.name === "Validar e preparar")
  validar.parameters.jsCode = patchWf7Code(validar.parameters.jsCode, entradaColumnId)
  await oldClient.updateWorkflow(wf7)

  const output = {
    updated_at: new Date().toISOString(),
    entrada: {
      board_id: BOARD_ENTRADA,
      column_id: entradaColumnId,
      title: TITULO_UNIDADE_ENTRADA,
      setup: entradaSetup,
    },
    unidades_por_contrato: UNIDADES_POR_CONTRATO,
    unidades_fora_escopo: [
      "ADMINISTRAÇÃO - INTERMITENTES",
      "LICENÇA MATERNIDADE",
      "IFAM TEFE",
      "AFASTADO INSS",
    ],
  }
  fs.mkdirSync("docs/n8n", { recursive: true })
  fs.writeFileSync("docs/n8n/unidades-contrato-columns.json", JSON.stringify(output, null, 2), "utf8")
  console.log(JSON.stringify(output, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
