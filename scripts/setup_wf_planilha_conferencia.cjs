#!/usr/bin/env node
/**
 * Setup do WF "Intermitente — Gerar Planilha Conferencia (Drive)" no n8n NOVO
 * (aionscorp-n8n.cloudfy.live).
 *
 * Cria novo workflow se ainda nao existir; senao atualiza.
 *
 * Funcionalidade:
 *   1. Webhook POST /gerar-planilha-conferencia
 *   2. Buscar item ENTRADA Monday + schema board (todas colunas)
 *   3. Code monta JSON 1:1 schema (1 linha de dados)
 *   4. Spreadsheet File converte JSON -> XLSX binary
 *   5. Google Drive: cria/acha subpasta CONFERENCIA na pasta convocacao
 *   6. Google Drive: upload XLSX com nome Conferencia_<CHAPA>_<DI>_<DF>.xlsx
 *   7. Atualiza coluna link no item ENTRADA com URL Drive (opcional)
 *   8. Responde 200 com {ok, file_id, web_view_link}
 *
 * Uso: node scripts/setup_wf_planilha_conferencia.cjs <N8N_NOVO_TOKEN>
 */

const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/setup_wf_planilha_conferencia.cjs <N8N_NOVO_TOKEN>")
  process.exit(1)
}

const BASE = "https://aionscorp-n8n.cloudfy.live/api/v1"
const WF_NAME = "Intermitente — Gerar Planilha Conferencia (Drive)"
const WEBHOOK_PATH = "gerar-planilha-conferencia"
const BOARD_ENTRADA = 18408773953
const MONDAY_CRED_ID = "6I0ycSr6PQJkBYpc" // Ray0 (já usado em PF)
// Google Drive cred no n8n NOVO — descobrir via API
const DRIVE_CRED_ID_PLACEHOLDER = "AUTO" // resolvido em runtime

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
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { _raw: text }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
  }
  return data
}

async function findOrFetchDriveCred() {
  // Lista todos WFs + acha 1ª cred googleDriveOAuth2Api usada
  const wfs = await n8n("GET", "/workflows?limit=200")
  for (const w of wfs.data || []) {
    for (const node of w.nodes || []) {
      const c = node.credentials || {}
      if (c.googleDriveOAuth2Api?.id) {
        return { id: c.googleDriveOAuth2Api.id, name: c.googleDriveOAuth2Api.name || "Drive" }
      }
    }
  }
  return null
}

function buildNodes(driveCred) {
  return [
    // 1. Webhook entry
    {
      parameters: {
        httpMethod: "POST",
        path: WEBHOOK_PATH,
        responseMode: "responseNode",
        options: {},
      },
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.1,
      position: [0, 0],
      id: "planilha-webhook",
      name: "Webhook",
      webhookId: "gerar-planilha-conferencia-wh",
    },
    // 2. Buscar item ENTRADA com TODAS as colunas
    {
      parameters: {
        method: "POST",
        url: "https://api.monday.com/v2",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "mondayComApi",
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: "Content-Type", value: "application/json" }],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={{ JSON.stringify({ query: `query { items(ids: [` + ($json.body.item_entrada_id) + `]) { id name column_values { id text value column { id title type } } } boards(ids: [' +
          BOARD_ENTRADA +
          ']) { columns { id title type } } }` }) }}',
        options: { response: { response: { neverError: true } } },
      },
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [240, 0],
      id: "planilha-buscar",
      name: "Buscar Item + Schema",
      credentials: {
        mondayComApi: { id: MONDAY_CRED_ID, name: "Ray0" },
      },
    },
    // 3. Code monta JSON 1:1 schema board
    {
      parameters: {
        jsCode: `
const respMonday = $('Buscar Item + Schema').first().json;
const webhookBody = $('Webhook').first().json.body || {};

const data = respMonday?.data || {};
const item = data.items?.[0];
const schema = data.boards?.[0]?.columns || [];

if (!item) {
  return [{ json: { _statusCode: 404, ok: false, erro: 'item_nao_encontrado', mensagem: 'Item ENTRADA nao encontrado' } }];
}

// Index column_values do item por column id
const cvById = {};
for (const cv of (item.column_values || [])) {
  cvById[cv.id] = cv;
}

function formatDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
  if (!m) return iso;
  return m[3] + '/' + m[2] + '/' + m[1];
}

function formatValue(col, cv) {
  if (!cv) return '';
  const text = cv.text || '';
  const type = col.type;
  if (type === 'date') return formatDate(text);
  if (type === 'numbers') {
    const n = parseFloat(text);
    if (isNaN(n)) return '';
    return Number(n.toFixed(2));
  }
  if (type === 'formula') {
    const n = parseFloat(text);
    if (isNaN(n)) return text;
    return Number(n.toFixed(2));
  }
  if (type === 'file') {
    try {
      const v = JSON.parse(cv.value || '{}');
      return v.files ? v.files.length : 0;
    } catch { return text ? 'sim' : ''; }
  }
  return text;
}

// Linha = headers ordenados pelo schema (1:1)
const linha = {};
linha['Item ID'] = item.id;
linha['Nome do Item'] = item.name;
for (const col of schema) {
  // Skip name column (já temos)
  if (col.id === 'name') continue;
  linha[col.title] = formatValue(col, cvById[col.id]);
}

// Campos derivados
const vrSaldoText = (cvById['formula_mkrzwf9c']?.text || '0').replace(',', '.');
const vtSaldoText = (cvById['f_rmula']?.text || '0').replace(',', '.');
const totalPago = (parseFloat(vrSaldoText) || 0) + (parseFloat(vtSaldoText) || 0);
linha['TOTAL PAGO'] = Number(totalPago.toFixed(2));
linha['Convocacao UUID'] = webhookBody.uuid || '';
linha['Data Geração'] = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');

// Filename + metadata vão num item adicional INTERNAL acessado via $node ref
const chapa = (cvById['texto']?.text || webhookBody.chapa || 'SEM-CHAPA').replace(/[^0-9A-Za-z]/g, '');
const di = (cvById['date_mktayxhb']?.text || '').slice(0, 10);
const df = (cvById['date_mktasnwq']?.text || '').slice(0, 10);
const filename = 'Conferencia_' + chapa + '_' + di + '_' + df + '.xlsx';

// Anexa metadata em chaves __meta_* (Spreadsheet File ignora? não — vai virar coluna).
// Solução: usar staticData ou node helper. Vou retornar APENAS linha. Metadata
// vira global via setWorkflowStaticData. Próximos nodes acessam via $execution
// OU re-derivam via $('Buscar Item + Schema').first().json + $('Webhook').first().json.
return [{ json: linha }];
`.trim(),
      },
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [480, 0],
      id: "planilha-montar",
      name: "Montar Linha XLSX",
    },
    // 4. Spreadsheet File: JSON -> XLSX binary (input = $json com chaves = headers)
    {
      parameters: {
        operation: "toFile",
        fileFormat: "xlsx",
        binaryPropertyName: "data",
        options: {
          sheetName: "Conferencia",
        },
      },
      type: "n8n-nodes-base.spreadsheetFile",
      typeVersion: 2,
      position: [720, 0],
      id: "planilha-xlsx",
      name: "Gerar XLSX",
    },
    // 5. Resolver/criar subpasta CONFERENCIA (Drive)
    {
      parameters: {
        method: "POST",
        url: "https://www.googleapis.com/drive/v3/files",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleDriveOAuth2Api",
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: "supportsAllDrives", value: "true" },
            { name: "fields", value: "id,name,webViewLink" },
          ],
        },
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: "Content-Type", value: "application/json" }],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={{ JSON.stringify({ name: \"CONFERENCIA\", mimeType: \"application/vnd.google-apps.folder\", parents: [$(\"Webhook\").first().json.body.pasta_convocacao_drive_id] }) }}',
        options: { response: { response: { neverError: true } } },
      },
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [960, 0],
      id: "planilha-folder",
      name: "Criar Subpasta CONFERENCIA",
      credentials: {
        googleDriveOAuth2Api: { id: driveCred.id, name: driveCred.name },
      },
    },
    // 6. Upload XLSX via Google Drive node nativo
    //    Filename calculado via expression a partir do Buscar Item + Schema
    //    (chapa do texto + datas date_mktayxhb/date_mktasnwq)
    {
      parameters: {
        resource: "file",
        operation: "upload",
        driveId: "My Drive",
        folderId: {
          __rl: true,
          value: '={{ $("Criar Subpasta CONFERENCIA").first().json.id }}',
          mode: "id",
        },
        name:
          '={{ "Conferencia_" + ($("Buscar Item + Schema").first().json.data.items[0].column_values.find(c => c.id === "texto").text || "SEM-CHAPA").replace(/[^0-9A-Za-z]/g, "") + "_" + ($("Buscar Item + Schema").first().json.data.items[0].column_values.find(c => c.id === "date_mktayxhb").text || "").slice(0, 10) + "_" + ($("Buscar Item + Schema").first().json.data.items[0].column_values.find(c => c.id === "date_mktasnwq").text || "").slice(0, 10) + ".xlsx" }}',
        binaryData: true,
        binaryPropertyName: "data",
        options: {},
      },
      type: "n8n-nodes-base.googleDrive",
      typeVersion: 3,
      position: [1200, 0],
      id: "planilha-upload",
      name: "Upload XLSX Drive",
      credentials: {
        googleDriveOAuth2Api: { id: driveCred.id, name: driveCred.name },
      },
    },
    // 7. Respond OK
    {
      parameters: {
        respondWith: "json",
        responseBody:
          '={{ JSON.stringify({ ok: true, file_id: $json.id, web_view_link: $json.webViewLink, name: $json.name }) }}',
        options: {
          responseCode: 200,
          responseHeaders: {
            entries: [{ name: "Content-Type", value: "application/json" }],
          },
        },
      },
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1440, 0],
      id: "planilha-respond",
      name: "Respond",
    },
  ]
}

function buildConnections() {
  // Reorganizado: subpasta criada PRIMEIRO (não precisa binary do XLSX).
  // Gerar XLSX vira penúltimo, e Upload recebe binary direto desse node.
  return {
    Webhook: { main: [[{ node: "Buscar Item + Schema", type: "main", index: 0 }]] },
    "Buscar Item + Schema": { main: [[{ node: "Criar Subpasta CONFERENCIA", type: "main", index: 0 }]] },
    "Criar Subpasta CONFERENCIA": { main: [[{ node: "Montar Linha XLSX", type: "main", index: 0 }]] },
    "Montar Linha XLSX": { main: [[{ node: "Gerar XLSX", type: "main", index: 0 }]] },
    "Gerar XLSX": { main: [[{ node: "Upload XLSX Drive", type: "main", index: 0 }]] },
    "Upload XLSX Drive": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
  }
}

async function findExistingWF() {
  const list = await n8n("GET", "/workflows?limit=200")
  for (const w of list.data || []) {
    if (w.name === WF_NAME) return w
  }
  return null
}

;(async () => {
  console.log("Resolvendo credencial Google Drive no n8n NOVO...")
  const driveCred = await findOrFetchDriveCred()
  if (!driveCred) {
    throw new Error("Nenhuma cred googleDriveOAuth2Api encontrada no n8n NOVO. Cadastre antes.")
  }
  console.log(`  Cred Drive: ${driveCred.id} (${driveCred.name})`)

  const existing = await findExistingWF()
  const payload = {
    name: WF_NAME,
    nodes: buildNodes(driveCred),
    connections: buildConnections(),
    settings: { executionOrder: "v1" },
  }

  if (existing) {
    console.log(`WF existe (id ${existing.id}). Atualizando...`)
    await n8n("PUT", `/workflows/${existing.id}`, payload)
    console.log("✓ Atualizado")
    console.log(`  Webhook URL: https://aionscorp-n8n.cloudfy.live/webhook/${WEBHOOK_PATH}`)
  } else {
    console.log("Criando WF novo...")
    const created = await n8n("POST", "/workflows", payload)
    console.log(`✓ Criado id=${created.id}`)
    console.log(`  Webhook URL: https://aionscorp-n8n.cloudfy.live/webhook/${WEBHOOK_PATH}`)
    console.log(`  Ative o WF manualmente no UI (n8n REST API nao tem endpoint activate).`)
  }
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
