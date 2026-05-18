const fs = require('fs');
const wfPath = "C:/Users/NOTECS-89/Downloads/CALCULO INTERMITENTE/Intermitente — 3. Finalizar (monday).json";
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

const REMOVER = new Set([
  "Tem Atestados?",
  "Preparar Input Atestados",
  "Processar Atestados (subworkflow)",
  "Validar Resultado Atestados",
  "Atestados OK?"
]);

const novoValidarCode = fs.readFileSync('scripts/wf3_validar.js', 'utf8');
const novoPrepararCode = [
  "// Passthrough — atestado saiu pro WF standalone (/atestados).",
  "// Mantido por compatibilidade: copia campos do Validar e preparar1",
  "// pro shape esperado por Atualizar item1.",
  "const hist = $('Validar e preparar1').first().json;",
  "return [{ json: { ...hist } }];"
].join('\n');

const novoColetarWarnings = [
  "const w = [];",
  "try { const wd = $('Coletar Warning Desconto').all(); if (wd.length > 0 && wd[0].json?.warning) w.push(wd[0].json.warning); } catch (e) {}",
  "try { const wb = $('Coletar Warning Boleto').all(); if (wb.length > 0 && wb[0].json?.warning) w.push(wb[0].json.warning); } catch (e) {}",
  "return [{ json: { warnings: w } }];"
].join('\n');

for (const n of wf.nodes) {
  if (n.name === 'Validar e preparar1') n.parameters.jsCode = novoValidarCode;
  if (n.name === 'Preparar Atualização Histórico') n.parameters.jsCode = novoPrepararCode;
  if (n.name === 'Coletar Warnings Final') n.parameters.jsCode = novoColetarWarnings;
}

wf.nodes = wf.nodes.filter(n => !REMOVER.has(n.name));

function limpaConn(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(grupo => Array.isArray(grupo) ? grupo.filter(c => !REMOVER.has(c.node)) : grupo);
}
for (const k of Object.keys(wf.connections)) {
  if (REMOVER.has(k)) { delete wf.connections[k]; continue; }
  const node = wf.connections[k];
  if (node.main) node.main = limpaConn(node.main);
}

if (wf.connections['Se Decisão OK?'] && wf.connections['Se Decisão OK?'].main && wf.connections['Se Decisão OK?'].main[0]) {
  wf.connections['Se Decisão OK?'].main[0] = [
    { node: 'Preparar Atualização Histórico', type: 'main', index: 0 }
  ];
}

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('OK', wf.nodes.length, 'nodes');
