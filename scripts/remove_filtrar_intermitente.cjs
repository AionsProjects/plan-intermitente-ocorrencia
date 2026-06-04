#!/usr/bin/env node
/**
 * Remove o node "Filtrar e Normalizar Intermitente" do WF5 PONTUAL e WF MENSAL.
 *
 * Esse node foi adicionado num momento de diagnostico errado (assumi SQL BEN 2
 * diferente). BEN 2 ja retorna shape esperado (Nome do Intermitente,
 * Matricula/Chapa, etc) — Filtrar so adiciona complexidade.
 *
 * Acao por WF:
 *   - Remove o node
 *   - Reconecta HTTP Request → If diretamente
 *   - Restaura refs $('HTTP Request') em HTTP Request3 + Code in JavaScript2
 *     (estavam apontando pra Filtrar)
 *
 * Uso: node scripts/remove_filtrar_intermitente.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/remove_filtrar_intermitente.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const WF_IDS = [
  { id: "Bso4k6ddDNcRmU83", label: "WF5 PONTUAL FIFO" },
  { id: "7OtCd751FL1IrkHi", label: "WF MENSAL FIFO" },
]
const FILTRAR = "Filtrar e Normalizar Intermitente"

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

async function processarWf({ id, label }) {
  console.log(`\n=== ${label} (${id}) ===`)
  const wf = await n8n("GET", `/workflows/${id}`)
  console.log(`  Nodes: ${wf.nodes.length}`)

  const filtrar = wf.nodes.find((n) => n.name === FILTRAR)
  if (!filtrar) {
    console.log("  Nao tem node Filtrar — skip.")
    return
  }

  // Remove o node
  wf.nodes = wf.nodes.filter((n) => n.name !== FILTRAR)
  console.log(`  Removido "${FILTRAR}"`)

  // Connections: remove origem dele + reconecta HTTP Request → o destino que Filtrar apontava
  wf.connections = wf.connections || {}
  let proximoDeFiltrar = null
  if (wf.connections[FILTRAR]) {
    const out = wf.connections[FILTRAR].main?.[0] || []
    proximoDeFiltrar = out[0]?.node || null
    delete wf.connections[FILTRAR]
  }

  // HTTP Request agora aponta direto pro destino que Filtrar tinha (geralmente "If")
  if (wf.connections["HTTP Request"]) {
    const destinoOriginal = wf.connections["HTTP Request"].main?.[0]?.[0]?.node
    if (destinoOriginal === FILTRAR) {
      wf.connections["HTTP Request"] = {
        main: [[{ node: proximoDeFiltrar || "If", type: "main", index: 0 }]],
      }
      console.log(`  HTTP Request → ${proximoDeFiltrar || "If"} (reconectado)`)
    }
  }

  // Patcha refs em nodes downstream: $('Filtrar e Normalizar Intermitente') → $('HTTP Request')
  const TARGETS = ["HTTP Request3", "Code in JavaScript2"]
  for (const name of TARGETS) {
    const node = wf.nodes.find((n) => n.name === name)
    if (!node) {
      console.warn(`  AVISO: node "${name}" nao achado`)
      continue
    }
    const before = JSON.stringify(node.parameters)
    const after = before
      .split(`$('${FILTRAR}')`)
      .join("$('HTTP Request')")
      .split(`$("${FILTRAR}")`)
      .join('$("HTTP Request")')
    if (before !== after) {
      node.parameters = JSON.parse(after)
      console.log(`  Refs restauradas em "${name}"`)
    }
  }

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

  await n8n("PUT", `/workflows/${id}`, payload)
  console.log(`  ✓ ${label} atualizado`)
}

;(async () => {
  for (const wf of WF_IDS) {
    await processarWf(wf)
  }
  console.log("\n✓ Limpeza concluida")
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
