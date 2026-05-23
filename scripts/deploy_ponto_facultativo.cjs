const fs = require("node:fs")

const N8N_URL = process.env.N8N_API_URL || "https://aionscorp-n8n.cloudfy.live"
const N8N_KEY = process.env.N8N_API_KEY

if (!N8N_KEY) {
  console.error("Defina N8N_API_KEY antes de rodar.")
  process.exit(1)
}

const MONDAY_CRED = { id: "6I0ycSr6PQJkBYpc", name: "Ray0" }

async function n8n(path, options = {}) {
  const res = await fetch(`${N8N_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_KEY,
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${options.method || "GET"} ${path}: ${res.status} ${text}`)
  return data
}

async function allWorkflows() {
  const out = []
  let cursor
  do {
    const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100"
    const page = await n8n(`/api/v1/workflows${qs}`)
    out.push(...(page.data || []))
    cursor = page.nextCursor
  } while (cursor)
  return out
}

async function upsertWorkflow(workflow) {
  const workflows = await allWorkflows()
  const existing = workflows.find((w) => w.name === workflow.name)
  const body = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || { executionOrder: "v1" },
  }
  if (!existing) {
    const created = await n8n("/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify(body),
    })
    await n8n(`/api/v1/workflows/${created.id}/activate`, { method: "POST", body: "{}" }).catch(() => null)
    return created.id
  }
  if (existing.active) {
    await n8n(`/api/v1/workflows/${existing.id}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
  }
  await n8n(`/api/v1/workflows/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  await n8n(`/api/v1/workflows/${existing.id}/activate`, { method: "POST", body: "{}" }).catch(() => null)
  return existing.id
}

function webhookNode(id, name, path, x, y, method = "POST") {
  return {
    parameters: {
      httpMethod: method,
      path,
      responseMode: "responseNode",
      options: {},
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [x, y],
    id,
    name,
    webhookId: `${path}-wh`,
  }
}

function codeNode(id, name, jsCode, x, y) {
  return {
    parameters: { jsCode },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [x, y],
    id,
    name,
  }
}

function mondayHttpNode(id, name, jsonBodyExpr, x, y) {
  return {
    parameters: {
      method: "POST",
      url: "https://api.monday.com/v2",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "mondayComApi",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: jsonBodyExpr,
      options: { response: { response: { neverError: true } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [x, y],
    id,
    name,
    credentials: { mondayComApi: MONDAY_CRED },
  }
}

function respondNode(id, name, bodyExpr, x, y, statusExpr = "={{ $json._statusCode || 200 }}") {
  return {
    parameters: {
      respondWith: "json",
      responseBody: bodyExpr,
      options: {
        responseCode: statusExpr,
        responseHeaders: {
          entries: [
            { name: "Access-Control-Allow-Origin", value: "*" },
            { name: "Content-Type", value: "application/json" },
          ],
        },
      },
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [x, y],
    id,
    name,
  }
}

const setupColumnWorkflow = {
  name: "Ponto Facultativo — Setup Coluna Origem",
  nodes: [
    webhookNode("pf-setup-webhook", "Webhook", "ponto-facultativo-setup-coluna", 0, 0),
    codeNode(
      "pf-setup-query",
      "Preparar",
      `const query = 'query { boards(ids: [18400981023]) { columns { id title type } } }'; return [{ json: { query } }];`,
      220,
      0,
    ),
    mondayHttpNode("pf-setup-buscar", "Buscar Colunas", "={{ JSON.stringify({ query: $json.query }) }}", 440, 0),
    codeNode(
      "pf-setup-decidir",
      "Decidir",
      `const cols = $json?.data?.boards?.[0]?.columns || [];
const found = cols.find(c => String(c.title || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim() === 'ORIGEM DO DESCONTO');
if (found) return [{ json: { _done: true, columnId: found.id, created: false } }];
const query = 'mutation { create_column(board_id: 18400981023, title: "Origem do Desconto", column_type: status) { id title type } }';
return [{ json: { _done: false, query } }];`,
      660,
      0,
    ),
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [{ id: "done", leftValue: "={{ $json._done }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
          combinator: "and",
        },
        options: {},
      },
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [880, 0],
      id: "pf-setup-if",
      name: "Ja Existe?",
    },
    mondayHttpNode("pf-setup-criar", "Criar Coluna", "={{ JSON.stringify({ query: $json.query }) }}", 1100, 120),
    codeNode(
      "pf-setup-final-criada",
      "Final Criada",
      `const col = $json?.data?.create_column; return [{ json: { columnId: col?.id || null, created: true } }];`,
      1320,
      120,
    ),
    respondNode("pf-setup-responder-existe", "Responder Existente", "={{ JSON.stringify({ ok: true, column_id: $json.columnId, created: false }) }}", 1100, -80),
    respondNode("pf-setup-responder-criada", "Responder Criada", "={{ JSON.stringify({ ok: true, column_id: $json.columnId, created: true }) }}", 1540, 120),
  ],
  connections: {
    Webhook: { main: [[{ node: "Preparar", type: "main", index: 0 }]] },
    Preparar: { main: [[{ node: "Buscar Colunas", type: "main", index: 0 }]] },
    "Buscar Colunas": { main: [[{ node: "Decidir", type: "main", index: 0 }]] },
    Decidir: { main: [[{ node: "Ja Existe?", type: "main", index: 0 }]] },
    "Ja Existe?": { main: [[{ node: "Responder Existente", type: "main", index: 0 }], [{ node: "Criar Coluna", type: "main", index: 0 }]] },
    "Criar Coluna": { main: [[{ node: "Final Criada", type: "main", index: 0 }]] },
    "Final Criada": { main: [[{ node: "Responder Criada", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
}

const prepararCode = `const ALLOWED = ['SEMSA','SEDUC ESCOLA','SEDUC SEDE','SEDUC INTERIOR','DETRAN','TRE PB','CETAM'];
const body = $json.body && typeof $json.body === 'object' ? $json.body : {};
const contrato = String(body.contrato || '').trim().toUpperCase();
const unidade = String(body.unidade || body.unidade_label || '').trim();
const data = String(body.data || '').trim();
const beneficios = Array.isArray(body.beneficios) ? [...new Set(body.beneficios.map(String).map(s => s.toUpperCase()).filter(s => s === 'VR' || s === 'VT'))] : [];
function fail(erro, mensagem, status = 400, extra = {}) { return [{ json: { _statusCode: status, _abort: true, ok: false, erro, mensagem, ...extra } }]; }
const FIXOS = ['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'];
function pascoa(year){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return new Date(Date.UTC(year,Math.floor(n/31)-1,(n%31)+1));}
function feriado(iso){const y=Number(iso.slice(0,4)); if (FIXOS.includes(iso.slice(5))) return true; const p=pascoa(y); p.setUTCDate(p.getUTCDate()-2); return p.toISOString().slice(0,10) === iso;}
const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
const anoAtual = nowParts.find(p => p.type === 'year').value;
const mesAtual = nowParts.find(p => p.type === 'month').value;
if (!ALLOWED.includes(contrato)) return fail('contrato_invalido', 'Contrato invalido para ponto facultativo.');
if (!unidade) return fail('unidade_obrigatoria', 'Informe a unidade do contrato.');
if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(data)) return fail('data_invalida', 'Informe a data em YYYY-MM-DD.');
if (data.slice(0,7) !== anoAtual + '-' + mesAtual) return fail('fora_mes_corrente', 'Ponto facultativo so pode ser aplicado no mes corrente.');
if (new Date(data + 'T00:00:00Z').getUTCDay() === 0) return fail('domingo_bloqueado', 'Domingo nao recebe ponto facultativo.');
if (feriado(data)) return fail('feriado_bloqueado', 'Feriado nacional ja e bloqueado.');
if (beneficios.length === 0) return fail('beneficios_obrigatorios', 'Selecione VR, VT ou ambos.');
const query = \`query {
  entrada: items_page_by_column_values(board_id: 18408773953, columns: [{ column_id: "color_mktcnxwn", column_values: [\${JSON.stringify(contrato)}] }], limit: 500) {
    items { id name column_values { id text value column { title } } }
  }
  historico: boards(ids: [18411141462]) {
    items_page(limit: 500) { items { id name column_values { id text value column { title } } } }
  }
  valores: boards(ids: [18413870370]) {
    items_page(limit: 500) { items { id name column_values { id text value column { title } } } }
  }
}\`;
return [{ json: { ok: true, contrato, unidade, data, beneficios, query } }];`

const opcoesPrepararCode = `const query = \`query {
  boards(ids: [18408773953]) {
    items_page(limit: 500) {
      items {
        id
        name
        column_values(ids: ["color_mktcnxwn", "dropdown_mm3mcnmn", "texto75"]) {
          id
          text
          value
          column { title }
        }
      }
    }
  }
}\`;
return [{ json: { query } }];`

const opcoesMoldarCode = `const ALLOWED = ['SEMSA','SEDUC ESCOLA','SEDUC SEDE','SEDUC INTERIOR','DETRAN','TRE PB','CETAM'];
const resp = $input.first().json;
if (Array.isArray(resp.errors) && resp.errors.length) {
  return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday', mensagem: resp.errors.map(e => e.message).join(' | ') } }];
}
function norm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim();}
function col(item,id){return (item.column_values||[]).find(c=>c.id===id)||null;}
function text(item,id){return col(item,id)?.text ?? '';}
const unidades = Object.fromEntries(ALLOWED.map(c => [c, []]));
const vistos = Object.fromEntries(ALLOWED.map(c => [c, new Set()]));
const items = resp?.data?.boards?.[0]?.items_page?.items || [];
for (const item of items) {
  const contratoRaw = text(item, 'color_mktcnxwn');
  const contrato = ALLOWED.find(c => norm(c) === norm(contratoRaw));
  if (!contrato) continue;
  const unidade = String(text(item, 'dropdown_mm3mcnmn') || text(item, 'texto75') || '').trim();
  if (!unidade) continue;
  const key = norm(unidade);
  if (vistos[contrato].has(key)) continue;
  vistos[contrato].add(key);
  unidades[contrato].push(unidade);
}
for (const c of ALLOWED) unidades[c].sort((a,b)=>a.localeCompare(b,'pt-BR'));
return [{ json: { _statusCode: 200, ok: true, unidade_column_id: 'dropdown_mm3mcnmn', unidades_por_contrato: unidades } }];`

function workflowOpcoes() {
  return {
    name: "Ponto Facultativo — Opcoes",
    nodes: [
      webhookNode("pf-opcoes-webhook", "Webhook", "ponto-facultativo-opcoes", 0, 0, "GET"),
      codeNode("pf-opcoes-preparar", "Preparar", opcoesPrepararCode, 240, 0),
      mondayHttpNode("pf-opcoes-buscar", "Buscar Dados", "={{ JSON.stringify({ query: $json.query }) }}", 480, 0),
      codeNode("pf-opcoes-moldar", "Moldar resposta", opcoesMoldarCode, 720, 0),
      respondNode("pf-opcoes-responder", "Responder", "={{ JSON.stringify($json) }}", 960, 0),
    ],
    connections: {
      Webhook: { main: [[{ node: "Preparar", type: "main", index: 0 }]] },
      Preparar: { main: [[{ node: "Buscar Dados", type: "main", index: 0 }]] },
      "Buscar Dados": { main: [[{ node: "Moldar resposta", type: "main", index: 0 }]] },
      "Moldar resposta": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

function calcPreviewCode(originColumnId, includeInternal = false) {
  return `const prep = $('Preparar').first().json;
if (prep._abort) return [{ json: prep }];
const resp = $input.first().json;
if (Array.isArray(resp.errors) && resp.errors.length) {
  return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday', mensagem: resp.errors.map(e => e.message).join(' | ') } }];
}
const COL = {
  E_CHAPA: 'texto', E_CPF: 'dup__of_matr_cula', E_FUNCAO: 'texto0', E_CONTRATO: 'color_mktcnxwn',
  E_UNIDADE: 'dropdown_mm3mcnmn', E_UNIDADE_TXT: 'texto75',
  E_DI: 'date_mktayxhb', E_DF: 'date_mktasnwq', E_STATUS: 'color_mm3a8ana', E_CANCEL_INICIO: 'date_mm3b88ta',
  E_OPTANTE_VT: 'optante___vt', E_OPTANTE_VT_ALT: 'color_mm34ry47', E_TRAB_SAB: 'color_mktaavmp',
  H_UUID: 'text_mm2xjend', H_CHAPA: 'text_mm33v9kp', H_DI: 'date_mm2xtp93', H_LEDGER: 'long_text_mm3ct3hg',
  H_TRAB_SAB: 'color_mm34yyet', H_SAB_EXTRAS: 'text_mm3bfn6h'
};
function norm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim();}
function normUnidade(s){return norm(s).replace(/[\\.,;:/\\\\|_()\\[\\]{}-]+/g,' ').replace(/\\s+/g,' ').trim();}
function origemUnidade(s){return normUnidade(s).replace(/\\s+/g,'_') || 'UNIDADE';}
function chapaNorm(s){return String(s||'').replace(/\\D/g,'').replace(/^0+/,'') || '0';}
function col(item,id){return (item.column_values||[]).find(c=>c.id===id)||null;}
function text(item,id){return col(item,id)?.text ?? '';}
function unidadeItem(item){return text(item,COL.E_UNIDADE) || text(item,COL.E_UNIDADE_TXT) || '';}
function titleCol(item,titles){const alvo=titles.map(norm); return (item.column_values||[]).find(c=>alvo.some(a=>norm(c.column?.title||'')===a || norm(c.column?.title||'').includes(a))) || null;}
function num(v){return Number(String(v||'0').replace(',', '.')) || 0;}
function parseJSON(v,fb){if(!v)return fb; try{return JSON.parse(v)}catch{return fb}}
function addDays(iso,n){const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);}
function pct(entry,key){const p = Number(entry?.[key + '_percentual'] ?? 0); if (p > 0) return p <= 1 ? p*100 : p; if (entry?.[key] === true) return 100; return 0;}
function resolverValores(items, contrato, funcao){
  function cell(cv){
    if (!cv) return '';
    if (cv.text !== undefined && cv.text !== null && String(cv.text).trim() !== '') return String(cv.text);
    if (!cv.value) return '';
    try {
      const p = typeof cv.value === 'string' ? JSON.parse(cv.value) : cv.value;
      if (p === null || p === undefined) return '';
      if (typeof p === 'number' || typeof p === 'string') return String(p);
      return String(p.number ?? p.value ?? p.label ?? p.text ?? '');
    } catch {
      return String(cv.value);
    }
  }
  function by(titles){ return cell(titleCol(this, titles)); }
  const ativos = items.filter(item => { const v = norm(cell(titleCol(item,['Ativo','Status','Habilitado']))); return !v || ['SIM','ATIVO','TRUE','1','HABILITADO'].includes(v); });
  const matches = [];
  for (const item of ativos) {
    const itemName = norm(item.name);
    const c = norm(cell(titleCol(item,['Contrato'])));
    const r = norm(cell(titleCol(item,['Regra/Função','Regra','Funcao','Função','Cargo'])));
    const contratoNorm = norm(contrato);
    const cPadrao = !c || ['PADRAO','PADRÃO','GLOBAL','*'].includes(c) || itemName.includes('PADRAO') || itemName.includes('PADRÃO') || itemName.includes('GLOBAL');
    const contratoBate = c === contratoNorm || c.includes(contratoNorm) || itemName.includes(contratoNorm);
    if (!cPadrao && !contratoBate) continue;
    const rPadrao = !r || ['PADRAO','PADRÃO','GERAL','*'].includes(r);
    if (!rPadrao && !norm(funcao).includes(r)) continue;
    const pri = num(cell(titleCol(item,['Prioridade','Ordem'])));
    matches.push({ item, score: (contratoBate ? 1000 : 0) + (!rPadrao ? 100 : 0) + pri });
  }
  matches.sort((a,b)=>b.score-a.score);
  const item = matches[0]?.item;
  if (!item) return { vr: 0, vt: 0, regra: 'Sem regra de valores' };
  const vr = num(cell(titleCol(item,['VR','Valor VR','Vale Refeição','Vale Refeicao'])));
  const vt = num(cell(titleCol(item,['VT','Valor VT','Vale Transporte'])));
  const contratoTxt = cell(titleCol(item,['Contrato'])) || item.name || contrato;
  const regraTxt = cell(titleCol(item,['Regra/Função','Regra','Funcao','Função','Cargo']));
  const regra = 'Board valores - ' + contratoTxt + (regraTxt ? ' / ' + regraTxt : '');
  return { vr, vt, regra };
}
const entrada = resp?.data?.entrada?.items || [];
const historicos = resp?.data?.historico?.[0]?.items_page?.items || [];
const valoresItems = resp?.data?.valores?.[0]?.items_page?.items || [];
const unidadesValidas = Array.from(new Set(entrada.map(unidadeItem).map(s => String(s || '').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
function levenshtein(a,b){
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[m][n];
}
function resolverUnidade(input, candidatas){
  const alvo = normUnidade(input);
  const pares = candidatas.map(label => ({ label, norm: normUnidade(label) })).filter(p => p.norm);
  const exatas = pares.filter(p => p.norm === alvo);
  if (exatas.length === 1) return { ok: true, label: exatas[0].label, norm: exatas[0].norm };
  if (exatas.length > 1) return { ok: false, erro: 'unidade_ambigua', mensagem: 'Unidade ambigua para este contrato.', candidatos: exatas.map(p=>p.label) };
  const contem = pares.filter(p => p.norm.includes(alvo) || alvo.includes(p.norm));
  if (contem.length === 1) return { ok: true, label: contem[0].label, norm: contem[0].norm };
  if (contem.length > 1) return { ok: false, erro: 'unidade_ambigua', mensagem: 'Unidade ambigua para este contrato.', candidatos: contem.map(p=>p.label) };
  const scored = pares.map(p => {
    const max = Math.max(alvo.length, p.norm.length) || 1;
    const score = 1 - (levenshtein(alvo, p.norm) / max);
    return { ...p, score };
  }).filter(p => p.score >= 0.78).sort((a,b)=>b.score-a.score);
  if (scored.length === 1 || (scored[0] && (!scored[1] || scored[0].score - scored[1].score >= 0.08))) return { ok: true, label: scored[0].label, norm: scored[0].norm };
  if (scored.length > 1) return { ok: false, erro: 'unidade_ambigua', mensagem: 'Unidade ambigua para este contrato.', candidatos: scored.slice(0,5).map(p=>p.label) };
  return { ok: false, erro: 'unidade_invalida', mensagem: 'Unidade nao encontrada para este contrato.', candidatos: candidatas };
}
const unidadeResolvida = resolverUnidade(prep.unidade, unidadesValidas);
if (!unidadeResolvida.ok) return [{ json: { _statusCode: 400, ok: false, erro: unidadeResolvida.erro, mensagem: unidadeResolvida.mensagem, contrato: prep.contrato, unidade: prep.unidade, candidatos: unidadeResolvida.candidatos || unidadesValidas } }];
const histMap = new Map();
for (const h of historicos) histMap.set(chapaNorm(text(h,COL.H_CHAPA)) + '|' + text(h,COL.H_DI), h);
const origem = 'ponto_facultativo:' + prep.contrato + ':' + origemUnidade(unidadeResolvida.label) + ':' + prep.data;
const isSab = new Date(prep.data + 'T00:00:00Z').getUTCDay() === 6;
const STATUS_IGNORAR = new Set(['CANCELADA','CANCELADO','BLOQUEADA - CONFLITO']);
const itens = [];
for (const e of entrada) {
  const unidadeReal = unidadeItem(e);
  if (normUnidade(unidadeReal) !== unidadeResolvida.norm) continue;
  const di = text(e,COL.E_DI), df = text(e,COL.E_DF);
  if (!di || !df) continue;
  const st = norm(text(e,COL.E_STATUS));
  if (STATUS_IGNORAR.has(st)) continue;
  let fimEf = df;
  const canc = text(e,COL.E_CANCEL_INICIO);
  if (/PARCIAL/i.test(st) && canc) fimEf = addDays(canc, -1);
  if (prep.data < di || prep.data > fimEf) continue;
  const chapa = chapaNorm(text(e,COL.E_CHAPA));
  const hist = histMap.get(chapa + '|' + di);
  if (!hist) continue;
  const sabadosExtras = String(text(hist,COL.H_SAB_EXTRAS)||'').split(/[,;\\n]/).map(s=>s.trim()).filter(s=>/^\\d{4}-\\d{2}-\\d{2}$/.test(s));
  const trabalhaSab = /SIM/i.test(text(e,COL.E_TRAB_SAB) || text(hist,COL.H_TRAB_SAB)) || sabadosExtras.includes(prep.data);
  if (isSab && !trabalhaSab) continue;
  const optTxt = String(text(e,COL.E_OPTANTE_VT) || text(e,COL.E_OPTANTE_VT_ALT) || '').toUpperCase();
  const optanteVT = optTxt.includes('SIM');
  const vtMeiaVolta = optTxt.includes('SIM*');
  const ledger = parseJSON(text(hist,COL.H_LEDGER), {}) || {};
  const entry = ledger[prep.data] || {};
  const vrJa = pct(entry,'vr') >= 100;
  const vtJa = pct(entry,'vt') >= 100;
  const valores = resolverValores(valoresItems, prep.contrato, text(e,COL.E_FUNCAO));
  const avisos = [];
  let valorVR = 0, valorVT = 0, aplicaVR = false, aplicaVT = false;
  if (prep.beneficios.includes('VR')) {
    if (isSab) avisos.push('VR nao aplicado em sabado');
    else if (vrJa) avisos.push('VR ja descontado no ledger');
    else { aplicaVR = true; valorVR = valores.vr; }
  }
  if (prep.beneficios.includes('VT')) {
    if (!optanteVT) avisos.push('Nao optante VT');
    else if (vtJa) avisos.push('VT ja descontado no ledger');
    else { aplicaVT = true; valorVT = vtMeiaVolta ? Math.round((valores.vt/2)*100)/100 : valores.vt; }
  }
  itens.push({
    item_entrada_id: String(e.id), item_historico_id: String(hist.id), uuid: text(hist,COL.H_UUID)||null,
    nome: e.name, chapa: text(e,COL.E_CHAPA), cpf: text(e,COL.E_CPF)||null, contrato: prep.contrato,
    unidade: unidadeResolvida.label,
    funcao: text(e,COL.E_FUNCAO)||null, periodo_inicio: di, periodo_fim: fimEf, data: prep.data,
    optante_vt: optanteVT, vt_meia_volta: vtMeiaVolta, trabalha_sabado: trabalhaSab,
    aplica_vr: aplicaVR, aplica_vt: aplicaVT, valor_vr: valorVR, valor_vt: valorVT,
    total: Math.round((valorVR+valorVT)*100)/100, avisos, regra_valores: valores.regra, _ledger: ledger, _origem: origem
  });
}
const publicItens = itens.map(({_ledger,_origem,...i})=>i);
const out = { _statusCode: 200, ok: true, contrato: prep.contrato, unidade: unidadeResolvida.label, data: prep.data, beneficios: prep.beneficios, aviso: publicItens.length === 0 ? 'sem_intermitentes_unidade_data' : null, total_colaboradores: publicItens.length, total_vr: Math.round(publicItens.reduce((a,i)=>a+i.valor_vr,0)*100)/100, total_vt: Math.round(publicItens.reduce((a,i)=>a+i.valor_vt,0)*100)/100, total: Math.round(publicItens.reduce((a,i)=>a+i.total,0)*100)/100, itens: publicItens };
if (${includeInternal ? "true" : "false"}) out._internal_itens = itens;
return [{ json: out }];`
}

function applyMutationCode(originColumnId) {
  return `${calcPreviewCode(originColumnId)}
// unreachable`;
}

const montarMutacaoCode = `const preview = $('Calcular Preview').first().json;
if (preview._statusCode && preview._statusCode !== 200) return [{ json: preview }];
if ((preview._internal_itens || []).length === 0) return [{ json: { ...preview, _statusCode: 409, ok: false, erro: 'sem_intermitentes_para_aplicar', mensagem: 'Nenhum intermitente convocado nesta unidade para esta data.', processados: 0, ignorados: 0 } }];
const resp = $('Buscar Dados').first().json;
const descontos = resp?.data?.descontos?.[0]?.items_page?.items || [];
const ORIGEM_COL = '__ORIGEM_COL__';
const COL_D = {
  NOME: 'dropdown_mm0rgfrx', CHAPA: 'text_mm0rpqxs', CPF: 'text_mm0r5ted',
  DI: 'date_mm0r6tyr', DF: 'date_mm0rzpyv', DIAS_VT: 'numeric_mm3428yj', DIAS_VR: 'numeric_mm34p6p7',
  QTD_ATRASOS: 'numeric_mm2pj1av', VR: 'numeric_mm0rgsaw', VT: 'numeric_mm0r5tca', STATUS: 'color_mm0r8mjr',
  RES_VR: 'numeric_mm0r1691', RES_VT: 'numeric_mm0rtwwg', DESC_VR: 'numeric_mm0rqy6z', DESC_VT: 'numeric_mm0r6cn0'
};
function col(item,id){return (item.column_values||[]).find(c=>c.id===id)||null;}
function text(item,id){return col(item,id)?.text ?? '';}
function num(v){return Number(String(v||'0').replace(',', '.')) || 0;}
function esc(values){return JSON.stringify(JSON.stringify(values));}
function findDesconto(item){
  return descontos.find(d => text(d,COL_D.CHAPA).replace(/\\D/g,'').replace(/^0+/,'') === String(item.chapa||'').replace(/\\D/g,'').replace(/^0+/,'') && text(d,COL_D.DI) === item.data && text(d,COL_D.DF) === item.data && String(text(d,ORIGEM_COL)).toUpperCase().includes('PONTO FACULTATIVO'));
}
const aliases = [];
let h = 0, d = 0, processados = 0, ignorados = 0;
for (const item of preview._internal_itens || []) {
  if (!item.aplica_vr && !item.aplica_vt) { ignorados++; continue; }
  const ledger = item._ledger || {};
  const atual = ledger[item.data] || { vr: false, vt: false, vr_percentual: 0, vt_percentual: 0, origens: [] };
  if (item.aplica_vr) { atual.vr = true; atual.vr_percentual = 100; }
  if (item.aplica_vt) { atual.vt = true; atual.vt_percentual = 100; }
  atual.origens = Array.from(new Set([...(atual.origens || []), item._origem]));
  ledger[item.data] = atual;
  aliases.push(\`h\${h++}: change_multiple_column_values(board_id: 18411141462, item_id: \${item.item_historico_id}, column_values: \${esc({ long_text_mm3ct3hg: JSON.stringify(ledger) })}, create_labels_if_missing: true) { id }\`);
  const existente = findDesconto(item);
  const addVR = item.valor_vr || 0, addVT = item.valor_vt || 0;
  if (existente) {
    const descVR = num(text(existente,COL_D.DESC_VR)), descVT = num(text(existente,COL_D.DESC_VT));
    const resVR = num(text(existente,COL_D.RES_VR)), resVT = num(text(existente,COL_D.RES_VT));
    const totalVR = num(text(existente,COL_D.VR)) + addVR;
    const totalVT = num(text(existente,COL_D.VT)) + addVT;
    const values = {
      [COL_D.DIAS_VR]: String((item.aplica_vr ? 1 : 0) + num(text(existente,COL_D.DIAS_VR))),
      [COL_D.DIAS_VT]: String((item.aplica_vt ? 1 : 0) + num(text(existente,COL_D.DIAS_VT))),
      [COL_D.VR]: String(Math.round(totalVR*100)/100),
      [COL_D.VT]: String(Math.round(totalVT*100)/100),
      [COL_D.RES_VR]: String(Math.round((resVR+addVR)*100)/100),
      [COL_D.RES_VT]: String(Math.round((resVT+addVT)*100)/100),
      [COL_D.DESC_VR]: String(descVR),
      [COL_D.DESC_VT]: String(descVT),
      [COL_D.STATUS]: { label: (descVR || descVT) ? 'PARCIAL' : 'PENDENTE' },
      [ORIGEM_COL]: { label: 'PONTO FACULTATIVO' }
    };
    aliases.push(\`d\${d++}: change_multiple_column_values(board_id: 18400981023, item_id: \${existente.id}, column_values: \${esc(values)}, create_labels_if_missing: true) { id }\`);
  } else {
    const values = {
      [COL_D.NOME]: { labels: [item.nome] },
      [COL_D.CHAPA]: String(item.chapa || ''),
      [COL_D.CPF]: String(item.cpf || ''),
      [COL_D.DI]: { date: item.data },
      [COL_D.DF]: { date: item.data },
      [COL_D.DIAS_VR]: String(item.aplica_vr ? 1 : 0),
      [COL_D.DIAS_VT]: String(item.aplica_vt ? 1 : 0),
      [COL_D.QTD_ATRASOS]: '0',
      [COL_D.VR]: String(addVR),
      [COL_D.VT]: String(addVT),
      [COL_D.STATUS]: { label: 'PENDENTE' },
      [COL_D.RES_VR]: String(addVR),
      [COL_D.RES_VT]: String(addVT),
      [COL_D.DESC_VR]: '0',
      [COL_D.DESC_VT]: '0',
      [ORIGEM_COL]: { label: 'PONTO FACULTATIVO' }
    };
    aliases.push(\`d\${d++}: create_item(board_id: 18400981023, group_id: "group_mm0rmjs3", item_name: "PONTO FACULTATIVO", column_values: \${esc(values)}, create_labels_if_missing: true) { id }\`);
  }
  processados++;
}
const publicJson = { ...preview };
delete publicJson._internal_itens;
if (aliases.length === 0) return [{ json: { ...publicJson, processados, ignorados, _statusCode: 200 } }];
return [{ json: { ...publicJson, processados, ignorados, mutation: 'mutation { ' + aliases.join(' ') + ' }' } }];`

function workflowPreview() {
  return {
    name: "Ponto Facultativo — Preview",
    nodes: [
      webhookNode("pf-preview-webhook", "Webhook", "ponto-facultativo-preview", 0, 0),
      codeNode("pf-preview-preparar", "Preparar", prepararCode, 240, 0),
      {
        parameters: {
          conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "abort", leftValue: "={{ $json._abort }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" },
          options: {},
        },
        type: "n8n-nodes-base.if", typeVersion: 2.2, position: [480, 0], id: "pf-preview-if", name: "Abortar?"
      },
      mondayHttpNode("pf-preview-buscar", "Buscar Dados", "={{ JSON.stringify({ query: $json.query }) }}", 720, 120),
      codeNode("pf-preview-calcular", "Calcular Preview", calcPreviewCode(""), 960, 120),
      respondNode("pf-preview-responder-erro", "Responder Erro", "={{ JSON.stringify($json) }}", 720, -120),
      respondNode("pf-preview-responder", "Responder", "={{ JSON.stringify($json) }}", 1200, 120),
    ],
    connections: {
      Webhook: { main: [[{ node: "Preparar", type: "main", index: 0 }]] },
      Preparar: { main: [[{ node: "Abortar?", type: "main", index: 0 }]] },
      "Abortar?": { main: [[{ node: "Responder Erro", type: "main", index: 0 }], [{ node: "Buscar Dados", type: "main", index: 0 }]] },
      "Buscar Dados": { main: [[{ node: "Calcular Preview", type: "main", index: 0 }]] },
      "Calcular Preview": { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

function workflowAplicar(originColumnId) {
  const prepararAplicar = prepararCode.replace(
    `  valores: boards(ids: [18413870370]) {
    items_page(limit: 500) { items { id name column_values { id text value column { title } } } }
  }
}\`;`,
    `  valores: boards(ids: [18413870370]) {
    items_page(limit: 500) { items { id name column_values { id text value column { title } } } }
  }
  descontos: boards(ids: [18400981023]) {
    items_page(limit: 500) { items { id name column_values { id text value column { title } } } }
  }
}\`;`,
  )
  return {
    name: "Ponto Facultativo — Aplicar",
    nodes: [
      webhookNode("pf-aplicar-webhook", "Webhook", "ponto-facultativo-aplicar", 0, 0),
      codeNode("pf-aplicar-preparar", "Preparar", prepararAplicar, 240, 0),
      {
        parameters: {
          conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "abort", leftValue: "={{ $json._abort }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" },
          options: {},
        },
        type: "n8n-nodes-base.if", typeVersion: 2.2, position: [480, 0], id: "pf-aplicar-if-abort", name: "Abortar?"
      },
      mondayHttpNode("pf-aplicar-buscar", "Buscar Dados", "={{ JSON.stringify({ query: $json.query }) }}", 720, 120),
      codeNode("pf-aplicar-calcular", "Calcular Preview", calcPreviewCode(originColumnId, true), 960, 120),
      codeNode("pf-aplicar-mutacao", "Montar Mutacao", montarMutacaoCode.replace("__ORIGEM_COL__", originColumnId), 1200, 120),
      {
        parameters: {
          conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "mut", leftValue: "={{ !!$json.mutation }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" },
          options: {},
        },
        type: "n8n-nodes-base.if", typeVersion: 2.2, position: [1440, 120], id: "pf-aplicar-if-mut", name: "Tem Mutacao?"
      },
      mondayHttpNode("pf-aplicar-exec", "Executar Mutacao", "={{ JSON.stringify({ query: $json.mutation }) }}", 1680, 40),
      codeNode("pf-aplicar-final", "Final", `const base = $('Montar Mutacao').first().json; const r = $json; if (Array.isArray(r.errors) && r.errors.length) return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday', mensagem: r.errors.map(e=>e.message).join(' | ') } }]; const out = { ...base }; delete out.mutation; return [{ json: out }];`, 1920, 40),
      respondNode("pf-aplicar-responder-erro", "Responder Erro", "={{ JSON.stringify($json) }}", 720, -120),
      respondNode("pf-aplicar-responder-skip", "Responder Sem Mutacao", "={{ JSON.stringify($json) }}", 1680, 220),
      respondNode("pf-aplicar-responder", "Responder", "={{ JSON.stringify($json) }}", 2160, 40),
    ],
    connections: {
      Webhook: { main: [[{ node: "Preparar", type: "main", index: 0 }]] },
      Preparar: { main: [[{ node: "Abortar?", type: "main", index: 0 }]] },
      "Abortar?": { main: [[{ node: "Responder Erro", type: "main", index: 0 }], [{ node: "Buscar Dados", type: "main", index: 0 }]] },
      "Buscar Dados": { main: [[{ node: "Calcular Preview", type: "main", index: 0 }]] },
      "Calcular Preview": { main: [[{ node: "Montar Mutacao", type: "main", index: 0 }]] },
      "Montar Mutacao": { main: [[{ node: "Tem Mutacao?", type: "main", index: 0 }]] },
      "Tem Mutacao?": { main: [[{ node: "Executar Mutacao", type: "main", index: 0 }], [{ node: "Responder Sem Mutacao", type: "main", index: 0 }]] },
      "Executar Mutacao": { main: [[{ node: "Final", type: "main", index: 0 }]] },
      Final: { main: [[{ node: "Responder", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  }
}

async function patchWorkflowLer() {
  const wf = await n8n("/api/v1/workflows/WHtIQDf8oOWinGyx")
  const node = wf.nodes.find((n) => n.name === "Moldar resposta")
  if (!node) throw new Error("Node Moldar resposta nao encontrado")
  let code = node.parameters.jsCode
  if (!code.includes("pontosFacultativos")) {
    code = code.replace(
      "const itemOrigemId = extrairItemOrigemId();",
      `const pontosFacultativos = [];
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

const itemOrigemId = extrairItemOrigemId();`,
    )
    code = code.replace(
      "beneficios_descontados: beneficiosDescontados && typeof beneficiosDescontados === 'object' ? beneficiosDescontados : {}",
      "beneficios_descontados: beneficiosDescontados && typeof beneficiosDescontados === 'object' ? beneficiosDescontados : {},\n    pontos_facultativos: pontosFacultativos",
    )
    node.parameters.jsCode = code
    const wasActive = wf.active
    if (wasActive) await n8n(`/api/v1/workflows/${wf.id}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
    await n8n(`/api/v1/workflows/${wf.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: wf.name,
        nodes: wf.nodes,
        connections: wf.connections,
        settings: { executionOrder: wf.settings?.executionOrder || "v1" },
      }),
    })
    if (wasActive) await n8n(`/api/v1/workflows/${wf.id}/activate`, { method: "POST", body: "{}" }).catch(() => null)
  }
}

async function main() {
  const setupId = await upsertWorkflow(setupColumnWorkflow)
  const setupResp = await fetch(`${N8N_URL}/webhook/ponto-facultativo-setup-coluna`, { method: "POST" })
  const setupJson = await setupResp.json()
  if (!setupJson.ok || !setupJson.column_id) throw new Error("Falha ao criar/localizar coluna Origem do Desconto: " + JSON.stringify(setupJson))
  fs.writeFileSync("ponto-facultativo-columns.json", JSON.stringify({ origem_do_desconto: setupJson.column_id }, null, 2))
  console.log("Coluna Origem do Desconto:", setupJson.column_id, setupJson.created ? "(criada)" : "(existente)")
  const opcoesId = await upsertWorkflow(workflowOpcoes())
  const previewId = await upsertWorkflow(workflowPreview())
  const aplicarId = await upsertWorkflow(workflowAplicar(setupJson.column_id))
  await patchWorkflowLer()
  await n8n(`/api/v1/workflows/${setupId}/deactivate`, { method: "POST", body: "{}" }).catch(() => null)
  console.log("Workflow setup:", setupId)
  console.log("Workflow opcoes:", opcoesId)
  console.log("Workflow preview:", previewId)
  console.log("Workflow aplicar:", aplicarId)
  console.log("WF intermitente-ler patchado.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
