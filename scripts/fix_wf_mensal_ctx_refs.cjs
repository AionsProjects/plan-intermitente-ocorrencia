#!/usr/bin/env node
/**
 * Fix: Code Build Antifraude e Code Normalizar Mensal referenciam Code Gate
 * (que pode nao rodar em test bypass). Trocar pra ler de Code Build Query
 * Mensal que faz ...ctx spread.
 *
 * Uso: node scripts/fix_wf_mensal_ctx_refs.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/fix_wf_mensal_ctx_refs.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const WF_ID = "7OtCd751FL1IrkHi"

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
  const wf = await n8n("GET", `/workflows/${WF_ID}`)

  const antifraude = wf.nodes.find((n) => n.name === "Code Build Antifraude")
  if (antifraude) {
    const before = antifraude.parameters.jsCode || ""
    const after = before.replace(/\$\('Code Gate'\)/g, "$('Code Build Query Mensal')")
    if (before !== after) {
      antifraude.parameters.jsCode = after
      console.log("✓ Code Build Antifraude: $('Code Gate') → $('Code Build Query Mensal')")
    }
  }

  const norm = wf.nodes.find((n) => n.name === "Code Normalizar Mensal")
  if (norm) {
    const before = norm.parameters.jsCode || ""
    // Normalizar le de Code Build Antifraude — manter como esta (Antifraude vai rodar agora)
    // Mas se quiser maior resiliencia, tambem trocar para Build Query Mensal:
    const after = before.replace(/\$\('Code Build Antifraude'\)/g, "$('Code Build Query Mensal')")
    if (before !== after) {
      norm.parameters.jsCode = after
      console.log("✓ Code Normalizar Mensal: $('Code Build Antifraude') → $('Code Build Query Mensal')")
    }
  }

  // Limpa elegiveis pra Normalizar pegar — Code Build Query Mensal nao tem elegiveis!
  // ATENCAO: Build Query Mensal tem ctx + query; Antifraude adicionou elegiveis e mais query.
  // Se Normalizar le ctx de Build Query, perde elegiveis. Precisa repensar.
  // SOLUCAO: Antifraude ainda exporta elegiveis, e Normalizar le elegiveis dela.
  // Reverter Normalizar para ler de Antifraude.
  if (norm) {
    const restore = (norm.parameters.jsCode || "").replace(
      /\$\('Code Build Query Mensal'\)/g,
      "$('Code Build Antifraude')",
    )
    norm.parameters.jsCode = restore
    console.log("  (revertido: Normalizar volta a ler de Code Build Antifraude — Antifraude exporta elegiveis)")
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
  console.log("✓ WF atualizado")
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
