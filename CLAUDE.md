# Registro de Ocorrências de Intermitentes

App web que o RH acessa via **link único** para registrar, dia a dia, se um intermitente **faltou**, **atrasou/saiu mais cedo**, ou **não teve ocorrência**, durante o período de uma convocação cadastrada no monday.com. Ao finalizar o preenchimento, os dados são gravados num **board do monday** (board "Plan. de Intermitentes — Histórico de Ocorrências", id `18411141462`).

## Estado atual do projeto

**Funcionando end-to-end (mock + real):**
- WF1 (Preparar) — n8n recebe webhook do monday quando RH muda status, gera UUID, cria item no board histórico (status=Aguardando), preenche Link Column do item de origem.
- WF2 (Ler) — n8n responde `GET /intermitente-ler?uuid=…`, busca item por UUID via `getByColumnValue`, parseia `respostas_json`/`dias_extras`/`dias_desativados`, retorna shape esperado.
- WF3 (Finalizar) — n8n responde `POST /intermitente-finalizar`, calcula agregados (qtd_faltas, qtd_atrasos, total_minutos), marca status=Concluído, grava `respostas_json`. Idempotente por natureza (1 item, `change_multiple_column_values`).
- WF4 (Buscar protocolo) — n8n responde `GET /intermitente-buscar-protocolo?protocolo=…`, retorna UUID+nome para o fluxo de correção.
- Frontend: painel com **modal por dia**, perguntas no positivo ("foi trabalhar?", "chegou no horário?"), adicionar/apagar dias com bolha estourando, fluxo de correção via protocolo `PROT-XXXX-XXXX`.

**Pendente (operacional):**
- Importar os 4 JSONs novos no n8n cloud (`docs/n8n/wf*.json`) e reconectar a credencial monday "Ray0" em cada node (ao importar JSON, credenciais ficam órfãs).
- Configurar job de expiração: pode ser n8n cron diário (lista itens com Status=Aguardando e Expira Em < hoje, muda para Expirado) **ou** monday Automation no próprio board.
- Se houver dados em produção no Supabase, migrar via WF one-shot que lê CSV exportado e cria items no board novo.

## Fluxo resumido

```
[monday "Plan. de Intermitentes" mensal] → mudança de status
                                         ↓
              [n8n WF1: preparar] → gera UUID, cria item no board Histórico, patch Link Column origem
                                         ↓
              RH clica no link na coluna Link
                                         ↓
              [Web app /preencher/:uuid]
                              ├─ GET WF2 → carrega dados + dias[] + respostas anteriores (se correção)
                              ├─ Painel: lista de dias, modal pra editar cada um
                              └─ POST WF3 → atualiza item no board Histórico (change_multiple)
                                            agregados + respostas_json + status=Concluído
                                         ↓
              Tela "Obrigado pelo preenchimento" (com protocolo PROT-XXXX-XXXX)

Fluxo de correção:
              [Web app /corrigir]
                              ├─ Digita PROT-XXXX-XXXX
                              ├─ GET WF4 → resolve protocolo → UUID
                              └─ Navega para /preencher/<uuid>?modo=correcao
                                 → re-abre WF2 com respostas anteriores carregadas
                                 → POST WF3 com eh_correcao=true → marca editado=true
```

## Decisões-chave

- **Sem login** — segurança = UUID longo aleatório + expiração de 30 dias.
- **Idempotência no WF3** — `change_multiple_column_values` em 1 item identificado por UUID. Pode ser chamado N vezes com o mesmo payload sem efeito colateral (sem inserts/deletes envolvidos).
- **Painel + modal** (não wizard sequencial) — RH só interage com dias problemáticos.
- **Frontend não conversa com monday direto** — toda I/O passa pelo n8n.
- **Estado armazenado no monday board "Histórico"** — 1 item por convocação. Detalhe dia-a-dia em `respostas_json` (long_text). Agregados (qtd_faltas/qtd_atrasos/total_minutos) em colunas dedicadas pra dashboards.
- **Migrado de Supabase para monday em abril/2026** — schema antigo (`processamentos` + `ocorrencias_dia`) desativado.

## Stack

- **Frontend**: Vite + React 19 + TypeScript (strict)
- **UI**: Tailwind v4 + shadcn/ui (new-york, base neutral) — Dialog, Card, Button, Input, Label, Separator
- **Estado server**: @tanstack/react-query (staleTime 0 no preencher pra invalidate funcionar bem)
- **Roteamento**: react-router-dom v7
- **Datas**: date-fns + locale pt-BR
- **Backend de orquestração**: n8n Cloud (`https://aionscorp-n8n.cloudfy.live`)
- **Storage**: monday.com — board "Plan. de Intermitentes — Histórico de Ocorrências" (id `18411141462`, workspace `DEPARTAMENTO PESSOAL`). Acesso só via n8n com a credencial monday "Ray0".
- **Integração externa**: monday.com API v2 (board origem mensal `18408773953`, board histórico `18411141462`)
- **Idioma da UI**: português do Brasil

## Comandos

- `npm run dev` — dev server Vite (porta 5173). Modo mock se `VITE_N8N_BASE_URL` vazio.
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — ESLint
- `npx tsc -b` — só typecheck, sem build

## Variáveis de ambiente

**`.env` do frontend:**
```
VITE_N8N_BASE_URL=https://aionscorp-n8n.cloudfy.live/webhook
```
Vazio = modo mock (UUIDs `mock-aguardando`, `mock-concluido`, `mock-expirado`).

**Credenciais no n8n:**
- **Monday API**: nome "Ray0" (id `6I0ycSr6PQJkBYpc`), token API v2 — única credencial necessária após a migração.

## Estrutura de arquivos

```
src/
├─ App.tsx                       rotas + dev index com links de teste mock
├─ main.tsx                      providers (QueryClient + Router)
├─ features/preencher/
│  ├─ api.ts                     fetch n8n + mocks (seed + lookup por protocolo)
│  ├─ types.ts                   StatusProcessamento, TipoOcorrencia, RespostaDia, ProcessamentoDados (com protocolo, editado, etc)
│  ├─ useProcessamento.ts        hooks react-query (useProcessamento, useFinalizarProcessamento)
│  ├─ PreencherPage.tsx          orquestra loading / 404 / expirado / concluido / aguardando + ?modo=correcao
│  ├─ FormularioWizard.tsx       painel principal + DialogDia (perguntas no positivo) + DialogAdicionarDias
│  ├─ TelaCarregando.tsx
│  ├─ TelaObrigado.tsx           exibe protocolo PROT-XXXX-XXXX + indica se foi editado
│  └─ TelaErro.tsx
├─ features/correcao/
│  ├─ CorrecaoPage.tsx           página /corrigir — input do protocolo + lista recentes
│  └─ protocoloStorage.ts        helpers do localStorage (gerar, salvar, listar protocolos)
├─ components/AuroraBackground.tsx  fundo glass com orbes
├─ components/ui/                shadcn customizado (dialog, button, input, label, separator)
└─ lib/utils.ts

docs/
├─ especificacao.md
├─ monday-board-schema.md         schema completo do board histórico monday (column IDs, payloads)
└─ n8n/
   ├─ wf1-preparar.json          Webhook → Get item origem → Code (UUID + column_values JSON) → Monday create_item → Monday change Link Column origem
   ├─ wf2-ler.json               Webhook GET → Monday getByColumnValue (UUID) → Code (parsear, montar shape) → Respond
   ├─ wf3-finalizar.json         Webhook POST → Monday getByColumnValue (UUID) → Code (validar + agregar + flag editado) →
                                  IF → Monday change_multiple_column_values → Respond OK / Erro
   └─ wf4-buscar-protocolo.json  Webhook GET → Monday getByColumnValue (Protocolo) → Code → Respond {uuid, nome}

.claude/skills/frontend-design/SKILL.md   skill instalado a nível de projeto

CLAUDE.md, README.md, .env, .env.example, components.json, package.json, tsconfig.*.json
```

## Schema do board monday (Histórico)

Board id: **`18411141462`** · workspace `DEPARTAMENTO PESSOAL` (`2739319`) · 1 item por convocação.

Mapa resumido (detalhe completo + payloads em [docs/monday-board-schema.md](docs/monday-board-schema.md)):

| Coluna | Column ID | Tipo | Conteúdo |
|---|---|---|---|
| Name | `name` | name | Nome do intermitente |
| UUID | `text_mm2xjend` | text | Mesmo UUID do link `/preencher/<uuid>` |
| Protocolo | `text_mm2xsvg6` | text | `PROT-XXXX-XXXX` (gerado no frontend) |
| Contrato | `text_mm2x1ktb` | text | Copiado do board origem |
| Solicitante | `text_mm2xxkm8` | text | Quem disparou o WF1 |
| Data Início | `date_mm2xtp93` | date | Início do período |
| Data Fim | `date_mm2xrr5q` | date | Fim do período |
| Expira Em | `date_mm2xrvt4` | date | criado_em + 30 dias |
| Criado Em | `date_mm2x115h` | date | Timestamp WF1 |
| Concluído Em | `date_mm2xh1vm` | date | Timestamp WF3 |
| Editado Em | `date_mm2x62fq` | date | Timestamp última correção |
| Status | `color_mm2xkqpc` | status | Aguardando(0) / Concluído(1) / Expirado(17) |
| Editado | `boolean_mm2x1aa4` | checkbox | true se foi alterado pós-finalização |
| Qtd. Faltas | `numeric_mm2xe2zk` | numbers | Agregado WF3 |
| Qtd. Atrasos | `numeric_mm2x18hh` | numbers | Agregado WF3 |
| Total Minutos Atraso | `numeric_mm2x4fjj` | numbers | Agregado WF3 |
| Dias Extras | `long_text_mm2x73w6` | long_text | JSON: array de YYYY-MM-DD adicionados |
| Dias Desativados | `long_text_mm2xm820` | long_text | JSON: array de YYYY-MM-DD apagados |
| Respostas JSON | `long_text_mm2xtcpw` | long_text | JSON: `[{data, tipo, minutos_atraso}]` (coração dos dados) |
| Item Origem | `link_mm2x1rk0` | link | URL do item no board mensal |
| Link Preencher | `link_mm2xfay7` | link | URL pública do form |

**Atenção**: o ID interno do label "Expirado" é `17`, não `2`. Aguardando=`0`, Concluído=`1`. Em mutations use `{label: "..."}` ou `{index: 0|1|17}`.

## Contratos com o n8n

### GET `/webhook/intermitente-ler?uuid=<uuid>`

WF2 retorna (snake_case, convertido pra camelCase no `api.ts`):
```ts
{
  uuid: string
  status: "aguardando" | "concluido" | "expirado"
  nome: string
  contrato: string | null
  data_inicio: string         // YYYY-MM-DD
  data_fim: string
  dias: string[]              // YYYY-MM-DD[]  (período base)
  expira_em: string
  concluido_em: string | null
  protocolo: string | null
  editado: boolean
  editado_em: string | null
  respostas: Array<{ data: string; tipo: ...; minutos_atraso?: number }>  // populadas pós-finalização
  dias_extras: string[]       // YYYY-MM-DD[]  (fora do período base)
  dias_desativados: string[]  // YYYY-MM-DD[]  (apagados pelo RH)
}
```
- **200** → renderiza painel se `status='aguardando'`, tela obrigado se `concluido`, tela erro se `expirado` (override no frontend se `?modo=correcao` e `concluido` → re-abre form com respostas anteriores)
- **404** → tela "Link não encontrado"

### POST `/webhook/intermitente-finalizar?uuid=<uuid>`

Body:
```ts
{
  uuid: string
  respostas: Array<{
    data: string              // YYYY-MM-DD
    tipo: "sem_ocorrencia" | "falta" | "atraso"
    minutos_atraso: number | null
  }>
  protocolo: string           // PROT-XXXX-XXXX (gerado no frontend)
  dias_extras: string[]
  dias_desativados: string[]
  eh_correcao: boolean        // true quando vem do fluxo /corrigir
}
```
WF3 retorna:
- **200** `{ ok: true, uuid, protocolo, editado, concluido_em }` → frontend invalida query
- **400** validação (resposta faltando, tipo inválido, minutos inválidos, protocolo inválido)
- **404** processamento não existe
- **409** já concluído (apenas se `eh_correcao=false`)
- **410** expirado

### GET `/webhook/intermitente-buscar-protocolo?protocolo=<PROT-XXXX-XXXX>`

WF4 retorna:
```ts
{ uuid: string; nome: string }
```
- **200** → frontend navega para `/preencher/<uuid>?modo=correcao`
- **404** → tela "Protocolo não encontrado" inline na página /corrigir

## Convenções

- TypeScript strict, sem `any`
- Components de feature em `src/features/<feature>/`
- Components genéricos em `src/components/ui/` (shadcn)
- Datas exibidas com `format(parseISO(iso), "...", { locale: ptBR })`
- Atrasos sempre em **minutos** (int positivo)
- Commits em português, imperativo curto

## Notas operacionais aprendidas

- **Code node do n8n Cloud não expõe `crypto` global** — usar UUIDv4 manual com `Math.random` (já aplicado no WF1).
- **Webhook responde vazio** se `Respond` não estiver em `Using 'Respond to Webhook' Node` — sempre verificar.
- **Reimport JSON perde credenciais** — todo monday node fica órfão e exige reseleção manual da credencial "Ray0".
- **Merge node com 2 inputs trava** se só 1 ramo chega — substituir por Code node reducer.
- **Long text do monday** suporta ~2000 chars. Períodos típicos (≤30 dias) com `respostas_json` ficam em ~2KB. Se o caso prever 60+ dias com extras, particionar em duas colunas.
- **Status label IDs** no monday são auto-atribuídos no momento da criação. No board atual: Aguardando=0, Concluído=1, Expirado=17 (não=2). Sempre prefira `{label: "..."}` em mutations.
- **monday `getByColumnValue`** retorna array de items mesmo quando vazio. O Code node deve checar `j.id && (j.column_values || j.name)` antes de tratar como hit.
- **Datas com hora no monday** exigem objeto `{date: "YYYY-MM-DD", time: "HH:mm:ss"}` (UTC). Sem `time` é só `{date: "..."}`.
- **Concluído Em é preservado** em re-edições (correção) — apenas `Editado Em` é atualizado.
- Em modo mock, `buscarProcessamento` deve retornar **cópia** do objeto pro React Query detectar mudanças após `finalizarProcessamento` mutar o original.

## Segurança

- UUIDs aleatórios via `Math.random` UUIDv4 no WF1 — impossível adivinhar.
- Protocolo `PROT-XXXX-XXXX` (8 chars úteis num alfabeto sem ambíguos `0/O/1/I`) — não é segredo, mas não é trivial de chutar; somente quem possuir o protocolo (ou o UUID) consegue corrigir.
- Link expira em 30 dias (coluna `Expira Em`); WF2 calcula on-the-fly se `agora > expira_em` e força status=expirado na resposta.
- Job de expiração: rodar como n8n cron diário OU monday Automation no board ("When Date arrives → Change status to Expirado").
- `MONDAY_API_TOKEN` **apenas** dentro do n8n (credencial "Ray0").
- Frontend expõe só `VITE_N8N_BASE_URL`.
- `.env` no `.gitignore`. `.env.local` força modo mock em dev.
