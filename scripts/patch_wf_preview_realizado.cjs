#!/usr/bin/env node
/**
 * Patcha WF "Ponto Facultativo — Preview" (7gHmbLcZ5r6D5sXz):
 * adiciona "REALIZADO" à whitelist do filtro de regra ativa do board
 * Parâmetros de Benefícios (18413870370). Bug: board tem coluna
 * "Ativo" com label "REALIZADO" mas code só aceitava ATIVA/SIM/etc,
 * caía no fallback "Sem regra ativa cadastrada no board" → VR=0.
 *
 * Uso: node scripts/patch_wf_preview_realizado.cjs <N8N_NOVO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/patch_wf_preview_realizado.cjs <N8N_NOVO_TOKEN>")
  process.exit(1)
}

const WFS = [
  { id: "7gHmbLcZ5r6D5sXz", name: "Preview" },
  { id: "XybrfnzI11Fw5sX4", name: "Aplicar" },
]
const BASE = "https://aionscorp-n8n.cloudfy.live/api/v1"
const ANTIGO = "['SIM','ATIVO','TRUE','1','HABILITADO']"
const NOVO = "['SIM','ATIVO','ATIVA','TRUE','1','HABILITADO','REALIZADO']"

async function fetchWF(id) {
  const res = await fetch(`${BASE}/workflows/${id}`, {
    headers: { "X-N8N-API-KEY": TOKEN },
  })
  if (!res.ok) throw new Error(`Fetch ${id}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function updateWF(id, wf) {
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData,
  }
  const res = await fetch(`${BASE}/workflows/${id}`, {
    method: "PUT",
    headers: {
      "X-N8N-API-KEY": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Update ${id}: ${res.status} ${await res.text()}`)
  return res.json()
}

;(async () => {
  for (const { id, name } of WFS) {
    console.log(`\n→ WF ${name} (${id})`)
    const wf = await fetchWF(id)
    let mudou = 0
    for (const node of wf.nodes) {
      if (node.type !== "n8n-nodes-base.code") continue
      const code = node.parameters?.jsCode || ""
      if (code.includes(ANTIGO)) {
        node.parameters.jsCode = code.split(ANTIGO).join(NOVO)
        mudou++
        console.log(`  Patched node "${node.name}"`)
      }
    }
    if (mudou === 0) {
      console.log(`  Nenhum node tinha o pattern (já patched?)`)
      continue
    }
    await updateWF(id, wf)
    console.log(`  ✓ Salvou WF ${name} (${mudou} nodes alterados)`)
  }
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
