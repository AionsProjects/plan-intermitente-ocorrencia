# PONTUAL — patches para múltiplas dívidas FIFO

Aplicar no workflow `AUTOMAÇÃO DE INTERMITENTES PONTUAL` no n8n. Substituir os Code nodes listados pelos códigos abaixo. Os 5 monday-update nodes hardcoded (Trocar Status, Residual VT/VR, Desconto VR/VT) viram **1 par SplitInBatches + change_multiple_column_values** dentro de um loop.

## Visão geral das mudanças

```
Antes:  ... → Code 8 (limit 1) → HTTP Monday → Code 9 (1 dívida) → IF descontoAtivo
              → Code 10 (1 cálculo) → 5 nodes hardcoded de update → Merge → Code 12

Depois: ... → Code 8 (limit 100, filtro status) → HTTP Monday → Code 9 (array ordenado)
              → IF temDividas → Code 10 (loop FIFO, gera array updates) → SplitInBatches
              → change_multiple_column_values (loop) → Merge → Code 12
```

## Nó 8 — `Code in JavaScript4` (montar GraphQL)

Substituir `jsCode` por:

```js
// ============================================================
// NÓ 8 — Buscar TODAS as dívidas PENDENTE/PARCIAL do empregado
// ============================================================

const dados = $input.first().json;
const nomeEmpregado = dados.nomeEmpregado;

const query = `query {
  items_page_by_column_values(
    limit: 100
    board_id: 18400981023
    columns: [
      { column_id: "dropdown_mm0rgfrx", column_values: ["${nomeEmpregado}"] }
    ]
  ) {
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
}`;

return [{
  json: {
    ...dados,
    mondayDescontoQuery: { query }
  }
}];
```

Mudança: `limit: 1` → `limit: 100`. Filtragem por status PENDENTE/PARCIAL feita no parsing (Nó 9), porque GraphQL `items_page_by_column_values` no monday só aceita 1 coluna como filtro.

## Nó 9 — `Code in JavaScript5` (parsear retorno → array ordenado)

Substituir `jsCode` por:

```js
// ============================================================
// NÓ 9 — Parsear retorno do Monday: array de dívidas ordenado
// ============================================================
// Saída: dadosNó7 + dividas (array ordenado por data_inicio ASC)
//        + temDividas (boolean)
// ============================================================

const dados = $('Code in JavaScript3').first().json; // Nó 7 - valor bruto
const response = $input.first().json;
const items = response.data?.items_page_by_column_values?.items || [];

// IDs das colunas do board base de descontos
const COL_STATUS         = 'color_mm0r8mjr';
const COL_DATA_INICIO    = 'date_mm0r6tyr';
const COL_DATA_FIM       = 'date_mm0rzpyv';
const COL_DESCONTO_VR    = 'numeric_mm0rgsaw';
const COL_DESCONTO_VT    = 'numeric_mm0r5tca';
const COL_RESIDUAL_VR    = 'numeric_mm0r1691';
const COL_RESIDUAL_VT    = 'numeric_mm0rtwwg';
const COL_DESCONTADO_VR  = 'numeric_mm0rqy6z';
const COL_DESCONTADO_VT  = 'numeric_mm0r6cn0';

const dividas = [];
for (const item of items) {
  const cols = {};
  for (const c of item.column_values) cols[c.id] = c.text;
  const status = (cols[COL_STATUS] || '').toUpperCase().trim();
  if (status !== 'PENDENTE' && status !== 'PARCIAL') continue;

  dividas.push({
    itemId: String(item.id),
    status,
    dataInicio: cols[COL_DATA_INICIO] || null,
    dataFim: cols[COL_DATA_FIM] || null,
    descontoVR: parseFloat(cols[COL_DESCONTO_VR]) || 0,
    descontoVT: parseFloat(cols[COL_DESCONTO_VT]) || 0,
    residualVR: parseFloat(cols[COL_RESIDUAL_VR]) || 0,
    residualVT: parseFloat(cols[COL_RESIDUAL_VT]) || 0,
    descontadoVR: parseFloat(cols[COL_DESCONTADO_VR]) || 0,
    descontadoVT: parseFloat(cols[COL_DESCONTADO_VT]) || 0
  });
}

// Ordena por data de início ASC (FIFO: dívida mais antiga primeiro)
dividas.sort((a, b) => (a.dataInicio || '').localeCompare(b.dataInicio || ''));

return [{
  json: {
    ...dados,
    dividas,
    temDividas: dividas.length > 0
  }
}];
```

## IF descontoAtivo → IF temDividas

No node `If1` (após Nó 9), trocar condição:

```
{{ $json.descontoAtivo }} equals true
```

por:

```
{{ $json.temDividas }} equals true
```

## Nó 10 — `Code in JavaScript6` (loop FIFO)

Substituir `jsCode` por:

```js
// ============================================================
// NÓ 10 — Aplicar dívidas FIFO ao benefício bruto
// ============================================================
// Para cada dívida (ordenada por data_inicio ASC):
//   - Aplica residualVR ao saldoVR (até zerar saldo ou residual)
//   - Aplica residualVT ao saldoVT (idem)
//   - Atualiza descontado, residual, status (PARCIAL/FINALIZADO)
//   - Para se saldoVR=0 e saldoVT=0
// Saída: dados + saldo restante (= valor líquido) + array updates
// ============================================================

const dados = $input.first().json;
const round = (n) => Math.round(n * 100) / 100;

let saldoVR = dados.valorBrutoVR;
let saldoVT = dados.valorBrutoVT;

const updates = [];
for (const d of dados.dividas) {
  let aplicadoVR = 0, aplicadoVT = 0;

  if (saldoVR > 0 && d.residualVR > 0) {
    aplicadoVR = Math.min(saldoVR, d.residualVR);
    saldoVR = round(saldoVR - aplicadoVR);
    d.residualVR = round(d.residualVR - aplicadoVR);
    d.descontadoVR = round(d.descontadoVR + aplicadoVR);
  }
  if (saldoVT > 0 && d.residualVT > 0) {
    aplicadoVT = Math.min(saldoVT, d.residualVT);
    saldoVT = round(saldoVT - aplicadoVT);
    d.residualVT = round(d.residualVT - aplicadoVT);
    d.descontadoVT = round(d.descontadoVT + aplicadoVT);
  }

  if (aplicadoVR > 0 || aplicadoVT > 0) {
    const novoStatus =
      (d.residualVR === 0 && d.residualVT === 0) ? 'FINALIZADO' : 'PARCIAL';
    updates.push({
      itemId: d.itemId,
      column_values_json: JSON.stringify({
        numeric_mm0rqy6z: String(d.descontadoVR),
        numeric_mm0r6cn0: String(d.descontadoVT),
        numeric_mm0r1691: String(d.residualVR),
        numeric_mm0rtwwg: String(d.residualVT),
        color_mm0r8mjr:   { label: novoStatus }
      }),
      novoStatus,
      aplicadoVR,
      aplicadoVT
    });
  }

  if (saldoVR === 0 && saldoVT === 0) break;
}

const valorLiquidoVR = round(saldoVR);
const valorLiquidoVT = round(saldoVT);

return [{
  json: {
    ...dados,
    valorLiquidoVR,
    valorLiquidoVT,
    updates,
    totalAplicadoVR: round(dados.valorBrutoVR - valorLiquidoVR),
    totalAplicadoVT: round(dados.valorBrutoVT - valorLiquidoVT)
  }
}];
```

## Substituir os 5 nodes hardcoded de update

**Remover** os nodes:
- `Trocar o Status do Desconto`
- `Valor Residual VT`
- `Valor Residual VR`
- `Desconto de VT Efetivo`
- `Desconto de VR Efetivo`

**Adicionar** no lugar:

### Node A — `Split In Batches Updates`

```
Type: n8n-nodes-base.splitInBatches
Input items: {{ $json.updates }}
Batch Size: 1
```

Output: `{{ $json }}` para cada update individual.

### Node B — `Atualizar Desconto Item`

```
Type: n8n-nodes-base.mondayCom
Resource: boardItem
Operation: changeMultipleColumnValues
Board ID: 18400981023
Item ID: {{ $json.itemId }}
Column Values: {{ $json.column_values_json }}
Credentials: Mike's Account (mesma do PONTUAL)
```

Conexão: `Code 10 → Split In Batches → Atualizar Desconto Item → (loop volta pra Split) → Merge`

Configurar `Split In Batches` em modo `loop` — quando esgota items, sai pelo branch "done" pro Merge.

## Nó 12 — `Code in JavaScript7` (consolidar)

Substituir `jsCode` por:

```js
// ============================================================
// NÓ 12 — Consolidar valores finais (pós-Merge)
// ============================================================

let valorFinalVR, valorFinalVT, dados, caminhoDesconto;

try {
  const com = $('Code in JavaScript6').first().json;
  valorFinalVR = com.valorLiquidoVR;
  valorFinalVT = com.valorLiquidoVT;
  dados = com;
  caminhoDesconto = true;
} catch (e) {
  const sem = $('Code in JavaScript5').first().json;
  valorFinalVR = sem.valorBrutoVR;
  valorFinalVT = sem.valorBrutoVT;
  dados = sem;
  caminhoDesconto = false;
}

const valorFinalTotal = Math.round((valorFinalVR + valorFinalVT) * 100) / 100;

return [{
  json: {
    nomeEmpregado: dados.nomeEmpregado,
    chapaRM: dados.chapaRM,
    secaoRM: dados.secaoRM,
    descricaoSecaoRM: dados.descricaoSecaoRM,
    funcaoRM: dados.funcaoRM,
    dataAdmissaoRM: dados.dataAdmissaoRM,
    contrato: dados.contrato,
    funcao: dados.funcao,
    regraAplicada: dados.regraAplicada,
    optanteVT: dados.optanteVT,
    trabalhaSabado: dados.trabalhaSabado,
    interior: dados.interior,
    dataInicio: dados.dataInicio,
    dataFim: dados.dataFim,
    diasVR: dados.diasVR,
    diasVT: dados.diasVT,
    vrDia: dados.vrDia,
    vtDia: dados.vtDia,
    valorBrutoVR: dados.valorBrutoVR,
    valorBrutoVT: dados.valorBrutoVT,
    descontoAplicadoVR: caminhoDesconto ? (dados.totalAplicadoVR || 0) : 0,
    descontoAplicadoVT: caminhoDesconto ? (dados.totalAplicadoVT || 0) : 0,
    qtdDividasAplicadas: caminhoDesconto ? (dados.updates?.length || 0) : 0,
    valorFinalVR,
    valorFinalVT,
    valorFinalTotal,
    boardId: dados.boardId,
    itemId: dados.itemId
  }
}];
```

## Resumo das mudanças

| Antes | Depois |
|---|---|
| Nó 8: `limit: 1` | Nó 8: `limit: 100` |
| Nó 9: 1 dívida (`desconto.itemIdDesconto`) | Nó 9: array `dividas[]` ordenado FIFO |
| Nó 10: 1 cálculo simples | Nó 10: loop com array `updates[]` |
| 5 nodes hardcoded de update | 1 SplitInBatches + 1 change_multiple (loop) |
| Nó 12: `valorEfetivoDescontoVR/VT` | Nó 12: `totalAplicadoVR/VT` (soma de todos os updates) |
| `descontoAtivo` boolean | `temDividas` boolean |

## Compatibilidade com WF3 que cria dívidas

WF3 (board histórico finalizar) agora cria items no board `18400981023` com:
- `dropdown_mm0rgfrx` = nome
- `text_mm0rpqxs` = chapa
- `text_mm0r5ted` = CPF
- `date_mm0r6tyr` / `date_mm0rzpyv` = período
- `numeric_mm0rgsaw` / `numeric_mm0r5tca` = desconto VR/VT (originais)
- `numeric_mm0r1691` / `numeric_mm0rtwwg` = residual VR/VT (= desconto na criação)
- `numeric_mm0rqy6z` / `numeric_mm0r6cn0` = descontado (= 0 na criação)
- `color_mm0r8mjr` = `PENDENTE`
- group `group_mm0rmjs3` (DESCONTOS)

PONTUAL refatorado consome esses items na próxima convocação do mesmo nome (`dropdown_mm0rgfrx`).

## Bloqueio de correção pós-PARCIAL/FINALIZADO

WF3 valida antes de atualizar item de desconto: se status atual é PARCIAL ou FINALIZADO em correção (`eh_reedicao=true`), retorna 409 com mensagem ao frontend. Histórico ainda é atualizado (form é só registro), mas o desconto fica intocado.
