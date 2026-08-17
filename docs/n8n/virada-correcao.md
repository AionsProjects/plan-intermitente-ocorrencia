# Virada BENAUT — correção do defeito que destruiu o board de agosto

> WF `gm2Ie8pbR2rOK5id` — *DP - Plan. de Intermitentes (BENAUT)*. Execução `183757`,
> 14/08/2026 21:00 UTC. Virada é **n8n permanente** (decisão do Isaac); isto aqui é o
> conserto do WF, não migração.

## Causa raiz

O nó **`Duplicar board central`** lê as variáveis do item que chega nele:

```
"variables": { "boardId": $json.centralBoardId, "boardName": $json.archiveBoardName }
```

Mas o item que chega vem de `Intermitentes suficientes?` ← `Conferir intermitentes`, cujo
json é `{ok, total, piso, lotes, motivo}`. **Nenhuma das duas chaves existe ali** — as duas
resolvem `undefined`.

Medido na execução:

```
saida de 'Conferir intermitentes'     -> chaves: ok, total, piso, lotes, motivo
saida de 'Intermitentes suficientes?' -> chaves: ok, total, piso, lotes, motivo
centralBoardId: undefined | archiveBoardName: undefined
```

Monday recusou com `Variable "$boardName" of required type "String!" was not provided`
(BAD_USER_INPUT) — e devolveu **HTTP 200**, porque erro de GraphQL não é erro de HTTP.

O nó `Renomear board central`, que funcionou, usa o padrão certo:

```
$('Preparar dados da virada').first().json.centralBoardId
```

## Por que virou destruição

O nó HTTP do n8n só olha o status. 200 → `success`. A cadeia seguiu:

```
Duplicar (falhou, marcado OK) → Aguardar 30s → webhooks (falharam, onError: continue)
  → Renomear central  ✅ EXECUTOU   (08/26 → 09/26)
  → Arquivar itens    ✅ EXECUTOU   (206 itens de agosto)
  → Criar intermitentes ✅ EXECUTOU (146 de setembro)
  → Salvar registry   ❌ falhou (única falha visível)
```

Os passos destrutivos dependem do board **central**, que existe — não da cópia, que não
existia. Por isso rodaram.

---

## Correção 1 — a expressão (obrigatória)

Nó **`Duplicar board central`** → campo **JSON Body**. Trocar por:

```
={{ { "query": "mutation ($boardId: ID!, $boardName: String!) { duplicate_board(board_id: $boardId, duplicate_type: duplicate_board_with_pulses_and_updates, board_name: $boardName, keep_subscribers: true) { board { id name url } } }", "variables": { "boardId": $('Preparar dados da virada').first().json.centralBoardId, "boardName": $('Preparar dados da virada').first().json.archiveBoardName } } }}
```

Mudou só a origem das duas variáveis: `$json.X` → `$('Preparar dados da virada').first().json.X`.

## Correção 2 — a trava (é ela que impede o estrago repetir)

Sem isto, qualquer falha futura da duplicação — token expirado, limite de complexidade,
board bloqueado — repete a destruição inteira.

**Novo nó Code**, inserido entre `Aguardar duplicacao` e `Criar webhook ativar na copia`.
Nome sugerido: `Conferir duplicacao`.

```javascript
// Trava de segurança: nada depois daqui pode rodar sem a cópia existir.
// O Monday devolve HTTP 200 com `errors[]`, então o nó HTTP marca success mesmo
// quando falhou — foi assim que a execução 183757 renomeou e arquivou o board de
// agosto sem ter criado cópia nenhuma.
const r = $('Duplicar board central').first().json;

if (r && r.errors) {
  throw new Error('Monday recusou a duplicacao: ' + JSON.stringify(r.errors));
}
const id = r && r.data && r.data.duplicate_board && r.data.duplicate_board.board
  ? r.data.duplicate_board.board.id
  : null;
if (!id) {
  throw new Error('Duplicacao nao devolveu board id — abortando ANTES de renomear/arquivar.');
}
return [{ json: { copiaBoardId: String(id) } }];
```

Deixar o `onError` deste nó no **padrão** (parar o workflow). É o ponto do nó.

## Correção 3 — já estava feita

O nó **`Criar webhook create_item na copia`** (que recriava na cópia o webhook do **WF5
Pontual**, e faria o pontual pagar duas vezes) **não existe mais** na definição atual — o
patch de `4516591` já o removeu. Ele aparece na execução `183757` porque aquela rodou uma
versão anterior do WF.

Nós que criam webhook hoje: `Criar webhook ativar na copia` e `Criar webhook monitor na
copia`. Ambos legítimos.

---

## Estado: 1 e 2 APLICADAS em 17/08/2026

Gravadas na definição do WF (`versionId c0rr3cao-183757-1786972387124`), com backup em
`docs/n8n/backups/virada-gm2Ie8pbR2rOK5id-antes-correcao-183757.json`.

Conferido por leitura independente da definição:

```
[1] nao usa mais $json.centralBoardId | usa $('Preparar dados da virada') nas DUAS variaveis
[2] 'Conferir duplicacao' existe | Code | onError padrao (para o WF)
    checa errors[]: true | checa board id: true
[3] fios: Duplicar -> Aguardar -> Conferir duplicacao -> Criar webhook ativar na copia
[4] passos destrutivos so alcancaveis via 'Criar webhook monitor na copia', a jusante da trava
```

### ⚠️ O n8n precisa RECARREGAR antes de executar

A gravação foi feita na definição (banco). O WF está `active: true`, e o n8n mantém workflow
ativo **em memória** — ele ainda não conhece a mudança. Executar sem recarregar rodaria a
versão VELHA parecendo corrigida, que é exatamente a classe de erro que causou este incidente.

Antes de executar:

1. Abrir o WF no n8n e dar **hard reload** na página (Ctrl+Shift+R).
2. Confirmar visualmente que existe o nó **`Conferir duplicacao`** entre `Aguardar duplicacao`
   e `Criar webhook ativar na copia`.
3. Abrir `Duplicar board central` → o JSON Body deve citar `$('Preparar dados da virada')`,
   e **não** `$json.centralBoardId`.
4. Desativar e reativar o toggle **Active** (re-registra o cron com a definição nova).

Se qualquer um dos três não conferir, **não executar** — a página estava em cache.

---

## ⚠️ Antes de reexecutar

**Restaurar os 206 itens de agosto PRIMEIRO.** Eles estão `archived` no board
`18418191275`. A virada duplica o que está **ativo** — se rodar agora, a cópia de agosto
nasce praticamente vazia (só a convocação da MICHELE, `12819426733`, de 17/08).

Ordem certa:

1. Restaurar os 206 pela UI do Monday (Board → `⋯` → itens arquivados → restaurar).
   A API v2 **não tem** `unarchive_item`; só a UI preserva os ids, e recriar quebraria os
   links de `link_mm2x1rk0` e `pi.convocacao_item_plano`.
2. Aplicar as correções 1, 2 e 3.
3. Conferir que o board se chama `08/26 - Plan. de Intermitente - Contato` (já renomeado de volta).
4. Executar.
5. Conferir: cópia criada com nome `08/26 ...`, central renomeado pra `09/26 ...`, e
   `pi.boards` com `atual = 2026-09` (cópia = `passado 2026-08`).

## Segurança — pendência separada

O nó `Salvar registry (virada)` carrega o **`X-Service-Token` em texto puro** nos parâmetros
do WF. Ele aparece em qualquer export, backup ou leitura da definição. Recomendado trocar por
credencial do n8n e **rotacionar o token atual** (`POST /api/... ` via `npm run token:servico`
no auth-backend gera outro).
