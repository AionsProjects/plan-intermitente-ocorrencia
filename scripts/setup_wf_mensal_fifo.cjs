#!/usr/bin/env node
/**
 * Cria "WF MENSAL FIFO" no n8n ANTIGO clonando WF5 PONTUAL FIFO
 * (Bso4k6ddDNcRmU83) com mudancas cirurgicas:
 *
 *   A. Trigger substituido: Webhook+If3+If6+Code(parser) saem.
 *      Entram: Schedule + Code Gate (UDU + competencia alvo) +
 *      If Deve Passar + Code Build Query Mensal + HTTP Monday +
 *      Code Build Antifraude + HTTP Monday +
 *      Code Normalizar/Filtrar + Split In Batches.
 *
 *   B. Code in JavaScript1: regra MENSAL (max 3 dias VR/VT, VT so para
 *      interior=SIM OU contrato in {SEDUC INTERIOR, TRE PB}).
 *      Continua spread ...dados pra propagar anoComp/mesComp.
 *
 *   C. Code in JavaScript9 (boleto SOAP) e Code in JavaScript11 (credito
 *      SOAP) leem anoComp/mesComp do Code1 (em vez de new Date()).
 *
 *   D. Code in JavaScript2 nao depende mais de $('Webhook') — le
 *      contratoOrgao direto do Code1.
 *
 * Uso: node scripts/setup_wf_mensal_fifo.cjs <N8N_ANTIGO_TOKEN>
 */
const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error("Uso: node scripts/setup_wf_mensal_fifo.cjs <N8N_ANTIGO_TOKEN>")
  process.exit(1)
}

const WF5_ID = "Bso4k6ddDNcRmU83"
const BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const BOARD_ENTRADA = 18408773953
const BOARD_SOLICITACAO = 18393673859
const MONDAY_TOKEN_HEADER =
  "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ0MDQyMzQ0NywiYWFpIjoxMSwidWlkIjo0NTk4NTI3NSwiaWFkIjoiMjAyNC0xMS0yM1QxODowNDo1MC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTI2ODUwMDYsInJnbiI6InVzZTEifQ.rQ4gm1nLNGZnI24LD4awmZIKM67iNZP7GDyI_tquLHA"

// ===============================================================
//  jsCode dos nodes NOVOS
// ===============================================================

const CODE_GATE = `// Gate: roda no ultimo dia util do mes OU em modo manual (editor).
// Define anoCompAlvo/mesCompAlvo = mes+1 do mes do disparo.
function ultimoDiaUtil(d){
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  x.setDate(0);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1);
  return x;
}

const hoje = new Date();
const isManual = $execution.mode === 'manual';
const udu = ultimoDiaUtil(hoje);
const isUDU =
  hoje.getFullYear() === udu.getFullYear() &&
  hoje.getMonth() === udu.getMonth() &&
  hoje.getDate() === udu.getDate();

const ref = hoje;
const anoCompAlvo = ref.getMonth() === 11 ? ref.getFullYear() + 1 : ref.getFullYear();
const mesCompAlvo = ref.getMonth() === 11 ? 1 : ref.getMonth() + 2;
const competenciaIso = anoCompAlvo + '-' + String(mesCompAlvo).padStart(2, '0');

const mesLabels = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
const competenciaLabel = mesLabels[mesCompAlvo - 1];

return [{
  json: {
    devePassar: isManual || isUDU,
    isManual,
    isUDU,
    hojeIso: hoje.toISOString().slice(0, 10),
    anoCompAlvo,
    mesCompAlvo,
    competenciaIso,
    competenciaLabel
  }
}];`

const CODE_BUILD_QUERY_MENSAL = `// Monta GraphQL pra listar convocacoes MENSAL elegiveis no board ENTRADA
// Filtros: Tipo Convocacao=MENSAL, Status Convocacao=Valida, Data Inicio em ANYWHERE
// (filtro de mes feito client-side pois Monday nao suporta filter por mes em date).
const ctx = $input.first().json;
const competenciaIso = ctx.competenciaIso;

// Pega items com Tipo=MENSAL e Status=Valida (qualquer data, filtra mes em Code Normalizar)
const query = \`query {
  items_page_by_column_values(
    limit: 500,
    board_id: \${${BOARD_ENTRADA}},
    columns: [
      { column_id: "color_mkta71ex", column_values: ["MENSAL"] },
      { column_id: "color_mm3a8ana", column_values: ["Válida", "Valida"] }
    ]
  ) {
    cursor
    items {
      id
      name
      column_values {
        id
        text
        value
      }
    }
  }
}\`;

return [{
  json: {
    ...ctx,
    query
  }
}];`

const CODE_BUILD_ANTIFRAUDE = `// Apos receber lista MENSAL elegiveis, monta segunda query no board
// Solicitacao Pagamento (18393673859) pra ver quais nomes ja tem item criado
// na competencia alvo (color_mks0yady = label JANEIRO/FEVEREIRO/...).
const ctx = $('Code Gate').first().json;
const respMonday = $input.first().json;

const items = respMonday?.data?.items_page_by_column_values?.items || [];

// Filtra por mes alvo: Data Inicio (date_mktayxhb) cai em competenciaIso (YYYY-MM)
const elegiveis = items.filter(it => {
  const cols = it.column_values || [];
  const dataInicioCol = cols.find(c => c.id === 'date_mktayxhb');
  if (!dataInicioCol) return false;
  let dateIso = '';
  try {
    const val = dataInicioCol.value ? JSON.parse(dataInicioCol.value) : null;
    dateIso = val?.date || dataInicioCol.text || '';
  } catch { dateIso = dataInicioCol.text || ''; }
  return String(dateIso).slice(0, 7) === ctx.competenciaIso;
});

if (elegiveis.length === 0) {
  return [{
    json: {
      ...ctx,
      elegiveis: [],
      _skip: true,
      _msg: 'Nenhuma convocacao MENSAL elegivel pra ' + ctx.competenciaIso
    }
  }];
}

// Query antifraude — busca items na compet alvo (label PT-BR) no board Solicitacao
const queryAntifraude = \`query {
  items_page_by_column_values(
    limit: 500,
    board_id: \${${BOARD_SOLICITACAO}},
    columns: [
      { column_id: "color_mks0yady", column_values: ["\${ctx.competenciaLabel}"] }
    ]
  ) {
    items { id name }
  }
}\`;

return [{
  json: {
    ...ctx,
    elegiveis,
    query: queryAntifraude
  }
}];`

const CODE_NORMALIZAR = `// Recebe lista antifraude + lista elegiveis. Filtra ja pagas e emite
// N items no shape esperado por Code in JavaScript1 do WF5 (parser equivalente).
const ctx = $('Code Build Antifraude').first().json;
const respMonday = $input.first().json;

const jaPagas = (respMonday?.data?.items_page_by_column_values?.items || [])
  .map(it => String(it.name || '').toUpperCase().trim());

function norm(s){ return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().trim(); }

function extrairCol(item, colId) {
  const c = (item.column_values || []).find(x => x.id === colId);
  if (!c) return null;
  if (c.value) {
    try { return JSON.parse(c.value); } catch { return c.text; }
  }
  return c.text;
}

function extrairDate(item, colId) {
  const v = extrairCol(item, colId);
  if (typeof v === 'object' && v?.date) return v.date;
  if (typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}/.test(v)) return v.slice(0, 10);
  return '';
}

function extrairLabel(item, colId) {
  const v = extrairCol(item, colId);
  if (typeof v === 'object' && v?.label) return String(v.label.text || v.label || '');
  if (typeof v === 'string') return v;
  return '';
}

function extrairDropdownLast(item, colId) {
  const v = extrairCol(item, colId);
  // dropdown chosenValues — pega o ultimo
  if (typeof v === 'object' && Array.isArray(v?.chosenValues)) {
    const arr = v.chosenValues;
    return arr.length ? arr[arr.length - 1].name : '';
  }
  // text fallback
  const txt = (item.column_values || []).find(x => x.id === colId)?.text || '';
  if (!txt) return '';
  // pode vir "NOMEA, NOMEB" — pega ultimo
  const parts = txt.split(',').map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || '';
}

const out = [];
for (const item of ctx.elegiveis) {
  const nomeEmpregado = extrairDropdownLast(item, 'dropdown_mktadatt').trim();
  if (!nomeEmpregado) continue;

  const nomeKey = 'INTERMITENTE - ' + norm(nomeEmpregado);
  if (jaPagas.includes(nomeKey)) {
    continue; // antifraude — ja paga na competencia alvo
  }

  const dataInicio = extrairDate(item, 'date_mktayxhb');
  const dataFim = extrairDate(item, 'date_mktasnwq');
  if (!dataInicio || !dataFim) continue;

  const optanteVtRaw = String(extrairLabel(item, 'optante___vt') || 'NÃO').toUpperCase().trim();
  const optanteVT = optanteVtRaw === 'SIM' || optanteVtRaw === 'SIM*';
  const vtSoVolta = optanteVtRaw === 'SIM*';
  const trabalhaSabado = String(extrairLabel(item, 'color_mktaavmp') || 'NÃO').toUpperCase() === 'SIM';
  const interior = String(extrairLabel(item, 'color__1') || 'NÃO').toUpperCase() === 'SIM';
  const contratoOrgao = norm(extrairLabel(item, 'color_mktcnxwn'));

  out.push({
    json: {
      nomeEmpregado,
      nomeLike: '%' + nomeEmpregado + '%',
      optanteVT,
      vtSoVolta,
      trabalhaSabado,
      interior,
      contratoOrgao,
      dataInicio,
      dataFim,
      boardId: ${BOARD_ENTRADA},
      itemId: Number(item.id),
      // Competencia alvo — propaga via spread ...dados em Code1/etc.
      anoComp: ctx.anoCompAlvo,
      mesComp: ctx.mesCompAlvo,
      competenciaIso: ctx.competenciaIso,
      competenciaLabel: ctx.competenciaLabel,
      _origemMensal: true
    }
  });
}

if (out.length === 0) {
  return [{ json: { _skip: true, _msg: 'Todas elegiveis ja pagas em ' + ctx.competenciaIso } }];
}

return out;`

// ===============================================================
//  jsCode dos nodes EXISTENTES patcheados
// ===============================================================

const CODE_JS1_MENSAL = `// =========================================================
// WF MENSAL — Calcula diasVR/diasVT segundo regra do MENSAL
// VR = min(3, diasUteis(periodo))
// VT = (optanteVT && (interior===true || contrato in [SEDUC INTERIOR, TRE PB])) ? min(3, diasUteis) : 0
// Propaga ...dados pra preservar anoComp/mesComp/etc downstream.
// =========================================================
const dados = $input.first().json;

const inicio = new Date(dados.dataInicio + 'T00:00:00');
const fim = new Date(dados.dataFim + 'T00:00:00');

let diasUteis = 0;
const atual = new Date(inicio);
while (atual <= fim) {
  const d = atual.getDay();
  if (d >= 1 && d <= 5) diasUteis++;
  atual.setDate(atual.getDate() + 1);
}

const diasVR = Math.min(3, diasUteis);

const contratosVTSempre = new Set(['SEDUC INTERIOR', 'TRE PB']);
const contaVT = dados.optanteVT && (dados.interior === true || contratosVTSempre.has(dados.contratoOrgao));
const diasVT = contaVT ? Math.min(3, diasUteis) : 0;

return [{
  json: {
    ...dados,
    diasVR,
    diasVT
  }
}];`

// Patches inline em strings dos Codes existentes
function patchCodeJs2(orig) {
  // Substitui:
  //   const evento = $('Webhook').first().json.body.event;
  //   const contrato = nomeNorm(evento.columnValues.color_mktcnxwn.label.text);
  // Por:
  //   const contrato = nomeNorm(dadosNo3.contratoOrgao);
  let out = orig
  out = out.replace(
    /const evento = \$\('Webhook'\)\.first\(\)\.json\.body\.event;\s*/,
    "// MENSAL: contrato vem direto do Code1 (sem dependencia de Webhook).\n",
  )
  out = out.replace(
    /const contrato = nomeNorm\(evento\.columnValues\.color_mktcnxwn\.label\.text\);/,
    "const contrato = nomeNorm(dadosNo3.contratoOrgao || '');",
  )
  return out
}

function patchCodeSoap(orig) {
  // Code9/Code11: trocar new Date() por leitura de Code1 anoComp/mesComp.
  // Substitui:
  //   const hoje = new Date();
  //   const anoComp = hoje.getFullYear();
  //   const mesComp = hoje.getMonth() + 1;
  // Por:
  //   const ctxMensal = $('Code in JavaScript1').first().json;
  //   const anoComp = ctxMensal.anoComp || (new Date()).getFullYear();
  //   const mesComp = ctxMensal.mesComp || ((new Date()).getMonth() + 1);
  let out = orig
  out = out.replace(
    /const hoje = new Date\(\);\s*\nconst anoComp = hoje\.getFullYear\(\);\s*\nconst mesComp = hoje\.getMonth\(\) \+ 1;/,
    [
      "// MENSAL: competencia vem do Code1 (mes+1 do disparo). Fallback hoje.",
      "const ctxMensal = $('Code in JavaScript1').first().json;",
      "const anoComp = ctxMensal.anoComp || (new Date()).getFullYear();",
      "const mesComp = ctxMensal.mesComp || ((new Date()).getMonth() + 1);",
    ].join("\n"),
  )
  return out
}

// ===============================================================
//  HELPERS HTTP
// ===============================================================

async function n8n(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-N8N-API-KEY": TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`)
  return text ? JSON.parse(text) : {}
}

// ===============================================================
//  MAIN
// ===============================================================

;(async () => {
  console.log("Fetching WF5 PONTUAL FIFO (base do clone)...")
  const wf5 = await n8n("GET", `/workflows/${WF5_ID}`)
  console.log(`  Nodes WF5: ${wf5.nodes.length}`)

  // Deep clone
  const wf = JSON.parse(JSON.stringify(wf5))
  wf.name = "WF MENSAL FIFO"
  delete wf.id
  delete wf.versionId
  delete wf.meta
  delete wf.tags
  delete wf.active
  delete wf.pinData
  delete wf.shared
  delete wf.triggerCount
  delete wf.createdAt
  delete wf.updatedAt

  // ---- Remove nodes do trigger antigo ----
  const REMOVE = new Set(["Webhook", "If3", "If6", "Code in JavaScript"])
  wf.nodes = wf.nodes.filter((n) => !REMOVE.has(n.name))

  // Limpa connections que apontam pros removidos
  for (const src of Object.keys(wf.connections || {})) {
    if (REMOVE.has(src)) {
      delete wf.connections[src]
      continue
    }
    const outs = wf.connections[src].main || []
    for (let i = 0; i < outs.length; i++) {
      outs[i] = (outs[i] || []).filter((link) => !REMOVE.has(link.node))
    }
  }

  // ---- Adiciona novos nodes do trigger MENSAL ----
  const baseX = -2400
  const baseY = 16

  const scheduleNode = {
    parameters: {
      rule: {
        interval: [{ field: "cronExpression", expression: "0 23 * * 1-5" }],
      },
    },
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [baseX, baseY],
    id: "wf-mensal-schedule",
    name: "Schedule Trigger",
  }

  const codeGate = {
    parameters: { jsCode: CODE_GATE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [baseX + 240, baseY],
    id: "wf-mensal-gate",
    name: "Code Gate",
  }

  const ifGate = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [
          {
            id: "gate-cond-1",
            leftValue: "={{ $json.devePassar }}",
            rightValue: true,
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2,
    position: [baseX + 480, baseY],
    id: "wf-mensal-if-gate",
    name: "If Deve Passar",
  }

  const codeBuildQuery = {
    parameters: { jsCode: CODE_BUILD_QUERY_MENSAL },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [baseX + 720, baseY],
    id: "wf-mensal-buildq",
    name: "Code Build Query Mensal",
  }

  const httpMondayElegiveis = {
    parameters: {
      method: "POST",
      url: "https://api.monday.com/v2",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "Authorization", value: MONDAY_TOKEN_HEADER },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ query: $json.query }) }}",
      options: { response: { response: { neverError: false } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [baseX + 960, baseY],
    id: "wf-mensal-http-eleg",
    name: "Buscar Mensal Elegíveis",
  }

  const codeBuildAntifraude = {
    parameters: { jsCode: CODE_BUILD_ANTIFRAUDE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [baseX + 1200, baseY],
    id: "wf-mensal-buildaf",
    name: "Code Build Antifraude",
  }

  const httpMondayAntifraude = {
    parameters: {
      method: "POST",
      url: "https://api.monday.com/v2",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "Authorization", value: MONDAY_TOKEN_HEADER },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ query: $json.query }) }}",
      options: { response: { response: { neverError: false } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [baseX + 1440, baseY],
    id: "wf-mensal-http-af",
    name: "Buscar Solicitacoes Ja Pagas",
  }

  const codeNormalizar = {
    parameters: { jsCode: CODE_NORMALIZAR },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [baseX + 1680, baseY],
    id: "wf-mensal-norm",
    name: "Code Normalizar Mensal",
  }

  const splitBatches = {
    parameters: {
      batchSize: 1,
      options: {},
    },
    type: "n8n-nodes-base.splitInBatches",
    typeVersion: 3,
    position: [baseX + 1920, baseY],
    id: "wf-mensal-split",
    name: "Split Convocacoes",
  }

  wf.nodes.push(
    scheduleNode,
    codeGate,
    ifGate,
    codeBuildQuery,
    httpMondayElegiveis,
    codeBuildAntifraude,
    httpMondayAntifraude,
    codeNormalizar,
    splitBatches,
  )

  // ---- Connect new chain ----
  wf.connections = wf.connections || {}
  wf.connections["Schedule Trigger"] = { main: [[{ node: "Code Gate", type: "main", index: 0 }]] }
  wf.connections["Code Gate"] = { main: [[{ node: "If Deve Passar", type: "main", index: 0 }]] }
  // If Deve Passar tem 2 outputs: true (main[0]) e false (main[1])
  wf.connections["If Deve Passar"] = {
    main: [
      [{ node: "Code Build Query Mensal", type: "main", index: 0 }],
      [], // false branch — sem-op
    ],
  }
  wf.connections["Code Build Query Mensal"] = { main: [[{ node: "Buscar Mensal Elegíveis", type: "main", index: 0 }]] }
  wf.connections["Buscar Mensal Elegíveis"] = { main: [[{ node: "Code Build Antifraude", type: "main", index: 0 }]] }
  wf.connections["Code Build Antifraude"] = { main: [[{ node: "Buscar Solicitacoes Ja Pagas", type: "main", index: 0 }]] }
  wf.connections["Buscar Solicitacoes Ja Pagas"] = { main: [[{ node: "Code Normalizar Mensal", type: "main", index: 0 }]] }
  wf.connections["Code Normalizar Mensal"] = { main: [[{ node: "Split Convocacoes", type: "main", index: 0 }]] }

  // Split In Batches v3: main[0] = batch item, main[1] = done.
  // Plug main[0] em Code in JavaScript1 (que continua a cadeia do WF5).
  wf.connections["Split Convocacoes"] = {
    main: [
      [{ node: "Code in JavaScript1", type: "main", index: 0 }],
      [], // done branch — sem-op (poderia ter um Code de log)
    ],
  }

  // ---- Patch Code in JavaScript1 (regra MENSAL) ----
  const code1 = wf.nodes.find((n) => n.name === "Code in JavaScript1")
  if (!code1) throw new Error('Node "Code in JavaScript1" nao achado no clone')
  code1.parameters.jsCode = CODE_JS1_MENSAL

  // ---- Patch Code in JavaScript2 (remove ref $('Webhook')) ----
  const code2 = wf.nodes.find((n) => n.name === "Code in JavaScript2")
  if (!code2) throw new Error('Node "Code in JavaScript2" nao achado')
  const code2Before = code2.parameters.jsCode || ""
  code2.parameters.jsCode = patchCodeJs2(code2Before)
  if (code2.parameters.jsCode === code2Before) {
    console.warn('  AVISO: patch Code2 nao alterou nada (regex nao bateu)')
  }

  // ---- Patch Code9 (boleto SOAP) ----
  const code9 = wf.nodes.find((n) => n.name === "Code in JavaScript9")
  if (!code9) throw new Error('Node "Code in JavaScript9" nao achado')
  const code9Before = code9.parameters.jsCode || ""
  code9.parameters.jsCode = patchCodeSoap(code9Before)
  if (code9.parameters.jsCode === code9Before) {
    console.warn('  AVISO: patch Code9 nao alterou nada')
  }

  // ---- Patch Code11 (credito SOAP) ----
  const code11 = wf.nodes.find((n) => n.name === "Code in JavaScript11")
  if (!code11) throw new Error('Node "Code in JavaScript11" nao achado')
  const code11Before = code11.parameters.jsCode || ""
  code11.parameters.jsCode = patchCodeSoap(code11Before)
  if (code11.parameters.jsCode === code11Before) {
    console.warn('  AVISO: patch Code11 nao alterou nada')
  }

  // ---- Whitelist settings ----
  const cleanSettings = {}
  const allowed = [
    "executionOrder",
    "saveDataErrorExecution",
    "saveDataSuccessExecution",
    "saveManualExecutions",
    "saveExecutionProgress",
    "timezone",
  ]
  for (const k of allowed) {
    if (wf.settings && wf.settings[k] !== undefined) cleanSettings[k] = wf.settings[k]
  }
  if (!cleanSettings.timezone) cleanSettings.timezone = "America/Sao_Paulo"
  if (!cleanSettings.executionOrder) cleanSettings.executionOrder = "v1"

  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings,
    staticData: wf.staticData,
  }

  console.log("Criando WF MENSAL FIFO no n8n antigo...")
  const created = await n8n("POST", "/workflows", payload)
  const newId = created.id || created.data?.id
  console.log("✓ Criado")
  console.log("  ID:  " + newId)
  console.log("  URL: https://antigoaionscorp-n8n.cloudfy.live/workflow/" + newId)
  console.log()
  console.log("Proximos passos:")
  console.log("  1. Abrir editor n8n, conferir conexoes")
  console.log("  2. Execute manual → bypassa gate UDU ($execution.mode='manual')")
  console.log("  3. Criar convocacoes MENSAL teste no board ENTRADA (Data Inicio mes alvo)")
  console.log("  4. Re-run manual e validar Solicitacao Pagamento + Caju + RM")
})().catch((err) => {
  console.error("ERRO:", err.message || err)
  process.exit(1)
})
