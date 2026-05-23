#!/usr/bin/env node
/**
 * Patch WF "Intermitente - Aplicar Split (monday)" (ZagUa2yuP6BsAE9i)
 * para escrever Split JSON no board Histórico em vez do board Entrada.
 *
 * Antes: change_simple_column_value(board=Entrada, column=long_text_mm3hgsph)
 * Depois: change_simple_column_value(board=Histórico, column=long_text_mm3m8k0m)
 *
 * Histórico item já é resolvido pela query inicial via UUID, então só precisa
 * usar `item.id` em vez de extrair `pulses/(\d+)` do link da Entrada.
 */
const N8N_URL = process.env.N8N_API_URL || "https://aionscorp-n8n.cloudfy.live"
const N8N_KEY = process.env.N8N_API_KEY
const WF_ID = process.env.WF_APLICAR_SPLIT_ID || "ZagUa2yuP6BsAE9i"
const COL_HIST = process.env.SPLIT_COL_HIST || "long_text_mm3m8k0m"
const BOARD_HISTORICO = 18411141462

if (!N8N_KEY) {
  console.error("Defina N8N_API_KEY.")
  process.exit(1)
}

async function n8n(path, options = {}) {
  const res = await fetch(`${N8N_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "X-N8N-API-KEY": N8N_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  })
  const text = await res.text()
  if (!res.ok)
    throw new Error(`${options.method || "GET"} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const PREPARAR_MUTATION_CODE = `const prep = $('Validar payload').first().json;
if (prep._erro) return [{ json: { ...prep, mutation: 'query { me { id } }' } }];

const resp = $json;
const item = resp?.data?.items_page_by_column_values?.items?.[0];
if (!item) return [{ json: { ...prep, _statusCode: 404, _erro: 'historico_nao_encontrado', mensagem: 'Historico nao encontrado para o uuid informado.', mutation: 'query { me { id } }' } }];

// Split JSON agora vive no proprio Historico (column ${COL_HIST}). Nao
// precisa mais extrair item_entrada_id do link — escreve direto no item
// Historico via item.id.
const itemHistoricoId = String(item.id);

const value = prep.tipo === 'reverter' ? '' : JSON.stringify(prep.split);
const mutation = \`mutation {
  change_simple_column_value(
    board_id: ${BOARD_HISTORICO},
    item_id: \${itemHistoricoId},
    column_id: "${COL_HIST}",
    value: \${JSON.stringify(value)}
  ) { id }
}\`;
return [{ json: { ...prep, item_historico_id: itemHistoricoId, mutation } }];`

const ALLOWED_SETTINGS = [
  "saveExecutionProgress",
  "saveManualExecutions",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "executionOrder",
]

;(async () => {
  const wf = await n8n(`/api/v1/workflows/${WF_ID}`)
  let mudou = 0
  for (const node of wf.nodes) {
    if (node.name === "Preparar mutation") {
      node.parameters = { ...node.parameters, jsCode: PREPARAR_MUTATION_CODE }
      mudou++
    }
  }
  if (mudou !== 1) {
    console.error(`Esperava patchar 1 node, patchou ${mudou}. Abortando.`)
    process.exit(1)
  }
  const settings = {}
  const raw = wf.settings || {}
  for (const k of ALLOWED_SETTINGS) if (raw[k] !== undefined) settings[k] = raw[k]
  if (settings.executionOrder === undefined) settings.executionOrder = "v1"

  await n8n(`/api/v1/workflows/${WF_ID}/deactivate`, {
    method: "POST",
    body: "{}",
  }).catch(() => null)
  await n8n(`/api/v1/workflows/${WF_ID}`, {
    method: "PUT",
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings,
    }),
  })
  await n8n(`/api/v1/workflows/${WF_ID}/activate`, {
    method: "POST",
    body: "{}",
  })
  console.log(
    `WF Aplicar Split ${WF_ID} patchado e reativado. Coluna alvo: ${COL_HIST}`,
  )
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
