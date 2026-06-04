#!/usr/bin/env node
/**
 * Adiciona webhook temporario ao WF MENSAL FIFO pra dispararmos via HTTP,
 * ativa o WF, dispara, aguarda execucao, lista resultado, e
 * remove o webhook ao final.
 *
 * Bypassa Schedule + Code Gate pra teste imediato.
 *
 * Uso: node scripts/trigger_wf_mensal_test.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/trigger_wf_mensal_test.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const HOST = "https://antigoaionscorp-n8n.cloudfy.live"
const WF_ID = "7OtCd751FL1IrkHi"
const WEBHOOK_PATH = "mensal-test-trigger"
const WEBHOOK_NODE_NAME = "TMP Webhook Test"

async function n8n(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-N8N-API-KEY": TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function setupWebhook() {
  const wf = await n8n("GET", `/workflows/${WF_ID}`)

  // Remove webhook tmp anterior (idempotente)
  wf.nodes = wf.nodes.filter((n) => n.name !== WEBHOOK_NODE_NAME)
  if (wf.connections[WEBHOOK_NODE_NAME]) delete wf.connections[WEBHOOK_NODE_NAME]

  const webhookNode = {
    parameters: {
      httpMethod: "POST",
      path: WEBHOOK_PATH,
      responseMode: "lastNode",
      options: {},
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [-2400, -200],
    id: "tmp-webhook-mensal",
    name: WEBHOOK_NODE_NAME,
    webhookId: "tmp-mensal-test-webhook-id",
  }
  wf.nodes.push(webhookNode)

  // Conecta webhook → Code Build Query Mensal (bypassa Schedule + Gate)
  wf.connections[WEBHOOK_NODE_NAME] = {
    main: [[{ node: "Code Build Query Mensal", type: "main", index: 0 }]],
  }

  // Tambem precisa garantir que Code Build Query Mensal aceita input do webhook
  // — ele faz $input.first().json — webhook entrega body como first().json.body
  // Vamos prefixar pra Code Build Query Mensal ler de Code Gate OU webhook
  // Mais simples: passar competencia via Code antes do Build Query.
  // Cria Code "TMP Context" que injeta ctx mock e conecta Webhook → TMP Context → Code Build Query Mensal
  const tmpCtxName = "TMP Context Manual"
  wf.nodes = wf.nodes.filter((n) => n.name !== tmpCtxName)
  const tmpCtx = {
    parameters: {
      jsCode: `// TMP — injeta contexto pra teste manual (ignora Code Gate)
const ref = new Date();
const anoCompAlvo = ref.getMonth() === 11 ? ref.getFullYear() + 1 : ref.getFullYear();
const mesCompAlvo = ref.getMonth() === 11 ? 1 : ref.getMonth() + 2;
const competenciaIso = anoCompAlvo + '-' + String(mesCompAlvo).padStart(2, '0');
const mesLabels = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
return [{ json: {
  devePassar: true,
  isManual: true,
  isUDU: false,
  hojeIso: ref.toISOString().slice(0,10),
  anoCompAlvo,
  mesCompAlvo,
  competenciaIso,
  competenciaLabel: mesLabels[mesCompAlvo - 1]
}}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-2200, -200],
    id: "tmp-ctx-mensal",
    name: tmpCtxName,
  }
  wf.nodes.push(tmpCtx)

  wf.connections[WEBHOOK_NODE_NAME] = {
    main: [[{ node: tmpCtxName, type: "main", index: 0 }]],
  }
  wf.connections[tmpCtxName] = {
    main: [[{ node: "Code Build Query Mensal", type: "main", index: 0 }]],
  }

  const cleanSettings = {}
  const allowed = ["executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution", "saveManualExecutions", "saveExecutionProgress", "timezone"]
  for (const k of allowed) if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k]

  await n8n("PUT", `/workflows/${WF_ID}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings,
    staticData: wf.staticData,
  })

  // Ativa workflow
  await n8n("POST", `/workflows/${WF_ID}/activate`)
  console.log("✓ WF ativado com webhook tmp")
}

async function cleanupWebhook() {
  try {
    await n8n("POST", `/workflows/${WF_ID}/deactivate`)
  } catch {}

  const wf = await n8n("GET", `/workflows/${WF_ID}`)
  wf.nodes = wf.nodes.filter((n) => n.name !== WEBHOOK_NODE_NAME && n.name !== "TMP Context Manual")
  delete wf.connections[WEBHOOK_NODE_NAME]
  delete wf.connections["TMP Context Manual"]

  const cleanSettings = {}
  const allowed = ["executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution", "saveManualExecutions", "saveExecutionProgress", "timezone"]
  for (const k of allowed) if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k]

  await n8n("PUT", `/workflows/${WF_ID}`, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings,
    staticData: wf.staticData,
  })
  console.log("✓ Webhook tmp removido + WF desativado")
}

async function fireWebhook() {
  const url = `${HOST}/webhook/${WEBHOOK_PATH}`
  console.log(`Disparando ${url}...`)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ test: true }),
  })
  const text = await res.text()
  console.log(`  HTTP ${res.status}`)
  console.log(`  Body: ${text.slice(0, 500)}`)
}

async function listLastExec() {
  // Lista execucoes recentes do WF MENSAL FIFO
  const res = await n8n("GET", `/executions?workflowId=${WF_ID}&limit=3&includeData=true`)
  const list = res.data || []
  if (list.length === 0) {
    console.log("  (nenhuma execucao recente)")
    return null
  }
  return list
}

;(async () => {
  try {
    console.log("=== Setup ===")
    await setupWebhook()

    // Aguarda webhook registration propagar
    await sleep(2000)

    console.log("\n=== Fire ===")
    await fireWebhook()

    console.log("\n=== Aguardando execucao (10s) ===")
    await sleep(10000)

    console.log("\n=== Execucoes recentes ===")
    const list = await listLastExec()
    if (list) {
      for (const e of list.slice(0, 1)) {
        console.log(`\nID ${e.id} status ${e.status} startedAt ${e.startedAt} stoppedAt ${e.stoppedAt}`)
        const runs = e.data?.resultData?.runData || {}
        const nodesRan = Object.keys(runs)
        console.log(`Nodes que rodaram (${nodesRan.length}):`)
        nodesRan.forEach((name) => {
          const r = runs[name][0]
          const err = r?.error?.message
          const outCount = r?.data?.main?.[0]?.length ?? 0
          console.log(`  ${err ? "✗" : "✓"} ${name}` + (err ? ` ERRO: ${err}` : ` (${outCount} items)`))
        })
      }
    }
  } finally {
    console.log("\n=== Cleanup ===")
    await cleanupWebhook()
  }
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
