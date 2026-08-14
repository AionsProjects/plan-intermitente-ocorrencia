# Contingência — rota de fuga e ensaio

> Premissa (invertida em 03/07/2026, Isaac): **o código no Vercel é o PRINCIPAL**. O n8n
> tem dois papéis, e só dois: **ponte** (o relógio de 15 min do `/api/jobs/tick`, porque a
> conta Vercel é Hobby e só aceita cron diário) e **escape**.
>
> Este documento é o que fazer quando o Vercel cai, e como ensaiar isso antes de precisar.

## Os quatro modos

`pi.rotas_processo` guarda um modo por processo. `chamarProcesso` ([`src/lib/http.ts`](../../src/lib/http.ts)) obedece:

| modo | leitura | escrita |
|---|---|---|
| `n8n` | n8n | n8n |
| `auto` | n8n; cai pro `/api` em rede/timeout/5xx | n8n; cai pro `/api` **só em 404** |
| `api` | `/api` | `/api` |
| **`escape`** | **`/api`; cai pro n8n em rede/timeout/5xx/404** | **só `/api`. Erro sobe. Nunca repete no n8n.** |

Linha `'*'` = default de quem não tem linha própria; `'*' = api` continua sendo kill-switch global.

**Por que a escrita não faz failover.** Timeout ou 5xx não provam que o backend deixou de
gravar — provam que a resposta não voltou. Repetir a mesma escrita no n8n lançaria o
desconto duas vezes, ou geraria um segundo pedido na Caju. Escrita que falha é decisão de
gente: o operador vê o erro, e quem manda voltar pro n8n é o flip manual.

**Sinal na tela.** Qualquer fuga acionada — ou escrita que falhou no primário — acende o
aviso de sessão degradada ([`AvisoRotaDeFuga.tsx`](../../src/components/AvisoRotaDeFuga.tsx)).
Se o operador viu esse aviso, o resultado daquela ação precisa ser conferido.

---

## Acionar o escape

### Caminho normal — backend de pé

```js
// no console do browser, logado como admin
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"n8n"})
}).then(r=>r.json())
```

### Caminho de contingência — backend NÃO responde

O `PATCH /api/rotas/:processo` mora no Vercel. Se o Vercel caiu, o botão do escape caiu
junto. Vá direto no Postgres:

```sql
-- devolve UM processo pro n8n
UPDATE pi.rotas_processo SET modo='n8n', atualizado_em=now() WHERE processo='registro';

-- ou tudo de uma vez (o '*' vale pra quem não tem linha própria; as linhas
-- próprias precisam ser mudadas também, porque elas vencem o '*')
UPDATE pi.rotas_processo SET modo='n8n', atualizado_em=now();
```

**O navegador pode não obedecer na hora.** O front cacheia o mapa por 60 s em memória e
persiste em `localStorage["pi_rotas"]`. Com o backend fora, o `GET /api/rotas` falha e o
cache persistido é usado — até 24 h (`CACHE_VALIDADE_MS`). Para forçar agora:

```js
localStorage.removeItem("pi_rotas"); location.reload()
```

Sem backend e sem cache válido, o mapa volta a `{}` = **tudo n8n**, que é o pior caso seguro.

---

## O que NÃO volta pro n8n

Reserva quente só serve se calcular igual, e não calcula. Antes de flipar qualquer coisa
de volta, conferir a coluna de divergências em [`docs/paridade/README.md`](../paridade/README.md).

| processo | pode voltar? | por quê |
|---|---|---|
| `convocar` | **não** | o n8n não faz a convocação no RM (inline desde 10/08) |
| `pontual` | **não** | o WF5 paga no `create_item`, sem a felipeta `OP - Compareceu?` (13/08). Gatilho diferente = pagamento sem confirmação de comparecimento |
| `registro`, `pontofac`, `descontos`, `atestados` | com ressalva | os WFs não têm o patch DETRAN/TRE PB (desconto VR Mensal/30, commit `907a7ff`, 12/08). Voltar = descontar diferente do que o app calcula hoje |

---

## Ensaio (~10 min) — validar a fuga em produção

Fazer em horário calmo. Nada aqui paga ninguém.
Pré-requisito: estar logado como **admin**.

### Passo 0 — preparar

Usar uma convocação real já CONCLUÍDA e conhecida, ou criar uma de teste pelo `/convocar`
com chapa de teste. Anotar **uuid** e **protocolo**.

### Passo 1 — conferir o estado

```js
await fetch("/api/rotas", {credentials:"include"}).then(r=>r.json())
// → { rotas: {...}, flags_rm: {...} }
```

### Passo 2 — colocar o processo em `escape`

```js
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"escape"})
}).then(r=>r.json())
```

Esperar 1 min (cache) ou abrir aba anônima.

### Passo 3 — caminho feliz

Operar normalmente (buscar pelo protocolo → registrar 1 dia → Concluir). No DevTools →
Network, a chamada tem que ir pro **`/api/…`**, e **nenhuma** execução do WF correspondente
pode aparecer no n8n na janela.

### Passo 4 — exercitar a queda (o teste de verdade)

Sem derrubar produção: numa aba, interceptar o backend antes da chamada.

```js
// bloqueia SÓ as chamadas /api desta aba, simulando o backend fora
const orig = window.fetch
window.fetch = (u, o) => String(u).startsWith("/api")
  ? Promise.reject(new TypeError("simulado: backend fora"))
  : orig(u, o)
```

Esperado:

- **Leitura** (abrir `/preencher/<uuid>`): a tela carrega, o aviso amarelo de rota de fuga
  aparece, e o Network mostra a chamada indo pro host do n8n.
- **Escrita** (Concluir): falha com erro visível, o aviso acende, e **nenhuma** execução no
  n8n — é o comportamento correto, não um bug.

Restaurar com `window.fetch = orig` ou recarregando a aba.

### Passo 5 — voltar

```js
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"n8n"})
}).then(r=>r.json())
```

### Passo 6 — conferir onde gravou

- **Postgres:** `GET /api/convocacoes/<uuid>` (logado) → `respostas`/`ledger_beneficios`/`qtd_faltas`.
- **Board Monday:** deve refletir o registro. Se não refletir, é gap de paridade — anotar.
- **n8n:** conferir que nenhuma execução do WF rodou na janela do ensaio
  (`nocturnalgoose.execution_entity`, retenção de 7 dias).

### Passo 7 — registrar

Atualizar "Último check" em [`docs/paridade/README.md`](../paridade/README.md) e anotar
qualquer divergência encontrada — divergência vira fix de paridade, não nota de rodapé.
