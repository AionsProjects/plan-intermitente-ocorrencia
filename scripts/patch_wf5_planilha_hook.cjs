#!/usr/bin/env node
/**
 * Patcha WF5 PONTUAL FIFO (Bso4k6ddDNcRmU83) no n8n ANTIGO adicionando:
 * - Code "Preparar Payload Planilha Conferencia"
 * - HTTP "Disparar Planilha Conferencia Async"
 *
 * Hook posicionado APÓS "Disparar Drive Caju Boleto Async" (último node atual).
 *
 * Payload pra webhook gerar-planilha-conferencia:
 *   item_entrada_id, uuid, pasta_convocacao_drive_id, pasta_pessoa_drive_id
 *
 * Uso: node scripts/patch_wf5_planilha_hook.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/patch_wf5_planilha_hook.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const WF_ID = "Bso4k6ddDNcRmU83"
const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const WEBHOOK_URL = "https://aionscorp-n8n.cloudfy.live/webhook/gerar-planilha-conferencia"
const HOOK_AFTER = "Disparar Drive Caju Boleto Async"

const NOVO_CODE = {
  parameters: {
    jsCode: `
// Monta payload pro WF "Gerar Planilha Conferencia" (n8n NOVO).
// Coleta dados dos nodes upstream: itemEntradaId + uuid (Code in JavaScript8)
// + pastaConvocacaoFolderId + pastaPessoaFolderId (Emitir Pasta Drive).
const dados = $('Code in JavaScript8').first().json;
let pasta = {};
try {
  pasta = $('Emitir Pasta Drive').first().json || {};
} catch {}

return [{
  json: {
    item_entrada_id: dados.itemEntradaId || dados.boardId || '',
    uuid: dados.uuid || dados.protocoloUUID || '',
    chapa: dados.chapaRM || '',
    nome: dados.nomeEmpregado || '',
    pasta_convocacao_drive_id: pasta.convocacaoFolderId || pasta.documentosFolderId || '',
    pasta_pessoa_drive_id: pasta.pessoaFolderId || ''
  }
}];
`.trim(),
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [19952, 4240],
  id: "wf5-planilha-payload",
  name: "Preparar Payload Planilha Conferencia",
}

const NOVO_HTTP = {
  parameters: {
    method: "POST",
    url: WEBHOOK_URL,
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Content-Type", value: "application/json" }],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json) }}",
    options: { response: { response: { neverError: true } } },
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [20176, 4240],
  id: "wf5-planilha-disparar",
  name: "Disparar Planilha Conferencia Async",
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

  // Remove versões antigas dos nodes (idempotente)
  wf.nodes = wf.nodes.filter(
    (n) => n.id !== "wf5-planilha-payload" && n.id !== "wf5-planilha-disparar",
  )

  // Adiciona nodes novos
  wf.nodes.push(NOVO_CODE, NOVO_HTTP)

  // Patcha connections: HOOK_AFTER → Preparar Payload → Disparar Planilha
  wf.connections = wf.connections || {}
  wf.connections[HOOK_AFTER] = {
    main: [[{ node: NOVO_CODE.name, type: "main", index: 0 }]],
  }
  wf.connections[NOVO_CODE.name] = {
    main: [[{ node: NOVO_HTTP.name, type: "main", index: 0 }]],
  }
  wf.connections[NOVO_HTTP.name] = { main: [[]] }

  // n8n REST API rejects extra fields em settings — keep only whitelist
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

  console.log("Subindo WF5 patched...")
  await n8n("PUT", `/workflows/${WF_ID}`, payload)
  console.log("✓ WF5 patched")
  console.log(`  Hook: "${HOOK_AFTER}" → "${NOVO_CODE.name}" → "${NOVO_HTTP.name}"`)
  console.log(`  Webhook destino: ${WEBHOOK_URL}`)
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
