#!/usr/bin/env node
/**
 * Patcha WF5 PONTUAL FIFO (Bso4k6ddDNcRmU83) no n8n ANTIGO:
 * Adiciona node "Setar Status AUTOMAÇÃO - OK" apos
 * "Criar Solicitacao Pgto Beneficio" — atualiza coluna `status` do
 * item criado no board 18393673859 (Solicitacao Pagamento) pro
 * label "AUTOMAÇÃO - OK" (id 19).
 *
 * Insere entre "Criar Solicitacao Pgto Beneficio" → existing next
 * node ("Preparar Job Drive Caju Boleto"), mantendo fluxo.
 *
 * Uso: node scripts/patch_wf5_status_automacao_ok.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/patch_wf5_status_automacao_ok.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const WF_ID = "Bso4k6ddDNcRmU83"
const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const HOOK_AFTER = "Criar Solicitacao Pgto Beneficio"
const NEXT_NODE = "Preparar Job Drive Caju Boleto"
const SOLICITACAO_BOARD = 18393673859

// Monday cred no n8n antigo — Ray0 nao existe aqui, usar Monday.com account isaac
const MONDAY_CRED_ID = "QuX90go84pJaRueJ"
const MONDAY_CRED_NAME = "Monday.com account isaac"

const NEW_NODE = {
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
    // change_simple_column_value escrita do label "AUTOMAÇÃO - OK" no
    // status do item recem-criado. ID do item vem do response do
    // node anterior (Criar Solicitacao Pgto Beneficio).
    jsonBody:
      '={{ JSON.stringify({ query: `mutation { change_simple_column_value(board_id: ' +
      SOLICITACAO_BOARD +
      ', item_id: ` + ($json.data.create_item.id) + `, column_id: "status", value: "AUTOMAÇÃO - OK") { id } }` }) }}',
    options: { response: { response: { neverError: true } } },
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [19360, 4144],
  id: "wf5-status-automacao-ok",
  name: "Setar Status AUTOMACAO - OK",
  credentials: {
    mondayComApi: { id: MONDAY_CRED_ID, name: MONDAY_CRED_NAME },
  },
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : {}
}

;(async () => {
  console.log("Fetching WF5...")
  const wf = await n8n("GET", `/workflows/${WF_ID}`)
  console.log(`  Nodes: ${wf.nodes.length}`)

  // Remove versão antiga (idempotente)
  wf.nodes = wf.nodes.filter((n) => n.id !== "wf5-status-automacao-ok")
  wf.nodes.push(NEW_NODE)

  // Re-routa: Criar Solicitacao → Setar Status → Preparar Job Drive
  wf.connections = wf.connections || {}
  wf.connections[HOOK_AFTER] = {
    main: [[{ node: NEW_NODE.name, type: "main", index: 0 }]],
  }
  wf.connections[NEW_NODE.name] = {
    main: [[{ node: NEXT_NODE, type: "main", index: 0 }]],
  }

  // Whitelist settings (n8n REST rejects extra fields)
  const cleanSettings = {}
  const allowed = ["executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution", "saveManualExecutions", "saveExecutionProgress", "timezone"]
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

  console.log("Subindo WF5...")
  await n8n("PUT", `/workflows/${WF_ID}`, payload)
  console.log("✓ WF5 patched")
  console.log(`  Hook: "${HOOK_AFTER}" → "${NEW_NODE.name}" → "${NEXT_NODE}"`)
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
