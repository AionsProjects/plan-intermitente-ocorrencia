#!/usr/bin/env node
/**
 * Patch WF2 "Intermitente 2. Ler (monday)" (WHtIQDf8oOWinGyx):
 *
 * 1. "Moldar resposta": Split JSON agora vem direto do Histórico (coluna
 *    nova `long_text_mm3m8k0m`); a query secundária na Entrada passa a
 *    pedir `date_mm3b88ta` + `color_mm3a8ana` (cancelamento).
 *
 * 2. "Anexar Split" → renomeado conceitualmente "Anexar Entrada Extras":
 *    extrai `data_inicio_cancelamento` + `status_cancelamento` da Entrada,
 *    além do CPF e chapa que já extraía. Split parsing sai daqui (já
 *    resolvido em Moldar).
 *
 * Side-effect: depois deste patch, frontend recebe `data_inicio_cancelamento`
 * e `status_cancelamento` no payload do WF2 — destrava render do tile
 * cancelado em /preencher e /corrigir.
 */
const N8N_URL = process.env.N8N_API_URL || "https://aionscorp-n8n.cloudfy.live"
const N8N_KEY = process.env.N8N_API_KEY
const WF_ID = process.env.WF2_ID || "WHtIQDf8oOWinGyx"
const COL_SPLIT_HIST = process.env.SPLIT_COL_HIST || "long_text_mm3m8k0m"

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

// Código novo para "Moldar resposta" — substitui a query secundária pra
// passar a buscar colunas de cancelamento na Entrada, e parseia o Split
// direto do Histórico.
const MOLDAR_CODE = `// ==============================================================
// WF2 - Ler (monday) — pós-migração Split JSON pro Histórico.
// Devolve dados do Histórico + extra (cancelamento) buscado na Entrada
// via etapa secundária. Split JSON agora lido do Histórico direto.
// ==============================================================

const COL_UUID         = 'text_mm2xjend';
const COL_PROTOCOLO    = 'text_mm2xsvg6';
const COL_CONTRATO     = 'text_mm2x1ktb';
const COL_DATA_INICIO  = 'date_mm2xtp93';
const COL_DATA_FIM     = 'date_mm2xrr5q';
const COL_EXPIRA_EM    = 'date_mm2xrvt4';
const COL_CONCLUIDO    = 'date_mm2xh1vm';
const COL_EDITADO_EM   = 'date_mm2x62fq';
const COL_STATUS       = 'color_mm2xkqpc';
const COL_EDITADO      = 'boolean_mm2x1aa4';
const COL_DIAS_EXTRAS  = 'long_text_mm2x73w6';
const COL_DIAS_DESATIV = 'long_text_mm2xm820';
const COL_RESPOSTAS    = 'long_text_mm2xtcpw';
const COL_TOTAL_MIN_DEVIDOS = 'numeric_mm3455ss';
const COL_DIAS_PERDE_VT     = 'numeric_mm345xb6';
const COL_DIAS_PERDE_VR     = 'numeric_mm34a3ph';
const COL_OPTANTE_VT        = 'color_mm34ry47';
const COL_TRABALHA_SAB      = 'color_mm34yyet';
const COL_SABADOS_EX_QTD    = 'numeric_mm3bvgy';
const COL_SABADOS_EX_TXT    = 'text_mm3bfn6h';
const COL_ATESTADOS_JSON    = 'long_text_mm3cp43g';
const COL_BENEF_LEDGER      = 'long_text_mm3ct3hg';
const COL_QTD_ATESTADOS     = 'numeric_mm3c4cse';
const COL_ITEM_ORIGEM       = 'link_mm2x1rk0';
// Split JSON migrou para o Histórico (a coluna no Entrada virou legacy).
const COL_SPLIT_JSON_HIST   = '${COL_SPLIT_HIST}';

const all = $input.all();
const uuid = $('Webhook').first().json.query?.uuid;

function firstRealItem() {
  for (const it of all) {
    const j = it.json;
    if (!j) continue;
    if (j.id && (j.column_values || j.name)) return j;
  }
  return null;
}

const item = firstRealItem();
if (!item) {
  return [{ json: { _statusCode: 404, erro: 'nao_encontrado', mensagem: 'Link invalido ou expirado.' } }];
}

const columnValues = item.column_values ?? [];
const getCol = (id) => columnValues.find(c => c.id === id) || null;
const text = (id) => getCol(id)?.text ?? null;
const rawValue = (id) => getCol(id)?.value ?? null;

function parseDate(id) { return text(id) || null; }
function parseCheckbox(id) {
  const v = rawValue(id);
  if (!v) return false;
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return parsed?.checked === true || parsed?.checked === 'true';
  } catch { return false; }
}
function parseLongTextJson(id, fallback) {
  const t = text(id);
  if (!t) return fallback;
  try { return JSON.parse(t); } catch { return fallback; }
}
function parseNumber(id) {
  const t = text(id);
  if (t === null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function extrairItemOrigemId() {
  const link = getCol(COL_ITEM_ORIGEM);
  if (!link) return null;
  let url = null;
  if (link.value) {
    try { url = (typeof link.value === 'string' ? JSON.parse(link.value) : link.value)?.url || null; } catch {}
  }
  if (!url) url = link.text || null;
  const m = String(url || '').match(/pulses\\/(\\d+)/);
  return m ? m[1] : null;
}
function parseSplit(raw) {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.data_inicio_parte2 || !parsed.contrato_parte1 || !parsed.contrato_parte2) return null;
  return {
    data_inicio_parte2: String(parsed.data_inicio_parte2),
    contrato_parte1: String(parsed.contrato_parte1),
    contrato_parte2: String(parsed.contrato_parte2)
  };
}

const dataInicio = parseDate(COL_DATA_INICIO);
const dataFim = parseDate(COL_DATA_FIM);
const statusLabel = text(COL_STATUS);
const statusMap = {
  'Aguardando': 'aguardando',
  'Concluído': 'concluido',
  'Concluido': 'concluido',
  'Expirado': 'expirado'
};
let status = statusMap[statusLabel] || 'aguardando';

const expiraEm = parseDate(COL_EXPIRA_EM);
const agora = new Date();
if (status === 'aguardando' && expiraEm && agora > new Date(expiraEm + 'T23:59:59Z')) {
  status = 'expirado';
}

const incluiSabado = String(text(COL_TRABALHA_SAB) || '').toUpperCase() === 'SIM';
const dias = [];
if (dataInicio && dataFim) {
  const cur = new Date(dataInicio + 'T00:00:00Z');
  const fim = new Date(dataFim + 'T00:00:00Z');
  while (cur <= fim) {
    const dow = cur.getUTCDay();
    const ehDomingo = dow === 0;
    const ehSabado = dow === 6;
    if (!ehDomingo && (!ehSabado || incluiSabado)) dias.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

const respostas = parseLongTextJson(COL_RESPOSTAS, []);
const diasExtras = parseLongTextJson(COL_DIAS_EXTRAS, []);
const diasDesativ = parseLongTextJson(COL_DIAS_DESATIV, []);
const atestados = parseLongTextJson(COL_ATESTADOS_JSON, []);
const beneficiosDescontados = parseLongTextJson(COL_BENEF_LEDGER, {});

const sabadosExTxt = text(COL_SABADOS_EX_TXT);
const sabadosExtras = sabadosExTxt
  ? sabadosExTxt.split(/[,;\\n]/).map(s => s.trim()).filter(s => /^\\d{4}-\\d{2}-\\d{2}$/.test(s))
  : [];

const pontosFacultativos = [];
if (beneficiosDescontados && typeof beneficiosDescontados === 'object') {
  for (const [data, entry] of Object.entries(beneficiosDescontados)) {
    const origens = Array.isArray(entry?.origens) ? entry.origens : [];
    const origem = origens.find(o => String(o).startsWith('ponto_facultativo:'));
    if (!origem) continue;
    const beneficios = [];
    const vrPct = Number(entry?.vr_percentual || 0);
    const vtPct = Number(entry?.vt_percentual || 0);
    if (entry?.vr === true || vrPct > 0) beneficios.push('VR');
    if (entry?.vt === true || vtPct > 0) beneficios.push('VT');
    pontosFacultativos.push({
      data,
      origem,
      contrato: String(origem).split(':')[1] || text(COL_CONTRATO),
      beneficios,
      valor_vr: 0,
      valor_vt: 0
    });
  }
}

// Split JSON: tenta ler do snapshot do mondayCom node, mas se vier vazio
// (node legado às vezes não pega colunas recém-criadas) deixa null aqui —
// a query secundária re-busca via HTTP direto e Anexar Entrada Extras
// preenche.
const split = parseSplit(text(COL_SPLIT_JSON_HIST));

const itemOrigemId = extrairItemOrigemId();
const itemHistoricoId = String(item.id);
// Query secundária faz dois fetches num shot:
//   entrada: cancelamento (date_mm3b88ta) + status (color_mm3a8ana) +
//            CPF/chapa (pra atestados).
//   historico: Split JSON (long_text_mm3m8k0m) — workaround pro mondayCom
//              node que às vezes não devolve colunas recém-criadas.
const queryEntradaExtras = itemOrigemId ? \`query {
  entrada: items(ids: [\${itemOrigemId}]) { id column_values(ids: ["date_mm3b88ta", "color_mm3a8ana", "dup__of_matr_cula", "texto"]) { id text value } }
  historico: items(ids: [\${itemHistoricoId}]) { id column_values(ids: ["${COL_SPLIT_HIST}"]) { id text value } }
}\` : null;

return [{
  json: {
    _statusCode: 200,
    uuid: text(COL_UUID) || uuid,
    item_origem_id: itemOrigemId,
    query_entrada_split: queryEntradaExtras,
    split,
    data_inicio_cancelamento: null,
    status_cancelamento: null,
    status,
    nome: item.name,
    contrato: text(COL_CONTRATO),
    data_inicio: dataInicio,
    data_fim: dataFim,
    dias,
    expira_em: expiraEm,
    concluido_em: parseDate(COL_CONCLUIDO),
    protocolo: text(COL_PROTOCOLO),
    editado: parseCheckbox(COL_EDITADO),
    editado_em: parseDate(COL_EDITADO_EM),
    respostas,
    dias_extras: diasExtras,
    dias_desativados: diasDesativ,
    total_min_devidos: parseNumber(COL_TOTAL_MIN_DEVIDOS),
    dias_perde_vt: parseNumber(COL_DIAS_PERDE_VT),
    dias_perde_vr: parseNumber(COL_DIAS_PERDE_VR),
    optante_vt: text(COL_OPTANTE_VT) || 'NAO',
    trabalha_sabado: text(COL_TRABALHA_SAB) || 'NAO',
    sabados_extras: sabadosExtras,
    qtd_sabados_extras: parseNumber(COL_SABADOS_EX_QTD) || sabadosExtras.length,
    atestados,
    qtd_atestados: parseNumber(COL_QTD_ATESTADOS) || atestados.length,
    beneficios_descontados: beneficiosDescontados,
    pontos_facultativos: pontosFacultativos
  }
}];`

// Código novo para "Anexar Split" → renomeado conceitualmente para
// "Anexar Entrada Extras" — extrai cancelamento da Entrada + Split do
// Histórico (a query secundária pega ambos num shot com aliases).
const ANEXAR_CODE = `const base = $('Moldar resposta').first().json;
const resp = $json;

function onlyDigits(v) { return String(v || '').replace(/\\D+/g, ''); }
function normalizaStatusCancelamento(label) {
  if (!label) return null;
  const norm = String(label).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();
  if (norm.includes('PARCIAL')) return 'cancelada_parcial';
  if (norm.includes('CANCEL')) return 'cancelada';
  if (norm.includes('BLOQUE')) return 'bloqueada';
  return 'valida';
}
function parseSplit(raw) {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.data_inicio_parte2 || !parsed.contrato_parte1 || !parsed.contrato_parte2) return null;
  return {
    data_inicio_parte2: String(parsed.data_inicio_parte2),
    contrato_parte1: String(parsed.contrato_parte1),
    contrato_parte2: String(parsed.contrato_parte2)
  };
}

// Alias 'entrada' = item Entrada (cancelamento, cpf, chapa).
const entradaCols = resp?.data?.entrada?.[0]?.column_values || [];
const get = (id) => entradaCols.find(c => c.id === id) || null;
const dataInicioCancelamento = get('date_mm3b88ta')?.text || null;
const statusConvocacaoLabel = get('color_mm3a8ana')?.text || null;
const statusCancelamento = normalizaStatusCancelamento(statusConvocacaoLabel);
const cpf = onlyDigits(get('dup__of_matr_cula')?.text || get('dup__of_matr_cula')?.value || '');
const chapa = String(get('texto')?.text || '').trim();

// Alias 'historico' = item Histórico (Split JSON — coluna nova).
const histCols = resp?.data?.historico?.[0]?.column_values || [];
const splitCol = histCols.find(c => c.id === '${COL_SPLIT_HIST}');
const splitFromHist = parseSplit(splitCol?.text || splitCol?.value);
const split = base.split || splitFromHist || null;

const queryControleAtestados = cpf
  ? 'query { items_page_by_column_values(board_id: 18298015951, columns: [{ column_id: "text_mm3j4nt3", column_values: ["' + cpf + '"] }], limit: 100) { items { id name column_values { id text value column { title } } } } }'
  : null;

return [{
  json: {
    ...base,
    split,
    data_inicio_cancelamento: dataInicioCancelamento,
    status_cancelamento: statusCancelamento,
    cpf_colaborador: cpf || null,
    chapa_colaborador: chapa || null,
    query_controle_atestados: queryControleAtestados
  }
}];`

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
    if (node.name === "Moldar resposta") {
      node.parameters = { ...node.parameters, jsCode: MOLDAR_CODE }
      mudou++
    }
    if (node.name === "Anexar Split") {
      node.parameters = { ...node.parameters, jsCode: ANEXAR_CODE }
      mudou++
    }
  }
  if (mudou !== 2) {
    console.error(`Esperava patchar 2 nodes, patchou ${mudou}. Abortando.`)
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
  console.log(`WF2 ${WF_ID} patchado e reativado. Split lido do Histórico (${COL_SPLIT_HIST}); cancelamento lido da Entrada.`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
