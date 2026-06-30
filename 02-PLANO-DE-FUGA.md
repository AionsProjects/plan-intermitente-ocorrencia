# 🪂 Plano de Fuga — n8n → Backend (código)

> **Objetivo:** tirar TODA a orquestração do n8n e levar pro backend (`auth-backend`, Fastify+TS). O backend passa a ser o dono do código: fala Monday/RM/Caju/Drive/Nexti direto, com lógica versionada, testável e em git.
>
> **Decisões tomadas (2026-06-30):**
> - **Fonte de verdade = Híbrido.** Postgres `pi` vira o core (lógica + estado). Monday é mantido como **view/espelho** pro DP via sync PG→Monday. Nenhum WF a mais escreve regra de negócio.
> - **Runtime = Vercel serverless + Vercel Cron.** Sem worker dedicado. Jobs longos (RM em lotes, polling boleto Caju, Pontual, Virada) são **quebrados em steps idempotentes** numa fila no Postgres e avançados por **tick de cron** — nunca esperando dentro de um request.
> - **Cutover = incremental por processo.** Um processo por vez: dual-write → validação em prod → mata o WF n8n correspondente.
>
> Plataforma/boards/acessos → **01-VISAO**. Estado/fixes → **03-OPERACAO**. Guia DP → **04-GUIA**. Mapa dos WFs → **MAPA-AUTOMACOES**.

---

## 0. Onde estamos (baseline real, não a doc aspiracional)

No disco, o `auth-backend` hoje tem só:
- **Rotas:** `auth` (SSO Google + login local), `usuarios` (admin), `atividade` (audit), `convocacoes` (CRUD do que era o board Histórico).
- **Migrations:** `001_init` (users/sessions/audit_lancamentos), `002_perfil`, `003_senha`, `004_atividade`, `005_convocacoes` (+ `service_tokens`).
- **Deps:** `fastify`, `@fastify/cookie`, `google-auth-library`, `pg`. **Não tem** cliente Monday, RM/SOAP, Caju, Drive, fila de jobs, nem validação de schema.
- **ETL já provado:** `scripts/importar-convocacoes.ts` lê o board Histórico via Monday GraphQL (cursor paginado) e faz upsert em `pi.convocacoes`. **Esse é o padrão de migração de dados** — replicar por board.
- **Front:** todos os `features/*/api.ts` batem em `VITE_N8N_BASE_URL`. `lib/http.ts` já injeta `operador` nos payloads (n8n ignora hoje). Cutover do front = trocar a base de cada chamada pra `/api/*` + ajustar shape.

> **Conclusão:** a fuga **já começou pela camada de dados** (convocacoes + service_tokens + ETL). Falta: (a) os clientes externos em código, (b) a lógica de cada processo, (c) a fila/cron pros jobs longos, (d) o sync PG→Monday, (e) virar o front processo a processo.

---

## 1. Arquitetura-alvo

```
[ Front React/Vercel ]  ──/api/*──►  [ Backend Fastify (Vercel serverless) ]
   (api.ts → /api, não                      │
    mais → n8n/webhook)                      ├── clients/    (monday, rm/aions, caju, drive, nexti)
                                             ├── domain/     (1 módulo por processo: convocar, registro,
                                             │                cancelar, pontual, atestados, ponto-fac,
                                             │                descontos, mensal, virada, feriados, valores)
                                             ├── jobs/       (fila em pi.jobs + steps idempotentes)
                                             └── sync/       (PG → Monday view)
                                             │
                                  [ Postgres `pi` ] ◄─ FONTE DE VERDADE (estado + ledger + regras)
                                             │
                          [ Vercel Cron ] ──tick──► avança jobs (RM lotes, Caju poll, virada, expiração)
                                             │
                  [ Monday boards ] = VIEW (sync de leitura pro DP; deixa de ser escrito por WF)
                  [ RM TOTVS (ponte AIONS) ] [ Caju ] [ Drive ] [ Nexti ] = sistemas externos
```

**Princípios:**
1. **Regra de negócio só no backend.** Cálculo de VR/VT, FIFO de desconto, mobilidade×VT, feriado por contrato, antifraude de período — tudo em `domain/`, com teste unitário. Hoje isso está espalhado em Code nodes do n8n (frágil, sem versão).
2. **Escrita externa idempotente + registrada.** Toda chamada que cria efeito no mundo (Caju PIX, SOAP RM) passa por uma tabela de **idempotência** (`pi.efeitos_externos`) com chave natural. Re-rodar nunca duplica. Mata o risco nº1 (PIX duplicado).
3. **Monday vira read-model.** O backend escreve no Postgres; um sync espelha pro board pro DP continuar enxergando. Webhooks do Monday (coluna `ativar`, `create_item`) passam a chamar `/api/*` do backend em vez do n8n.
4. **Serverless-safe:** request curto sempre. Qualquer coisa que demore (lote RM, boleto Caju async) vira **job** persistido + avançado por cron.

---

## 2. Camada de clients (substitui os nós n8n)

Um módulo tipado por sistema externo. Cada um encapsula auth, retry, rate-limit e logging.

| Client | Substitui | Núcleo | Notas de risco |
|---|---|---|---|
| `clients/monday.ts` | nós `mondayCom` + HTTP api.monday.com | GraphQL: query items (cursor), `change_multiple_column_values`, `create_item`, `move_item_to_group`, `add_file_to_column` (multipart `/v2/file`) | token "Ray0" → env `MONDAY_TOKEN`. Long_text ~2000 chars. |
| `clients/rm.ts` (ponte AIONS) | HTTP `headed-shawl-annex.ngrok-free.dev` | `/consultar-rm` (SQL: BEN 2, unidades), `/enviar-rm` (SaveRecord), `/executar-processo-rm`, `/deletar-rm` | header `AIONS-AUTH`. **Sempre em lotes** (ngrok derruba volume). porta 8077. Writes idempotentes. |
| `clients/caju.ts` | nós Caju OAuth/criar/confirmar | OAuth `auth.caju.com.br`, criar pedido (crédito), confirmar PIX, GET boleto (`pixCode.encodedImage`) | **encodedImage é async → polling por cron**, nunca espera no request. PIX real = idempotência obrigatória. |
| `clients/drive.ts` | nó `googleDrive` | `ensurePaths` (ano/mês/contrato/pessoa/período), upload binário (retry 5×), gera link | cred "iray". normaliza binário. |
| `clients/nexti.ts` | nós Nexti | OAuth + GET persons/absences/absencesituations | valida atestado por CPF×data. |

Deps novas: cliente HTTP (`undici`/fetch nativo já serve), validação (`zod`), e — pra multipart Monday `/v2/file` — montar form manualmente. **Sem SDK pesado.**

---

## 3. Modelo de dados (Postgres core + Monday view)

### 3.1 Tabelas a criar (migrations 006+)

| Migration | Tabela | Substitui board | Conteúdo |
|---|---|---|---|
| ~~`006`~~ | `pi.boards`, `pi.board_colunas`, `pi.board_grupos` | (registry) | **JÁ EXISTE no DB** (criado fora do repo). `006_dias_descontados.sql` ocupou o número (col `dias_descontados` no convocacoes). Registry: criar migration idempotente retroativa (renº). |
| `007_entrada` | `pi.entrada_convocacoes` | Entrada `18413180912`/`18418191275` | origem da convocação (15 campos do form `/convocar`) + status |
| `008_base_desconto` | `pi.descontos` (ledger) | Base Desconto `18400981023` | **o mais crítico**: ledger financeiro PENDENTE/PARCIAL/FINALIZADO, FIFO |
| `009_valores` | `pi.valores` | Valores `18413870370` | VR/VT por contrato+função (parâmetros) |
| `010_feriados` | `pi.feriados` | Feriados `18415442661` | feriado por contrato (NAC/EST/MUN) |
| `011_atestados` | `pi.atestados` | Controle Atestados `18298015951` | documental (1/atestado + ref. arquivo Drive) |
| `012_solicitacao_pgto` | `pi.solicitacoes_pgto` | Sol. Pagamento `18393673859` | pedidos Caju/RM |
| `013_controle_caju` | `pi.caju_ledger` | Controle Caju `7833600425` | débito/saldo Caju |
| `014_jobs` | `pi.jobs`, `pi.efeitos_externos` | (n8n executions) | fila de jobs + idempotência de efeitos externos |

> `pi.convocacoes` (005) já cobre o Histórico. **006_dias_descontados** (hoje) adicionou a coluna `dias_descontados jsonb` = fonte de verdade do **incremento** (delta = dias no ledger que não estão aqui → lança só os novos, sem duplicar). O route `convocacoes.ts` foi reconciliado pra persistir/mergear essa coluna (POST upsert + PATCH `dias_descontados_merge`). As colunas Monday→lógico já mapeadas em `importar-convocacoes.ts` viram a referência pro ETL dos outros boards.

### 3.2 Sync PG → Monday (view)

Módulo `sync/` que, após cada mutação de domínio, **enfileira** um job `sync_monday` que escreve as colunas do board correspondente (via `change_multiple_column_values`). Idempotente (sobrescreve). Assim o DP continua vendo tudo no Monday, mas o board não é mais autoridade. Direção **só PG→Monday** (one-way) pra não haver conflito de escrita.

> Edição manual do DP no board (hoje permitida): durante a transição, um **webhook Monday→backend** captura mudanças relevantes e reconcilia. Pós-cutover, telas do front cobrem o que o DP editava à mão.

### 3.3 Idempotência de efeitos externos (anti-duplicação)

```sql
-- pi.efeitos_externos: trava de "isso já foi feito no mundo real"
CREATE TABLE pi.efeitos_externos (
  chave text PRIMARY KEY,        -- ex: "caju:pedido:<uuid>:<competencia>" | "rm:lanc:<chapa>:<evento>:<comp>"
  tipo text NOT NULL,            -- caju_pix | rm_soap | drive_upload
  status text NOT NULL,          -- pendente | confirmado | falhou
  ref_externa text,              -- id do pedido Caju / idVR/idVT do RM
  payload jsonb,
  criado_em timestamptz DEFAULT now(),
  confirmado_em timestamptz
);
```
Antes de qualquer Caju/RM: `INSERT ... ON CONFLICT DO NOTHING`. Se já existe `confirmado` → pula. Resolve o terror do "re-trigger duplica PIX".

---

## 4. Fila de jobs sem worker (serverless + cron)

O n8n era o motor de jobs longos. Sem worker, o padrão é **fila no Postgres + tick de cron**:

```sql
CREATE TABLE pi.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,            -- pontual | mensal | virada | caju_poll | sync_monday | expiracao
  estado text NOT NULL,          -- pendente | rodando | aguardando_externo | concluido | falhou
  passo int NOT NULL DEFAULT 0,  -- step atual (retomada idempotente)
  payload jsonb NOT NULL,
  cursor jsonb,                  -- progresso (ex: lote RM 50/199, último chapa processado)
  tentativas int DEFAULT 0,
  proximo_em timestamptz,        -- backoff / agendamento
  erro text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz
);
CREATE INDEX idx_jobs_due ON pi.jobs (estado, proximo_em);
```

- **Endpoint** `POST /api/jobs/tick` (protegido por token Vercel Cron): pega N jobs `due`, avança **um passo cada** dentro do timeout, persiste `cursor`/`passo`, reenfileira. Idempotente por construção.
- **Vercel Cron** (`vercel.json`): `* * * * *` chama o tick (jobs gerais), `0 17 14 * *` chama a virada, `0 3 * * *` chama expiração de links.
- **Lote RM:** job `pontual`/`mensal` guarda no `cursor` o índice do lote (50 chapas) — cada tick manda 1 lote; ngrok não derruba.
- **Boleto Caju async:** job `caju_poll` em `aguardando_externo`; cada tick faz GET do `encodedImage`; quando vier, baixa, dispara Drive, conclui. Retry com backoff.

> Isso replica fielmente o comportamento "SplitInBatches + Wait + retry" do n8n, mas em código versionado e retomável após crash.

---

## 5. Ordem de cutover (incremental por processo)

Sequência pensada por **risco crescente** e **dependência**. Cada processo: codar → dual-write → validar em prod → desligar WF.

| Ordem | Processo | WFs n8n que morrem | Risco | Pré-requisito |
|---|---|---|---|---|
| **F0** | Infra: clients + jobs + sync + registry + ETL dos boards | — | baixo | migrations 006–014 |
| **F1** | **Leituras** (Ler/WF2, Buscar Protocolo/WF4, Buscar Convocações, Feriados, Unidades RM, Buscar Empregado RM/WF8, Celetista) | 2, 4, 8, Feriados, Unidades, Celetista, Buscar Convocações | **baixo** (só lê) | clients monday+rm |
| **F2** | **Registro de ocorrência** (Finalizar/WF3 + Sábados Extras + WF6) | 3, Sábados Extras, 6 | médio (desconto, mas sem Caju no caminho feliz) | F1 + ledger + idempotência RM |
| **F3** | **Convocar** (WF7 + WF1 Preparar + Drive) | 7, 1, Drive Arquivar, Gerar Planilha | médio (antifraude período, webhook ativar) | F1 + entrada + drive |
| **F4** | **Cancelamento** | Cancelar | médio (sempre desconta) | F2 |
| **F5** | **Atestados + Nexti** | Lançar Documentos, Nexti Validar | médio | F1 + atestados + nexti |
| **F6** | **Ponto Facultativo** (3 WFs) | Ponto-Fac Opcoes/Preview/Aplicar | médio | F1 + ledger + unidades |
| **F7** | **Descontos manuais** (3 WFs) | Descontos Gerar Link/Ler/Registrar | baixo | F2 (ledger) |
| **F8** | **Pontual FIFO** (WF5, 56 nós) | 5 | **ALTO** (Caju PIX + RM) | F2 + idempotência + jobs + caju |
| **F9** | **Mensal Intermitente** (krRj3/KxysR) | krRj3, KxysR | **ALTO** (massa) | F8 |
| **F10** | **Virada de mês** (BENAUT) | Virada `gm2Ie8pbR2rOK5id` | ALTO (recria tudo) | F0 registry + cron |

> Ordem deliberada: leituras primeiro (zero risco de duplicar nada), pagamento real (Caju/RM) por último e só depois da idempotência blindada. As pendências antigas (DETRAN 87792, etc.) **ficam fora** — serão feitas no modelo novo.

### Mecânica do dual-write por processo
1. Backend implementa a rota `/api/<processo>` com a lógica em `domain/`.
2. Front passa a chamar `/api/<processo>` (flag/env por feature pra rollback rápido).
3. Backend escreve no Postgres + enfileira `sync_monday` (board atualizado).
4. Roda em paralelo ao WF por X dias; compara resultado (job de reconciliação).
5. Confirmado → **desativa o WF no n8n** (não deletar; arquivar) e remove o webhook Monday correspondente.

---

## 6. Tickets de implementação (granular)

### F0 — Fundação
- [ ] Add deps: `zod` (validação), nada mais (fetch nativo).
- [ ] `clients/monday.ts` — query paginada, mutations, upload `/v2/file`. Reusar mapa de colunas do ETL.
- [ ] `clients/rm.ts` — wrapper ponte AIONS, lotes + retry/backoff.
- [ ] `clients/caju.ts`, `clients/drive.ts`, `clients/nexti.ts`.
- [ ] migrations `006`–`014` (registry, entrada, descontos, valores, feriados, atestados, sol.pgto, caju_ledger, jobs, efeitos_externos).
- [ ] ETL por board (replicar `importar-convocacoes.ts`): entrada, valores, feriados, base_desconto, atestados.
- [ ] `jobs/runner.ts` + `POST /api/jobs/tick` + `vercel.json` cron.
- [ ] `sync/monday.ts` — job `sync_monday` one-way.
- [ ] `domain/` puro testável: `calcVrVt.ts`, `feriadoContrato.ts`, `mobilidadeVt.ts`, `fifoDesconto.ts`, `antifraudePeriodo.ts` (com testes — replicar regras hoje nos Code nodes).

### F1 — Leituras (corta 7 WFs, risco ~zero)
- [ ] `GET /api/intermitente/ler/:uuid` (← WF2). Lê `pi.convocacoes` + atestados + split.
- [ ] `GET /api/intermitente/protocolo/:protocolo` (← WF4). Já existe parcial em convocacoes.ts.
- [ ] `GET /api/intermitente/convocacoes?chapa=&mes=` (← Buscar Convocações).
- [ ] `GET /api/feriados?contrato=` (← Feriados).
- [ ] `GET /api/rm/empregado?nome=` (← WF8, BEN 2) e `/api/rm/celetista?nome=` (← Celetista).
- [ ] `GET /api/rm/unidades?contrato=` (← Unidades RM).
- [ ] Front: trocar base dessas chamadas pra `/api`. Desligar os 7 WFs.

### F2 — Registro (Finalizar)
- [ ] `POST /api/intermitente/finalizar/:uuid` (← WF3). Calcula falta/atraso, grava ledger (`pi.descontos`), agrega, marca concluído, espelha (sync). DETRAN/TRE não descontam falta.
- [ ] Sábado extra → enfileira job `caju_poll` (boleto VT) + lançamento RM via idempotência.
- [ ] Idempotência: re-finalizar não duplica (chave `uuid`).

### F3–F10 — (detalhar a cada fase, mesma mecânica)

---

## 7. Guardrails (não repetir as dores conhecidas)

- **PIX/RM duplicado** → `pi.efeitos_externos` antes de qualquer escrita externa. Job retomável nunca re-executa passo confirmado.
- **ngrok derruba volume** → RM sempre em lote (cursor no job), nunca payload gigante.
- **Boleto Caju vazio** → polling por cron (`aguardando_externo`), nunca espera no request.
- **Segredos expostos** (Postgres/RM/Caju/Monday/n8n key) → **rotacionar antes do cutover** e mover tudo pra env do backend (já é runtime, não baked). Tirar das docs.
- **Edição manual do DP no Monday** → durante transição, webhook de reconciliação; pós-cutover, tela no front.
- **Virada** → testar em board de staging antes de ligar o cron `0 17 14 * *`. Registry é pré-requisito duro.
- **Timeout serverless** → nenhuma rota faz loop externo; tudo pesado é job.

---

## 8. Definição de pronto (fuga completa)

- [ ] n8n com **zero WFs ativos** de intermitente (todos arquivados).
- [ ] Webhooks Monday apontam pro backend (ou foram substituídos por ação no front).
- [ ] Postgres `pi` é fonte de verdade; Monday é view sincronizada one-way.
- [ ] Toda regra de negócio em `domain/` com teste.
- [ ] Jobs longos rodam por cron, retomáveis, idempotentes.
- [ ] Segredos rotacionados, só em env do backend.
- [ ] Front 100% em `/api/*`, `VITE_N8N_*` removido.

---

## 9. Próximo passo imediato

**F0 + F1** é o arranque de menor risco e maior alívio (corta 7 WFs sem tocar em dinheiro):
1. `clients/monday.ts` + `clients/rm.ts`.
2. migrations `006` (registry) e `009`/`010` (valores/feriados — leituras de F1).
3. Rotas de leitura F1 + virar o front dessas telas.

Decidir: **começo a codar F0 agora** (clients + migrations) ou quer revisar/ajustar o plano antes?
