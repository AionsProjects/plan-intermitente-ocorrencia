#!/usr/bin/env node
/**
 * Patch WF3 (Finalizar) — subitems do split no board FIXO de junho.
 *
 * Corrige o "Preparar Mutacao Subitems": os ids de coluna e o board_id eram de
 * MAIO (18408773966) hardcoded; em junho (subitem board 18413180938) só CONTRATO
 * e Qtd Faltas batiam → resto não preenchia. Agora:
 *   - ids de coluna = JUNHO
 *   - board_id do change_multiple_column_values = dinâmico (do subitem existente)
 *   - propaga Empregado Substituído + Insalubridade do item pai (Entrada)
 *
 * Mantém: fallback de split via Histórico (long_text_mm3m8k0m), partição por
 * data, agregados, idempotência (edita se subitem "Parte N" já existe).
 *
 * Uso:  N8N_API_KEY=<chave do n8n NOVO> node scripts/patch_wf3_subitems_junho.cjs
 */
const N8N_URL = process.env.N8N_API_URL || "https://aionscorp-n8n.cloudfy.live"
const N8N_KEY = process.env.N8N_API_KEY
const WF3_ID = process.env.WF3_ID || "rlxTk4VZLM2gTzx7"

if (!N8N_KEY) {
  console.error("Defina N8N_API_KEY (chave do n8n NOVO) antes de rodar.")
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

// ── Node "Preparar Subitems Split": query traz Empregado Substituído +
//    Insalubridade do pai e o board de cada subitem (p/ board_id dinâmico).
const PREPARAR_SUBITEMS_CODE = `const hist = $('Validar e preparar1').first().json;
let split = hist.split || null;

// Fallback: payload pode chegar com split=null por race condition do frontend.
// Recupera do item Histórico (coluna long_text_mm3m8k0m).
if (!split) {
  try {
    const all = $('Buscar por UUID1').all();
    let raw = null;
    for (const it of all) {
      const j = it.json;
      if (!j || !Array.isArray(j.column_values)) continue;
      const c = j.column_values.find((x) => x.id === 'long_text_mm3m8k0m');
      if (c?.text || c?.value) { raw = c.text || c.value; break; }
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

// Traz colunas do pai (Entrada) p/ propagar + board de cada subitem (board_id dinamico).
const querySubitems = \`query { items(ids: [\${hist.item_origem_id}]) { id column_values(ids: ["text_mktc23av","color_mktq63xa"]) { id text } subitems { id name board { id } } } }\`;
return [{ json: { _statusCode: 200, sem_split: false, split, querySubitems } }];`

// ── Node "Preparar Mutacao Subitems": ids de JUNHO + board dinamico + propagacao.
const PREPARAR_MUTACAO_CODE = `const hist = $('Validar e preparar1').first().json;
const prep = $('Preparar Subitems Split').first().json;
const split = prep.split || hist.split;
const parentId = hist.item_origem_id;
const resp = $json;
const parentItem = resp?.data?.items?.[0] || {};
const subitems = parentItem.subitems || [];

// Valores do pai p/ propagar (mesmo nas 2 partes).
const pcv = Array.isArray(parentItem.column_values) ? parentItem.column_values : [];
function pcol(id) { const c = pcv.find((x) => x.id === id); return c ? (c.text || '') : ''; }
const empregadoSubstituido = pcol('text_mktc23av');
const insalubridade = pcol('color_mktq63xa');

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function sideByDate(d) { return d < split.data_inicio_parte2 ? 1 : 2; }
function arr(v) { return Array.isArray(v) ? v : []; }
function filterDates(list, side) { return arr(list).filter((d) => typeof d === 'string' && sideByDate(d) === side); }
function filterRespostas(side) { return arr(hist.respostas).filter((r) => r?.data && sideByDate(r.data) === side); }
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
  const v = {
    "date_mm41xsnq": { date: inicio },
    "date_mm41drra": { date: fim },
    "color_mktqewwq": { label: contrato },
    "long_text_mm418z0z": longText(respostas),
    "numeric_mm3h1g0": String(ag.qtdFaltas),
    "numeric_mm413fsm": String(ag.qtdAtrasos),
    "numeric_mm41pnsy": String(ag.totalMin),
    "long_text_mm41971g": longText(filterDates(hist.dias_extras, part)),
    "long_text_mm41m5rv": longText(filterDates(hist.dias_desativados, part)),
    "long_text_mm412w8n": longText(filterDates(hist.sabados_extras_final, part)),
    "color_mm41xff4": { label: 'Concluido' }
  };
  if (empregadoSubstituido) v["text_mktq90cy"] = { text: empregadoSubstituido };
  if (insalubridade) v["color_mktqs6xg"] = { label: insalubridade };
  return v;
}
function existing(part) { const prefix = 'Parte ' + part; return subitems.find((s) => String(s.name || '').startsWith(prefix)); }
function mutationFor(alias, part) {
  const contrato = part === 1 ? split.contrato_parte1 : split.contrato_parte2;
  const name = 'Parte ' + part + ' - ' + contrato;
  const cv = JSON.stringify(JSON.stringify(valuesFor(part)));
  const ex = existing(part);
  if (ex?.id) {
    const boardId = ex.board?.id || 18413180938;
    return \`\${alias}: change_multiple_column_values(board_id: \${boardId}, item_id: \${ex.id}, column_values: \${cv}, create_labels_if_missing: true) { id }\`;
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
