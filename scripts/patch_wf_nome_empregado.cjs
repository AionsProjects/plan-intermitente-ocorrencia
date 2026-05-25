#!/usr/bin/env node
/**
 * Patcha WFs Preview (7gHmbLcZ5r6D5sXz) e Aplicar (XybrfnzI11Fw5sX4):
 * troca fonte do `nome` retornado por item — usar Nome do Empregado
 * (dropdown_mktadatt) em vez do field `name` do item Monday.
 *
 * Bug: items com name="TESTE" estavam mascarando nome real do RM
 * (que vive em dropdown_mktadatt).
 *
 * Uso: node scripts/patch_wf_nome_empregado.cjs <N8N_NOVO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/patch_wf_nome_empregado.cjs <N8N_NOVO_TOKEN>")
  process.exit(1)
}

const WFS = [
  { id: "7gHmbLcZ5r6D5sXz", name: "Preview" },
  { id: "XybrfnzI11Fw5sX4", name: "Aplicar" },
]
const BASE = "https://aionscorp-n8n.cloudfy.live/api/v1"

// 1) Adiciona E_NOME_EMPREGADO ao COL block
const PATCH_COL_FROM = "E_CHAPA: 'texto',"
const PATCH_COL_TO = "E_NOME_EMPREGADO: 'dropdown_mktadatt', E_CHAPA: 'texto',"

// 2) Substitui fonte do nome
const PATCH_NOME_FROM = "nome: e.name,"
const PATCH_NOME_TO = "nome: text(e, COL.E_NOME_EMPREGADO) || e.name,"

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
      let code = node.parameters?.jsCode || ""
      let nodeChanged = false

      if (code.includes(PATCH_COL_FROM) && !code.includes("E_NOME_EMPREGADO")) {
        code = code.replace(PATCH_COL_FROM, PATCH_COL_TO)
        nodeChanged = true
      }
      if (code.includes(PATCH_NOME_FROM)) {
        code = code.split(PATCH_NOME_FROM).join(PATCH_NOME_TO)
        nodeChanged = true
      }

      if (nodeChanged) {
        node.parameters.jsCode = code
        mudou++
        console.log(`  Patched node "${node.name}"`)
      }
    }
    if (mudou === 0) {
      console.log("  Nenhum node alterado (já patched ou pattern diferente)")
      continue
    }
    await updateWF(id, wf)
    console.log(`  ✓ Salvou WF ${name} (${mudou} nodes alterados)`)
  }
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
