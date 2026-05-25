#!/usr/bin/env node
/**
 * Patcha WF "Ponto Facultativo — Opcoes" (id JXpJ6xuSZMcu2IVn) no n8n NOVO:
 * - Adiciona node HTTP "Buscar Items Convocacoes" (Monday GraphQL items_page)
 *   entre "Buscar Unidades RM" e "Moldar resposta"
 * - Reescreve "Moldar resposta" pra agregar items por (contrato, unidade)
 *   filtrando mês corrente + status nao-cancelado
 * - Retorno passa a ser unidades_por_contrato: { contrato: [{ label, qtd_intermitentes }] }
 *
 * Uso: node scripts/patch_wf_ponto_facultativo_opcoes.cjs <N8N_NOVO_TOKEN>
 */

const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/patch_wf_ponto_facultativo_opcoes.cjs <N8N_NOVO_TOKEN>")
  process.exit(1)
}

const WF_ID = "JXpJ6xuSZMcu2IVn"
const BASE = "https://aionscorp-n8n.cloudfy.live/api/v1"
const MONDAY_CRED_ID = "6I0ycSr6PQJkBYpc"

const MONDAY_QUERY_JSONBODY =
  '={{ JSON.stringify({ query: `query { boards(ids:[18408773953]) { items_page(limit: 500) { cursor items { id column_values(ids:[\\"color_mktcnxwn\\", \\"dropdown_mm3mcnmn\\", \\"texto75\\", \\"date_mktayxhb\\", \\"date_mktasnwq\\", \\"color_mm3a8ana\\"]) { id text } } } } }` }) }}'

const NOVO_BUSCAR_ITEMS = {
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
    jsonBody: MONDAY_QUERY_JSONBODY,
    options: { response: { response: { neverError: true } } },
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [480, 0],
  id: "pf-opcoes-items",
  name: "Buscar Items Convocacoes",
  credentials: {
    mondayComApi: { id: MONDAY_CRED_ID, name: "Ray0" },
  },
}

const NOVO_MOLDAR_CODE = `
const ALLOWED = ['SEMSA','SEDUC ESCOLA','SEDUC SEDE','SEDUC INTERIOR','DETRAN','TRE PB','CETAM'];
const STATUS_BLOQUEADOS = new Set(['cancelada','cancelada parcialmente','bloqueada','bloqueada - conflito']);

const respRM = $('Buscar Unidades RM').first().json;
const respMonday = $('Buscar Items Convocacoes').first().json;

if (!respRM?.ok || !respRM?.unidades_por_contrato) {
  return [{ json: { _statusCode: 502, ok: false, erro: 'unidades_rm_indisponiveis', mensagem: 'Nao foi possivel carregar as unidades oficiais do RM.', detalhe: respRM } }];
}

const hoje = new Date();
const primeiroDiaMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
const ultimoDiaMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0));
const PRIMEIRO_ISO = primeiroDiaMes.toISOString().slice(0,10);
const ULTIMO_ISO = ultimoDiaMes.toISOString().slice(0,10);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').replace(/\\s+/g,' ').trim();
}

const contagens = {};
for (const c of ALLOWED) contagens[c] = {};

const items = respMonday?.data?.boards?.[0]?.items_page?.items || [];
for (const item of items) {
  const cv = Object.fromEntries((item.column_values || []).map(c => [c.id, c.text]));
  const contrato = (cv['color_mktcnxwn'] || '').trim();
  if (!ALLOWED.includes(contrato)) continue;
  const status = String(cv['color_mm3a8ana'] || '').toLowerCase().trim();
  if (STATUS_BLOQUEADOS.has(status)) continue;
  const dataIni = (cv['date_mktayxhb'] || '').slice(0,10);
  const dataFim = (cv['date_mktasnwq'] || '').slice(0,10);
  if (!dataIni || !dataFim) continue;
  if (dataIni > ULTIMO_ISO) continue;
  if (dataFim < PRIMEIRO_ISO) continue;
  const unidade = cv['dropdown_mm3mcnmn'] || cv['texto75'] || '';
  if (!unidade) continue;
  contagens[contrato][unidade] = (contagens[contrato][unidade] || 0) + 1;
}

const unidades_por_contrato = {};
for (const c of ALLOWED) {
  const lista = Array.isArray(respRM.unidades_por_contrato?.[c]) ? respRM.unidades_por_contrato[c] : [];
  const contagensDoContrato = contagens[c] || {};
  const contagensNorm = {};
  for (const [lbl, qtd] of Object.entries(contagensDoContrato)) {
    contagensNorm[norm(lbl)] = (contagensNorm[norm(lbl)] || 0) + qtd;
  }
  const unidadesArr = lista.map(label => ({
    label,
    qtd_intermitentes: contagensNorm[norm(label)] || 0,
  }));
  const labelsCanonNorm = new Set(lista.map(l => norm(l)));
  for (const [lbl, qtd] of Object.entries(contagensDoContrato)) {
    if (!labelsCanonNorm.has(norm(lbl))) {
      unidadesArr.push({ label: lbl, qtd_intermitentes: qtd, _fora_rm: true });
    }
  }
  unidades_por_contrato[c] = unidadesArr;
}

const totalConvocados = Object.values(contagens).reduce((acc, m) => acc + Object.values(m).reduce((a,b) => a+b, 0), 0);

return [{ json: {
  _statusCode: 200,
  ok: true,
  fonte: 'rm:UNIDADES + monday:items_page',
  unidade_column_id: respRM.unidade_column_id || 'dropdown_mm3mcnmn',
  contagens: Object.fromEntries(ALLOWED.map(c => [c, Object.values(contagens[c]).reduce((a,b)=>a+b,0)])),
  total_convocacoes_mes: totalConvocados,
  mes_referencia: PRIMEIRO_ISO.slice(0,7),
  unidades_por_contrato,
  unidades: respRM.unidades || []
}}];
`.trim()

async function fetchWF() {
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { "X-N8N-API-KEY": TOKEN },
  })
  if (!res.ok) throw new Error(`Fetch WF: ${res.status} ${await res.text()}`)
  return res.json()
}

async function updateWF(wf) {
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData,
  }
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: "PUT",
    headers: {
      "X-N8N-API-KEY": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Update WF: ${res.status} ${await res.text()}`)
  return res.json()
}

;(async () => {
  console.log("Buscando WF atual...")
  const wf = await fetchWF()
  console.log(`  Nodes: ${wf.nodes.length}`)

  let buscarItemsIdx = wf.nodes.findIndex((n) => n.name === "Buscar Items Convocacoes")
  if (buscarItemsIdx >= 0) {
    wf.nodes[buscarItemsIdx] = NOVO_BUSCAR_ITEMS
    console.log('  Node "Buscar Items Convocacoes" atualizado')
  } else {
    wf.nodes.push(NOVO_BUSCAR_ITEMS)
    console.log('  Node "Buscar Items Convocacoes" inserido')
  }

  const moldar = wf.nodes.find((n) => n.name === "Moldar resposta")
  if (!moldar) throw new Error('Node "Moldar resposta" nao encontrado')
  moldar.parameters.jsCode = NOVO_MOLDAR_CODE
  console.log('  Node "Moldar resposta" code atualizado')

  wf.connections = {
    Webhook: { main: [[{ node: "Buscar Unidades RM", type: "main", index: 0 }]] },
    "Buscar Unidades RM": { main: [[{ node: "Buscar Items Convocacoes", type: "main", index: 0 }]] },
    "Buscar Items Convocacoes": { main: [[{ node: "Moldar resposta", type: "main", index: 0 }]] },
    "Moldar resposta": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
  }
  console.log("  Connections atualizadas")

  console.log("Subindo update...")
  await updateWF(wf)
  console.log("✓ WF patched. Endpoint mantém path /webhook/ponto-facultativo-opcoes")
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
