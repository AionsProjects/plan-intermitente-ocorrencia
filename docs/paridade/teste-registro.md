# Teste comparativo do `registro` — código × WF3

> Portão antes de flipar `registro` para `escape`. Objetivo: provar que o código produz o
> MESMO resultado que o WF3 nos quatro lugares que o DP lê, e que as divergências que
> sobram são conhecidas e aceitas — não surpresas.
>
> Pré-requisito: código da Fase 2 em produção (feito, 17/08) e estar logado como **admin**.

## Por que comparativo, e não só "funciona"

`registro` é o único processo cujo espelho, até a Fase 2, gravava **só Postgres**. Agora ele
escreve Histórico, Base de Desconto, espelho no Plano e os subitems do split. Cada um desses
é um número que o DP confere à mão. Um deles diferente do WF e a automação perde a confiança
que levou meses pra ganhar — mesmo que o novo número esteja *mais certo* (é o caso do
`dias_perde_vr`, ver §5).

## Desenho: a MESMA convocação, os dois executores

As escritas são idempotentes e **sobrescrevem** (nunca incrementam). Então dá pra finalizar a
mesma convocação duas vezes — a segunda como correção — e comparar saída contra saída, com
entrada idêntica. É o teste mais limpo possível: elimina "os dados eram diferentes".

```
criar convocação de teste  ->  ativar  ->  finalizar com registro='n8n'   -> SNAPSHOT A
                                       ->  flip registro='escape'
                                       ->  refinalizar (eh_correcao)      -> SNAPSHOT B
                                       ->  diff A x B
```

### ⚠️ Duas convocações, e por quê

| | Convocação A | Convocação B |
|---|---|---|
| Conteúdo | 1 falta + 1 atraso (60 min) + **split** | 1 falta + **1 sábado extra** |
| Executores | n8n **e** código | **só código** |
| Motivo | comparação direta, sem dinheiro externo | o WF3 dispara boleto REAL na Caju; o código com `SABADO_EXTRA_HABILITADO=0` só simula |

**Nunca rode a convocação B pelo n8n.** Um sábado extra pelo WF cria pedido PIX de verdade na
Caju para uma chapa de teste.

---

## 1. Preparar

Chapa de teste, contrato com valores conhecidos no board `18413870370`. Período curto que
cruze o corte do split e caia num sábado.

Sugestão para A: `2026-09-01` a `2026-09-11`, corte do split em `2026-09-08`.

1. `/convocar` → criar. Anotar **item_id** da Entrada.
2. Mudar a coluna `ativar` no board → gera o link. Anotar **uuid** e **protocolo**.
3. `/preencher/<uuid>` → botão violeta **Dividir convocação** → corte `2026-09-08`,
   contrato P1 ≠ contrato P2.
4. Lançar: 1 falta antes do corte, 1 atraso de 60 min antes do corte, 1 falta depois do corte.

## 2. Snapshot A — com o WF3 (estado atual)

Confirmar que `registro` está em `n8n`:

```js
await fetch("/api/rotas", {credentials:"include"}).then(r=>r.json())
```

Finalizar pelo `/preencher`. Depois, registrar os valores das tabelas do §4 — **print da tela
serve**, mas anote os números.

Conferir que rodou pelo n8n mesmo: em `nocturnalgoose.execution_entity`, deve existir execução
do WF `rlxTk4VZLM2gTzx7` no horário.

## 3. Snapshot B — com o código

```js
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"escape"})
}).then(r=>r.json())
```

Esperar 1 min (cache do front) ou abrir aba anônima. Reabrir pelo **protocolo** em
"Atualizar ocorrência", **sem mudar nada**, e Concluir.

No DevTools → Network, a chamada tem que ir pro `/api/intermitente-finalizar`. E **nenhuma**
execução nova do `rlxTk4VZLM2gTzx7` no n8n.

---

## 4. O que comparar

### 4.1 Board Histórico (`18411141462`)

| Campo | Coluna | A (n8n) | B (código) |
|---|---|---|---|
| Status | `color_mm2xkqpc` | | |
| Protocolo | `text_mm2xsvg6` | | |
| Concluído Em | `date_mm2xh1vm` | | |
| Qtd. Faltas | `numeric_mm2xe2zk` | | |
| Qtd. Atrasos | `numeric_mm2x18hh` | | |
| Total Minutos | `numeric_mm2x4fjj` | | |
| Total Min. Devidos | `numeric_mm3455ss` | | |
| **Dias Perde VR** | `numeric_mm34a3ph` | | ← **divergência esperada, §5.1** |
| Dias Perde VT | `numeric_mm345xb6` | | |
| Respostas JSON | `long_text_mm2xtcpw` | | |
| Dias Extras / Desativados | `long_text_mm2x73w6` / `long_text_mm2xm820` | | |
| Qtd/Txt Sábados Extras | `numeric_mm3bvgy` / `text_mm3bfn6h` | | |
| Ledger Benefícios | `long_text_mm3ct3hg` | | |

`Concluído Em` deve ser **preservado** do snapshot A (o código faz `COALESCE`). `Editado` vira
`true` e `Editado Em` é preenchido no B — isso é correto, não divergência.

### 4.2 Base de Desconto (`18400981023`)

Mesmo item (casa por chapa + período), sobrescrito:

| Campo | Coluna |
|---|---|
| Desconto VR / VT | `numeric_mm0rgsaw` / `numeric_mm0r5tca` |
| Residual VR / VT | `numeric_mm0r1691` / `numeric_mm0rtwwg` |
| Dias Perde VR / VT | `numeric_mm34p6p7` / `numeric_mm3428yj` |
| **Qtd Atrasos** | `numeric_mm2pj1av` — são **MINUTOS**, não contagem |
| Status | `color_mm0r8mjr` |
| Protocolo | `text_mm3zac2t` |
| CPF | `text_mm0r5ted` — **não pode ficar vazio no B** |

O **desconto em reais tem que bater exatamente**. É o número que vira dinheiro.

### 4.3 Espelho no item do Plano (Entrada)

| Campo | Coluna |
|---|---|
| Faltas registradas | `numeric` |
| Minutos de atraso | `texto5` |
| Protocolo | `text_mm3zezw` |

### 4.4 Subitems do split

Dois subitems `Parte 1 - <contrato>` e `Parte 2 - <contrato>`. Conferir:

- **exatamente DOIS** (se aparecer um terceiro, o casamento por prefixo falhou)
- Parte 1: início = início da convocação, fim = **corte − 1 dia**
- Parte 2: início = **corte**, fim = fim da convocação
- agregados por metade somam o total do pai
- `empregado substituído` e `insalubridade` propagados do pai, se o pai os tiver

### 4.5 Postgres

```sql
SELECT status, protocolo, qtd_faltas, qtd_atrasos, total_minutos,
       dias_perde_vr, dias_perde_vt, editado, concluido_em, editado_em
  FROM pi.convocacoes WHERE uuid = '<uuid>';

SELECT desconto_vr, desconto_vt, residual_vr, residual_vt, status
  FROM pi.descontos WHERE uuid_convocacao = '<uuid>';
```

### 4.6 `/atividade`

A execução do B deve abrir com as etapas: `selecao`/`ledger` → `gravar_convocacao` →
`desconto` → `monday_historico` → `desconto_board` → `subitems_split` → `monday_plano`, e
artefatos clicáveis (item do Histórico, item da Base de Desconto).

Desfecho `ok`. Se vier `parcial`, o resumo diz em `monday_falhas` o que ficou pra trás.

---

## 5. Divergências ESPERADAS — confirmar com o DP antes do flip

### 5.1 `dias_perde_vr` virou fracionário

O WF3 conta `dias com vr=true`; o código soma percentual (`vr_percentual/100`), fiel ao que o
próprio WF3 usa no `descontosPorDia`.

Atraso de 60 min numa jornada de 480:

| | WF3 | Código |
|---|---|---|
| `dias_perde_vr` | `1` | `0.125` |
| Desconto VR em reais | igual | igual |

**Não muda dinheiro** — o desconto sai dos percentuais, não deste campo. O que muda é o número
reportado, que passa a bater com o valor em reais da mesma linha. Antes, uma linha dizia
"1 dia perdido" e descontava R$ 3,06 de um VR de R$ 24,50.

**Decisão do DP:** aceitar o número novo, ou manter a contagem inteira por compatibilidade de
relatório?

### 5.2 `Editado` / `Editado Em` no snapshot B

Esperado: o B **é** uma reedição. Não é divergência.

### 5.3 Sábado extra (convocação B) — `ANOREF/MESREF` no RM

O XML do WF manda `ANOREF/MESREF = ANOCOMP/MESCOMP` e **não** manda `CODSECAO` nem
`DATAIMPORT`. O código reusa `montarXmlHistorico` do mensal, que manda os dois campos e usa
**REF = competência anterior** — a convenção validada em produção no mensal (6/6 contratos).

Não é campo de valor, mas muda o período de referência da linha no RM.

**Decisão do DP:** confirmar qual referência o RM espera para lançamento diário.

---

## 6. Convocação B — sábado extra em modo simulado

Com `SABADO_EXTRA_HABILITADO=0` (estado atual — conferir em `GET /api/rotas` → `flags_rm`):

1. Criar convocação num contrato com `trabalhaSabado=NÃO`.
2. `/preencher` → botão azul **Adicionar sábados extras** → escolher 1 sábado.
3. Finalizar com `registro='escape'`.

Conferir no `/atividade`, etapa **`sabado_extra`**:

```
metadados: { job: <id>, qtd_sabados: 1, vt_dia: <x>, valor_total: <x>, habilitado: false }
```

E que o job rodou em simulado:

```sql
SELECT tipo, estado, passo, cursor FROM pi.jobs
  WHERE tipo = 'sabado_extra' ORDER BY criado_em DESC LIMIT 1;

SELECT chave, status, ref_externa FROM pi.efeitos_externos
  WHERE chave LIKE 'sabado_extra:%' ORDER BY criado_em DESC;
```

Esperado: job `concluido` no passo 3, e três efeitos `confirmado` com
`ref_externa = 'SIMULADO'`. **Zero** pedido novo no painel da Caju.

Conferir `valor_total` à mão: `vtDia do contrato × 1`, com metade se o empregado é `SIM*`.

---

## 7. Portão

Flipar `registro` para `escape` **só se**:

- [ ] desconto VR e VT em reais **idênticos** entre A e B
- [ ] agregados (faltas, atrasos, minutos) idênticos
- [ ] `Concluído Em` preservado, `Editado` = true no B
- [ ] CPF presente no item da Base de Desconto
- [ ] espelho no Plano com faltas, minutos **e protocolo**
- [ ] exatamente 2 subitems, períodos e agregados por metade corretos
- [ ] `/atividade` fechou `ok`, sem `monday_falhas`
- [ ] nenhuma execução nova do WF `rlxTk4VZLM2gTzx7`
- [ ] §5.1 e §5.3 decididas pelo DP, por escrito
- [ ] sábado extra simulado com os 3 efeitos `SIMULADO` e nada na Caju

Divergência não explicada = **não flipa**. Anotar e corrigir primeiro.

## 8. Desfazer

```js
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"n8n"})
}).then(r=>r.json())
```

Backend fora: `UPDATE pi.rotas_processo SET modo='n8n' WHERE processo='registro';` e limpar o
`localStorage["pi_rotas"]` do navegador.

Limpeza do teste: apagar os itens de teste dos boards (Entrada, Histórico, Base de Desconto,
subitems) e

```sql
DELETE FROM pi.descontos    WHERE uuid_convocacao = '<uuid>';
DELETE FROM pi.convocacoes  WHERE uuid = '<uuid>';
DELETE FROM pi.jobs         WHERE tipo = 'sabado_extra' AND payload->'pedido'->>'uuid' = '<uuid>';
DELETE FROM pi.efeitos_externos WHERE chave LIKE 'sabado_extra:%<uuid>%';
```

## 9. Depois do flip

Só então, e separado, ligar `SABADO_EXTRA_HABILITADO=1` — com o DP avisado, **uma** convocação
real com sábado extra, e conferência do pedido no painel da Caju antes de liberar o resto.
