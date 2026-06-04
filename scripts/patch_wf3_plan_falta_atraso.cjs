const WF3_ID = "rlxTk4VZLM2gTzx7"

const API_URL = (process.env.N8N_API_URL || "https://aionscorp-n8n.cloudfy.live").replace(/\/$/, "")
const API_KEY = process.env.N8N_API_KEY

if (!API_KEY) {
  console.error("Defina N8N_API_KEY antes de rodar.")
  process.exit(1)
}

async function n8n(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
  }
  return text ? JSON.parse(text) : {}
}

const PREPARAR_PLAN_CODE = `// ==============================================================
// WF3 - Preparar atualização do Plan de Intermitentes
// Espelha os agregados finais do registro manual no item de origem:
//   - numeric = quantidade de faltas
//   - texto5  = total de minutos de atraso
// Idempotente: sobrescreve valores absolutos, nunca soma com valor antigo.
// ==============================================================

const state = $('Validar e preparar1').first().json || {};
const itemOrigemId = state.item_origem_id ? String(state.item_origem_id) : '';

const qtdFaltas = Number(state.qtd_faltas || 0) || 0;
const totalMinAtraso = Number(state.total_min_atraso ?? state.total_min ?? 0) || 0;

if (!itemOrigemId) {
  return [{
    json: {
      ...$json,
      _skip_plan_update: true,
      warning_plan_update: 'item_origem_id_ausente'
    }
  }];
}

const columnValues = {
  numeric: String(qtdFaltas),
  texto5: String(totalMinAtraso)
};

return [{
  json: {
    ...$json,
    _skip_plan_update: false,
    plan_item_id: itemOrigemId,
    plan_column_values_json: JSON.stringify(columnValues),
    plan_faltas: qtdFaltas,
    plan_minutos_atraso: totalMinAtraso
  }
}];`

function codeNode(name, position, jsCode) {
  return {
    parameters: { jsCode },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    id: "wf3-plan-preparar-atualizacao",
    name,
  }
}

function ifNode(name, position) {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: "tem-item-plan",
            leftValue: "={{ !$json._skip_plan_update && !!$json.plan_item_id }}",
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "true",
              singleValue: true,
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    id: "wf3-plan-tem-item",
    name,
  }
}

function mondayUpdateNode(name, position) {
  return {
    parameters: {
      resource: "boardItem",
      operation: "changeMultipleColumnValues",
      boardId: 18408773953,
      itemId: "={{ $json.plan_item_id }}",
      columnValues: "={{ $json.plan_column_values_json }}",
    },
    type: "n8n-nodes-base.mondayCom",
    typeVersion: 1,
    position,
    id: "wf3-plan-atualizar-falta-atraso",
    name,
    credentials: {
      mondayComApi: {
        id: "6I0ycSr6PQJkBYpc",
        name: "Ray0",
      },
    },
  }
}

function conn(node, index = 0) {
  return { node, type: "main", index }
}

function sameTarget(a, b) {
  return a && b && a.node === b.node && a.type === b.type && a.index === b.index
}

function uniqueTargets(targets) {
  const out = []
  for (const target of targets || []) {
    if (!out.some((x) => sameTarget(x, target))) out.push(target)
  }
  return out
}

function getMainTargets(workflow, nodeName, outputIndex = 0) {
  return workflow.connections?.[nodeName]?.main?.[outputIndex] || []
}

function setMainTargets(workflow, nodeName, outputs) {
  workflow.connections[nodeName] = { main: outputs }
}

function stripReadOnlyWorkflowFields(wf) {
  const allowedSettings = [
    "saveExecutionProgress",
    "saveManualExecutions",
    "saveDataErrorExecution",
    "saveDataSuccessExecution",
    "executionTimeout",
    "errorWorkflow",
    "timezone",
    "executionOrder",
  ]
  const settings = {}
  const raw = wf.settings || {}
  for (const key of allowedSettings) {
    if (raw[key] !== undefined) settings[key] = raw[key]
  }
  if (settings.executionOrder === undefined) settings.executionOrder = "v1"
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings,
  }
}

function upsertNode(workflow, node) {
  const idx = workflow.nodes.findIndex((n) => n.name === node.name)
  if (idx >= 0) workflow.nodes[idx] = { ...workflow.nodes[idx], ...node }
  else workflow.nodes.push(node)
}

;(async () => {
  const wf = await n8n(`/api/v1/workflows/${WF3_ID}`)
  const wasActive = !!wf.active

  const prepararName = "Preparar Atualizacao Plan"
  const ifName = "Tem Item Plan?"
  const updateName = "Atualizar Plan Falta/Atraso"

  const patchedTarget = conn(prepararName)
  let originalTargets = getMainTargets(wf, "Atualizar item1")

  if (originalTargets.length === 1 && sameTarget(originalTargets[0], patchedTarget)) {
    originalTargets = [
      ...getMainTargets(wf, updateName, 0),
      ...getMainTargets(wf, ifName, 1),
    ]
  }

  originalTargets = uniqueTargets(
    originalTargets.filter((target) => target.node !== prepararName && target.node !== ifName && target.node !== updateName),
  )

  if (originalTargets.length === 0) {
    throw new Error("Não consegui descobrir os destinos originais de 'Atualizar item1'. Abortando.")
  }

  upsertNode(wf, codeNode(prepararName, [36720, 20960], PREPARAR_PLAN_CODE))
  upsertNode(wf, ifNode(ifName, [36928, 20960]))
  upsertNode(wf, mondayUpdateNode(updateName, [37136, 20960]))

  wf.connections = wf.connections || {}
  setMainTargets(wf, "Atualizar item1", [[patchedTarget]])
  setMainTargets(wf, prepararName, [[conn(ifName)]])
  setMainTargets(wf, ifName, [[conn(updateName)], originalTargets])
  setMainTargets(wf, updateName, [originalTargets])

  const body = stripReadOnlyWorkflowFields(wf)

  if (wasActive) await n8n(`/api/v1/workflows/${WF3_ID}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
  await n8n(`/api/v1/workflows/${WF3_ID}`, { method: "PUT", body: JSON.stringify(body) })
  if (wasActive) await n8n(`/api/v1/workflows/${WF3_ID}/activate`, { method: "POST", body: "{}" })

  console.log(`WF3 ${WF3_ID} atualizado: ${prepararName} -> ${ifName} -> ${updateName}`)
  console.log(`Destinos preservados: ${originalTargets.map((t) => t.node).join(", ")}`)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
