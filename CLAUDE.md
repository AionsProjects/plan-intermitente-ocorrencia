# Plano de Intermitentes — App web

App web pra **gerenciar convocações de intermitentes** no monday: cria convocação, registra ocorrências dia-a-dia (faltou/atrasou) e permite correção via protocolo. Acesso via link único da convocação (registrar ocorrência) ou via **hub principal** (criar convocação / corrigir).

## Estado atual do projeto (2026-05)

**Funcionando end-to-end (mock + real, produção na VM):**

### Frontend (SPA React)
- **Hub principal** (`/`) — 2 tiles: Nova convocação · Atualizar ocorrência. Botão flask discreto canto sup-direito → `/teste` (área de mocks).
- **Convocar** (`/convocar`) — substitui o form nativo do monday do board de entrada. Etapas internas com slide carrossel:
  1. **Buscar empregado** — autocomplete por nome (search-as-you-type, debounce 250ms, min 3 chars, highlight das letras buscadas, 3 visíveis + "ver todos")
  2. **Formulário convocação** — 15 campos + bloco read-only com dados do RM (Nome, Chapa, CPF, Função, Admissão, Seção). Selects e DatePicker custom via Dialog (mesmo padrão visual do `DialogDia` de registrar ocorrência).
  3. **Tela sucesso** — ID do item + URL do board monday + CTA "Nova convocação"
- **Preencher** (`/preencher/:uuid`) — painel com modal por dia, perguntas no positivo ("foi trabalhar?", "chegou no horário?"), adicionar/apagar dias com bolha estourando, fluxo de correção via protocolo `PROT-XXXX-XXXX`.
- **Corrigir** (`/corrigir`) — input do protocolo + lista de recentes (localStorage) + atalho flask pro `PROT-DEMO-1234`.
- **Teste** (`/teste`) — área de mocks (4 UUIDs `mock-*` + chave demo). Acessível só via botão discreto do hub.

### Transições globais (Liquid Glass)
- **PageTransition** (`src/components/PageTransition.tsx`) — wrapper de `<Routes>` que detecta path change e aplica slide carrossel direcional. Hierarquia: `/` = 0; `/teste|convocar|corrigir` = 1; `/preencher/*` = 2. Forward = nível ↑ (slide saí esquerda + entra direita); backward = nível ↓ (inverso).
- **SlideStack** (`src/components/SlideStack.tsx`) — carrossel genérico reutilizável (trilho 200% + 2 slots × 50%, translateX 0↔-50%, 520ms cubic-bezier ease-out, overflow só durante anim, preserva sombras em idle). Consumido por `PageTransition` (rotas) e `ConvocarPage` (etapas internas).
- **Background animado** — keyframe `bg-hue-cycle` (120s ease-in-out infinite) no `<html>`: navy → púrpura-fumê → preto puro → azul-preto → navy. Sutil, não rouba atenção.

### Backend n8n (6 workflows)
- **WF1 Preparar** — webhook do monday quando coluna `ativar` muda. Gera UUID, cria item no board Histórico (`18411141462`), patch Link Column no item de origem.
- **WF2 Ler** — `GET /intermitente-ler?uuid=…`. Busca item por UUID via `getByColumnValue`, parseia respostas_json/dias_extras/dias_desativados.
- **WF3 Finalizar** — `POST /intermitente-finalizar`. Valida payload, agrega (qtd_faltas/atrasos/total_minutos), grava respostas_json, marca status=Concluído. Trava antifraude se desconto já consumido. **Idempotente** (1 item, `change_multiple_column_values`).
- **WF4 Buscar protocolo** — `GET /intermitente-buscar-protocolo?protocolo=…` → `{uuid, nome}`.
- **WF7 Convocar** *(novo)* — `POST /intermitente-convocar` (multipart). Cria item no board ENTRADA (`18408773953`) com `Tipo Convocação=PONTUAL` fixo. Upload de Termo de Convocação + Termo de Insalubridade via `add_file_to_column` no `/v2/file`. Reutiliza credencial `Ray0`.
- **WF8 Buscar empregado RM** *(novo)* — `GET /convocar-buscar-empregado?nome=…` (min 3 chars). Consulta SQL `BEN 2` do RM TOTVS via `consultaSQLServer/RealizaConsulta` (mesmo endpoint usado pelo WF5 de pagamento). Retorna array `[{nome, chapa, cpf, funcao, admissao, secao, codcoligada}]`. Cred basic auth `rm mike`. **CPF não retornado pela `BEN 2` atual** — fica vazio até estender SQL no RM.

### Deploy
- Container Docker rodando na VM `192.168.0.41:80` (intranet, sem domínio público).
- Stack: Dockerfile multi-stage (node:20-alpine build → nginx:alpine runtime), `docker-compose.yml`, `docker/nginx.conf` (catch-all server_name).
- Atualizar: `git pull && docker compose up -d --build`.

**Pendente:**
- Configurar job de expiração: monday Automation no board histórico → *"When Expira Em arrives → Change Status to Expirado"* OU n8n cron diário.
- Estender SQL `BEN 2` no RM TOTVS pra incluir CPF (hoje vem vazio).
- Atualizar `DEPLOY.md` se host n8n mudou pra `antigoaionscorp-n8n.cloudfy.live`.

## Fluxos

```
NOVO: Hub web → cria convocação fora do monday
─────────────────────────────────────────────
  Hub `/` → click "Nova convocação"
            ↓
  [Web app /convocar]
            ├─ Busca: GET WF8 (BEN 2 LIKE %nome%) → lista de empregados
            ├─ Form: 15 campos + dados RM readonly
            └─ POST WF7 (multipart) → monday create_item board ENTRADA + upload files
            ↓
  Item no board 18408773953 (Tipo Convocação=PONTUAL, ativar=vazio)
  Operacional/RH muda "ativar" → dispara WF1 → fluxo histórico normal


CLÁSSICO: Registrar ocorrências (link único)
─────────────────────────────────────────────
  [monday board ENTRADA] → muda coluna "ativar"
            ↓
  WF1 Preparar → cria item Histórico + Link Column
            ↓
  RH clica no link → [Web app /preencher/:uuid]
            ├─ GET WF2 → dados + dias[] + respostas anteriores (se correção)
            ├─ Painel: modal por dia (positivo: "foi trabalhar?" / "chegou no horário?")
            └─ POST WF3 → change_multiple_column_values + status=Concluído
            ↓
  Tela "Obrigado" com protocolo PROT-XXXX-XXXX


CORREÇÃO: via protocolo
─────────────────────────────────────────────
  Hub `/` → click "Atualizar ocorrência" → [/corrigir]
            ├─ Digita PROT-XXXX-XXXX
            ├─ GET WF4 → resolve protocolo → UUID
            └─ Navega /preencher/<uuid>?modo=correcao → WF2 com respostas anteriores
            ↓
  POST WF3 com eh_correcao=true → marca editado=true
```

## Decisões-chave

- **Hub principal em `/`** — substitui DevIndex antigo. Operacional bate em `http://192.168.0.41` e vê opções claras (Convocar / Corrigir). Mocks acessíveis via `/teste` (entrada discreta).
- **Frontend nunca conversa com monday direto** — toda I/O via n8n.
- **Sem login** — segurança = UUID longo aleatório + expiração 30 dias. Protocolo `PROT-XXXX-XXXX` em alfabeto sem ambíguos.
- **Idempotência WF3** — `change_multiple_column_values` em 1 item. Pode chamar N× sem efeito colateral.
- **Painel + modal** (não wizard sequencial) — RH só interage com dias problemáticos.
- **/convocar etapas internas em state** (não rotas) — back do browser fecha /convocar inteiro. SlideStack interno cuida da transição.
- **PONTUAL fixo no /convocar** — MENSAL/MOP/DEMISSÃO ficam pra depois.
- **Estado armazenado no monday** — board Histórico tem 1 item por convocação. Detalhe dia-a-dia em `respostas_json` (long_text). Agregados em colunas dedicadas pra dashboards.

## Stack

- **Frontend**: Vite + React 19 + TypeScript (strict)
- **UI**: Tailwind v4 + shadcn/ui (new-york, neutral) — Dialog, Card, Button, Input, Label, Separator
- **Estado server**: @tanstack/react-query (staleTime 0 no preencher)
- **Roteamento**: react-router-dom v7
- **Datas**: date-fns + locale pt-BR
- **Backend de orquestração**: n8n Cloud (`https://antigoaionscorp-n8n.cloudfy.live`)
- **Storage**: monday.com — boards `18408773953` (entrada) e `18411141462` (histórico), workspace `DEPARTAMENTO PESSOAL`. Acesso via n8n com cred "Ray0".
- **Integração externa**: monday.com API v2; RM TOTVS via SQL `BEN 2` (cred "rm mike")
- **Idioma da UI**: pt-BR

## Comandos

- `npm run dev` — dev server Vite (porta 5173). Modo mock se `VITE_N8N_BASE_URL` vazio.
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — ESLint
- `npx tsc -b` — só typecheck
- `docker compose up -d --build` — sobe container (na VM ou local). Lê `.env` na raiz.
- `docker compose logs -f app` — logs nginx do container.

## Variáveis de ambiente

**`.env` do frontend:**
```
VITE_N8N_BASE_URL=https://antigoaionscorp-n8n.cloudfy.live/webhook
```
Vazio = modo mock (UUIDs `mock-*` e protocolos `PROT-TEST-*`/`PROT-DEMO-*` resolvem local mesmo com n8n real).

> Vite resolve `import.meta.env.*` em **build-time** (bundle baked). Mudou `.env`? Tem que `docker compose up -d --build` (sem `--build` o bundle antigo continua).

**Credenciais no n8n:**
- **Monday API**: nome "Ray0" (id `6I0ycSr6PQJkBYpc`) — único token usado em todos os WFs do monday.
- **RM TOTVS (basic auth)**: nome "rm mike" (id `S3pKAv6O75vlOFh8`) — consulta SQL e SOAP.

## Estrutura de arquivos

```
src/
├─ App.tsx                          rotas + PageTransition wrapper
├─ main.tsx                         providers (QueryClient + BrowserRouter)
├─ index.css                        Tailwind + glass classes + keyframes + bg-hue-cycle
├─ components/
│  ├─ AuroraBackground.tsx          fundo com orbes + filtros SVG (#liquid-glass, #liquid-glass-soft)
│  ├─ SlideStack.tsx                carrossel horizontal genérico (200% trilho + 2 slots)
│  ├─ PageTransition.tsx            wrapper de Routes que detecta path change e direção
│  └─ ui/                           shadcn customizado (dialog c/ overlayClassName, button, input, label, select, separator, badge, card, table)
├─ features/hub/
│  ├─ HubPage.tsx                   rota `/` — 2 tiles + botão flask discreto
│  └─ TestePage.tsx                 rota `/teste` — 4 UUIDs mock + chave PROT-DEMO-1234
├─ features/convocar/
│  ├─ ConvocarPage.tsx              orquestra busca/form/sucesso via SlideStack interno
│  ├─ BuscarEmpregado.tsx           autocomplete com highlight + 3 visíveis + expandir
│  ├─ FormularioConvocacao.tsx      15 campos + bloco RM readonly + botão Convocar com avião decolando
│  ├─ TelaSucesso.tsx               item ID + URL board + CTA "Nova convocação"
│  ├─ GlassSelect.tsx               Select via Dialog (mesma cara do DialogDia)
│  ├─ GlassDatePicker.tsx           DatePicker via Dialog (calendário glass)
│  ├─ api.ts                        buscarEmpregado + criarConvocacao (mock + n8n real)
│  ├─ types.ts                      EmpregadoRM, ConvocacaoPayload, CONTRATOS, JUSTIFICATIVAS
│  └─ useConvocacao.ts              hooks react-query (busca debounced + mutation)
├─ features/preencher/
│  ├─ api.ts                        fetch n8n + mocks (seed + lookup por protocolo)
│  ├─ types.ts                      StatusProcessamento, TipoOcorrencia, RespostaDia, ProcessamentoDados
│  ├─ useProcessamento.ts           hooks react-query
│  ├─ PreencherPage.tsx             orquestra loading / 404 / expirado / concluido / aguardando + ?modo=correcao
│  ├─ FormularioWizard.tsx          painel principal + DialogDia + DialogAdicionarDias
│  ├─ TelaCarregando.tsx
│  ├─ TelaObrigado.tsx              exibe protocolo + indica se foi editado
│  └─ TelaErro.tsx
├─ features/correcao/
│  ├─ CorrecaoPage.tsx              input do protocolo + lista recentes + atalho PROT-DEMO-1234
│  └─ protocoloStorage.ts           helpers localStorage
└─ lib/utils.ts

docs/
├─ especificacao.md
├─ monday-board-schema.md           schema completo do board histórico
└─ n8n/
   ├─ wf1-preparar.json
   ├─ wf2-ler.json
   ├─ wf3-finalizar.json
   └─ wf4-buscar-protocolo.json
   (WF7 e WF8 vivem em C:\Users\NOTECS-89\Downloads\CALCULO INTERMITENTE\)

docker/
└─ nginx.conf                       catch-all server_name, SPA fallback, gzip, cache

Dockerfile                          multi-stage: node:20-alpine (build) → nginx:alpine (runtime)
docker-compose.yml                  serviço único, restart unless-stopped, porta 80
.dockerignore

CLAUDE.md, README.md, DEPLOY.md, .env, .env.example, components.json, package.json, tsconfig.*.json
```

## Schema dos boards monday

### Board Entrada `18408773953` — Plan. de Intermitentes (mensal/pontual)

Origem das convocações. Form `/convocar` cria itens aqui. WF1 dispara quando coluna `ativar` muda.

| Coluna | Column ID | Tipo | Notas |
|---|---|---|---|
| Name | `name` | name | Padrão: "INTERMITENTE - NOME" |
| Nome do Empregado | `dropdown_mktadatt` | dropdown | Last chosenValue = intermitente |
| CPF | `dup__of_matr_cula` | text | |
| Funcionário (Chapa) | `texto` | text | |
| Admissão | `text_mkzh8jhn` | text | Data string |
| Função | `texto0` | text | |
| Escala | `text_mkvn2cmr` | text | |
| Local/Unidade | `texto75` | text | |
| Solicitante | `color_mktc9q29` | status | OPERACIONAL / RH |
| Op - Contrato | `color_mktcnxwn` | status | 10 opções (SEDUC SEDE/ESCOLA/INTERIOR, DETRAN, CETAM, SEMSA, TRE PB, URUGUAIANA, ADMINISTRATIVO) |
| OP - Sábado? | `color_mktaavmp` | status | SIM(0) / NÃO(5) |
| Op - Insalubridade? | `color_mktq63xa` | status | SIM(1) / NÃO(2) / NÃO INFORMADO(5) |
| OP - Interior? | `color__1` | status | SIM(0) / NÃO(5) |
| OP - Tipo Convocação | `color_mkta71ex` | status | PONTUAL(0) / MOP(1) / DEMISSÃO(2) / NÃO CONVOCADO(5) / MENSAL(12) |
| OP - VT só volta? | `color_mkwaw840` | status | SIM(2) / NÃO(5) |
| OP - Justificativa | `color_mktarrgs` | status | 13 opções (AFASTAMENTO, ATESTADO, FÉRIAS, ..., DEMITIDO) |
| OP - Data/Início | `date_mktayxhb` | date | |
| OP - Data/Fim | `date_mktasnwq` | date | |
| OP - Empregado Substituído | `text_mktc23av` | text | |
| Termo de Convocação | `file_mm21x463` | file | Upload via WF7 (`add_file_to_column`) |
| Termo de Insalubridade | `file_mm21457r` | file | Upload via WF7 |
| Link | `link_mm2pn9kg` | link | Preenchido pelo WF1 com URL do `/preencher/<uuid>` |
| **ativar** | `color_mm2pxmak` | status | `ativar(1)` = trigger do WF1 |

### Board Histórico `18411141462` — Ocorrências (WF2/WF3)

1 item por convocação. Detalhe dia-a-dia em `long_text_mm2xtcpw`.

| Coluna | Column ID | Tipo | Conteúdo |
|---|---|---|---|
| Name | `name` | name | Nome do intermitente |
| UUID | `text_mm2xjend` | text | Mesmo UUID do link `/preencher/<uuid>` |
| Protocolo | `text_mm2xsvg6` | text | `PROT-XXXX-XXXX` (gerado no frontend) |
| Contrato | `text_mm2x1ktb` | text | Copiado do board origem |
| Chapa | `text_mm33v9kp` | text | Funcionário (chapa RM) |
| Solicitante | `text_mm2xxkm8` | text | Quem disparou o WF1 |
| Data Início | `date_mm2xtp93` | date | |
| Data Fim | `date_mm2xrr5q` | date | |
| Expira Em | `date_mm2xrvt4` | date | criado_em + 10 dias |
| Criado Em | `date_mm2x115h` | date | Timestamp WF1 |
| Concluído Em | `date_mm2xh1vm` | date | Timestamp WF3 |
| Editado Em | `date_mm2x62fq` | date | Timestamp última correção |
| Status | `color_mm2xkqpc` | status | Aguardando(0) / Concluído(1) / Expirado(17) |
| Editado | `boolean_mm2x1aa4` | checkbox | true se alterado pós-finalização |
| Qtd. Faltas | `numeric_mm2xe2zk` | numbers | Agregado WF3 |
| Qtd. Atrasos | `numeric_mm2x18hh` | numbers | Agregado WF3 |
| Total Minutos Atraso | `numeric_mm2x4fjj` | numbers | Agregado WF3 |
| Dias Extras | `long_text_mm2x73w6` | long_text | JSON: array YYYY-MM-DD |
| Dias Desativados | `long_text_mm2xm820` | long_text | JSON: array YYYY-MM-DD |
| Respostas JSON | `long_text_mm2xtcpw` | long_text | JSON `[{data, tipo, minutos_atraso}]` (core) |
| Optante VT | `color_mm34ry47` | status | SIM/NÃO |
| Trabalha Sábado | `color_mm34yyet` | status | SIM/NÃO |
| Item Origem | `link_mm2x1rk0` | link | URL item no board origem |
| Link Preencher | `link_mm2xfay7` | link | URL pública do form |

**Atenção**: label "Expirado" tem ID interno `17` (não `2`). Aguardando=`0`, Concluído=`1`. Use `{label: "..."}` em mutations.

## Contratos n8n

### GET `/webhook/intermitente-ler?uuid=<uuid>` (WF2)

Retorna (snake_case, convertido pra camelCase em `features/preencher/api.ts`):
```ts
{
  uuid, status: "aguardando" | "concluido" | "expirado",
  nome, contrato, data_inicio, data_fim, dias: string[],
  expira_em, concluido_em, protocolo, editado, editado_em,
  respostas: [{data, tipo, minutos_atraso?}],
  dias_extras: string[], dias_desativados: string[]
}
```
- 200 → renderiza painel (`aguardando`), tela obrigado (`concluido`), tela erro (`expirado`)
- 404 → "Link não encontrado"

### POST `/webhook/intermitente-finalizar?uuid=<uuid>` (WF3)

Body:
```ts
{
  uuid, respostas: [{data, tipo, minutos_atraso: number | null}],
  protocolo, dias_extras, dias_desativados, eh_correcao: boolean
}
```
- 200 `{ok, uuid, protocolo, editado, concluido_em}` → frontend invalida query
- 400 validação | 404 não existe | 409 já concluído (se `eh_correcao=false`) | 410 expirado

### GET `/webhook/intermitente-buscar-protocolo?protocolo=<PROT-XXXX-XXXX>` (WF4)

Retorna `{uuid, nome}` ou 404.

### GET `/webhook/convocar-buscar-empregado?nome=<string>` (WF8, novo)

Retorna `{resultados: EmpregadoRM[]}`. Mínimo 3 chars no nome. Consulta `BEN 2` no RM com `LIKE %nome%`. CPF vazio até estender SQL.

### POST `/webhook/intermitente-convocar` (WF7, novo) — multipart/form-data

Body: name, empregado_{nome,chapa,cpf,funcao,admissao,secao,codcoligada}, escala, solicitante, contrato, local_unidade, sabado, insalubridade, interior, data_inicio, data_fim, justificativa, empregado_substituido, termo_convocacao? (file), termo_insalubridade? (file)
- 200 `{ok, item_id, item_url}` → cria item no board ENTRADA + upload files
- 400 campo_obrigatorio | data_invalida

## Convenções

- TypeScript strict, sem `any`
- Components de feature em `src/features/<feature>/`
- Components genéricos em `src/components/` (SlideStack, PageTransition, AuroraBackground, ui/)
- Datas exibidas com `format(parseISO(iso), "...", { locale: ptBR })`
- Atrasos sempre em **minutos** (int positivo)
- Commits em português, imperativo curto
- Tilt 3D em superfícies clicáveis (`--mx`/`--my` via `mousemove`)

## Notas operacionais aprendidas

- **n8n Cloud Code node não expõe `crypto`** — UUIDv4 manual com `Math.random` (já no WF1).
- **Webhook responde vazio** se `Respond` não estiver em `Using 'Respond to Webhook' Node` — sempre verificar.
- **Reimport JSON perde credenciais** — todo monday node fica órfão; reseleção manual de "Ray0" e "rm mike".
- **n8n HTTP node fragmenta JSON array** — resposta `[{...}, {...}]` do RM vira N items. Code subsequente deve usar `$input.all()`, não `$input.first()`.
- **Long text monday** ~2000 chars. Períodos típicos ~2KB.
- **Status label IDs** auto-atribuídos: Aguardando=0, Concluído=1, **Expirado=17** (não=2). Use `{label}` em mutations.
- **`getByColumnValue`** retorna array vazio quando nada acha. Checar `j.id && (j.column_values || j.name)`.
- **Datas com hora monday** = `{date: "YYYY-MM-DD", time: "HH:mm:ss"}` (UTC).
- **`Concluído Em` preservado** em re-edição — só `Editado Em` atualiza.
- **`VITE_N8N_BASE_URL` é baked no bundle** em build-time. Mudar `.env` exige `--build` no compose.
- **Sem domínio + IP privado** → HTTP puro intranet. Botão Copiar usa fallback `execCommand`.
- **Liquid glass: distorção só na quina** — `feDisplacementMap` direto no `.glass-modal` vira água, não lente. Solução: `::after` com mask radial carregando filtro.
- **Cutout de blur via mask-composite** não funcionou em Chromium — overlay simples só com tint escuro.
- **Scrollbar não pode aplicar width em html/body** — sempre separar regras de `*::-webkit-scrollbar` das de `html`/`body`.
- **DialogContent ganhou prop `overlayClassName`** — permite usos futuros não-bloqueantes (`pointer-events-none`) sem afetar o `DialogDia` original.
- **Refs durante render geram lint** (`react-hooks/refs`). Pra detectar "valor anterior" em `PageTransition`, usar padrão setState during render (docs do React) ao invés de `useRef`.
- **`add_file_to_column` monday** = POST `https://api.monday.com/v2/file` com GraphQL multipart (campos `query` + `variables` + `map` + `0`=binary). Autorização via Header `Authorization: <token>`.
- **Avião decolando**: keyframe `plane-takeoff` translada (40, -40) → salto pra (-40, 40) → volta (0, 0); button `.plane-btn` com `overflow:hidden` clipa só conteúdo, glow externo (box-shadow) **não é afetado**.

## Segurança

- UUIDs aleatórios via `Math.random` UUIDv4 — impossível adivinhar.
- Protocolo `PROT-XXXX-XXXX` (alfabeto sem ambíguos `0/O/1/I`) — não é segredo, mas não trivial de chutar.
- Link expira em 10 dias (coluna `Expira Em`); WF2 calcula on-the-fly.
- Job de expiração: monday Automation OU n8n cron diário (pendente).
- `MONDAY_API_TOKEN` apenas dentro do n8n (cred "Ray0"). RM token apenas em cred "rm mike".
- Frontend expõe só `VITE_N8N_BASE_URL`.
- `.env` no `.gitignore`. `.env.local` força modo mock em dev.
