<!-- refreshed: 2026-07-28 -->
# Architecture

**Analysis Date:** 2026-07-28

## System Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                    SPA React 19 + Vite + TypeScript — `src/`              │
├───────────────────────┬────────────────────────────┬──────────────────────┤
│  Feature modules       │  Global shell              │  Cross-cutting       │
│  convocar/preencher/   │  PageTransition/SlideStack │  AuthContext (session│
│  atestados/mensal/…    │  /ZoomTransition/NavCluster│  + operador identity)│
│  `src/features/<f>/`   │  `src/components/*`        │  `src/lib/*`          │
└───────────┬────────────┴──────────────┬─────────────┴───────────┬──────────┘
            │                           │                         │
   chamarProcesso()+comOperador()  (same shell wraps               direct fetch
   `src/lib/http.ts` — per-process   every route)                 `/api/*` `/auth/*`
   routing via `pi.rotas_processo`                                 (fully cut-over:
            │                                                       mensal, auth, boards)
   ┌────────┴─────────┐                                                    │
   ▼                  ▼                                                    ▼
┌───────────────┐  ┌────────────────────────────────────────────────────────────┐
│   n8n Cloud   │  │  auth-backend (Fastify) — `auth-backend/src/`               │
│  ~26 workflows│◄─┤  routes/ → domain/ + repo/ + clients/ + mensal/ + jobs/     │
│  (legacy      │  │  ONE app (`app.ts`), TWO hosts:                             │
│  orchestrator,│  │   • `server.ts`     — persistent Node (dev/Render/old VM)   │
│  being retired│  │   • `api/index.ts` — single Vercel serverless fn (Nitro     │
│  per-process) │  │     routes `/api/**` + `/auth/**` to it, `vite.config.ts`)  │
└───────┬───────┘  └───┬─────────────────┬──────────────────┬──────────────────┘
        │              │                 │                  │
        ▼              ▼                 ▼                  ▼
┌───────────────────────────────┐  ┌───────────────────────────────────────────┐
│      Monday.com boards        │  │        Postgres — schema `pi`              │
│  Entrada (dynamic, duplicates │  │  sessions/users, board registry             │
│  every month) · Histórico /   │◄─┤  (board_colunas/board_grupos), convocações  │
│  Controle-Atestados (fixed)   │  │  mirror, efeitos_externos idempotency      │
│  columns resolved by TITLE    │  │  ledger, jobs queue, mensal_run* (durable   │
│  via `board_colunas` registry │  │  workflow state), rotas_processo (fuga)     │
└───────────────────────────────┘  └───────────────────┬─────────────────────────┘
                                                        │ started via workflow/api `start()`
                                                        ▼
                                        ┌───────────────────────────────────┐
                                        │   `workflows/mensal.ts`            │
                                        │   Vercel Workflow DevKit: 12       │
                                        │   durable steps/contract, retryable,│
                                        │   n8n NOT involved in this flow    │
                                        └───────────────────────────────────┘
```

External systems reached from `auth-backend/src/clients/`: RM TOTVS (via the "ponte AIONS" HTTP bridge, `clients/rm.ts`), Caju benefits API (`clients/caju.ts`), Google Drive (`clients/drive.ts`), Nexti (attestation validation, called from a Monday automation, not from this app's request paths).

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App shell / router | Declares every route; wraps them in `ZoomProvider`/`NavProvider`; splits public (UUID-link) vs authenticated routes | `src/App.tsx` |
| Page transition shell | Detects route "depth" change (via a level map) and drives forward/backward slide direction | `src/components/PageTransition.tsx` |
| Slide carousel primitive | Generic 2-slot horizontal carousel; reused by page transitions AND in-feature wizards (Convocar/Atestados/Descontos step flows) | `src/components/SlideStack.tsx` |
| Zoom navigation | Tile-to-fullscreen zoom transition from the hub; tells `PageTransition` to skip its slide when active | `src/components/ZoomTransition.tsx` |
| Nav shell (global) | Fixed voltar/home/config balloon rendered outside `PageTransition`, persists across every screen | `src/components/NavCluster.tsx` + `src/components/NavContext.tsx` |
| Auth session state | react-query-backed session (`GET /auth/me`), Google SSO popup flow, feeds operator identity into `lib/http.ts` | `src/components/AuthContext.tsx` |
| Route guards | Redirect unauthenticated / incomplete-profile / under-privileged users before rendering a page | `src/components/RequireAuth.tsx`, `src/components/RequireRole.tsx` |
| Dual-path integration helper | Routes each "processo" to n8n or `/api` per `pi.rotas_processo`; injects operator identity into payloads | `src/lib/http.ts` |
| Feature module (×10) | Self-contained page + `api.ts` + `types.ts` + hooks per business flow | `src/features/<feature>/` |
| Fastify app assembly | Registers every route module into one Fastify instance (shared by both deploy targets) | `auth-backend/src/app.ts` |
| Serverless entry | Wraps the compiled Fastify app as a single reusable Vercel function | `api/index.ts` |
| Board registry | Resolves the CURRENT Monday board id + column/group ids by TITLE for a `papel` (atual/proximo/passado) or explicit `board_id` | `auth-backend/src/routes/boards.ts` |
| Monday webhook intake | Replicates the legacy WF1: Monday "ativar" column change → creates the Histórico item + link, without n8n | `auth-backend/src/routes/gatilhos.ts` |
| Domain layer | Pure, unit-tested business rules — discount calc, antifraud, FIFO, holidays, mobility | `auth-backend/src/domain/*.ts` |
| Postgres mirror ("espelho") | Serves reads/writes of the intermitente flow from `pi.convocacoes`, used as fallback when Monday errors and as the webhook-name-compatible escape route for `chamarProcesso` | `auth-backend/src/routes/espelhoIntermitente.ts` |
| Mensal orchestration domain | Builds the read-only preview snapshot and the Caju/RM/Monday/Drive effect payloads for monthly closing | `auth-backend/src/mensal/previa.ts`, `calculo.ts`, `*Efeitos.ts` |
| Durable workflow | 12-step-per-contract retryable execution of the monthly closing, independent of any HTTP request lifetime | `workflows/mensal.ts` |
| Idempotency ledger | Reserve/confirm a key before any external side effect; makes retries safe | `auth-backend/src/jobs/repo.ts` (`reservarEfeito`/`confirmarEfeito`) |
| Jobs runner | Polls `pi.jobs`, advances one step per tick (cron-safe, serverless-safe) | `auth-backend/src/jobs/runner.ts` |
| Contingency dashboard | Read-only Postgres view of payment state when n8n itself is unreachable | `auth-backend/src/routes/contingencia.ts` |

## Pattern Overview

**Overall:** Feature-sliced React SPA on top of a backend that is mid-migration from an n8n-orchestrated integration layer to a Fastify service ("Plano de Fuga" — see `02-PLANO-DE-FUGA.md`). Monday.com boards remain the operational system-of-record for most of the intermitente flow today; Postgres (`pi` schema) already holds sessions, the board-id registry, a synchronized mirror of convocações, an idempotency ledger, and — for the newest subsystem (fechamento mensal) — the full durable-execution state, with n8n not involved at all in that one flow.

**Key Characteristics:**
- Frontend organized strictly by feature (`src/features/<feature>/`), each with its own `api.ts`/`types.ts`/react-query hook, not by technical layer.
- A single frontend helper (`chamarProcesso`) decides, per business "processo," whether a call goes to the legacy n8n webhook or the backend mirror — controlled by a database flag, not a redeploy.
- The backend mirrors that same duality one level down: when it must read/write Monday and the Monday API call fails, it falls back to a Postgres mirror table instead of failing the request.
- Monday board IDs are NOT stable: the Entrada board is duplicated every month ("virada"). All column/group access for that board goes through a title→id registry in Postgres, never a hardcoded id.
- The newest orchestration (fechamento mensal) is fully backend-native: it never calls n8n, and uses a durable-workflow runtime (Vercel Workflow DevKit, `workflow` npm package) instead of a request/response HTTP call, so a 20+ minute, 6-contract, ~19-steps-per-contract run can suspend/retry/resume safely.
- One Fastify app (`construirApp()`) is deployed two ways from the same source: a persistent Node process (`server.ts`, historically VM/Docker, now legacy) and a single Vercel serverless function (`api/index.ts`) reused across warm invocations.

## Layers

**Frontend — Feature Modules:**
- Purpose: One self-contained slice of product functionality (page + data access + types + local components).
- Location: `src/features/<feature>/` — `atestados`, `auth`, `config`, `convocar`, `correcao`, `descontos`, `hub`, `mensal`, `ponto-facultativo`, `preencher`.
- Contains: `<Feature>Page.tsx` (route entry), `api.ts` (mock + real fetch/`chamarProcesso` calls), `types.ts`, `use<Feature>.ts` (react-query hooks — present in 6 of 10 features; `mensal`/`correcao`/`hub`/`auth` call `useQuery`/`useMutation` inline or skip react-query entirely), sub-components.
- Depends on: `src/components/*` (shell/guards), `src/lib/http.ts`, `src/lib/utils.ts`, shadcn `src/components/ui/*`.
- Used by: `src/App.tsx` route table.

**Frontend — Global Shell & Cross-Cutting:**
- Purpose: Navigation chrome, transition choreography, and app-wide state that must persist across route changes.
- Location: `src/components/` (`NavCluster.tsx`, `NavContext.tsx`, `PageTransition.tsx`, `SlideStack.tsx`, `ZoomTransition.tsx`, `AuthContext.tsx`, `RequireAuth.tsx`, `RequireRole.tsx`, `AuroraBackground.tsx`, `FundoTematico.tsx`) and `src/lib/` (`http.ts`, `theme.ts`, `cpf.ts`, `feriadosBoard.ts`, `feriadosBr.ts`, `unidadesContrato.ts`, `useUnidadesRm.ts`, `atividade.ts`).
- Contains: React context providers, route guards, the two transition primitives, and framework-free helpers.
- Depends on: react-router-dom, @tanstack/react-query.
- Used by: every feature module; mounted once in `src/App.tsx`/`src/main.tsx`.

**Backend — Routes (HTTP boundary):**
- Purpose: Fastify request handlers — parse/validate input, call domain+repo+clients, shape the HTTP response.
- Location: `auth-backend/src/routes/*.ts` (22 modules, e.g. `convocar.ts`, `intermitente.ts`, `espelhoIntermitente.ts`, `finalizar.ts`, `atestados.ts`, `descontos.ts`, `pontofac.ts`, `mensal.ts`, `mensalRun.ts`, `mensalOrquestracao.ts`, `boards.ts`, `gatilhos.ts`, `rotas.ts`, `contingencia.ts`, `jobs.ts`, `rm.ts`, `rmLookups.ts`, `drive.ts`, `auth.ts`, `usuarios.ts`, `atividade.ts`, `feriados.ts`, `convocacoes.ts`).
- Contains: `async function rotas<Nome>(app: FastifyInstance)` registration functions; each does its own session/role check via `usuarioDaSessao`.
- Depends on: `domain/`, `repo/`, `clients/`, `mensal/`, `jobs/`, `session.ts`, `db.ts`, `config.ts`.
- Used by: `auth-backend/src/app.ts` (registers all of them into one app).

**Backend — Domain (pure business rules):**
- Purpose: Framework-free, deterministic business logic ported 1:1 from the former n8n Code nodes — the part of the system CLAUDE.md and `02-PLANO-DE-FUGA.md` call out as needing to be "versioned, testable, in git."
- Location: `auth-backend/src/domain/` — `desconto.ts`, `descontoDia.ts`, `ledgerBeneficios.ts`, `antifraude.ts`, `fifo.ts`, `feriado.ts`, `mobilidade.ts`, `diasUteis.ts`, each with a co-located `*.test.ts`.
- Contains: pure functions taking plain data in, returning plain data or a typed error union out (no I/O).
- Depends on: nothing external (no Postgres, no Monday, no fetch).
- Used by: `routes/espelhoIntermitente.ts`, `routes/finalizar.ts`, `routes/pontofac.ts`, `mensal/calculo.ts`.

**Backend — Repo (Postgres access):**
- Purpose: One module per table/board area, hiding raw SQL from routes.
- Location: `auth-backend/src/repo/` — `boards.ts`, `boardDescontos.ts`, `descontos.ts`, `feriados.ts`, `historico.ts`, `valores.ts`.
- Contains: parametrized `query()` calls (via `db.ts`), row→domain-shape mapping.
- Depends on: `db.ts` (Postgres pool), `clients/monday.ts` (some repo modules also read Monday directly, e.g. `historico.ts`).
- Used by: `routes/*`, `mensal/*`.

**Backend — Clients (external integrations):**
- Purpose: One typed HTTP client per external system.
- Location: `auth-backend/src/clients/` (`monday.ts`, `monday.parse.ts`, `rm.ts`, `caju.ts`, `drive.ts`, `xlsx.ts`) plus a second, older Monday client at `auth-backend/src/monday.ts` used by `gatilhos.ts`/`convocar.ts`/`boards.ts`/`atestados.ts`.
- Contains: auth, retry, and payload-shaping for Monday GraphQL, the RM "ponte AIONS" bridge, Caju's OAuth+order API, Google Drive uploads, and XLSX generation.
- Depends on: `config.ts` for credentials/URLs (never hardcoded, never `VITE_*`).
- Used by: `routes/*`, `mensal/*Efeitos.ts`, `services/driveArquivar.ts`.

**Backend — Mensal Orchestration Domain:**
- Purpose: Everything specific to the durable monthly benefits closing — snapshotting, per-contract calculation, and the four external-effect builders.
- Location: `auth-backend/src/mensal/` — `previa.ts` (read-only snapshot), `calculo.ts`, `repo.ts` (run/item/event persistence + advisory lock), `types.ts`, `mondayEfeitos.ts`, `rmEfeitos.ts`, `driveEfeitos.ts`, `workflowClient.ts`.
- Contains: snapshot-shape types (`SnapshotPreviaMensal`, `ContratoPreviaMensal`), Monday/RM/Drive write helpers gated by `modo`+ledger.
- Depends on: `domain/`, `clients/`, `jobs/repo.ts`.
- Used by: `routes/mensal.ts`, `routes/mensalOrquestracao.ts`, `workflows/mensal.ts`.

**Backend — Durable Workflow Execution:**
- Purpose: Run the monthly closing as a long-lived, retryable, resumable process outside the Fastify request/response cycle.
- Location: `workflows/mensal.ts` (compiled by the `workflow` Vite plugin, see `vite.config.ts:6,10`); runtime state in `.well-known/workflow/` (compiled manifest) and `.workflow-data/` (dev-only run/step/event store, gitignored).
- Contains: `"use step"` functions (one per external effect, each with `.maxRetries`) and one `"use workflow"` entry function (`executarMensalWorkflow`) that loops contracts serially.
- Depends on: `auth-backend/src/mensal/*Efeitos.ts`, `auth-backend/src/jobs/repo.ts` (idempotency), `workflow` package (`sleep`, `FatalError`, `getStepMetadata`).
- Used by: started from `auth-backend/src/routes/mensalOrquestracao.ts` via `start()` from `workflow/api`.

**Storage — Monday.com boards:**
- Purpose: Operational system-of-record for convocações, atestados, benefit values, and holidays; what the DP/RH team actually looks at day to day.
- Location: external SaaS; board ids and fixed column ids are documented in `CLAUDE.md`; dynamic column ids are resolved at runtime.
- Contains: Entrada (per-month, duplicated), Histórico (fixed), Controle de Atestados (fixed), Base de Desconto (fixed), Valores/Feriados (fixed, parameter boards).
- Depends on: nothing in this repo (it's the external system); receives writes from `auth-backend`'s Monday clients and (still, for several processes) from n8n.
- Used by: `auth-backend/src/clients/monday.ts` / `auth-backend/src/monday.ts`, n8n workflows.

**Storage — Postgres (schema `pi`):**
- Purpose: Session store, board-id registry, the resilience mirror of convocações, the idempotency ledger, the job queue, and (fully authoritative here) the mensal durable-run state.
- Location: `auth-backend/db/migrations/001..014_*.sql`; connection in `auth-backend/src/db.ts`.
- Contains: `usuarios`/sessions, `boards`/`board_colunas`/`board_grupos`, `convocacoes` (mirror), `descontos`, `jobs`/`efeitos_externos`, `rotas_processo`, `mensal_run`/`mensal_run_item`/`mensal_run_event`.
- Depends on: nothing in-repo (external managed Postgres, shared "cloudfy" instance — isolated via `search_path = pi, public`, `auth-backend/src/db.ts:17-19`).
- Used by: every backend module via `repo/*` or direct `query()`.

**Orchestration — n8n Cloud (legacy, coexisting):**
- Purpose: Original integration/orchestration layer (~26 workflows) for processes not yet cut over: RM employee search, some convocar/cancelar paths, ponto facultativo, atestados' Nexti validation trigger, sábados extras.
- Location: external (n8n Cloud); inventory documented in `MAPA-AUTOMACOES-COMPLETO.md` and `docs/n8n/`.
- Contains: webhook-triggered workflows keyed by path names that the backend mirrors exactly (see Key Abstractions).
- Depends on: Monday, RM (old host, "ponte AIONS" credentials), Caju, Drive.
- Used by: `src/lib/http.ts` (`chamarProcesso`) whenever `pi.rotas_processo` still routes a given "processo" to `n8n`.

## Data Flow

### Primary Request Path — Registrar ocorrência (`/preencher/:uuid`)

1. RH opens the emailed/Monday-generated link; `PreencherPage.tsx` mounts and calls `useProcessamento(uuid)` (`src/features/preencher/useProcessamento.ts`), which calls `buscarProcessamento()` (`src/features/preencher/api.ts:430`).
2. `buscarProcessamento` fetches `GET /api/intermitente/ler?uuid=` directly with plain `fetch` (`src/features/preencher/api.ts:446`) — this read has already been fully cut over and does not go through `chamarProcesso`.
3. The backend handler (`auth-backend/src/routes/intermitente.ts:160`) reads the Histórico board live from Monday; if the Monday call throws, it falls back to the Postgres mirror `lerConvocacaoPg()` (`auth-backend/src/routes/espelhoIntermitente.ts:85`).
4. RH answers day-by-day in `FormularioWizard.tsx`; on submit, `finalizarProcessamento()` (`src/features/preencher/api.ts:526`) calls `chamarProcesso("registro", "intermitente-finalizar?uuid=…", …, { tipo: "escrita" })` (`src/lib/http.ts:98`).
5. Per the current `registro` entry in `pi.rotas_processo`, that POST lands on the n8n WF3 webhook OR — in `auto`/`api` mode — on the mirror `POST /api/intermitente-finalizar` (`auth-backend/src/routes/espelhoIntermitente.ts:207`), which recomputes the VR/VT ledger via `derivarDescontosPorDia`/`calcularDesconto` (`auth-backend/src/domain/descontoDia.ts`, `desconto.ts`) and writes `pi.convocacoes` + `pi.descontos`.
6. The frontend shows `TelaObrigado.tsx` with the generated protocol code.

### Secondary Flow — Criar convocação (`/convocar`)

1. Operator (session required — `<RequireAuth>`, `src/App.tsx:40`) opens `ConvocarPage.tsx`; the name autocomplete calls `buscarEmpregado()` (`src/features/convocar/api.ts:185`) via `chamarProcesso("convocar", "convocar-buscar-empregado?nome=…")` — this process is still n8n-primary because the RM `BEN 2` SQL lookup only runs through the old n8n host's bridge credentials.
2. Form submit calls `criarConvocacao()` (`src/features/convocar/api.ts:254`), which builds a multipart `FormData` (two optional file uploads) and calls `chamarProcesso("convocar", "intermitente-convocar", …, { tipo: "escrita" })`.
3. The backend mirror handler is registered at BOTH `/api/convocar/criar` and `/api/intermitente-convocar` (`auth-backend/src/routes/convocar.ts:376-377`) — same function, two paths, so the webhook-name alias keeps working for `chamarProcesso` while a cleaner path exists for anything calling the backend directly.
4. Either path creates the item on the CURRENT Entrada board (resolved via the board registry) with unit options sourced from RM (`unidadesRm()`, `auth-backend/src/routes/rmLookups.ts`) and returns `{item_id, item_url}`; `ConvocarPage.tsx` renders `TelaSucesso.tsx`.

### Secondary Flow — Fechamento mensal (durable workflow, no n8n)

1. DP opens `/mensal` (`<RequireRole nivelMinimo="dp">`, `src/App.tsx:47`) and requests a read-only snapshot: `criarPreviaMensal()` (`src/features/mensal/api.ts:170`) → `POST /api/mensal/runs/previa` → `calcularPreviaMensal()` (`auth-backend/src/mensal/previa.ts`); a `mensal_run` row is persisted with `status='aguardando_aprovacao'`.
2. DP approves: `POST /api/mensal/runs/:runId/aprovar` (`auth-backend/src/routes/mensalOrquestracao.ts:86`) takes a global Postgres advisory lock (`travarRun()`, `auth-backend/src/mensal/repo.ts:80`) so only one mensal run can be active system-wide, then calls `start(executarMensalWorkflowClient, […])` from `workflow/api` (`mensalOrquestracao.ts:44`), scheduling `executarMensalWorkflow` (`workflows/mensal.ts:655`) on the durable-workflow runtime.
3. The workflow loops contracts serially; each contract runs ~12 gated steps (Caju employee lookup/credit/PIX, RM history batches + FopRotinas + IDFINANC integration — always serial, `workflows/mensal.ts:174` notes the AIONS bridge "não aguenta volume" — then Monday Plano/Controle-Caju/Solicitação/Status-OK, then Drive archiving). Every step reserves an idempotency key before acting (`reservarEfeito`/`confirmarEfeito`, `auth-backend/src/jobs/repo.ts:71-91`) and is gated by `modo` (`homologacao` simulates; `producao` additionally requires `MENSAL_PRODUCTION_ENABLED=1`).
4. The frontend polls `GET /api/mensal/runs/:runId/ao-vivo?after=` (`mensalOrquestracao.ts:199`) to render `Acompanhamento.tsx` live from `mensal_run`/`mensal_run_item`/`mensal_run_event` rows the steps write as they execute. n8n is never called in this flow (`docs/mensal-duravel.md:3-5`).

**State Management:**
- Frontend server-state cache: `@tanstack/react-query` (`staleTime: 30_000` global default, `src/main.tsx:14-20`; overridden per-feature, e.g. `0` in preencher, `5min` in `useUnidadesRm`).
- `chamarProcesso`'s routing table: in-memory + `localStorage["pi_rotas"]`, 60s TTL (`src/lib/http.ts:54-58`).
- Backend request state: none cached — every request re-reads the session row via `usuarioDaSessao()` (`auth-backend/src/session.ts`); the only long-lived object is the Postgres `pool` (`auth-backend/src/db.ts:10`) and, on Vercel, the module-level `appPromise` that keeps the Fastify app warm across invocations (`api/index.ts:8`).
- Durable workflow state: lives entirely in Postgres (`mensal_run*` tables) plus the Workflow DevKit's own run/step/event store; the workflow function itself holds no in-memory state across a `sleep()` suspension.

## Key Abstractions

**Dual-path "Plano de Fuga" routing (`chamarProcesso`):**
- Purpose: let any given business "processo" be served by the legacy n8n webhook or the backend mirror, switchable from a database row instead of a redeploy.
- Examples: `src/lib/http.ts:98` (`chamarProcesso`), `auth-backend/src/routes/rotas.ts` (`pi.rotas_processo` CRUD), every feature `api.ts` that still imports `chamarProcesso`.
- Pattern: `modo` per processo = `n8n` (always legacy) | `api` (always backend, manual kill-switch) | `auto` (try n8n, fail over to `/api` on 404/5xx/timeout for reads, only on 404 for writes — a timeout on a write does not prove nothing happened).

**Board registry (title → column id):**
- Purpose: survive Monday duplicating the Entrada board every month without breaking any column reference.
- Examples: `auth-backend/src/routes/boards.ts` (`registrarBoard`, `/api/boards/resolver`, `/api/boards/virada`), consumed via title maps like `NOMES`/`COL` in `auth-backend/src/routes/convocar.ts` and `E`/`H` in `auth-backend/src/routes/gatilhos.ts`.
- Pattern: never hardcode a `color_*`/`text_*` id for a board that duplicates; look it up by the column's human title, once, and cache in `pi.board_colunas`.

**Postgres mirror ("espelho") of Monday state:**
- Purpose: keep the intermitente flow answering even if the Monday API is down, and give DP a Monday-independent view for contingency.
- Examples: `auth-backend/src/routes/espelhoIntermitente.ts` (`lerConvocacaoPg`, `protocoloPg`, `convocacoesEmpregadoPg`), `pi.convocacoes` (populated by `gatilhos.ts` on creation and by every write in `espelhoIntermitente.ts`), `auth-backend/src/scripts/importar-convocacoes.ts` (bulk ETL).
- Pattern: Monday is read/written first (source of truth today); the same request also updates the Postgres row, wrapped so a mirror-write failure only logs a warning and never fails the user-facing response.

**Idempotency ledger for external effects:**
- Purpose: make any retried step of a payment-adjacent operation safe to re-run without double-charging or double-posting.
- Examples: `auth-backend/src/jobs/repo.ts` (`reservarEfeito`/`confirmarEfeito`, table `pi.efeitos_externos`), used by every `"use step"` function in `workflows/mensal.ts` that touches Caju/RM/Monday.
- Pattern: `reservarEfeito(chave, tipo, payload)` → `"novo"` (proceed), `"confirmado"` (skip, already done), `"pendente"` (previous attempt didn't finish — usually requires manual conciliation outside `teste`/`homologacao` modes).

**Durable workflow steps (`"use step"` / `"use workflow"`):**
- Purpose: express a long, multi-external-system business process as ordinary async TypeScript functions that the Workflow DevKit can persist, retry per-step, and resume after a process restart.
- Examples: `workflows/mensal.ts` (every `etapa*`/`executarPedidoCaju`/`resolverEmployeesCaju` function has `"use step"`; `executarMensalWorkflow` has `"use workflow"`).
- Pattern: a step function is a plain function with a `"use step"` directive and, optionally, a `.maxRetries` property; `sleep("60s")` suspends the whole workflow (not just the step) without holding a request open.

**Role hierarchy & route guards:**
- Purpose: gate screens/endpoints by a single ordered role enum instead of ad hoc boolean flags.
- Examples: `admin > dp > rh/operacional` (`temNivel()`, `src/features/auth/types.ts`; mirrored server-side as `NIVEL` maps in `auth-backend/src/routes/mensalOrquestracao.ts`, `contingencia.ts`, `usuarios.ts`); frontend guards `src/components/RequireAuth.tsx`, `src/components/RequireRole.tsx`.
- Pattern: `<RequireRole nivelMinimo="dp">` wraps a route subtree (`src/App.tsx:47`); backend routes call an `exigirDP`/`exigirAdmin`-style helper at the top of the handler.

**Navigation/transition shell:**
- Purpose: give every screen the same "console" chrome (voltar/home/config) and a consistent slide/zoom feel without each page re-implementing it.
- Examples: `src/components/PageTransition.tsx` (route-level slide direction by depth), `src/components/SlideStack.tsx` (generic 2-slot carousel, also reused inside `ConvocarPage`/`AtestadosPage`/`DescontosPage` for their internal step wizards), `src/components/ZoomTransition.tsx` (hub-tile-to-page zoom, tells `PageTransition` to skip its own slide), `src/components/NavCluster.tsx`+`NavContext.tsx` (global fixed balloon; page registers its "voltar etapa" via `useRegistrarVoltar`).
- Pattern: the "voltar etapa" callback is kept in a `useRef`, not `useState`, specifically to avoid re-mounting the global nav balloon on every render (`src/components/NavContext.tsx:31-34`).

## Entry Points

**Frontend SPA bootstrap:**
- Location: `src/main.tsx:23` (`createRoot(...).render(...)`) → `src/App.tsx`.
- Triggers: browser navigation to any path.
- Responsibilities: mounts `QueryClientProvider` → `BrowserRouter` → `AuthProvider` → `App` (routes + global shell).

**Backend serverless entry (current production path):**
- Location: `api/index.ts:16` (`export default async function handler(req, res)`).
- Triggers: any request to `/api/**` or `/auth/**` on Vercel, routed there by Nitro (`vite.config.ts:11-16`) / `vercel.json` rewrites.
- Responsibilities: lazily builds the Fastify app once per cold start (`api/index.ts:8-14`), then re-emits the raw Node request into Fastify's HTTP server for every invocation.

**Backend persistent entry (legacy VM/Render path):**
- Location: `auth-backend/src/server.ts:6` (`const app = await construirApp(); app.listen(...)`).
- Triggers: `npm run dev` / `npm start` inside `auth-backend/`, or the `auth` service in `docker-compose.yml`.
- Responsibilities: same app as above, but as a long-lived process listening on `PORT`.

**Monday webhook intake:**
- Location: `auth-backend/src/routes/gatilhos.ts:184` (`POST /api/monday/ativar`).
- Triggers: Monday column-value-changed webhook on the Entrada board's "ativar" column (any month's duplicate board), or directly from the frontend at `/api/convocar/ativar` (`gatilhos.ts:328`).
- Responsibilities: replicates the legacy WF1 — creates the Histórico item, generates the UUID/protocol, patches the "Link" column back on the Entrada item, upserts `pi.convocacoes`.

**Scheduled entry (Vercel Cron):**
- Location: `vercel.json` (`crons: [{ path: "/api/mensal/manutencao/retencao", schedule: "17 3 1 * *" }]`) → handler in `auth-backend/src/routes/mensalOrquestracao.ts:55`.
- Triggers: Vercel's cron scheduler, monthly; guarded by a `Bearer <CRON_SECRET>` check.
- Responsibilities: purges mensal run history older than the retention window.

**Durable workflow entry:**
- Location: `workflows/mensal.ts:655-656` (`export async function executarMensalWorkflow(...)`, `"use workflow"`).
- Triggers: `start(executarMensalWorkflowClient, [...])` called from `auth-backend/src/routes/mensalOrquestracao.ts:44` (on approve) or `:145` (on resume).
- Responsibilities: iterates every contract in the snapshot serially, honoring operator cancellation between contracts, and finalizes the run.

## Architectural Constraints

- **Threading:** Node.js single-threaded event loop per Fastify instance. On Vercel, each invocation may get a fresh instance, but warm invocations reuse the module-level `appPromise` (`api/index.ts:8`) — the Postgres pool is therefore also reused, not reopened per request.
- **Forced seriality:** the RM "ponte AIONS" bridge cannot handle concurrent/high-volume calls, so all RM writes inside the mensal workflow are deliberately serial with `sleep("60s")` between history batches and `sleep("7s")` before integration (`workflows/mensal.ts:174-176, 601-621`); the workflow also processes contracts one at a time (`sleep("1s")` between contracts, `workflows/mensal.ts:675`) — there is no parallelism to add here without first fixing the bridge.
- **Global state (module-level singletons):** the Postgres pool (`auth-backend/src/db.ts:10`), the routing-table cache and `degradado` flag (`src/lib/http.ts:54, 91`), the `operadorProvider` getter registered by `AuthContext` (`src/lib/http.ts:17-21`), and the warm-app cache (`api/index.ts:8`).
- **Avoided circular import:** `src/lib/http.ts` deliberately does not import React/`AuthContext`; instead `AuthContext.tsx` calls `setOperadorProvider()` on mount (`src/components/AuthContext.tsx:116-122`) so the plain-TS helper never depends on the component tree.
- **Same-origin session cookie:** `pi_sess` is httpOnly and only attached same-origin, so frontend and backend must share an origin — via nginx proxy on the legacy VM or Vercel rewrites (`vercel.json`) in production, and via Vite's dev `server.proxy` (`vite.config.ts:32-35`) locally.
- **Single global mensal run:** a Postgres advisory lock (`pg_advisory_xact_lock`, `auth-backend/src/mensal/repo.ts:35, 81`) guarantees only one mensal run can be `aguardando_aprovacao`/`fila`/`rodando`/`recuperando` at a time, system-wide.
- **Retry-safety requirement:** any function marked `"use step"` in `workflows/mensal.ts` may be re-executed by the Workflow DevKit after a transient failure; it MUST be idempotent (see the `reservarEfeito`/`confirmarEfeito` pattern in Key Abstractions) — this is a hard constraint on any new step, not a suggestion.
- **Build-time vs runtime config:** `VITE_*` variables are baked into the frontend bundle at build time (Vite); all `auth-backend/src/config.ts` variables are read at container/function boot. Changing a `VITE_*` value requires a rebuild, not just a redeploy of the backend.

## Anti-Patterns

### Hardcoding a Monday column id for a board that duplicates monthly

**What happens:** a column is referenced by its raw Monday id (e.g. `color_mm3a8ana`, `date_mm3b88ta`) for the Entrada board.
**Why it's wrong:** Entrada is duplicated every month during the "virada"; a column added or reordered on a later month's copy can get a different id, silently breaking any code with a hardcoded reference — and the failure only shows up weeks later, on the new board.
**Do this instead:** resolve the id by the column's human TITLE through the registry (`GET /api/boards/resolver?board_id=`, or the title maps `NOMES`/`COL` in `auth-backend/src/routes/convocar.ts` and `E` in `auth-backend/src/routes/gatilhos.ts`). Raw id constants are only acceptable for the two boards explicitly documented as fixed — Histórico (`COL_HIST` in `auth-backend/src/repo/historico.ts`) and Controle de Atestados (`C` in `auth-backend/src/routes/atestados.ts`).

### Calling `/api/*` directly for a "processo" whose n8n workflow is still relied upon

**What happens:** a feature's `api.ts` uses plain `fetch("/api/...")` instead of `chamarProcesso(...)`.
**Why it's wrong:** it permanently forfeits the per-process n8n/backend routing that `pi.rotas_processo` exists to provide. If the n8n workflow for that process still performs work the backend mirror does not (a common state mid-migration), bypassing `chamarProcesso` can silently skip that work instead of falling back to it.
**Do this instead:** use `chamarProcesso(processo, path, init, { tipo })` (`src/lib/http.ts:98`) for anything whose n8n webhook is still registered. Only fetch `/api/*`/`/auth/*` directly once a feature has no n8n equivalent left to fall back to — as is already true for `mensal`, `auth`, `boards`, `usuarios`, `atividade` (confirmed in `docs/mensal-duravel.md:3-5` for mensal specifically).

### External side effects inside a workflow step without an idempotency reservation

**What happens:** a `"use step"` function calls a Caju/RM/Monday write API directly, with no `reservarEfeito`/`confirmarEfeito` guard.
**Why it's wrong:** the Workflow DevKit automatically retries a step that throws or times out (see `.maxRetries` on `executarPedidoCaju`, `workflows/mensal.ts:171`); without a guard, a retry re-issues the same PIX/SOAP call and produces a duplicate real-world payment or ledger entry.
**Do this instead:** wrap every external effect with `reservarEfeito(chave, tipo, payload)` before acting and `confirmarEfeito(chave, ref)` after (`auth-backend/src/jobs/repo.ts:71-91`), using a `chave` stable across retries (pattern: `mensal:<competencia>:<contrato>:<etapa>`) — exactly as every step in `workflows/mensal.ts` already does.

## Error Handling

**Strategy:** HTTP handlers return structured JSON (`{ erro: "<code>", mensagem?, ... }`) with the matching status code (400 validation, 401/403 auth, 404 not found, 409 conflict/already-done, 502 upstream failure) rather than letting exceptions leak as 500s. The domain layer avoids throwing for expected business outcomes — e.g. `resolverValores()` returns a `ValoresResolvidos | ErroValores` union instead of throwing (`auth-backend/src/domain/desconto.ts`). Inside durable workflow steps, `FatalError` (from the `workflow` package) marks a non-retryable business-rule stop (e.g. `execucao_mensal_producao_bloqueada_ate_cutover`, `workflows/mensal.ts:96`), while an ordinary `throw` is treated as transient and retried up to `.maxRetries`.

**Patterns:**
- Frontend custom `Error` subclasses carry structured detail for the UI to branch on: `ConvocacaoApiError` (`.status`/`.erro`/`.conflito`, `src/features/convocar/api.ts`), `CancelarConvocacaoApiError`, `AplicarSplitApiError` (`src/features/preencher/api.ts`), `MensalApiError` (`.codigo`/`.status`/`.corpo`, `src/features/mensal/api.ts:126`).
- Backend route errors are logged with context via Fastify's built-in logger: `req.log.error(e, "<contexto>")` before responding — consistent across nearly every route file.
- Contract-level failures inside the mensal workflow are isolated per contract (`try { … } catch { marcarContratoFinal(runId, contrato, "erro", mensagem) }`, `workflows/mensal.ts:649-652`) so one bad contract never aborts the whole run.

## Cross-Cutting Concerns

**Logging:** Fastify's built-in Pino logger (`Fastify({ logger: true })`, `auth-backend/src/app.ts:31`); no external log aggregation wired in-repo.
**Validation:** manual, inline (regex for dates/UUIDs/protocol format, explicit null/shape checks with early `reply.code(400)` returns); no schema library (`zod`) is wired despite being proposed in `02-PLANO-DE-FUGA.md:67`.
**Authentication:** opaque httpOnly session cookie (`pi_sess`) resolved per-request via `usuarioDaSessao(req)` (`auth-backend/src/session.ts`) hitting Postgres — no in-memory session cache. Role checks are duplicated ad hoc per route file (`NIVEL` maps) rather than centralized in one Fastify plugin/decorator.
**Contingency ("Plano de Fuga"), three independent layers:** (1) frontend per-process n8n/backend routing (`chamarProcesso`, `pi.rotas_processo`); (2) backend Monday-read-then-Postgres-mirror fallback (`espelhoIntermitente.ts`); (3) a read-only DP-facing contingency dashboard (`GET /api/contingencia/pagamentos`, `auth-backend/src/routes/contingencia.ts`) backed entirely by Postgres, paired with a manual runbook (`docs/contingencia/pagamentos.md`) — execution during an incident is always manual, never automatic.

---

*Architecture analysis: 2026-07-28*
