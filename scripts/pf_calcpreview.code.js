const prep = $('Preparar').first().json;
if (prep._abort) return [{ json: prep }];
const resp = $input.first().json;
if (Array.isArray(resp.errors) && resp.errors.length) {
  return [{ json: { _statusCode: 500, ok: false, erro: 'erro_monday', mensagem: resp.errors.map(e => e.message).join(' | ') } }];
}
let unidadesRm = {};
try { unidadesRm = $('Buscar Unidades RM').first().json || {}; } catch (e) {}
if (!unidadesRm?.ok || !unidadesRm?.unidades_por_contrato) {
  return [{ json: { _statusCode: 502, ok: false, erro: 'unidades_rm_indisponiveis', mensagem: 'Nao foi possivel validar as unidades oficiais do RM.', detalhe: unidadesRm } }];
}
const COL = {
  E_NOME_EMPREGADO: 'dropdown_mktadatt', E_CHAPA: 'texto', E_CPF: 'dup__of_matr_cula', E_FUNCAO: 'texto0', E_CONTRATO: 'color_mktcnxwn',
  E_UNIDADE: 'dropdown_mm3ts726', E_UNIDADE_TXT: 'texto75',
  E_DI: 'date_mktayxhb', E_DF: 'date_mktasnwq', E_STATUS: 'color_mm3a8ana', E_CANCEL_INICIO: 'date_mm3b88ta',
  E_OPTANTE_VT: 'optante___vt', E_OPTANTE_VT_ALT: 'color_mm34ry47', E_TRAB_SAB: 'color_mktaavmp',
  H_UUID: 'text_mm2xjend', H_CHAPA: 'text_mm33v9kp', H_DI: 'date_mm2xtp93', H_LEDGER: 'long_text_mm3ct3hg',
  H_TRAB_SAB: 'color_mm34yyet', H_SAB_EXTRAS: 'text_mm3bfn6h'
};
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();}
function normUnidade(s){return norm(s).replace(/[\.,;:/\\|_()\[\]{}-]+/g,' ').replace(/\s+/g,' ').trim();}
function origemUnidade(s){return normUnidade(s).replace(/\s+/g,'_') || 'UNIDADE';}
function chapaNorm(s){return String(s||'').replace(/\D/g,'').replace(/^0+/,'') || '0';}
function col(item,id){return ((item&&item.column_values)||[]).find(c=>c.id===id)||null;}
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
  function vrDe(item){ return num(cell(titleCol(item,['VR','Valor VR','Vale Refeição','Vale Refeicao']))); }
  function vtDe(item){ return num(cell(titleCol(item,['VT','Valor VT','Vale Transporte']))); }
  function descricao(item, sufixo){
    const cTxt = cell(titleCol(item,['Contrato'])) || item.name || '';
    const rTxt = cell(titleCol(item,['Regra/Função','Regra','Funcao','Função','Cargo']));
    return 'Board valores - ' + (cTxt || 'sem contrato') + (rTxt ? ' / ' + rTxt : '') + (sufixo ? ' (' + sufixo + ')' : '');
  }
  const ativos = items.filter(item => { const v = norm(cell(titleCol(item,['Ativo','Status','Habilitado']))); return !v || ['SIM','ATIVO','ATIVA','TRUE','1','HABILITADO','REALIZADO'].includes(v); });
  if (ativos.length === 0) return { vr: 0, vt: 0, regra: 'Sem regra ativa cadastrada no board' };
  const contratoNorm = norm(contrato);
  const funcaoNorm = norm(funcao);
  function classifica(item){
    const itemName = norm(item.name);
    const c = norm(cell(titleCol(item,['Contrato'])));
    const r = norm(cell(titleCol(item,['Regra/Função','Regra','Funcao','Função','Cargo'])));
    const ehPadrao = !c || ['PADRAO','PADRÃO','GLOBAL','*','-'].includes(c) || itemName.includes('PADRAO') || itemName.includes('PADRÃO') || itemName.includes('GLOBAL') || itemName.includes('DEFAULT');
    const contratoBate = !!contratoNorm && (c === contratoNorm || (c && c.includes(contratoNorm)) || (contratoNorm && itemName.includes(contratoNorm)));
    const rPadrao = !r || ['PADRAO','PADRÃO','GERAL','*','-'].includes(r);
    const funcaoBate = !!funcaoNorm && !rPadrao && funcaoNorm.includes(r);
    return { c, r, itemName, ehPadrao, contratoBate, rPadrao, funcaoBate };
  }
  // 1ª passada: contrato específico bate + (regra padrão OU função bate)
  const especificos = [];
  for (const item of ativos) {
    const x = classifica(item);
    if (!x.contratoBate) continue;
    if (!x.rPadrao && !x.funcaoBate) continue;
    const pri = num(cell(titleCol(item,['Prioridade','Ordem'])));
    especificos.push({ item, score: 1000 + (!x.rPadrao ? 100 : 0) + pri });
  }
  if (especificos.length > 0) {
    especificos.sort((a,b)=>b.score-a.score);
    const it = especificos[0].item;
    return { vr: vrDe(it), vt: vtDe(it), regra: descricao(it) };
  }
  // 2ª passada: regra Padrão (contrato vazio/global)
  const padroes = ativos.filter(item => classifica(item).ehPadrao);
  if (padroes.length > 0) {
    const it = padroes[0];
    return { vr: vrDe(it), vt: vtDe(it), regra: descricao(it, 'padrão (sem regra para ' + contrato + ')') };
  }
  // 3ª passada (último recurso): primeira regra ativa que tem VR ou VT > 0
  const comValor = ativos.find(item => vrDe(item) > 0 || vtDe(item) > 0);
  if (comValor) {
    return { vr: vrDe(comValor), vt: vtDe(comValor), regra: descricao(comValor, 'fallback — nenhuma regra específica ou padrão encontrada') };
  }
  return { vr: 0, vt: 0, regra: 'Sem regra de valores aplicável a ' + contrato };
}
const entrada = resp?.data?.entrada?.items || [];
const historicos = resp?.data?.historico?.[0]?.items_page?.items || [];
const valoresItems = resp?.data?.valores?.[0]?.items_page?.items || [];
const unidadesValidas = Array.isArray(unidadesRm.unidades_por_contrato?.[prep.contrato])
  ? unidadesRm.unidades_por_contrato[prep.contrato].map(s => String(s || '').trim()).filter(Boolean)
  : [];
// RM sem unidades oficiais NAO bloqueia: casa direto contra os convocados (unidade escolhida).
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
const _listaUni = Array.isArray(prep.unidades) && prep.unidades.length ? prep.unidades : [prep.unidade];
const unidadesResolvidas = _listaUni.map(u => { const r = resolverUnidade(u, unidadesValidas); return (r && r.ok) ? r : { ok: true, label: u, norm: normUnidade(u), fallback: true }; });
function unidadeItemBate(valorItem, oficialNorm) {
  const itemNorm = normUnidade(valorItem);
  if (!itemNorm) return false;
  if (itemNorm === oficialNorm) return true;
  if (itemNorm.includes(oficialNorm) || oficialNorm.includes(itemNorm)) return true;
  const itemTokens = itemNorm.split(' ').filter(t => t.length > 2);
  const oficialTokens = oficialNorm.split(' ').filter(t => t.length > 2);
  if (oficialTokens.length === 0) return false;
  const common = oficialTokens.filter(t => itemTokens.includes(t)).length;
  if (common / oficialTokens.length >= 0.75) return true;
  const max = Math.max(itemNorm.length, oficialNorm.length) || 1;
  return 1 - (levenshtein(itemNorm, oficialNorm) / max) >= 0.82;
}
const histMap = new Map();
for (const h of historicos) histMap.set(chapaNorm(text(h,COL.H_CHAPA)) + '|' + text(h,COL.H_DI), h);
// origem por item (cada item usa a unidade que casou)
const isSab = new Date(prep.data + 'T00:00:00Z').getUTCDay() === 6;
const STATUS_IGNORAR = new Set(['CANCELADA','CANCELADO','BLOQUEADA - CONFLITO']);
const itens = [];
for (const e of entrada) {
  const unidadeReal = unidadeItem(e);
  const uMatch = unidadesResolvidas.find(u => unidadeItemBate(unidadeReal, u.norm)); if (!uMatch) continue;
  const origem = 'ponto_facultativo:' + prep.contrato + ':' + origemUnidade(uMatch.label) + ':' + prep.data;
  const di = text(e,COL.E_DI), df = text(e,COL.E_DF);
  if (!di || !df) continue;
  const st = norm(text(e,COL.E_STATUS));
  if (STATUS_IGNORAR.has(st)) continue;
  let fimEf = df;
  const canc = text(e,COL.E_CANCEL_INICIO);
  if (/PARCIAL/i.test(st) && canc) fimEf = addDays(canc, -1);
  if (prep.data < di || prep.data > fimEf) continue;
  const chapa = chapaNorm(text(e,COL.E_CHAPA));
  let hist = histMap.get(chapa + '|' + di) || null;
  if (!hist) { hist = historicos.find(h => chapaNorm(text(h,COL.H_CHAPA)) === chapa && text(h,COL.H_DI) && text(h,COL.H_DI) >= di && text(h,COL.H_DI) <= df) || null; }
  const sabadosExtras = String(text(hist,COL.H_SAB_EXTRAS)||'').split(/[,;\n]/).map(s=>s.trim()).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s));
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
  // Contratos que NUNCA descontam (DETRAN/TRE PB): declara mas desconto = 0.
  if (['DETRAN','TRE PB'].includes(prep.contrato)) {
    aplicaVR = false; aplicaVT = false; valorVR = 0; valorVT = 0;
    avisos.push('Contrato nao desconta beneficio');
  }
  itens.push({
    item_entrada_id: String(e.id), item_historico_id: hist ? String(hist.id) : null, uuid: text(hist,COL.H_UUID)||null,
    nome: text(e, COL.E_NOME_EMPREGADO) || e.name, chapa: text(e,COL.E_CHAPA), cpf: text(e,COL.E_CPF)||null, contrato: prep.contrato,
    unidade: uMatch.label,
    funcao: text(e,COL.E_FUNCAO)||null, periodo_inicio: di, periodo_fim: fimEf, data: prep.data,
    optante_vt: optanteVT, vt_meia_volta: vtMeiaVolta, trabalha_sabado: trabalhaSab,
    aplica_vr: aplicaVR, aplica_vt: aplicaVT, valor_vr: valorVR, valor_vt: valorVT,
    total: Math.round((valorVR+valorVT)*100)/100, avisos, regra_valores: valores.regra, _ledger: ledger, _origem: origem
  });
}
const publicItens = itens.map(({_ledger,_origem,...i})=>i);
const out = { _statusCode: 200, ok: true, contrato: prep.contrato, unidades: unidadesResolvidas.map(u=>u.label), data: prep.data, beneficios: prep.beneficios, aviso: publicItens.length === 0 ? 'sem_intermitentes_unidade_data' : null, total_colaboradores: publicItens.length, total_vr: Math.round(publicItens.reduce((a,i)=>a+i.valor_vr,0)*100)/100, total_vt: Math.round(publicItens.reduce((a,i)=>a+i.valor_vt,0)*100)/100, total: Math.round(publicItens.reduce((a,i)=>a+i.total,0)*100)/100, itens: publicItens };
if (false) out._internal_itens = itens;
return [{ json: out }];