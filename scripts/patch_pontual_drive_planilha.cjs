#!/usr/bin/env node
/**
 * Corrige o encadeamento Pontual -> Drive -> Planilha Conferencia.
 *
 * Problemas vistos em execucao real:
 * - Pontual enviava item_entrada_id=null ao Drive.
 * - Pontual chamava a planilha com item_entrada_id=18408773953 (board id),
 *   entao a planilha nao achava o item e subia XLSX na raiz do Drive.
 * - Drive criava a pasta, mas a planilha era disparada cedo demais, sem
 *   pasta_convocacao_drive_id.
 *
 * Este patch:
 * 1) Pontual antigo ativo: manda dados.itemId como item_entrada_id ao Drive
 *    e deixa o Drive disparar a planilha depois de resolver as pastas.
 * 2) Drive central novo: quando payload.gerar_planilha_conferencia=true,
 *    chama /gerar-planilha-conferencia com item e pasta corretos.
 * 3) Planilha Conferencia: bloqueia payload incompleto para nao cair na raiz.
 */

const OLD_KEY = process.env.N8N_ANTIGO_API_KEY
const NEW_KEY = process.env.N8N_API_KEY

if (!OLD_KEY || !NEW_KEY) {
  console.error("Defina N8N_ANTIGO_API_KEY e N8N_API_KEY antes de rodar.")
  process.exit(1)
}

const OLD_BASE = "https://antigoaionscorp-n8n.cloudfy.live/api/v1"
const NEW_BASE = "https://aionscorp-n8n.cloudfy.live/api/v1"

const WF_PONTUAL_OLD = "Bso4k6ddDNcRmU83"
const WF_DRIVE_NEW = "XRdAYO9dx2jSU8ps"
const WF_PLANILHA_NEW = "aBXCqYHPtZNjDMOM"

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`)
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

  const job = findNode(wf, "Preparar Job Drive Caju Boleto")
  job.parameters.jsCode = `const dados = $('Code in JavaScript8').first().json;
let boletoOrderId = '';
try { boletoOrderId = String($('HTTP Request6').first().json.allowanceOrderId || ''); } catch {}

let solicitacaoId = null;
try {
  const resp = $('Criar Solicitacao Pgto Beneficio').first().json || {};
  solicitacaoId = resp?.data?.create_item?.id || resp?.body?.data?.create_item?.id || null;
} catch {}

const itemEntradaId = dados.itemEntradaId || dados.itemId || null;
const cajuSummaryUrl = boletoOrderId ? 'https://empresa.caju.com.br/classic/#/order/' + boletoOrderId + '/summary' : '';

return [{
  json: {
    tipo: 'caju_boleto',
    nome: dados.nomeEmpregado,
    chapa: dados.chapaRM,
    cpf: dados.cpfCaju,
    contrato: dados.contrato,
    data_inicio: dados.dataInicio,
    data_fim: dados.dataFim,
    item_entrada_id: itemEntradaId,
    item_solicitacao_id: solicitacaoId,
    uuid: dados.uuid || dados.protocoloUUID || '',
    nome_arquivo: boletoOrderId ? 'boleto-caju-' + boletoOrderId + '.pdf' : 'boleto-caju.pdf',
    atualizar_monday: true,
    gerar_planilha_conferencia: true,
    boletoOrderId,
    cajuSummaryUrl
  }
}];`

  // A planilha agora e responsabilidade do WF Drive, que possui os IDs das pastas.
  // Evita chamada antiga com pasta vazia, que fazia upload do XLSX na raiz.
  wf.connections["Disparar Drive Caju Boleto Async"] = { main: [[]] }

  await n8n(OLD_BASE, OLD_KEY, "PUT", `/workflows/${WF_PONTUAL_OLD}`, cleanPayload(wf))
  console.log("OK Pontual antigo: item_entrada_id correto e planilha delegada ao Drive.")
}

async function patchDriveNew() {
  const wf = await n8n(NEW_BASE, NEW_KEY, "GET", `/workflows/${WF_DRIVE_NEW}`)

  const prep = {
    parameters: {
      jsCode: `const state = $json || {};
const p = state.payload || {};
const deveGerar = p.gerar_planilha_conferencia === true;
const itemEntradaId = p.item_entrada_id || p.itemEntradaId || state.resolved_item_entrada_id || null;
const pastaConvocacaoId = state.folders?.convocacao?.id || '';
const pastaPessoaId = state.folders?.pessoa?.id || '';

if (!deveGerar || !itemEntradaId || !pastaConvocacaoId) {
  return [{
    json: {
      ...state,
      skipPlanilhaConferencia: true,
      motivoPlanilhaConferencia: !deveGerar ? 'nao_solicitada' : (!itemEntradaId ? 'item_entrada_id_ausente' : 'pasta_convocacao_ausente')
    }
  }];
}

return [{
  json: {
    ...state,
    skipPlanilhaConferencia: false,
    payloadPlanilhaConferencia: {
      item_entrada_id: String(itemEntradaId),
      uuid: p.uuid || '',
      chapa: p.chapa || '',
      nome: p.nome || p.empregado_nome || '',
      pasta_convocacao_drive_id: pastaConvocacaoId,
      pasta_pessoa_drive_id: pastaPessoaId
    }
  }
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4384, 416],
    id: "drive-preparar-planilha-conferencia",
    name: "Preparar Planilha Conferencia Drive",
  }

  const iff = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [
          {
            id: "tem-planilha-conferencia",
            leftValue: "={{ !$json.skipPlanilhaConferencia }}",
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
    position: [4608, 416],
    id: "drive-tem-planilha-conferencia",
    name: "Tem Planilha Conferencia Drive?",
  }

  const call = {
    parameters: {
      method: "POST",
      url: "https://aionscorp-n8n.cloudfy.live/webhook/gerar-planilha-conferencia",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.payloadPlanilhaConferencia) }}",
      options: { response: { response: { neverError: true } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [4832, 400],
    id: "drive-disparar-planilha-conferencia",
    name: "Disparar Planilha Conferencia Drive",
  }

  upsertNode(wf, prep)
  upsertNode(wf, iff)
  upsertNode(wf, call)

  const existing = wf.connections["Preparar Updates Monday Drive Async"]?.main?.[0] || []
  const withoutOld = existing.filter((c) => c.node !== prep.name)
  wf.connections["Preparar Updates Monday Drive Async"] = {
    main: [[...withoutOld, { node: prep.name, type: "main", index: 0 }]],
  }
  wf.connections[prep.name] = { main: [[{ node: iff.name, type: "main", index: 0 }]] }
  wf.connections[iff.name] = { main: [[{ node: call.name, type: "main", index: 0 }], []] }
  wf.connections[call.name] = { main: [[]] }

  await n8n(NEW_BASE, NEW_KEY, "PUT", `/workflows/${WF_DRIVE_NEW}`, cleanPayload(wf))
  console.log("OK Drive: dispara planilha depois de resolver pasta da convocacao.")
}

async function patchPlanilhaNew() {
  const wf = await n8n(NEW_BASE, NEW_KEY, "GET", `/workflows/${WF_PLANILHA_NEW}`)

  const validar = {
    parameters: {
      jsCode: `const respMonday = $json || {};
const body = $('Webhook').first().json.body || {};
const item = respMonday?.data?.items?.[0] || null;
const pastaConvocacaoId = String(body.pasta_convocacao_drive_id || '').trim();

if (!body.item_entrada_id || !item) {
  return [{ json: { _statusCode: 404, ok: false, _skip: true, erro: 'item_entrada_nao_encontrado', mensagem: 'Item ENTRADA nao encontrado para gerar planilha.', item_entrada_id: body.item_entrada_id || null } }];
}
if (!pastaConvocacaoId) {
  return [{ json: { _statusCode: 400, ok: false, _skip: true, erro: 'pasta_convocacao_ausente', mensagem: 'pasta_convocacao_drive_id e obrigatorio para nao subir planilha na raiz.', item_entrada_id: body.item_entrada_id } }];
}
return [{ json: { _statusCode: 200, ok: true, _skip: false, item_entrada_id: body.item_entrada_id, pasta_convocacao_drive_id: pastaConvocacaoId } }];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [576, 144],
    id: "planilha-validar-payload",
    name: "Validar Payload Planilha",
  }

  const iff = {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [
          {
            id: "pode-gerar-planilha",
            leftValue: "={{ !$json._skip }}",
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
    position: [800, 144],
    id: "planilha-pode-gerar",
    name: "Pode Gerar Planilha?",
  }

  const respErro = {
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify($json) }}",
      options: {
        responseCode: "={{ $json._statusCode || 400 }}",
        responseHeaders: { entries: [{ name: "Content-Type", value: "application/json" }] },
      },
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [1024, 320],
    id: "planilha-responder-erro",
    name: "Responder Erro Planilha",
  }

  upsertNode(wf, validar)
  upsertNode(wf, iff)
  upsertNode(wf, respErro)

  wf.connections["Buscar Item + Schema"] = { main: [[{ node: validar.name, type: "main", index: 0 }]] }
  wf.connections[validar.name] = { main: [[{ node: iff.name, type: "main", index: 0 }]] }
  wf.connections[iff.name] = {
    main: [
      [{ node: "Criar Subpasta CONFERENCIA", type: "main", index: 0 }],
      [{ node: respErro.name, type: "main", index: 0 }],
    ],
  }

  await n8n(NEW_BASE, NEW_KEY, "PUT", `/workflows/${WF_PLANILHA_NEW}`, cleanPayload(wf))
  console.log("OK Planilha: payload incompleto nao sobe mais arquivo na raiz.")
}

;(async () => {
  await patchPontualOld()
  await patchDriveNew()
  await patchPlanilhaNew()
})().catch((err) => {
  console.error("ERRO:", err.stack || err.message || err)
  process.exit(1)
})
