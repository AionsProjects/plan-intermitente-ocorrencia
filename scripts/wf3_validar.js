// ==============================================================
// WF3 - Validar e preparar (monday) — versao JSON-only
// Atestado/declaracao saíram pra feature standalone (/atestados).
// Este node nao toca em long_text_mm3cp43g, numeric_mm3c4cse,
// file_mm3cvt54. So gerencia respostas/sabados/desconto manual.
// O ledger long_text_mm3ct3hg eh MESCLADO: preserva origens de
// atestado/declaracao (gravadas pelo WF Lancar Documentos) e
// soma origens de falta/atraso/desconsideracao.
// ==============================================================

const COL_UUID = 'text_mm2xjend';
const COL_PROTOCOLO = 'text_mm2xsvg6';
const COL_DATA_INICIO = 'date_mm2xtp93';
const COL_DATA_FIM = 'date_mm2xrr5q';
const COL_EXPIRA_EM = 'date_mm2xrvt4';
const COL_CONCLUIDO_EM = 'date_mm2xh1vm';
const COL_EDITADO_EM = 'date_mm2x62fq';
const COL_STATUS = 'color_mm2xkqpc';
const COL_EDITADO = 'boolean_mm2x1aa4';
const COL_QTD_FALTAS = 'numeric_mm2xe2zk';
const COL_QTD_ATRASOS = 'numeric_mm2x18hh';
const COL_TOTAL_MIN = 'numeric_mm2x4fjj';
const COL_DIAS_EXTRAS = 'long_text_mm2x73w6';
const COL_DIAS_DESATIV = 'long_text_mm2xm820';
const COL_RESPOSTAS = 'long_text_mm2xtcpw';
const COL_TOTAL_MIN_DEVIDOS = 'numeric_mm3455ss';
const COL_DIAS_PERDE_VT = 'numeric_mm345xb6';
const COL_DIAS_PERDE_VR = 'numeric_mm34a3ph';
const COL_TRABALHA_SAB = 'color_mm34yyet';
const COL_QTD_SABADOS_EX = 'numeric_mm3bvgy';
const COL_SABADOS_EX_TXT = 'text_mm3bfn6h';
const COL_BENEF_LEDGER = 'long_text_mm3ct3hg';
const COL_STATUS_CANCELAMENTO = 'color_mm3b9v4n';
const COL_CONTRATO = 'text_mm2x1ktb';
const COL_CHAPA = 'text_mm33v9kp';
const COL_OPTANTE_VT = 'color_mm34ry47';
const COL_ITEM_ORIGEM = 'link_mm2x1rk0';

const webhook = $('Webhook1').first().json;
const body = webhook.body || {};
const payload = (typeof body === 'object') ? body : {};

const uuid = webhook.query?.uuid || payload.uuid;
const respostas = Array.isArray(payload.respostas) ? payload.respostas : [];
const protocolo = payload.protocolo || null;
const diasExtras = Array.isArray(payload.dias_extras) ? payload.dias_extras : [];
const diasDesativ = Array.isArray(payload.dias_desativados) ? payload.dias_desativados : [];
const sabadosExtras = Array.isArray(payload.sabados_extras)
  ? payload.sabados_extras.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
  : [];
const ehCorrecaoFlag = !!payload.eh_correcao;

const all = $input.all();
function firstRealItem() { for (const it of all) { const j = it.json; if (j && j.id && (j.column_values || j.name)) return j; } return null; }
const item = firstRealItem();
if (!item) return [{ json: { _statusCode: 404, _erro: 'nao_encontrado', mensagem: 'Processamento nao encontrado.' } }];

const columnValues = item.column_values ?? [];
const getCol = (id) => columnValues.find(c => c.id === id);
const text = (id) => getCol(id)?.text ?? null;
const rawValue = (id) => getCol(id)?.value ?? null;

function parseCheckbox(id) { const v = rawValue(id); if (!v) return false; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return p?.checked === true || p?.checked === 'true'; } catch { return false; } }
function parseLongTextJson(id, fallback) { const t = text(id); if (!t) return fallback; try { return JSON.parse(t); } catch { return fallback; } }
function normLabel(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
function dateValue(d, withTime) {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const yyyy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  if (!withTime) return { date: `${yyyy}-${mm}-${dd}` };
  const hh = String(x.getUTCHours()).padStart(2, '0');
  const mi = String(x.getUTCMinutes()).padStart(2, '0');
  const ss = String(x.getUTCSeconds()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}` };
}
function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
function isSabado(d) { return dow(d) === 6; }
function isDomingo(d) { return dow(d) === 0; }
function jornadaMin(d) { if (isDomingo(d)) return 0; if (isSabado(d)) return 240; return 480; }
function rangeDatas(inicio, fim) { const out = []; const cur = new Date(inicio + 'T00:00:00Z'); const end = new Date(fim + 'T00:00:00Z'); while (cur <= end) { out.push(cur.toISOString().slice(0,10)); cur.setUTCDate(cur.getUTCDate()+1); } return out; }

const statusLabel = text(COL_STATUS);
const statusNorm = normLabel(statusLabel);
const dataInicio = text(COL_DATA_INICIO);
const dataFim = text(COL_DATA_FIM);
const expiraEm = text(COL_EXPIRA_EM);
const concluidoEmAtual = text(COL_CONCLUIDO_EM);
const jaEstavaEditado = parseCheckbox(COL_EDITADO);
const agora = new Date();

if (statusNorm === 'EXPIRADO' || (expiraEm && agora > new Date(expiraEm + 'T23:59:59Z') && statusNorm !== 'CONCLUIDO')) {
  return [{ json: { _statusCode: 410, _erro: 'expirado', mensagem: 'Link expirado.' } }];
}
const statusCancelamento = text(COL_STATUS_CANCELAMENTO);
const statusCancelamentoNorm = normLabel(statusCancelamento);
if (statusCancelamentoNorm === 'CANCELADA' || statusCancelamentoNorm === 'CANCELADA PARCIALMENTE') {
  return [{ json: { _statusCode: 409, _erro: 'convocacao_cancelada', mensagem: 'Esta convocacao foi cancelada.', status_cancelamento: statusCancelamento } }];
}
if (statusNorm === 'CONCLUIDO' && !ehCorrecaoFlag) {
  return [{ json: { _statusCode: 409, _erro: 'ja_concluido', mensagem: 'Este formulario ja foi finalizado.' } }];
}
if (!protocolo || !/^PROT-[A-Z0-9-]+$/i.test(protocolo)) {
  return [{ json: { _statusCode: 400, _erro: 'protocolo_invalido', mensagem: 'Protocolo ausente ou invalido.' } }];
}

const sabadosExtrasAnterioresTxt = text(COL_SABADOS_EX_TXT) || '';
const sabadosExtrasAnteriores = sabadosExtrasAnterioresTxt.split(/[,;\n]/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
const setAnteriores = new Set(sabadosExtrasAnteriores);
const setAtuais = new Set(sabadosExtras);
const sabadosRemovidos = sabadosExtrasAnteriores.filter(d => !setAtuais.has(d));
if (sabadosRemovidos.length > 0) {
  return [{ json: { _statusCode: 409, _erro: 'sabados_pagos_removidos', mensagem: `Sabados extras ja pagos nao podem ser removidos: ${sabadosRemovidos.join(', ')}.`, sabados_removidos: sabadosRemovidos } }];
}
const sabadosExtrasNovos = sabadosExtras.filter(d => !setAnteriores.has(d));
const sabadosExtrasFinal = [...new Set([...sabadosExtrasAnteriores, ...sabadosExtras])].sort();
const sabadosExtrasSet = new Set(sabadosExtrasFinal);

const trabalhaSabado = String(text(COL_TRABALHA_SAB) || '').toUpperCase() === 'SIM';
function diaConta(d) {
  if (isDomingo(d)) return false;
  if (isSabado(d)) return trabalhaSabado || sabadosExtrasSet.has(d);
  return true;
}

const diasBase = [];
if (dataInicio && dataFim) {
  for (const d of rangeDatas(dataInicio, dataFim)) {
    if (!isDomingo(d) && (!isSabado(d) || trabalhaSabado)) diasBase.push(d);
  }
}
const desativ = new Set(diasDesativ);
const diasValidos = [...new Set([...diasBase, ...diasExtras, ...sabadosExtrasFinal])].filter(d => !desativ.has(d)).sort();

const mapaRespostas = new Map(respostas.map(r => [r.data, r]));
const respostasFinal = [];
for (const dia of diasValidos) {
  const r = mapaRespostas.get(dia);
  if (!r || !r.tipo) return [{ json: { _statusCode: 400, _erro: 'resposta_faltando', mensagem: `Resposta faltando para o dia ${dia}.` } }];
  if (!['sem_ocorrencia','falta','atraso'].includes(r.tipo)) return [{ json: { _statusCode: 400, _erro: 'tipo_invalido', mensagem: `Tipo invalido em ${dia}: ${r.tipo}` } }];
  const minutos = r.minutos_atraso;
  if (r.tipo === 'atraso' && (!Number.isInteger(minutos) || minutos <= 0)) return [{ json: { _statusCode: 400, _erro: 'minutos_invalidos', mensagem: `Minutos de atraso invalidos em ${dia}.` } }];
  respostasFinal.push({ data: dia, tipo: r.tipo, minutos_atraso: r.tipo === 'atraso' ? minutos : null });
}

// Le ledger anterior pra mesclar — preserva origens de atestado/declaracao
const ledgerAnterior = parseLongTextJson(COL_BENEF_LEDGER, {}) || {};
const ledgerVRAtestado = {};
const ledgerVTAtestado = {};
for (const [data, entry] of Object.entries(ledgerAnterior)) {
  if (entry && Array.isArray(entry.origens)) {
    const origensDoc = entry.origens.filter(o => o.startsWith('atestado:') || o.startsWith('declaracao:'));
    if (origensDoc.length > 0) {
      ledgerVRAtestado[data] = entry.vr_percentual || 0;
      ledgerVTAtestado[data] = entry.vt_percentual || 0;
    }
  }
}

const descontosPorDiaMap = new Map();
function entry(d) {
  if (!descontosPorDiaMap.has(d)) descontosPorDiaMap.set(d, { data: d, vr: false, vt: false, vr_tipo: null, vr_percentual: 0, minutos_atraso: 0, origens: [] });
  return descontosPorDiaMap.get(d);
}
function addDesconto(d, opts) {
  if (!diaConta(d)) return;
  const e = entry(d);
  if (opts.vt) e.vt = true;
  if (opts.vr) {
    e.vr = true;
    if (opts.vr_tipo === 'atraso') {
      if (e.vr_tipo !== 'integral') e.vr_tipo = 'atraso';
      if (opts.minutos_atraso) e.minutos_atraso = Math.max(e.minutos_atraso || 0, opts.minutos_atraso);
    } else {
      const pct = opts.vr_percentual ?? 100;
      e.vr_percentual = Math.min(100, (e.vr_percentual || 0) + pct);
      e.vr_tipo = e.vr_percentual >= 100 ? 'integral' : 'parcial';
    }
  }
  if (opts.origem && !e.origens.includes(opts.origem)) e.origens.push(opts.origem);
}

for (const d of diasDesativ) {
  if (!diaConta(d)) continue;
  addDesconto(d, { vt: true, vr: !isSabado(d), vr_tipo: 'integral', origem: 'desconsiderado' });
}
for (const r of respostasFinal) {
  if (!diaConta(r.data)) continue;
  if (r.tipo === 'falta') addDesconto(r.data, { vt: true, vr: !isSabado(r.data), vr_tipo: 'integral', origem: 'falta' });
  if (r.tipo === 'atraso' && !isSabado(r.data)) addDesconto(r.data, { vr: true, vt: false, vr_tipo: 'atraso', minutos_atraso: r.minutos_atraso || 0, origem: 'atraso' });
}

const descontosPorDia = [...descontosPorDiaMap.values()].sort((a, b) => a.data.localeCompare(b.data));
const qtdFaltas = respostasFinal.filter(r => r.tipo === 'falta').length;
const qtdAtrasos = respostasFinal.filter(r => r.tipo === 'atraso').length;
const totalMin = respostasFinal.reduce((acc, r) => acc + (r.tipo === 'atraso' ? (r.minutos_atraso || 0) : 0), 0);
const diasPerdeVT = descontosPorDia.filter(d => d.vt).length;
const diasPerdeVR = descontosPorDia.reduce((acc, d) => acc + (d.vr && d.vr_tipo !== 'atraso' ? ((d.vr_percentual || 100) / 100) : 0), 0);
let totalMinDevidos = 0;
for (const d of descontosPorDia) {
  if (d.vt || d.origens.includes('falta') || d.origens.includes('desconsiderado')) totalMinDevidos += jornadaMin(d.data);
  else if (d.vr_tipo === 'atraso') totalMinDevidos += d.minutos_atraso || 0;
  else if (d.vr) totalMinDevidos += Math.round((jornadaMin(d.data) || 0) * ((d.vr_percentual || 100) / 100));
}

// Mescla ledger: preserva entradas de atestado/declaracao existentes,
// soma o que este WF descontou em cima sem ultrapassar 100% por beneficio/data.
const ledger = { ...ledgerAnterior };
for (const d of descontosPorDia) {
  const ja = ledger[d.data] || { vr: false, vt: false, vr_percentual: 0, vt_percentual: 0, origens: [] };
  const vrAteste = ledgerVRAtestado[d.data] || 0;
  const vtAteste = ledgerVTAtestado[d.data] || 0;
  let vrPct = 0;
  if (d.vr) {
    if (d.vr_tipo === 'atraso' && d.minutos_atraso) {
      const jor = jornadaMin(d.data) || 480;
      vrPct = Math.min(100, Math.round((d.minutos_atraso / jor) * 10000) / 100);
    } else {
      vrPct = Math.min(100, d.vr_percentual || 100);
    }
  }
  // VR ja descontado por atestado/declaracao -> nao soma novamente
  vrPct = Math.max(0, Math.min(100, vrPct - vrAteste));
  const vtPct = d.vt ? Math.max(0, 100 - vtAteste) : 0;
  const novasOrigens = [...new Set([...(ja.origens || []), ...d.origens])];
  const novoVRTotal = Math.min(100, vrAteste + vrPct);
  const novoVTTotal = Math.min(100, vtAteste + vtPct);
  ledger[d.data] = {
    vr: novoVRTotal > 0,
    vt: novoVTTotal > 0,
    vr_percentual: novoVRTotal,
    vt_percentual: novoVTTotal,
    origens: novasOrigens
  };
  if (d.vr_tipo) ledger[d.data].vr_tipo = d.vr_tipo;
  if (d.minutos_atraso) ledger[d.data].minutos_atraso = d.minutos_atraso;
}

const ehReedicao = statusNorm === 'CONCLUIDO' || ehCorrecaoFlag;
const editadoFlag = ehReedicao || jaEstavaEditado;

const columnValuesUpdate = {
  [COL_STATUS]: { label: 'Concluído' },
  [COL_PROTOCOLO]: protocolo,
  [COL_CONCLUIDO_EM]: dateValue(concluidoEmAtual ? concluidoEmAtual : agora.toISOString(), true),
  [COL_EDITADO]: { checked: editadoFlag ? 'true' : 'false' },
  [COL_EDITADO_EM]: ehReedicao ? dateValue(agora.toISOString(), true) : null,
  [COL_QTD_FALTAS]: String(qtdFaltas),
  [COL_QTD_ATRASOS]: String(qtdAtrasos),
  [COL_TOTAL_MIN]: String(totalMin),
  [COL_TOTAL_MIN_DEVIDOS]: String(totalMinDevidos),
  [COL_DIAS_PERDE_VT]: String(diasPerdeVT),
  [COL_DIAS_PERDE_VR]: String(diasPerdeVR),
  [COL_DIAS_EXTRAS]: { text: JSON.stringify(diasExtras) },
  [COL_DIAS_DESATIV]: { text: JSON.stringify(diasDesativ) },
  [COL_RESPOSTAS]: { text: JSON.stringify(respostasFinal) },
  [COL_QTD_SABADOS_EX]: String(sabadosExtrasFinal.length),
  [COL_SABADOS_EX_TXT]: sabadosExtrasFinal.length ? sabadosExtrasFinal.join(', ') : '',
  [COL_BENEF_LEDGER]: { text: JSON.stringify(ledger) }
};
for (const k of Object.keys(columnValuesUpdate)) if (columnValuesUpdate[k] === null || columnValuesUpdate[k] === undefined) delete columnValuesUpdate[k];

// Extrai item_origem_id do link column (formato YYYY-MM-DD agnostico: monday
// devolve em `value` JSON { url, text } — extrai o id do final da URL)
function extrairItemOrigemId() {
  const link = getCol(COL_ITEM_ORIGEM);
  if (!link) return null;
  const v = link.value;
  let url = null;
  if (v) {
    try { const p = typeof v === 'string' ? JSON.parse(v) : v; url = p?.url || null; } catch {}
  }
  if (!url) url = link.text || null;
  if (!url) return null;
  const m = String(url).match(/pulses\/(\d+)/);
  return m ? m[1] : null;
}

const nome = item.name;
const chapa = String(text(COL_CHAPA) || '').trim();
const contrato = text(COL_CONTRATO) || null;
const optanteVtTxt = text(COL_OPTANTE_VT) || 'NAO';
const itemOrigemId = extrairItemOrigemId();
const concluidoEmFinal = concluidoEmAtual || agora.toISOString().slice(0, 19).replace('T', ' ');

return [{
  json: {
    _statusCode: 200,
    item_id: String(item.id),
    item_origem_id: itemOrigemId,
    uuid,
    nome,
    chapa,
    contrato,
    optante_vt: optanteVtTxt,
    data_inicio: dataInicio,
    data_fim: dataFim,
    protocolo,
    column_values_json: JSON.stringify(columnValuesUpdate),
    respostas: respostasFinal,
    descontos_por_dia: descontosPorDia,
    qtd_faltas: qtdFaltas,
    qtd_atrasos: qtdAtrasos,
    total_min: totalMin,
    total_min_atraso: totalMin,
    total_min_devidos: totalMinDevidos,
    dias_perde_vt: diasPerdeVT,
    dias_perde_vr: diasPerdeVR,
    sabados_extras_final: sabadosExtrasFinal,
    sabados_extras_novos: sabadosExtrasNovos,
    qtd_sabados_extras: sabadosExtrasFinal.length,
    qtd_sabados_extras_novos: sabadosExtrasNovos.length,
    eh_correcao: ehCorrecaoFlag,
    eh_reedicao: ehReedicao,
    concluido_em: concluidoEmAtual || agora.toISOString(),
    concluido_em_final: concluidoEmFinal,
    editado: editadoFlag,
    editado_em: ehReedicao ? agora.toISOString() : null
  }
}];
