# Plano de Intermitentes — Documentação da Automação

> Documento único: **Parte 1 (Técnica)** para quem mantém o sistema + **Parte 2 (Guia de uso)** para o DP.
> Atualizado em 2026-06. Boards na conta Monday **Contato Serviços** (`contato-serv`), workspace **DEPARTAMENTO PESSOAL** (id `2739319`).

---

## Visão geral

O sistema gerencia **convocações de intermitentes**: cria convocação, gera link de preenchimento, registra ocorrências (faltas/atrasos), aplica descontos de benefício (VR/VT), faz lançamento financeiro (RM/Caju) e arquiva documentos. Roda em 4 camadas:

```
 [ Front React/Vercel ]  →  [ n8n (conectores + lógica) ]  →  [ Monday (boards = banco) ]
        (telas DP)              webhooks / WFs                  +  [ RM TOTVS / Caju / Drive ]
            │                          │
            └──── /api/* ────►  [ Backend Vercel (auth-backend) ]  ──►  [ Postgres `pi` ]
                                  (auth, leituras, registry)            (auth + registry de boards)
```

- **Front (Vercel)** — SPA React. Telas do DP. Fala com **n8n** (escritas/RM/Caju) e com o **backend Vercel** (leituras + registry).
- **n8n** — orquestração. Cada fluxo (WF) é disparado por **webhook** (do front ou do Monday) ou **agendamento**. Faz a lógica e escreve no Monday / chama RM/Caju/Drive.
- **Monday** — é o "banco de dados" de negócio (boards). O DP também edita à mão.
- **Backend Vercel (`auth-backend`)** — login/sessão + leituras + **registry de boards** (Postgres `pi`), que resolve os IDs de colunas/grupos/board por mês (robusto à virada).
- **Postgres `pi`** (cloudfy) — só auth, atividade e registry. **NÃO** guarda dado de negócio (isso é Monday).

**Dois deploys** convivem: **VM** `http://192.168.0.41:8081` (antigo) e **Vercel** `https://plan-intermitente-ocorrencia.vercel.app` (atual, prod = branch `vercel-deploy`).

---

# PARTE 1 — TÉCNICA

## 1. Boards Monday

| Board | ID | Função | Virada |
|---|---|---|---|
| **Entrada / Central** | `18413180912` (jun) / `18418191275` (jul) | Origem da convocação. Form `/convocar` cria item aqui; coluna `ativar` dispara o registro. | **DUPLICA todo mês** (id muda → resolver via registry) |
| **Histórico** | `18411141462` | 1 item por convocação: respostas, agregados, status, ledger de cancelamento. | FIXO |
| **Controle de Atestados** | `18298015951` | Documental (1 item/atestado + arquivo). | FIXO |
| **Base de Desconto** | `18400981023` | Ledger financeiro (PENDENTE/PARCIAL/FINALIZADO). | FIXO |
| **Valores (Parâmetros)** | `18413870370` | VR/VT por contrato+função (diário e mensal). | FIXO |
| **Feriados** | `18415442661` | Feriados por contrato (NACIONAL/ESTADUAL/MUNICIPAL). | FIXO |
| **Solicitação de Pagamento** | `18393673859` | Pedidos de pagamento de benefício (Caju/RM). | FIXO |
| **Controle Caju** | `7833600425` | Débito/saldo Caju. | FIXO |

**Colunas-chave da Entrada** (ids estáveis na duplicação — ver §3): `ativar` (`color_mm2pxmak`), `OP - Tipo Convocação` (`color_mkta71ex`), `Op - Contrato` (`color_mktcnxwn`), `Status Convocação` (`color_mm3a8ana`: Válida/Cancelada/Cancelada parcialmente/Bloqueada), `OP - Interior?` (`color__1`), datas (`date_mktayxhb`/`date_mktasnwq`), `OP - Local/Unidade` (`dropdown_mm3ts726`). Grupos: `PONTUAL` (`group_mkta43yr`), `NÃO CONVOCADOS` (`group_mm2eqsdr`), `CANCELADOS` (`group_mkybnrd1`), `CANCELADOS PARCIAL` (`group_mm3hpa19`).

## 2. Registry de boards (Postgres `pi`) — robustez à virada

Tabelas: `pi.boards` (monday_board_id, competencia, papel `atual|proximo|passado`), `pi.board_colunas` (titulo→column_id), `pi.board_grupos` (titulo→group_id).

**Endpoints** (`auth-backend/src/routes/boards.ts`):
- `GET /api/boards/resolver?papel=atual|proximo|passado` (ou `?competencia=YYYY-MM` ou `?board_id=`) → `{board_id, competencia, papel, colunas{titulo:id}, grupos{titulo:group_id}}`. **É o que os WFs/front consultam pra achar o board/coluna/grupo do mês.**
- `POST /api/boards/registrar {monday_board_id, competencia, papel}` — lê colunas+grupos do Monday e grava. Admin OU `X-Service-Token`.
- `POST /api/boards/virada {copia_board_id, central_board_id, copia_competencia, central_competencia, dry_run?}` — transação da virada: `atual→passado`, cópia=`atual`, central=`proximo`. `X-Service-Token`. `dry_run:true` valida sem gravar.
- `POST /api/boards/garantir-webhook {monday_board_id}` — cria o webhook `ativar` se não existe.

**Descoberta importante:** `duplicate_board` do Monday **preserva column_ids e group_ids** (junho→julho = 0 mudanças). Só o **board_id** muda na virada. Então os WFs só precisam resolver o **board_id** dinâmico — as colunas/grupos hardcoded continuam válidos nos boards duplicados. (Exceção: maio era board antigo, ids diferentes.)

## 3. Backend Vercel (`auth-backend`)

- **Auth**: SSO Google (`@contatoserv.com.br`) + sessão cookie. Papéis admin>dp>rh/op. (`src/routes/auth.ts`)
- **Leituras/registry**: `/api/convocar/opcoes` (labels dos selects + unidades RM por contrato), `/api/intermitente/{ler,interior,buscar-protocolo,convocacoes-empregado,descontos-ler}`, `/api/boards/*`, `/api/feriados`, `/api/valores`.
  - `/api/intermitente/interior?uuid=` → `{interior}` (coluna OP-Interior? OU contrato TRE PB/SEDUC INTERIOR) — usado pelo Sábados pra mobilidade Caju.
- **Config/env**: `MONDAY_TOKEN`, `VITE_N8N_BASE_URL`, `SERVICE_TOKEN` (WF de virada→backend), `N8N_WEBHOOK_BASE`, `PUBLIC_BASE_URL`.

## 4. Workflows n8n — índice

n8n: `https://aionscorp-n8n.cloudfy.live`. Webhooks: `…/webhook/<path>`.

| WF | ID | Gatilho | Função | Chamado por |
|---|---|---|---|---|
| **1. Preparar** | `rkIBahkH1h7cqnzE` | webhook `Intermitentehaha` (Monday: coluna `ativar`) | Gera UUID+link, cria item no Histórico, grava link na Entrada | Monday (mudar `ativar`) |
| **2. Ler** | `WHtIQDf8oOWinGyx` | webhook `intermitente-ler` | Lê convocação por UUID (dados+respostas+atestados) | `/preencher` |
| **3. Finalizar** | `rlxTk4VZLM2gTzx7` | webhook `intermitente-finalizar` | Calcula desconto (faltas/atrasos), grava Histórico+Base Desconto, espelha no Plan, dispara sábados extras | `/preencher` |
| **4. Buscar Protocolo** | `m5GIJMo0ghgSGbh2` | webhook `intermitente-buscar-protocolo` | Protocolo→UUID | `/corrigir` |
| **5. Pontual FIFO** | `E1XAdrEbPy5lZhNS` | webhook `intermitentes/pontual` | Calcula benefício do período, Caju (crédito/boleto), RM (WF6), Solicitação Pgto, espelha Plan, dispara Drive | criar item / WF3 |
| **6. Lançamento Financeiro** | `NdUSkYcRT4DkKfzW` | sub-workflow (executeWorkflow) | SOAP RM (FopRotinas) por evento 100=VR/110=VT; retorna idVR/idVT | WF5/Sábados |
| **7. Convocar** | `dX8OZzxr6sh0Upug` | webhook `intermitente-convocar` | Antifraude período + cria item na Entrada (grupo PONTUAL) + upload termos. **Resolve board/grupo/colunas via registry** (papel) | `/convocar` |
| **8. Buscar Empregado RM** | `Dt0p1T6OZECuXRiI` | webhook `convocar-buscar-empregado` | SQL RM (BEN 2) por nome | `/convocar`, `/atestados` |
| **9. Opcoes convocação** | `EImlFizH4jDgxW1Z` | webhook `intermitente-convocar-opcoes` | **OBSOLETO** (substituído por `/api/convocar/opcoes`). Aponta board de maio. | (legado VM) |
| **Cancelar** | `sbKoeewbkS7LNORH` | webhook `intermitente-cancelar-convocacao` | Status Cancelada/parcial + desconto + **move pro grupo CANCELADOS/PARCIAL** (registry). Board do item via item_origem | `/preencher` |
| **Aplicar Split** | `ZagUa2yuP6BsAE9i` | webhook `intermitente-aplicar-split` | Grava Split JSON no Histórico | `/preencher` |
| **Buscar Convocações** | `8l69E6Z9ouZAL027` | webhook `intermitente-convocacoes-empregado` | Convocações do empregado no mês (board atual via registry) | `/atestados` |
| **Lançar Documentos** | `kVpn69JFUJfR7T7U` | webhook `intermitente-lancar-documentos` | Cria item Controle Atestados + arquivo | `/atestados` |
| **Ponto-Fac Opcoes** | `JXpJ6xuSZMcu2IVn` | webhook `ponto-facultativo-opcoes` | Unidades por contrato + contagem (board atual via registry) | `/ponto-facultativo` |
| **Ponto-Fac Preview** | `7gHmbLcZ5r6D5sXz` | webhook `ponto-facultativo-preview` | Afetados+valores por contrato/unidades/data (sem gravar). DETRAN/TRE = não desconta | `/ponto-facultativo` |
| **Ponto-Fac Aplicar** | `XybrfnzI11Fw5sX4` | webhook `ponto-facultativo-aplicar` | Idem preview + grava ledger/Base Desconto | `/ponto-facultativo` |
| **Unidades RM** | `OggzTr5xRYc6s3NV` | webhook `intermitente-unidades-rm` | Unidades por contrato (SQL RM) | `/api/convocar/opcoes`, Ponto-Fac |
| **Drive Arquivar** | `XRdAYO9dx2jSU8ps` | webhook `drive-intermitente-arquivar` | Cria pastas Drive + upload boleto/comprovante Caju; dispara Gerar Planilha. Board atual via registry | WF5, WF7, Lançar Docs |
| **Gerar Planilha** | `aBXCqYHPtZNjDMOM` | webhook `gerar-planilha-conferencia` | XLSX com todas as colunas do board (do item) → pasta CONFERENCIA | Drive Arquivar |
| **Feriados** | `QzZ02GGqjs9udBe2` | webhook `intermitente-feriados` | Lê board Feriados | front (calendários) |
| **Descontos — Gerar Link** | `BCgD9f1b3tKebluP` | webhook `descontos-gerar-link` | Gera link de retirada manual | Monday Automation |
| **Descontos — Ler** | `EXuqosXXOSQNlmqY` | webhook `descontos-ler` | Lê desconto por UUID | `/descontos` |
| **Descontos — Registrar** | `sr4xxXLxmZ8EMURF` | webhook `descontos-registrar-manual` | Registra retirada VR/VT | `/descontos` |
| **Sábados Extras** | `3TAyDuKFkWGvXTHT` | webhook `sabados-extras-boleto` | Boleto VT de sábado extra (Caju); mobilidade via `/api/intermitente/interior` | WF3 |
| **Nexti Validar Atestado** | `6efSZQYzLaP304rn` | webhook `nexti-validar-atestado` | Valida atestado vs Nexti (CPF) | Monday Automation (Controle Atestados) |
| **Virada (BENAUT)** | `gm2Ie8pbR2rOK5id` | **agendamento** dia 14, 17h (`0 17 14 * *`) | Duplica central, arquiva, renomeia, repovoa (TOTVS), **cria webhooks na cópia + salva registry** | cron (inativo até ativar) |
| **Rentabilidade** | `dciSc45YRKcQPGdq` | agendamento | Relatório (fora do fluxo principal) | cron |

## 5. Fluxos end-to-end

**A) Convocar → Registrar → Finalizar**
```
/convocar → WF8 (busca RM) → WF7 (cria item Entrada, grupo PONTUAL, resolve board via registry)
   → DP muda coluna "ativar" no Monday → WF1 (cria Histórico + link /preencher)
   → DP/RH abre link → /preencher → WF2 (lê) → WF3 (finaliza: desconto + agregados)
```

**B) Pontual / financeiro**
```
WF5 Pontual: calcula VR/VT do período (board Valores), abate FIFO (Base Desconto),
  Caju (crédito FOOD_AID + VT TRANSPORTATION/TRANSPORTATION_VOUCHER), WF6 (SOAP RM, idVR/idVT),
  cria Solicitação Pgto, espelha Plan, dispara Drive Arquivar → Gerar Planilha
```

**C) Ponto facultativo** (`/ponto-facultativo`): Opcoes (unidades) → multi-seleção + "Selecionar tudo" → Preview (afetados, board atual via registry) → Aplicar (ledger). DETRAN/TRE PB **não descontam**.

**D) Cancelar** (`/preencher`): WF Cancelar → status Cancelada/parcial + desconto + **move pro grupo** (registry). Cancelamento **desconta** (inclusive DETRAN/TRE).

**E) Virada de mês** — ver §6.

## 6. Virada de mês (WF BENAUT, dia 14 17h)

**Modelo "central fixo":** existe um board central (`18418191275`) que avança de mês. A cada virada:
1. **Duplica** o central → **cópia** (snapshot do mês corrente).
2. **Cria os webhooks na cópia** (`ativar`→WF1, `create_item`→WF5) — Monday **não** copia webhooks API na duplicação, então o WF recria via `create_webhook`.
3. **Arquiva** os itens do central + **renomeia** + **repovoa** com colaboradores frescos do RM (TOTVS → grupo NÃO CONVOCADOS).
4. **Salva no registry** (`/api/boards/virada`, header `X-Service-Token`): `atual→passado`, **cópia=atual**, **central=proximo**.

Papéis (3 boards vivos): **passado** (mês fechado) / **atual** (cópia, convocações vivas) / **proximo** (central, futuro). Convocação funciona em **atual + proximo**.

> Testado (board de teste, isolado): duplicar ✅, criar webhook via automação ✅, arquivar/renomear ✅, salvar registry (node→backend) ✅, despromoção de papéis (SQL) ✅. RM (TOTVS) tem **Retry on Fail** ligado (timeout transitório).

## 7. Regras de negócio

- **VR/VT** vêm do board Valores (`18413870370`) por **contrato + função**. Prioridade: **VR Mensal** (÷ **30** = diário) > VR Diário > PADRÃO. VT é sempre **diário/unitário** (nunca mensal).
- **Caju categories**: VR=`FOOD_AID`; VT normal=`TRANSPORTATION_VOUCHER`; **mobilidade**=`TRANSPORTATION`. (`MOBILITY` não existe.)
- **Mobilidade (interior)** = coluna `OP - Interior?`=SIM **OU** contrato ∈ {**TRE PB**, **SEDUC INTERIOR**}.
- **VR conta dias CORRIDOS** (sáb+dom) para **DETRAN e TRE PB** (VR mensal cobre mês cheio). Só VR; VT segue dias úteis (+sábado se trabalha).
- **DETRAN e TRE PB NÃO DESCONTAM** por falta/atestado (declara falta, desconto=0) — em **Finalizar** e **Ponto Facultativo**. **Cancelamento DESCONTA** normal (inclusive eles).
- **Feriado por contrato**: NACIONAL bloqueia todos; ESTADUAL/MUNICIPAL só os do contrato; **SEDUC\* e DETRAN recebem em feriado** (não bloqueiam).

## 8. Credenciais / segurança

- **Monday**: cred n8n "Ray0" (`6I0ycSr6PQJkBYpc`) e "api monday - Isaac" (`n5gkjTMvpDvy8eER`, usada na virada — precisa permissão de criar/duplicar board). Backend usa `MONDAY_TOKEN`.
- **RM TOTVS**: cred "rm mike" (basic auth).
- **SERVICE_TOKEN**: env no Vercel + header `X-Service-Token` no node "Salvar registry" do WF de virada. (token de serviço, igual nos 2 lados).
- **Segredos colados em chat = rotacionar** (repo público): Monday token, n8n API key, Postgres pw, SERVICE_TOKEN.

---

# PARTE 2 — GUIA DE USO (DP)

Acesso: `https://plan-intermitente-ocorrencia.vercel.app` (login Google `@contatoserv.com.br`). Hub com os atalhos.

## Convocar um intermitente
1. Hub → **Nova convocação**.
2. Busca o empregado (nome, ≥3 letras) → seleciona.
3. **Escolhe o mês** (atual ou próximo).
4. Preenche o formulário (contrato, unidade — filtrada pelo contrato, datas, sábado, insalubridade, interior, justificativa). Anexa termos se houver.
5. **Convocar** → cria o item no board do mês (grupo PONTUAL).

## Gerar o link de preenchimento (ativar)
No board Monday, no item da convocação, muda a coluna **"ativar"** para **ativar** → o sistema gera o **link** (coluna Link) e cria o registro no Histórico.

## Registrar ocorrência
Abre o **link** (`/preencher/...`) → marca por dia (foi trabalhar? chegou no horário?) → **Finalizar**. Gera protocolo `PROT-XXXX-XXXX` + aplica desconto de benefício.

## Corrigir um registro
Hub → **Atualizar ocorrência** → digita o protocolo → reabre o preenchimento.

## Cancelar convocação
No `/preencher`, ícone de cancelar → **total** (finaliza) ou **parcial** (escolhe data; não finaliza). O item **move** pro grupo CANCELADOS / CANCELADOS PARCIAL e gera o desconto.

## Ponto facultativo (desconto em massa)
Hub → **Ponto facultativo** (só DP) → escolhe **contrato** → **marca várias unidades** (ou **Selecionar tudo**) → **Prosseguir** → data → benefícios (VR/VT) → **pré-visualizar** (vê os afetados) → confirmar. *DETRAN e TRE PB não descontam.*

## Atestados / declarações
Hub → **Atestados** → tipo (Intermitente/CLT) → busca empregado → escolhe a convocação → preenche (tipo, datas, upload) → conclui (cria item no Controle de Atestados).

## Descontos manuais (retirada Caju)
Pelo link gerado no board Desconto (`/descontos/...`) → informa VR/VT retirado → registra.

## Virada de mês (dia 14)
Todo dia **14 às 17h** o sistema (quando ativado) duplica o board, arquiva o mês, cria o board do próximo e repovoa com os intermitentes do RM. **Convocar funciona no mês atual e no próximo.** Os links/gatilhos (ativar) são recriados automaticamente na cópia.

---

## Apêndice — Troubleshooting

- **WF1 não gera link** ao mudar "ativar" → verificar se o **webhook ativar** existe no board (`change_specific_column_value` em `color_mm2pxmak` → `/webhook/Intermitentehaha`). Recriar via `/api/boards/garantir-webhook` ou `create_webhook`.
- **Virada para no TOTVS** (timeout RM) → o node "Consultar colaboradores TOTVS" tem **Retry on Fail** (3×, 5s). Se persistir, RM indisponível.
- **Cópia da virada sem webhook** → o WF de virada recria; se faltar, rodar `create_webhook` na cópia.
- **Convocar/Ponto-Fac no board errado após virada** → conferir o registry (`/api/boards/resolver?papel=atual`) aponta o board certo; re-registrar se preciso.
- **Boards de teste (ZZ-\*)** → descartáveis, podem ser deletados.
