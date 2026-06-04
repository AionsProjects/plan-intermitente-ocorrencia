#!/usr/bin/env node
/**
 * Pontual: envia artefatos Caju para as pastas Drive da convocacao.
 *
 * O fluxo ativo antigo cria o pedido Caju e a solicitacao Monday, mas o WF
 * Drive recebia apenas JSON, sem binario. Este patch:
 * - busca o pedido Caju depois da confirmacao;
 * - gera um arquivo de boleto PIX (QR Code PNG quando a Caju devolver encodedImage;
 *   fallback TXT com link do summary quando nao devolver);
 * - gera um comprovante TXT do pedido/summary;
 * - envia ambos via multipart para o WF Drive central novo.
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

  findNode(wf, "Setar Status AUTOMACAO - OK")
  findNode(wf, "HTTP Request2")
  findNode(wf, "HTTP Request6")

  const buscarPedido = {
    parameters: {
      method: "GET",
      url: "=https://services.caju.com.br/partners/v1/voucher/allowance_order/{{ $('HTTP Request6').first().json.allowanceOrderId }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: "Authorization",
            value: "=Bearer {{ $('HTTP Request2').first().json.access_token }}",
          },
          {
            name: "Accept",
            value: "application/json",
          },
        ],
      },
      options: {
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [19616, 4240],
    id: "pontual-caju-buscar-pedido-boleto",
    name: "Buscar Pedido Caju Boleto",
  }

  const prepararArquivos = {
    parameters: {
      jsCode: `const dados = $('Code in JavaScript8').first().json || {};

function firstJson(name) {
  try { return $(name).first().json || {}; } catch { return {}; }
}

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeName(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'arquivo';
}

function toBase64Text(text) {
  return Buffer.from(String(text || ''), 'utf8').toString('base64');
}

function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    for (const p of path.split('.')) {
      if (cur == null) break;
      cur = cur[p];
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return null;
}

function stripDataUri(v) {
  return String(v || '').replace(/^data:image\\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
}

const pedido = $input.first().json || {};
const boletoOrderId = String(firstJson('HTTP Request6').allowanceOrderId || dados.boletoOrderId || '');
const cajuSummaryUrl = boletoOrderId ? 'https://empresa.caju.com.br/classic/#/order/' + boletoOrderId + '/summary' : '';

let solicitacaoId = null;
try {
  const resp = firstJson('Criar Solicitacao Pgto Beneficio');
  solicitacaoId = resp?.data?.create_item?.id || resp?.body?.data?.create_item?.id || resp?.id || null;
} catch {}

let entradaCtx = {};
try { entradaCtx = firstJson('Preparar Update Entrada Drive Pontual'); } catch {}
const itemEntradaId =
  dados.itemEntradaId ||
  dados.item_entrada_id ||
  entradaCtx.itemEntradaId ||
  dados.itemId ||
  null;

const common = {
  nome: dados.nomeEmpregado || dados.nome || '',
  chapa: dados.chapaRM || dados.chapa || '',
  cpf: dados.cpfCaju || dados.cpf || '',
  contrato: dados.contrato || '',
  data_inicio: dados.dataInicio || dados.data_inicio || '',
  data_fim: dados.dataFim || dados.data_fim || '',
  item_entrada_id: itemEntradaId,
  item_solicitacao_id: solicitacaoId,
  uuid: dados.uuid || dados.protocoloUUID || '',
  atualizar_monday: true,
  boletoOrderId,
  cajuSummaryUrl,
};

const encodedImage = stripDataUri(pick(pedido, [
  'pixCode.encodedImage',
  'data.pixCode.encodedImage',
  'body.pixCode.encodedImage',
  'payment.pixCode.encodedImage',
]));

const pixPayload = pick(pedido, [
  'pixCode.emv',
  'pixCode.payload',
  'pixCode.copyPaste',
  'data.pixCode.emv',
  'data.pixCode.payload',
  'data.pixCode.copyPaste',
]) || '';

const valorVR = money(dados.boletoVR);
const valorVT = money(dados.boletoVT);
const total = Math.round((valorVR + valorVT) * 100) / 100;
const baseFile = safeName((dados.nomeEmpregado || 'intermitente') + '-' + (boletoOrderId || 'caju'));
const now = new Date().toISOString();

const out = [];

if (encodedImage) {
  out.push({
    json: {
      ...common,
      tipo: 'caju_boleto',
      nome_arquivo: 'boleto-pix-caju-' + baseFile + '.png',
      gerar_planilha_conferencia: true,
      origem_arquivo: 'caju.pixCode.encodedImage',
    },
    binary: {
      file: {
        data: encodedImage,
        mimeType: 'image/png',
        fileName: 'boleto-pix-caju-' + baseFile + '.png',
      },
    },
  });
} else {
  const fallback = [
    'Boleto Caju - referencia do pedido',
    '',
    'Pedido Caju: ' + (boletoOrderId || '(sem id)'),
    'Summary: ' + (cajuSummaryUrl || '(sem link)'),
    'Nome: ' + (common.nome || ''),
    'Chapa: ' + (common.chapa || ''),
    'CPF: ' + (common.cpf || ''),
    'Contrato: ' + (common.contrato || ''),
    'Periodo: ' + (common.data_inicio || '') + ' a ' + (common.data_fim || ''),
    'VR boleto: R$ ' + valorVR.toFixed(2),
    'VT boleto: R$ ' + valorVT.toFixed(2),
    'Total: R$ ' + total.toFixed(2),
    pixPayload ? 'PIX copia e cola: ' + pixPayload : '',
    '',
    'Obs.: a API Caju nao retornou imagem encodedImage nesta consulta; este arquivo guarda o link do pedido.',
    'Gerado em: ' + now,
  ].filter(Boolean).join('\\n');
  out.push({
    json: {
      ...common,
      tipo: 'caju_boleto',
      nome_arquivo: 'boleto-caju-' + baseFile + '.txt',
      gerar_planilha_conferencia: true,
      origem_arquivo: 'fallback.summary',
      warning: 'caju_encoded_image_ausente',
    },
    binary: {
      file: {
        data: toBase64Text(fallback),
        mimeType: 'text/plain',
        fileName: 'boleto-caju-' + baseFile + '.txt',
      },
    },
  });
}

const comprovante = [
  'Comprovante de pedido Caju',
  '',
  'Pedido Caju: ' + (boletoOrderId || '(sem id)'),
  'Summary: ' + (cajuSummaryUrl || '(sem link)'),
  'Solicitacao Monday: ' + (solicitacaoId || '(sem id)'),
  'Item Entrada/Plan: ' + (itemEntradaId || '(sem id)'),
  'Nome: ' + (common.nome || ''),
  'Chapa: ' + (common.chapa || ''),
  'CPF: ' + (common.cpf || ''),
  'Contrato: ' + (common.contrato || ''),
  'Periodo: ' + (common.data_inicio || '') + ' a ' + (common.data_fim || ''),
  'VR boleto: R$ ' + valorVR.toFixed(2),
  'VT boleto: R$ ' + valorVT.toFixed(2),
  'Total boleto: R$ ' + total.toFixed(2),
  pixPayload ? 'PIX copia e cola: ' + pixPayload : '',
  '',
  'Gerado automaticamente em: ' + now,
].filter(Boolean).join('\\n');

out.push({
  json: {
    ...common,
    tipo: 'caju_comprovante',
    nome_arquivo: 'comprovante-caju-' + baseFile + '.txt',
    gerar_planilha_conferencia: false,
    origem_arquivo: 'pontual.caju.summary',
  },
  binary: {
    file: {
      data: toBase64Text(comprovante),
      mimeType: 'text/plain',
      fileName: 'comprovante-caju-' + baseFile + '.txt',
    },
  },
});

return out;`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [19840, 4240],
    id: "pontual-caju-preparar-arquivos-drive",
    name: "Preparar Arquivos Caju Drive",
  }

  const dispararDrive = {
    parameters: {
      method: "POST",
      url: "https://aionscorp-n8n.cloudfy.live/webhook/drive-intermitente-arquivar",
      sendBody: true,
      contentType: "multipart-form-data",
      bodyParameters: {
        parameters: [
          {
            name: "payload",
            value: "={{ JSON.stringify($json) }}",
          },
          {
            parameterType: "formBinaryData",
            name: "file",
            inputDataFieldName: "file",
          },
        ],
      },
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
    position: [20064, 4240],
    id: "pontual-caju-disparar-drive-arquivos",
    name: "Disparar Drive Arquivos Caju",
    onError: "continueRegularOutput",
  }

  upsertNode(wf, buscarPedido)
  upsertNode(wf, prepararArquivos)
  upsertNode(wf, dispararDrive)

  // Substitui o caminho JSON-only antigo por um caminho multipart com binarios.
  wf.connections["Setar Status AUTOMACAO - OK"] = {
    main: [[{ node: "Buscar Pedido Caju Boleto", type: "main", index: 0 }]],
  }
  wf.connections["Buscar Pedido Caju Boleto"] = {
    main: [[{ node: "Preparar Arquivos Caju Drive", type: "main", index: 0 }]],
  }
  wf.connections["Preparar Arquivos Caju Drive"] = {
    main: [[{ node: "Disparar Drive Arquivos Caju", type: "main", index: 0 }]],
  }
  wf.connections["Disparar Drive Arquivos Caju"] = { main: [[]] }

  // Mantem os nodes antigos no canvas como legado, mas sem disparo por engano.
  if (wf.connections["Preparar Job Drive Caju Boleto"]) {
    wf.connections["Preparar Job Drive Caju Boleto"] = { main: [[]] }
  }
  if (wf.connections["Disparar Drive Caju Boleto Async"]) {
    wf.connections["Disparar Drive Caju Boleto Async"] = { main: [[]] }
  }

  await n8n(OLD_BASE, OLD_KEY, "PUT", `/workflows/${WF_PONTUAL_OLD}`, cleanPayload(wf))
  console.log("OK Pontual antigo: boleto/comprovante Caju enviados ao Drive central via multipart.")
}

patchPontualOld().catch((err) => {
  console.error(err)
  process.exit(1)
})
