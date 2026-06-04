#!/usr/bin/env node
/**
 * Pontual: espelha valores calculados no item original do Plan.
 *
 * Ponto de insercao: logo apos "Code in JavaScript8", antes de criar o
 * credito Caju. O update usa valores absolutos e depois restaura o JSON
 * original do Code8 para nao quebrar os nodes Caju seguintes.
 */

const OLD_KEY = process.env.N8N_ANTIGO_API_KEY

if (!OLD_KEY) {
  console.error("Defina N8N_ANTIGO_API_KEY antes de rodar.")
  process.exit(1)
}

const OLD_BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const WF_PONTUAL_OLD = "Bso4k6ddDNcRmU83"

async function n8n(base, key, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "X-N8N-API-KEY": key,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 800)}`)
  return text ? JSON.parse(text) : {}
}

function cleanPayload(wf) {
  const allowed = [
    "executionOrder",
    "saveDataErrorExecution",
    "saveDataSuccessExecution",
    "saveManualExecutions",
    "saveExecutionProgress",
    "timezone",
  ]
  const settings = {}
  for (const k of allowed) {
    if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k]
  }
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections || {},
    settings,
    staticData: wf.staticData,
  }
}

function upsertNode(wf, node) {
  wf.nodes = (wf.nodes || []).filter((n) => n.id !== node.id && n.name !== node.name)
  wf.nodes.push(node)
}

function findNode(wf, name) {
  const node = (wf.nodes || []).find((n) => n.name === name)
  if (!node) throw new Error(`Node nao encontrado: ${name}`)
  return node
}

async function patchPontualOld() {
  const wf = await n8n(OLD_BASE, OLD_KEY, "GET", `/workflows/${WF_PONTUAL_OLD}`)

  findNode(wf, "Code in JavaScript8")
  findNode(wf, "HTTP Request4")

  const preparar = {
    parameters: {
      jsCode: `const dados = $input.first().json || {};

function round2(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function inteiro(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const itemId = String(dados.itemId || dados.item_entrada_id || '').trim();
if (!itemId) {
  return [{
    json: {
      ...dados,
      _update_plan_beneficios: false,
      motivo_update_plan_beneficios: 'item_plan_ausente'
    }
  }];
}

const values = {
  n_meros0: String(round2(dados.vtDia)),              // VT - Diario
  vr___saldo: String(round2(dados.vrDia)),            // VR - Unitario
  numeric2: String(inteiro(dados.diasVT)),            // Dias Uteis/Mes - VT
  numeric21: String(inteiro(dados.diasVR)),           // Dias Uteis/Mes - VR
  numeric_mm0346q0: String(round2(dados.creditoVR)),  // CREDITO CAJU (VR)
  numeric_mm031cg7: String(round2(dados.creditoVT))   // CREDITO VT
};

const escaped = JSON.stringify(JSON.stringify(values));
const query = 'mutation { change_multiple_column_values(board_id: 18408773953, item_id: ' + itemId + ', column_values: ' + escaped + ', create_labels_if_missing: true) { id } }';

return [{
  json: {
    ...dados,
    _update_plan_beneficios: true,
    item_plan_beneficios_id: itemId,
    column_values_plan_beneficios: values,
    queryUpdatePlanBeneficios: query
  }
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [14384, 4080],
    id: "pontual-preparar-update-plan-beneficios",
    name: "Preparar Update Plan Beneficios",
  }

  const iff = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [
          {
            id: "tem-update-plan-beneficios",
            leftValue: "={{ $json._update_plan_beneficios === true && !!$json.queryUpdatePlanBeneficios }}",
            rightValue: true,
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [14592, 4080],
    id: "pontual-if-update-plan-beneficios",
    name: "Tem Update Plan Beneficios?",
  }

  const executar = {
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
      jsonBody: "={{ JSON.stringify({ query: $json.queryUpdatePlanBeneficios }) }}",
      options: {
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [14816, 3984],
    id: "pontual-executar-update-plan-beneficios",
    name: "Executar Update Plan Beneficios",
    credentials: {
      mondayComApi: {
        id: "QuX90go84pJaRueJ",
        name: "Monday.com account isaac",
      },
    },
  }

  const restaurar = {
    parameters: {
      jsCode: `const dados = $('Code in JavaScript8').first().json || {};

let updatePlanBeneficios = { skipped: true, motivo: 'nao_executado' };
try {
  const prep = $('Preparar Update Plan Beneficios').first().json || {};
  if (prep._update_plan_beneficios !== true) {
    updatePlanBeneficios = {
      skipped: true,
      motivo: prep.motivo_update_plan_beneficios || 'sem_update'
    };
  } else {
    const resp = $('Executar Update Plan Beneficios').first().json || {};
    updatePlanBeneficios = {
      skipped: false,
      ok: !Array.isArray(resp.errors),
      response: resp,
      item_id: prep.item_plan_beneficios_id,
      values: prep.column_values_plan_beneficios
    };
  }
} catch (e) {
  updatePlanBeneficios = {
    skipped: false,
    ok: false,
    erro: e.message || String(e)
  };
}

return [{ json: { ...dados, updatePlanBeneficios } }];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [15040, 4080],
    id: "pontual-restaurar-contexto-pos-update-plan",
    name: "Restaurar Contexto Pontual",
  }

  upsertNode(wf, preparar)
  upsertNode(wf, iff)
  upsertNode(wf, executar)
  upsertNode(wf, restaurar)

  wf.connections["Code in JavaScript8"] = {
    main: [[{ node: "Preparar Update Plan Beneficios", type: "main", index: 0 }]],
  }
  wf.connections["Preparar Update Plan Beneficios"] = {
    main: [[{ node: "Tem Update Plan Beneficios?", type: "main", index: 0 }]],
  }
  wf.connections["Tem Update Plan Beneficios?"] = {
    main: [
      [{ node: "Executar Update Plan Beneficios", type: "main", index: 0 }],
      [{ node: "Restaurar Contexto Pontual", type: "main", index: 0 }],
    ],
  }
  wf.connections["Executar Update Plan Beneficios"] = {
    main: [[{ node: "Restaurar Contexto Pontual", type: "main", index: 0 }]],
  }
  wf.connections["Restaurar Contexto Pontual"] = {
    main: [[{ node: "HTTP Request4", type: "main", index: 0 }]],
  }

  await n8n(OLD_BASE, OLD_KEY, "PUT", `/workflows/${WF_PONTUAL_OLD}`, cleanPayload(wf))
  console.log("OK Pontual antigo: valores de beneficio espelhados no Plan.")
}

patchPontualOld().catch((err) => {
  console.error(err)
  process.exit(1)
})
