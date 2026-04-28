# Registro de Ocorrências de Intermitentes — Especificação

App web de uso interno do RH para registrar ocorrências (faltas, atrasos, saídas antecipadas) dos funcionários intermitentes durante o período de cada convocação. O acesso é feito por **link único gerado via monday.com + n8n**, sem login.

---

## 1. Visão geral

- **Fonte da convocação**: board `Plano Intermitentes` no monday
- **Orquestração**: n8n (dispara na mudança de status, gera link, escreve de volta)
- **Banco**: Supabase Postgres (histórico + controle de estado do link)
- **Destino dos dados**: outro board do monday (a ser definido)
- **Ator único**: colaborador de RH (sem autenticação — a segurança é o UUID do link)

---

## 2. Fluxo ponta a ponta

### Gatilho
1. No board `Plano Intermitentes`, há uma **Button Column** "Processar"
2. RH clica no botão → **automação do monday** muda uma **Status Column oculta** (ex: `Status Processamento`) para "Solicitado"
3. A mudança dessa coluna dispara um **webhook** para o n8n

### Fluxo "preparar" (n8n)
1. Recebe payload com `item_id`
2. Busca os dados do item no monday (nome, contrato, data início/fim, etc)
3. Calcula a lista de dias da convocação
4. Gera um **UUID aleatório** (`gen_random_uuid`)
5. INSERT na tabela `processamentos` (status `aguardando`, `expira_em = now() + 30 dias`)
6. PATCH no monday: preenche uma **Link Column** da própria row com `https://app/preencher/{uuid}`
7. Opcional: muda o Status oculto para "Link gerado"

### Preenchimento (web app)
1. RH clica no link da row
2. App abre `/preencher/:uuid` → GET no n8n
3. Wizard renderiza uma tela por dia:
   - **P1:** "O intermitente faltou neste dia?"
     - **Sim** → registra `falta`, avança
     - **Não** → **P2:** "Atrasou ou saiu mais cedo?"
       - **Sim** → campo numérico "Minutos fora do expediente" → registra `atraso` + minutos
       - **Não** → registra `sem_ocorrencia`, avança
4. Ao final: tela de **revisão** com todos os dias; clicar em qualquer um volta ao wizard daquele dia
5. "Finalizar e enviar" → POST no n8n

### Fluxo "finalizar" (n8n)
1. Recebe `{ respostas: [...] }` com o `uuid` na URL
2. Valida `status = aguardando`
3. INSERT em `ocorrencias_dia` (uma linha por dia)
4. CREATE item(s) no **board de destino** do monday com os dados
5. UPDATE `processamentos`: `status = concluido`, `concluido_em = now()`, `monday_destino_item_id = ...`
6. Opcional: muda o Status oculto do item de origem para "Finalizado"

### Reabertura do link
- Se `status = aguardando` → mostra o wizard (o progresso do RH não é persistido entre abas por enquanto)
- Se `status = concluido` → tela "Obrigado pelo preenchimento"
- Se `status = expirado` → tela "Link expirado"
- Se UUID não existe → tela "Link não encontrado"

---

## 3. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Vite + React 19 + TypeScript |
| UI | Tailwind v4 + shadcn/ui |
| Estado server | React Query |
| Backend orquestração | n8n (3 webhooks) |
| Banco | Supabase Postgres |
| Integração | monday.com API v2 (GraphQL) |

---

## 4. Schema do banco

Ver [`schema.sql`](./schema.sql). Resumo:

- **`processamentos`** — uma linha por solicitação. Colunas: `id (uuid)`, `monday_item_id`, `nome`, `contrato`, `data_inicio`, `data_fim`, `qtd_dias` (generated), `status` (`aguardando|concluido|expirado`), `expira_em`, `criado_em`, `concluido_em`, `monday_destino_item_id`.
- **`ocorrencias_dia`** — uma linha por dia respondido. Colunas: `id`, `processamento_id`, `data`, `tipo` (`falta|atraso|sem_ocorrencia`), `minutos_atraso`, `criado_em`.

RLS **desabilitada**. Acesso só via n8n com `service_role`.

---

## 5. Configuração do monday (board de origem)

Colunas novas a criar no `Plano Intermitentes`:

| Coluna | Tipo | Visível? | Usada para |
|---|---|---|---|
| Processar | Button | sim | RH clica pra iniciar |
| Status Processamento | Status | não (oculta no view padrão) | gatilho da automação + acompanhamento |
| Link Processamento | Link | sim (aparece após o n8n preencher) | RH abre o app |

Automações:

1. **"Quando botão Processar é clicado → mudar Status Processamento para Solicitado"**
2. **"Quando Status Processamento muda para Solicitado → enviar webhook"** → URL do n8n (`/webhook/monday-trigger`)

---

## 6. Board de destino no monday

**A definir.** Precisa das colunas:
- Funcionário (referência/texto)
- Contrato
- Data da ocorrência
- Tipo da ocorrência (status: Falta | Atraso | Sem ocorrência)
- Minutos de atraso (números, só preenchido em atrasos)
- (opcional) ID do item de origem pra cruzar com o board de convocações

O n8n cria **uma row por dia respondido** (ou só por dias com ocorrência — decidir).

---

## 7. n8n — contratos dos webhooks

### Webhook 1 — `POST /webhook/monday-trigger`
Disparado pela automação do monday quando o status oculto vira "Solicitado".

Faz: busca no monday, gera uuid, INSERT processamentos, PATCH Link Column, muda status pra "Link gerado".

### Webhook 2 — `GET /webhook/processamento/:uuid`
Chamado pelo frontend ao abrir o link.

Faz: SELECT em `processamentos`. Se `expira_em < now()` e `status = aguardando`, marca como `expirado` antes de retornar.

Retorna:
```json
{
  "uuid": "…",
  "nome": "…",
  "contrato": "…",
  "dataInicio": "2026-04-20",
  "dataFim": "2026-04-25",
  "dias": ["2026-04-20", "2026-04-21", ...],
  "status": "aguardando",
  "concluidoEm": null
}
```

### Webhook 3 — `POST /webhook/processamento/:uuid/finalizar`
Chamado pelo frontend ao submeter.

Body:
```json
{
  "respostas": [
    { "data": "2026-04-20", "tipo": "falta" },
    { "data": "2026-04-21", "tipo": "atraso", "minutosAtraso": 30 },
    { "data": "2026-04-22", "tipo": "sem_ocorrencia" }
  ]
}
```

Faz: INSERT em `ocorrencias_dia`, CREATE no board destino, UPDATE `processamentos` pra `concluido`.

Retorna: 200 OK (body vazio).

---

## 8. UX do wizard

- **Um dia por tela** (reduz carga cognitiva, Enter avança)
- Progress bar no topo ("3 de 6 dias preenchidos — 50%")
- Botão "Voltar" discreto (sempre disponível)
- Tela final de **revisão** antes do submit; cada dia é clicável pra editar
- Respostas NÃO são persistidas entre refreshes (MVP) — se o RH fechar a aba, perde o progresso e começa do dia 1 ao reabrir

Estados terminais (todos sem wizard):
- `concluido` → tela "Obrigado pelo preenchimento" (ícone verde, data/hora)
- `expirado` → tela "Link expirado"
- 404 → tela "Link não encontrado"

---

## 9. Segurança

- UUID v4 criptográfico: ~122 bits de entropia, impossível de enumerar
- Link expira em 30 dias (configurável via `expira_em`)
- Um mesmo UUID **não pode ser finalizado duas vezes** (n8n valida `status = aguardando` antes de aceitar o POST)
- `MONDAY_API_TOKEN` e `service_role` do Supabase **somente no n8n**
- Frontend só expõe `VITE_N8N_BASE_URL` (é pública — é apenas a URL base do webhook)

---

## 10. Roteiro de implementação

1. ✅ **Fase 1** — limpeza do scaffolding antigo (auth do Google removido)
2. ✅ **Fase 2** — frontend com wizard, telas de estado e mocks locais
3. ⏳ **Fase 3** — n8n workflows
4. ⏳ **Fase 4** — schema Supabase (rodar `docs/schema.sql`)
5. ⏳ **Fase 5** — config das colunas e automações no monday
6. ⏳ **Fase 6** — conectar frontend ao n8n real
