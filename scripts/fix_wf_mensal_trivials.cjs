#!/usr/bin/env node
/**
 * Fixes triviais no WF MENSAL FIFO (7OtCd751FL1IrkHi):
 *   #3: MARCO → MARÇO em Code Gate (alinha com Preparar Solicitacao Pgto)
 *   #4: neverError=true em 8 HTTP nodes criticos
 *
 * Uso: node scripts/fix_wf_mensal_trivials.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/fix_wf_mensal_trivials.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const WF_ID = "7OtCd751FL1IrkHi"

const NEVER_ERROR_NODES = [
  "HTTP Request",
  "HTTP Request1",
  "HTTP Request2",
  "HTTP Request3",
  "HTTP Request4",
  "HTTP Request5",
  "HTTP Request6",
  "HTTP Request7",
  "Criar Solicitacao Pgto Beneficio",
  "Buscar Mensal Elegíveis",
  "Buscar Solicitacoes Ja Pagas",
]

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

;(async () => {
  console.log("Fetching WF MENSAL FIFO...")
  const wf = await n8n("GET", `/workflows/${WF_ID}`)
  console.log(`  Nodes: ${wf.nodes.length}`)

  // Fix #3 — MARCO → MARÇO em Code Gate
  const codeGate = wf.nodes.find((n) => n.name === "Code Gate")
  if (codeGate) {
    const before = codeGate.parameters.jsCode || ""
    const after = before.replace(/'MARCO'/g, "'MARÇO'")
    if (before !== after) {
      codeGate.parameters.jsCode = after
      console.log("  ✓ Code Gate: MARCO → MARÇO")
    } else {
      console.log("  Code Gate: já corrigido (sem MARCO sem cedilha)")
    }
  }

  // Fix #4 — neverError=true nos HTTP nodes
  let changed = 0
  for (const name of NEVER_ERROR_NODES) {
    const node = wf.nodes.find((n) => n.name === name)
    if (!node) {
      console.warn(`  AVISO: node "${name}" nao achado`)
      continue
    }
    node.parameters.options = node.parameters.options || {}
    node.parameters.options.response = node.parameters.options.response || {}
    node.parameters.options.response.response = node.parameters.options.response.response || {}
    if (!node.parameters.options.response.response.neverError) {
      node.parameters.options.response.response.neverError = true
      console.log(`  ✓ ${name} neverError=true`)
      changed++
    }
  }
  console.log(`  ${changed} HTTP nodes atualizados`)

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

  await n8n("PUT", `/workflows/${WF_ID}`, payload)
  console.log("✓ WF MENSAL FIFO atualizado")
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
