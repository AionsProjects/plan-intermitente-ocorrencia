#!/usr/bin/env node
/**
 * Patch WF3 (Finalizar) "Preparar Subitems Split" e
 * "Preparar Mutacao Subitems" para usar split persistido na Entrada como
 * fallback quando o payload do finalize chega com split=null (race
 * condition do frontend: Aplicar Split invalida o cache mas usuario
 * pode clicar Finalizar antes do refetch do WF2 resolver).
 */
const N8N_URL = process.env.N8N_API_URL || "https://aionscorp-n8n.cloudfy.live"
const N8N_KEY = process.env.N8N_API_KEY
const WF3_ID = process.env.WF3_ID || "rlxTk4VZLM2gTzx7"

if (!N8N_KEY) {
  console.error("Defina N8N_API_KEY antes de rodar.")
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
  if (!res.ok) throw new Error(`${options.method || "GET"} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const PREPARAR_SUBITEMS_CODE = `const hist = $('Validar e preparar1').first().json;
let split = hist.split || null;

// Fallback: payload pode chegar com split=null por race condition do
// frontend (mutation invalida cache mas Finalizar pode disparar antes
// do refetch do WF2). Tenta recuperar do próprio item Histórico (coluna
// nova long_text_mm3m8k0m), que é onde Aplicar Split escreve depois da
// migração Entrada→Histórico.
if (!split) {
  try {
    // Re-lê o item Histórico vindo de 'Buscar por UUID1' (monday getByColumnValue).
    const all = $('Buscar por UUID1').all();
    let raw = null;
    for (const it of all) {
      const j = it.json;
      if (!j || !Array.isArray(j.column_values)) continue;
      const c = j.column_values.find((x) => x.id === 'long_text_mm3m8k0m');
      if (c?.text || c?.value) {
        raw = c.text || c.value;
        break;
      }
    }
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && parsed.data_inicio_parte2 && parsed.contrato_parte1 && parsed.contrato_parte2) {
        split = {
          data_inicio_parte2: String(parsed.data_inicio_parte2),
          contrato_parte1: String(parsed.contrato_parte1),
          contrato_parte2: String(parsed.contrato_parte2),
        };
      }
    }
  } catch (e) {}
}

if (!split || !split.data_inicio_parte2) {
  return [{ json: { _statusCode: 200, sem_split: true } }];
}
if (!hist.item_origem_id) {
  return [{ json: { _statusCode: 409, _erro: 'entrada_nao_vinculada', mensagem: 'Nao foi possivel localizar o item de Entrada para criar subitems do split.' } }];
}

const querySubitems = \`query { items(ids: [\${hist.item_origem_id}]) { id subitems { id name } } }\`;
return [{ json: { _statusCode: 200, sem_split: false, split, querySubitems } }];`

const PREPARAR_MUTACAO_CODE = `const hist = $('Validar e preparar1').first().json;
// Fonte do split: prioriza output de "Preparar Subitems Split" (que
// ja inclui fallback via Entrada). Cai pra hist.split como compat.
const prep = $('Preparar Subitems Split').first().json;
const split = prep.split || hist.split;
const parentId = hist.item_origem_id;
const resp = $json;
const subitems = resp?.data?.items?.[0]?.subitems || [];

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function sideByDate(d) { return d < split.data_inicio_parte2 ? 1 : 2; }
function arr(v) { return Array.isArray(v) ? v : []; }
function filterDates(list, side) {
  return arr(list).filter((d) => typeof d === 'string' && sideByDate(d) === side);
}
function filterRespostas(side) {
  return arr(hist.respostas).filter((r) => r?.data && sideByDate(r.data) === side);
}
function agregados(respostas) {
  return {
    qtdFaltas: respostas.filter((r) => r.tipo === 'falta').length,
    qtdAtrasos: respostas.filter((r) => r.tipo === 'atraso').length,
    totalMin: respostas.reduce((acc, r) => acc + (r.tipo === 'atraso' ? Number(r.minutos_atraso || 0) : 0), 0)
  };
}
function longText(value) { return { text: JSON.stringify(value) }; }
function valuesFor(part) {
  const respostas = filterRespostas(part);
  const ag = agregados(respostas);
  const contrato = part === 1 ? split.contrato_parte1 : split.contrato_parte2;
  const inicio = part === 1 ? hist.data_inicio : split.data_inicio_parte2;
  const fim = part === 1 ? addDays(split.data_inicio_parte2, -1) : hist.data_fim;
  return {
    "date_mm3hayv0": { date: inicio },
    "date_mm3hs0er": { date: fim },
    "color_mktqewwq": { label: contrato },
    "long_text_mm3h1qva": longText(respostas),
    "numeric_mm3h1g0": String(ag.qtdFaltas),
    "numeric_mm3h88rd": String(ag.qtdAtrasos),
    "numeric_mm3h7syh": String(ag.totalMin),
    "long_text_mm3hpvmh": longText(filterDates(hist.dias_extras, part)),
    "long_text_mm3hsg83": longText(filterDates(hist.dias_desativados, part)),
    "long_text_mm3hgp6y": longText(filterDates(hist.sabados_extras_final, part)),
    "color_mm3hqr6c": { label: 'Concluido' }
  };
}
function existing(part) {
  const prefix = 'Parte ' + part;
  return subitems.find((s) => String(s.name || '').startsWith(prefix));
}
function mutationFor(alias, part) {
  const contrato = part === 1 ? split.contrato_parte1 : split.contrato_parte2;
  const name = 'Parte ' + part + ' - ' + contrato;
  const cv = JSON.stringify(JSON.stringify(valuesFor(part)));
  const ex = existing(part);
  if (ex?.id) {
    return \`\${alias}: change_multiple_column_values(board_id: 18408773966, item_id: \${ex.id}, column_values: \${cv}, create_labels_if_missing: true) { id }\`;
  }
  return \`\${alias}: create_subitem(parent_item_id: \${parentId}, item_name: \${JSON.stringify(name)}, column_values: \${cv}, create_labels_if_missing: true) { id }\`;
}

const mutationSubitems = 'mutation { ' + mutationFor('p1', 1) + ' ' + mutationFor('p2', 2) + ' }';
return [{ json: { _statusCode: 200, mutationSubitems } }];`

;(async () => {
  const wf = await n8n(`/api/v1/workflows/${WF3_ID}`)
  let mudou = 0
  for (const node of wf.nodes) {
    if (node.name === "Preparar Subitems Split") {
      node.parameters = { ...node.parameters, jsCode: PREPARAR_SUBITEMS_CODE }
      mudou++
    }
    if (node.name === "Preparar Mutacao Subitems") {
      node.parameters = { ...node.parameters, jsCode: PREPARAR_MUTACAO_CODE }
      mudou++
    }
  }
  if (mudou !== 2) {
    console.error(`Esperava patchar 2 nodes, patchou ${mudou}. Abortando.`)
    process.exit(1)
  }
  // n8n PUT aceita apenas propriedades específicas em settings — copia campos válidos.
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
  for (const k of allowedSettings) {
    if (raw[k] !== undefined) settings[k] = raw[k]
  }
  if (settings.executionOrder === undefined) settings.executionOrder = "v1"
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings,
  }
  await n8n(`/api/v1/workflows/${WF3_ID}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
  await n8n(`/api/v1/workflows/${WF3_ID}`, { method: "PUT", body: JSON.stringify(body) })
  await n8n(`/api/v1/workflows/${WF3_ID}/activate`, { method: "POST", body: "{}" })
  console.log(`WF3 ${WF3_ID} patchado e reativado. (${mudou} nodes)`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
