# Registro de Ocorrências de Intermitentes

App web que o RH acessa via **link único** para registrar, dia a dia, se um intermitente **faltou**, **atrasou/saiu mais cedo**, ou **não teve ocorrência**, durante o período de uma convocação cadastrada no monday.com. Ao finalizar o preenchimento, os dados são gravados no Supabase (e futuramente também num board de destino do monday).

## Estado atual do projeto

**Funcionando end-to-end (mock + real):**
- WF1 (Preparar) — n8n recebe webhook do monday quando RH muda status, gera UUID, insere em `processamentos`, preenche Link Column do item de origem.
- WF2 (Ler) — n8n responde `GET /intermitente-ler?uuid=…`, retornando dados + `dias[]` + status.
- WF3 (Finalizar) — n8n responde `POST /intermitente-finalizar`, faz delete idempotente em `ocorrencias_dia`, insere as novas ocorrências, marca `processamentos.status='concluido'`.
- Frontend: novo painel com **modal por dia** — todos os dias começam como "Sem ocorrências", RH clica só nos dias com problema, modal pergunta Faltou? → Atrasou? → minutos.

**Pendente:**
- WF3: criar item no board de destino do monday (hoje só tem o node `TODO Monday destino` como passthrough).
- (Futuro) Migrar storage de Supabase para um board do monday — usuário enviou xlsx com estrutura sugerida (colunas: UUID, Contrato, Data início/fim, Status, Expira em, Concluído em, Item origem, Link, dias com falta agregado, tempo total atraso agregado). Decisão sobre granularidade (por dia vs só agregados) ainda pendente.

## Fluxo resumido

```
[monday "Plano Intermitentes"] → mudança de status
                              ↓
              [n8n WF1: preparar] → gera UUID, insert Supabase, patch Link Column
                              ↓
              RH clica no link na coluna Link
                              ↓
              [Web app /preencher/:uuid]
                              ├─ GET WF2 → carrega dados + dias[]
                              ├─ Painel: lista de dias, modal pra editar cada um
                              └─ POST WF3 → grava ocorrências, marca concluído
                              ↓
              Tela "Obrigado pelo preenchimento"
```

## Decisões-chave

- **Sem login** — segurança = UUID longo aleatório + expiração de 30 dias.
- **Idempotência no WF3** — antes de inserir ocorrências, faz `DELETE` por `processamento_id` (permite re-finalizar sem violar UNIQUE constraint).
- **Painel + modal** (não wizard sequencial) — RH só interage com dias problemáticos.
- **Frontend não conversa com Supabase direto** — toda I/O de banco e monday passa pelo n8n.
- **Estado armazenado no Supabase** (decisão temporária, com plano de migrar pra board monday no futuro).

## Stack

- **Frontend**: Vite + React 19 + TypeScript (strict)
- **UI**: Tailwind v4 + shadcn/ui (new-york, base neutral) — Dialog, Card, Button, Input, Label, Separator
- **Estado server**: @tanstack/react-query (staleTime 0 no preencher pra invalidate funcionar bem)
- **Roteamento**: react-router-dom v7
- **Datas**: date-fns + locale pt-BR
- **Backend de orquestração**: n8n Cloud (`https://aionscorp-n8n.cloudfy.live`)
- **Banco**: Supabase Postgres (acesso só via n8n com service_role)
- **Integração externa**: monday.com API v2 (board origem ID `18408773953`)
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
- **Supabase API**: nome "supabase ray", host = URL do projeto, key = `service_role` (não a publishable).
- **Monday API**: nome "Ray0", token API v2.

## Estrutura de arquivos

```
src/
├─ App.tsx                       rotas + dev index com links de teste mock
├─ main.tsx                      providers (QueryClient + Router)
├─ features/preencher/
│  ├─ api.ts                     fetch n8n + mocks (com clone de resposta)
│  ├─ types.ts                   StatusProcessamento, TipoOcorrencia, RespostaDia, etc
│  ├─ useProcessamento.ts        hooks react-query (useProcessamento, useFinalizarProcessamento)
│  ├─ PreencherPage.tsx          orquestra loading / 404 / expirado / concluido / aguardando
│  ├─ FormularioWizard.tsx       painel principal + DialogDia (modal por dia)
│  ├─ TelaCarregando.tsx
│  ├─ TelaObrigado.tsx
│  └─ TelaErro.tsx
├─ components/ui/                shadcn (button, card, dialog, input, label, separator, badge, select, table)
└─ lib/utils.ts

docs/
├─ schema.sql                    cria tables processamentos e ocorrencias_dia
├─ especificacao.md
└─ n8n/
   ├─ wf1-preparar.json          Webhook → Get item → Code (extrai colunas, gera UUID) → Supabase insert → Monday change column
   ├─ wf2-ler.json                Webhook GET → Supabase select → Code (404/expirado) → Respond
   └─ wf3-finalizar.json          Webhook POST → Supabase select → Validar Code → IF →
                                    Limpar ocorrências antigas (Supabase delete) →
                                    Reinjetar ocorrências (Code) → Split → Insert ocorrência →
                                    Consolidar inserts (Code) → Marcar concluído →
                                    TODO Monday destino → Respond OK / Erro

.claude/skills/frontend-design/SKILL.md   skill instalado a nível de projeto

CLAUDE.md, README.md, .env, .env.example, components.json, package.json, tsconfig.*.json
```

## Schema Supabase

```sql
processamentos:
  id uuid PK
  monday_item_id text
  nome text
  contrato text
  data_inicio date
  data_fim date
  qtd_dias int (generated)
  status text ('aguardando' | 'concluido' | 'expirado')
  expira_em timestamptz (default = criado_em + 30 days)
  criado_em timestamptz
  concluido_em timestamptz
  solicitante text
  monday_destino_item_id text

ocorrencias_dia:
  id uuid PK
  processamento_id uuid FK (cascade delete)
  data date
  tipo text ('sem_ocorrencia' | 'falta' | 'atraso')
  minutos_atraso int
  UNIQUE (processamento_id, data)
  CHECK (tipo='atraso' → minutos_atraso > 0)
```

RLS desabilitada — acesso só via n8n com service_role.

## Contratos com o n8n

### GET `/webhook/intermitente-ler?uuid=<uuid>`

WF2 retorna (snake_case do banco, convertido pra camelCase no `api.ts`):
```ts
{
  uuid: string
  status: "aguardando" | "concluido" | "expirado"
  nome: string
  contrato: string | null
  data_inicio: string         // YYYY-MM-DD
  data_fim: string
  dias: string[]              // YYYY-MM-DD[]
  expira_em: string
  concluido_em: string | null
  _statusCode: number         // metadata, ignorado pelo frontend
}
```
- **200** → renderiza painel se `status='aguardando'`, tela obrigado se `concluido`, tela erro se `expirado`
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
}
```
WF3 retorna:
- **200** `{ ok: true, uuid, concluido_em }` → frontend invalida query, refetch traz `status: concluido`
- **400** validação (resposta faltando, tipo inválido, minutos inválidos)
- **404** processamento não existe
- **409** já concluído
- **410** expirado

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
- **Reimport JSON perde credenciais** — todo Supabase/monday node fica órfão e exige reseleção manual.
- **Merge node com 2 inputs trava** se só 1 ramo chega — substituir por Code node reducer.
- **SplitOut espera string field name**, não expression que retorna array — usar Code node intermediário pra reinjetar dados após operações que alteram payload.
- Em modo mock, `buscarProcessamento` deve retornar **cópia** do objeto pro React Query detectar mudanças após `finalizarProcessamento` mutar o original.

## Segurança

- UUIDs aleatórios (`gen_random_uuid()` pgcrypto, ou `Math.random` UUIDv4 no WF1) — impossível adivinhar.
- Link expira em 30 dias (`expira_em`); WF2 marca como expirado se `agora > expira_em`.
- Função `expirar_processamentos_vencidos()` pode ser cronada no Supabase.
- `MONDAY_API_TOKEN` e Supabase `service_role` **apenas** dentro do n8n.
- Frontend expõe só `VITE_N8N_BASE_URL`.
- `.env` no `.gitignore`.
