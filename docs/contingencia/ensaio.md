# Ensaio de contingência (~10 min) — validar a rota de fuga em produção

> Fazer em horário calmo. Nada aqui paga ninguém. Objetivo: exercitar o flip
> `modo=api` de verdade e confirmar que o DP consegue operar com o n8n "fora".
> Pré-requisito: estar logado como **admin** no app.

## Passo 0 — Preparar uma convocação de teste

Usar uma convocação real já CONCLUÍDA e conhecida (ou criar uma de teste pelo fluxo
normal /convocar com uma chapa de teste). Anotar o **uuid** e o **protocolo**.

## Passo 1 — Conferir o estado dos flags (console do browser, F12, logado)

```js
await fetch("/api/rotas", {credentials:"include"}).then(r=>r.json())
// esperado: { rotas: { "*": "n8n" } }  ← tudo no primário
```

## Passo 2 — FLIP: registro assume pelo backend

```js
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"api"})
}).then(r=>r.json())
// esperado: { ok:true, processo:"registro", modo:"api" }
```
O front cacheia os flags por 60s — **espere 1 min** ou recarregue a aba anônima nova.

## Passo 3 — Operar como DP (o teste de verdade)

1. Abrir "Atualizar ocorrência" → buscar pelo **protocolo** da convocação de teste.
2. Reabrir e registrar 1 dia (ex.: marcar 1 falta) → Concluir.
3. **Sinal de sucesso:** a operação completa sem erro. No DevTools → Network, a
   chamada `intermitente-finalizar` foi pra **`/api/intermitente-finalizar`**
   (não pro n8n).

## Passo 4 — Verificar onde gravou

- **Postgres (fonte da contingência):**
  `GET /api/convocacoes/<uuid>` (logado) → `respostas`/`ledger_beneficios`/`qtd_faltas`
  refletem o registro do passo 3.
- **Board Monday:** NÃO atualiza no modo fallback (gap documentado) — é esperado.
- **n8n:** conferir que NENHUMA execução do WF finalizar (rlxTk4) rodou nesse horário.

## Passo 5 — FLIP de volta (fim do ensaio)

```js
await fetch("/api/rotas/registro", {method:"PATCH", credentials:"include",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({modo:"n8n"})
}).then(r=>r.json())
```

## Passo 6 — Reconciliar o teste

O registro do passo 3 existe SÓ no PG (board ficou para trás — igual numa contingência
real). Duas opções:
- **Replay:** refazer o mesmo registro pelo fluxo normal (agora via n8n) → board e PG
  convergem (o espelho é idempotente por uuid).
- **Descartar:** se foi convocação de teste, apagar o item do board + `DELETE FROM
  convocacoes WHERE uuid='<uuid>'` + limpar o desconto de teste em `pi.descontos`.

## Passo 7 — Registrar o resultado

Atualizar a coluna "Último check" em `docs/paridade/README.md` e anotar qualquer
divergência de shape/comportamento encontrada (vira fix de paridade).

---

## Ensaio B (opcional, +5 min) — fallback de LEITURA

O fallback de leitura dispara sozinho quando o MONDAY falha (não o n8n). Pra exercitar
sem derrubar nada, teste o espelho direto:

```js
// espelho PG (o que o fallback serve):
await fetch("/api/intermitente-ler?uuid=<uuid>").then(r=>r.json())
// rota normal (Monday):
await fetch("/api/intermitente/ler?uuid=<uuid>").then(r=>r.json())
// → comparar os dois JSONs: shapes/valores devem bater (diferenças = fix de paridade).
```

## Ensaio C (opcional) — kill-switch global

`PATCH /api/rotas/*` com `{modo:"api"}` manda TUDO que usa chamarProcesso pro backend
de uma vez (leituras + escritas espelhadas). Só ensaiar depois do A passar limpo.
Voltar com `{modo:"n8n"}`.

---

**Critério de aprovação do ensaio:** passo 3 sem erro + passo 4 com PG correto +
nenhuma execução n8n no período + flip de volta limpo. Com isso, a confiança da
contingência de escrita sobe de "média" pra "alta".
