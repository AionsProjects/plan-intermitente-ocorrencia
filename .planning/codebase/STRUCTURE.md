# Codebase Structure

**Analysis Date:** 2026-07-28

Scope note: this document covers the whole repository except build/backup artifacts that are explicitly out of scope for mapping: `src.bak-fase3/`, `dist/`, `node_modules/`, `_wf7tmp/`, `.output/`, `.swc/`.

## Directory Layout

```
plano-vercel/
├── src/                             SPA React 19 + Vite + TypeScript — frontend
│   ├── App.tsx                      route table + global shells (Zoom/Nav/Auth guards)
│   ├── main.tsx                     bootstrap: QueryClientProvider + BrowserRouter + AuthProvider
│   ├── index.css                    Tailwind v4 + design tokens + theme variables + keyframes
│   ├── liquid-glass-v2.css          "vidro fumê" v2 skin tokens/classes (imported by index.css)
│   ├── components/                  generic/global components (not feature-specific)
│   │   └── ui/                      shadcn/ui primitives (button, dialog, select, card, ...)
│   ├── features/                    one folder per product feature (see below)
│   │   ├── atestados/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── convocar/
│   │   ├── correcao/
│   │   ├── descontos/
│   │   ├── hub/
│   │   ├── mensal/
│   │   ├── ponto-facultativo/
│   │   └── preencher/
│   ├── hooks/                       empty (only `.gitkeep`) — hooks live inside each feature instead
│   └── lib/                         cross-feature helpers (http, theme, cpf, feriados, unidades)
│
├── auth-backend/                    Fastify + TypeScript backend — auth, business logic, integrations
│   ├── src/
│   │   ├── app.ts                   builds the Fastify app, registers every route module
│   │   ├── server.ts                persistent-process entrypoint (dev / Render / legacy VM)
│   │   ├── config.ts                runtime env vars (never exposed to the frontend bundle)
│   │   ├── db.ts                    Postgres pool (schema `pi`)
│   │   ├── session.ts               cookie session read/write/destroy
│   │   ├── cpf.ts / senha.ts / oauth.ts / calculoBeneficios.ts / monday.ts
│   │   ├── routes/                  Fastify handlers, one module per resource (22 files)
│   │   ├── domain/                  pure business rules + co-located `*.test.ts`
│   │   ├── repo/                    Postgres data access, one module per table/board area
│   │   ├── clients/                 external HTTP integrations (Monday, RM, Caju, Drive, xlsx)
│   │   ├── mensal/                  fechamento-mensal domain (snapshot, calc, effects, run repo)
│   │   ├── jobs/                    lightweight job queue + external-effect idempotency ledger
│   │   ├── services/                cross-cutting service helpers (e.g. Drive archiving)
│   │   └── scripts/                 one-off CLIs: migrate, seed, importar-convocacoes, ...
│   ├── db/
│   │   ├── migrations/              sequential SQL, `001_init.sql` .. `014_mensal_duravel.sql`
│   │   └── seed.sql
│   ├── scripts/                     shell tooling (`push-vercel-env.sh`)
│   └── Dockerfile, tsconfig.json, package.json
│
├── workflows/
│   └── mensal.ts                    durable workflow (Vercel Workflow DevKit) for the monthly close
│
├── api/
│   └── index.ts                     single Vercel serverless function; wraps auth-backend's compiled app
│
├── docs/                             technical documentation
│   ├── n8n/                         extracted n8n workflow JSON + per-feature notes
│   ├── contingencia/                "Plano de Fuga" runbooks (pagamentos, ensaio)
│   ├── paridade/                    legacy-vs-new parity harness notes
│   ├── pdf/                         generated user/technical PDF manual + generator scripts
│   ├── especificacao.md, design-system.md, mensal-duravel.md, schema.sql, ...
│
├── docker/nginx.conf                 legacy VM reverse-proxy config (SPA fallback, /auth+/api proxy)
├── Dockerfile, docker-compose.yml    legacy VM deploy (2 containers: app, auth) — Vercel is current
├── scripts/                          n8n workflow patch/deploy tooling — gitignored, not deployed
├── public/                           static assets served as-is (favicon, logo)
├── .planning/codebase/               generated codebase maps (this document's home)
│
├── vite.config.ts                    Vite + nitro + workflow + react + tailwind plugins, dev proxy
├── vercel.json                       rewrites (/auth, /api → serverless fn), monthly cron
├── package.json                      frontend deps + (deliberately) backend runtime deps — see below
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── eslint.config.js, components.json
└── CLAUDE.md, README.md, DEPLOY.md, 02-PLANO-DE-FUGA.md, 03-OPERACAO.md,
    04-GUIA-DP-OPERACIONAL.md, MAPA-AUTOMACOES-COMPLETO.md
```

Runtime-only / generated directories that exist on disk but are gitignored (do not treat as source):
`.workflow-data/` (Workflow DevKit local run state), `.well-known/workflow/` (compiled workflow manifest), `.vercel/` (Vercel CLI project link).

## Directory Purposes

**`src/features/<feature>/`:**
- Purpose: everything needed to render and drive one product flow.
- Contains: `<Feature>Page.tsx` (route entry component), `api.ts` (mock data + real fetch/`chamarProcesso` calls), `types.ts`, `use<Feature>.ts` (react-query hooks — present in `atestados`, `config`, `convocar`, `descontos`, `ponto-facultativo`, `preencher`; the others call `useQuery`/`useMutation` inline or don't need react-query), plus sub-components and step screens (`Tela*.tsx`, `Dialog*.tsx`, wizard steps).
- Key files: see the per-feature list below.

**`src/components/`:**
- Purpose: components shared across features — navigation chrome, transitions, auth/role guards, ambient backgrounds.
- Contains: `NavCluster.tsx`+`NavContext.tsx` (global voltar/home/config balloon), `PageTransition.tsx`+`SlideStack.tsx`+`ZoomTransition.tsx` (route/step transition primitives), `AuthContext.tsx`+`RequireAuth.tsx`+`RequireRole.tsx` (session + RBAC), `AuroraBackground.tsx`+`FundoTematico.tsx` (ambient visuals).
- Key files: `src/components/ui/` holds the shadcn/ui primitives (`button.tsx`, `dialog.tsx`, `select.tsx`, `card.tsx`, `combobox-filtravel.tsx`, `table.tsx`, `badge.tsx`, `input.tsx`, `label.tsx`, `separator.tsx`).

**`src/lib/`:**
- Purpose: framework-agnostic helpers usable from any feature.
- Contains: `http.ts` (`chamarProcesso`/`comOperador`/`anexarOperador` — the n8n/backend routing helper), `theme.ts` (light/dark/system + accent schemes, localStorage), `cpf.ts` (validation, mirrored in `auth-backend/src/cpf.ts`), `feriadosBoard.ts`/`feriadosBr.ts` (holiday rules, board-backed with a hardcoded fallback), `unidadesContrato.ts`/`useUnidadesRm.ts` (unit-by-contract lookups, RM-backed with a hardcoded fallback), `atividade.ts` (activity/audit log client), `utils.ts` (`cn()` class merge helper).

**`auth-backend/src/routes/`:**
- Purpose: the HTTP boundary — one file per resource, each exporting an `async function rotas<Nome>(app)` registered in `app.ts`.
- Contains 22 modules covering auth/session, board registry, convocar/finalizar/cancelar/split, atestados, descontos, ponto facultativo, mensal (3 files: `mensal.ts`, `mensalRun.ts`, `mensalOrquestracao.ts`), RM lookups, Drive, feriados, activity, users, contingency, and the Monday-webhook intake (`gatilhos.ts`).
- Key files: `intermitente.ts` + `espelhoIntermitente.ts` both implement reads/writes for the intermitente flow (Monday-live-with-PG-fallback vs. PG-mirror-with-webhook-compatible-paths respectively) — see `ARCHITECTURE.md`'s Anti-Patterns for the distinction.

**`auth-backend/src/domain/`:**
- Purpose: pure, framework-free business rules ported from the former n8n Code nodes.
- Contains: `desconto.ts`/`descontoDia.ts`/`ledgerBeneficios.ts` (VR/VT discount calculation), `antifraude.ts` (duplicate-period detection), `fifo.ts` (discount payoff ordering), `feriado.ts` (holiday-applies-to-contract rule), `mobilidade.ts` (interior/mobility vs VT rule), `diasUteis.ts` (business-day generation).
- Key files: every file has a co-located `*.test.ts` run via `node --test` (see Testing convention below — full detail belongs in `TESTING.md`).

**`auth-backend/src/repo/`:**
- Purpose: Postgres/Monday read-write helpers scoped to one table or board area, called from routes so routes stay thin.
- Contains: `boards.ts`, `boardDescontos.ts`, `descontos.ts`, `feriados.ts`, `historico.ts` (Histórico board column constants + helpers), `valores.ts`.

**`auth-backend/src/clients/`:**
- Purpose: typed HTTP clients for external systems.
- Contains: `monday.ts`+`monday.parse.ts` (GraphQL + response parsing), `rm.ts` ("ponte AIONS" bridge to RM TOTVS), `caju.ts` (OAuth + benefit orders), `drive.ts` (Google Drive upload), `xlsx.ts` (spreadsheet generation for conferência).
- Note: a second, older Monday client lives at `auth-backend/src/monday.ts` (used by `gatilhos.ts`, `convocar.ts`, `boards.ts`, `atestados.ts`) alongside `clients/monday.ts` (used by `intermitente.ts`, `espelhoIntermitente.ts`, `finalizar.ts`) — both are live, not one legacy/one current.

**`auth-backend/src/mensal/`:**
- Purpose: everything specific to the durable monthly benefits closing.
- Contains: `previa.ts` (read-only snapshot builder), `calculo.ts` (per-person/contract totals), `repo.ts` (run/item/event persistence, advisory lock, retry/resume prep), `types.ts` (snapshot shapes), `mondayEfeitos.ts`/`rmEfeitos.ts`/`driveEfeitos.ts` (gated external-effect builders), `workflowClient.ts` (typed stub the workflow compiler replaces).

**`auth-backend/src/jobs/`:**
- Purpose: a minimal, serverless-safe job queue plus the idempotency ledger every external effect relies on.
- Contains: `repo.ts` (`enfileirar`/`pegarDevidos`/`avancar`/`falhar`, `reservarEfeito`/`confirmarEfeito`), `runner.ts` (`tick()` — processes due jobs; RM/Caju/mensal/virada handlers are currently `gated` placeholders, only `expiracao` and `noop` are live).

**`auth-backend/db/migrations/`:**
- Purpose: the only schema-change mechanism (no ORM). Sequential, idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) SQL files, applied by `auth-backend/src/scripts/migrate.ts`.
- Contains: `001_init.sql` through `014_mensal_duravel.sql`, covering users/sessions → profile/password → activity → board registry (+groups) → mensal run tracking → convocações mirror → discounted-days tracking → naming → descontos → jobs/idempotency → contingency routing → durable mensal state.

**`workflows/`:**
- Purpose: durable-workflow definitions compiled by the `workflow` Vite plugin.
- Contains: `mensal.ts` only, today. Any new long-running, multi-external-system, retryable process belongs here, not in a route handler.

**`docs/`:**
- Purpose: reference material — not consumed by the running app.
- Key files: `docs/n8n/` (workflow JSON exports + `atestados-feature.md`, `ponto-facultativo.md`, `controle-atestados-board.md`, `wf-mensal-fifo.md` — the last explicitly marked as describing the legacy flow, not the current one, in `docs/mensal-duravel.md:142`), `docs/contingencia/` (`pagamentos.md`, `ensaio.md` — manual runbooks), `docs/paridade/README.md` (legacy-vs-new comparison harness notes), `docs/schema.sql` (a snapshot of the Postgres schema), `docs/mensal-duravel.md` (the durable-mensal design/status doc).

**`scripts/` (repo root):**
- Purpose: one-off Node scripts (`.cjs`) that patched/deployed n8n workflows during development.
- Contains: `patch_wf*.cjs`, `deploy_*.cjs`, `setup_wf_*.cjs`, `mapping_*.json`, `scripts/data/unidades*.csv`.
- Not deployed: entirely gitignored (`.gitignore`: `scripts/`) because some historically contained hardcoded tokens; safe to explore locally but never assume these run in CI/production.

**`public/`:**
- Purpose: static assets copied as-is into the built SPA.
- Contains: `favicon.svg`, `logo-aions.svg`.

**`docker/`, root `Dockerfile`, `docker-compose.yml`:**
- Purpose: the legacy VM deployment (nginx + 2 containers: `app` serving the built SPA + proxying `/auth`/`/api`, `auth` running the Fastify backend). Per `CLAUDE.md`, that VM is deactivated; Vercel is the live deployment target. The files remain in-repo and are still buildable locally.

## Key File Locations

**Entry Points:**
- `src/main.tsx`: frontend bootstrap (providers + `initTheme()`).
- `src/App.tsx`: route table.
- `auth-backend/src/server.ts`: backend persistent-process entry (legacy VM/Render/local dev).
- `api/index.ts`: backend serverless entry (current production path on Vercel).
- `auth-backend/src/app.ts`: shared Fastify app assembly used by both entries above.
- `workflows/mensal.ts`: durable-workflow entry (`executarMensalWorkflow`).

**Configuration:**
- `vite.config.ts`: build/dev plugins (`nitro`, `workflow`, `react`, `tailwindcss`), dev-only `/auth`+`/api` proxy to `127.0.0.1:3000`.
- `vercel.json`: production rewrites + the monthly retention cron.
- `auth-backend/src/config.ts`: all backend runtime env vars, with `req()`/`opt()` helpers that throw on missing required vars at boot.
- `.env.example` (root, frontend `VITE_*` + Docker-Compose-read backend vars) / `auth-backend/.env.example` (full backend var list) — document names only; real values are gitignored.
- `components.json`: shadcn/ui generator config (aliases, style "new-york").
- `docker/nginx.conf`: legacy reverse-proxy rules.

**Core Logic:**
- `auth-backend/src/domain/*.ts`: VR/VT discount, antifraud, FIFO, holiday, mobility rules.
- `auth-backend/src/mensal/*.ts`: monthly-closing snapshot, calculation, and effect builders.
- `workflows/mensal.ts`: the durable execution graph itself.
- `src/lib/http.ts`: the n8n/backend dual-path routing helper every write-capable feature uses.

**Testing:**
- `auth-backend/src/**/*.test.ts`: co-located with the module under test, run via `npm test` → `node --test` (see `auth-backend/package.json:10`).
- No frontend test runner is configured (no `*.test.tsx`/Vitest/Jest setup found under `src/`).

## Naming Conventions

**Files:**
- Frontend page/route components: `<Feature>Page.tsx` (e.g. `ConvocarPage.tsx`, `MensalPage.tsx`).
- Frontend data modules: always `api.ts` + `types.ts` per feature; hooks as `use<Feature>.ts` (e.g. `useConvocacao.ts`, `usePontoFacultativo.ts`).
- Frontend result/step screens: `Tela<Estado>.tsx` (`TelaSucesso.tsx`, `TelaErro.tsx`, `TelaCarregando.tsx`, `TelaObrigado.tsx`, `TelaRegistrado.tsx`).
- Backend route modules: `<recurso>.ts` under `routes/`, exporting `rotas<Recurso>(app)` (Portuguese, camelCase function name matching the file).
- Backend domain/test pairing: `<regra>.ts` + `<regra>.test.ts` in the same directory (never a separate `__tests__/` tree).
- SQL migrations: `NNN_<descricao>.sql`, zero-padded 3-digit sequence, one concern per file.

**Directories:**
- Frontend: `src/features/<kebab-case-feature-name>/` (e.g. `ponto-facultativo`), one level deep, no nested sub-features.
- Backend: flat `routes/`/`domain/`/`repo/`/`clients/` per concern, with `mensal/` and `jobs/` as the two exceptions that group by subsystem instead of by technical layer (because they're each a fairly self-contained subsystem).

**Language:**
- Portuguese (Brazilian) throughout: variable/function names, comments, commit messages, error codes (`erro: "nao_autenticado"`), Fastify route registration function names. English is limited to a handful of generic technical filenames (`api.ts`, `types.ts`, `config.ts`) and library-mandated identifiers.
- Monday column ids are opaque auto-generated strings (`color_mm3a8ana`, `text_mm2xjend`, `long_text_mm3ct3hg`); they are always referenced through a named constant map (`COL_HIST`, `C`, `H`, `COL`, `NOMES`) in the file that owns that board — never inlined as string literals in business logic.

## Where to Add New Code

**New frontend feature:**
- Create `src/features/<nome>/` with `<Nome>Page.tsx` + `api.ts` + `types.ts`; add a `use<Nome>.ts` hook file if the feature does more than one react-query call.
- Register the route in `src/App.tsx`, inside `<RequireAuth>` (and `<RequireRole>` if role-gated) unless the page must be reachable by an anonymous UUID link (put those alongside `/preencher/:uuid` and `/descontos/:uuid`, outside the guards).
- If the feature calls a process that might still run through n8n, add/confirm a `pi.rotas_processo` entry and call it through `chamarProcesso()` (`src/lib/http.ts`), not a bare `fetch`. If the feature is backend-native from day one (no n8n equivalent ever existed), `fetch("/api/...", { credentials: "include" })` directly, following `src/features/mensal/api.ts`.

**New backend route:**
- Add `auth-backend/src/routes/<nome>.ts` exporting `async function rotas<Nome>(app: FastifyInstance)`; register it in `auth-backend/src/app.ts`.
- If the route mirrors a still-relevant n8n webhook name (cutover in progress), register the SAME handler function at both the clean path and the legacy webhook-name path — see `criarConvocacaoHandler` in `auth-backend/src/routes/convocar.ts:376-377` for the pattern.
- Put pure calculation/validation in `auth-backend/src/domain/<nome>.ts` with a co-located `<nome>.test.ts`; put Postgres access in `auth-backend/src/repo/<nome>.ts`; put any new external system call in `auth-backend/src/clients/<sistema>.ts`.

**New Postgres table/column:**
- Add `auth-backend/db/migrations/<next-number>_<nome>.sql`, written idempotently (`IF NOT EXISTS`), schema-qualified only when outside `pi` (the pool sets `search_path`).
- Apply via `npm run migrate` (`auth-backend/src/scripts/migrate.ts`); never hand-edit the target database.

**New long-running/multi-system orchestration:**
- Model it as a workflow in `workflows/<nome>.ts` (functions with `"use step"`, an entry function with `"use workflow"`), following the gating pattern in `workflows/mensal.ts` (`modo`/ledger checks before any external effect).
- Start it from a route via `start()` from `workflow/api` (see `auth-backend/src/routes/mensalOrquestracao.ts:44`), and expose polling/status routes analogous to `/api/mensal/runs/:runId/ao-vivo`.

**Utilities:**
- Frontend cross-feature helpers: `src/lib/`.
- Backend cross-route helpers that aren't a client/repo/domain concern: `auth-backend/src/services/` (currently just `driveArquivar.ts`).

## Special Directories

**`.workflow-data/`:**
- Purpose: local run/step/event/wait state for the Workflow DevKit during `vite dev`.
- Generated: yes (by the `workflow` Vite plugin at dev/runtime).
- Committed: no (`.gitignore`: `.workflow-data/`).

**`.well-known/workflow/`:**
- Purpose: compiled workflow manifest + step/flow bundles produced from `workflows/mensal.ts`.
- Generated: yes (build/dev-time output of the `workflow` Vite plugin).
- Committed: no (`.gitignore`: `.well-known/`).

**`.vercel/`:**
- Purpose: Vercel CLI's local project-link cache.
- Generated: yes.
- Committed: no.

**`auth-backend/db/migrations/`:**
- Purpose: versioned schema history for the `pi` Postgres schema.
- Generated: no (hand-written).
- Committed: yes — this is the schema's source of truth, not `docs/schema.sql` (which is a snapshot).

**`scripts/` (root):**
- Purpose: n8n workflow patch/deploy tooling used during the ongoing migration.
- Generated: no (hand-written, but treated as disposable/local-only).
- Committed: no (`.gitignore`: `scripts/`, plus several more specific n8n-dump patterns).

---

*Structure analysis: 2026-07-28*
