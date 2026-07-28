# External Integrations

**Analysis Date:** 2026-07-28

## Architectural context — why some integrations exist twice

The repo is mid-migration off n8n ("Plano de Fuga", see `02-PLANO-DE-FUGA.md`). The **target** architecture treats Postgres (schema `pi`) as the source of truth and Monday as a read-only view for DP staff, with `auth-backend` calling every external system directly. Today, most processes still run through n8n, and the backend has a **parallel, path-compatible implementation** of the same processes (e.g. n8n webhook `/webhook/intermitente-ler` mirrored by backend route `/api/intermitente-ler`). Routing between the two is controlled per-process by the `pi.rotas_processo` table (`n8n` | `auto` | `api`), read by the frontend through `chamarProcesso()` in `src/lib/http.ts`, and administered via `GET/PATCH /api/rotas` (`auth-backend/src/routes/rotas.ts`). This explains why several integrations below are described from **two call sites** (n8n workflow AND backend route).

## APIs & External Services

**Workflow orchestration — n8n Cloud (two hosts):**
- **New host** — `https://aionscorp-n8n.cloudfy.live/webhook` (env `VITE_N8N_BASE_URL`, frontend build-time; backend mirrors as `config.n8nWebhookBase`/`N8N_WEBHOOK_BASE` and `config.n8nWebhookAtivar`/`N8N_WEBHOOK_ATIVAR`, default webhook path `.../webhook/Intermitentehaha`). Hosts the workflows for read (`intermitente-ler`), finalize (`intermitente-finalizar`), cancel, split, atestados, descontos, ponto facultativo, feriados.
- **Old host** — `https://antigoaionscorp-n8n.cloudfy.live/webhook` (env `VITE_N8N_ANTIGO_BASE_URL`). RM-dependent workflows that have not migrated: convocar (WF7), employee search via `BEN 2` (WF8), "sábados extras" boleto, cancel-convocação legacy path.
- Frontend fallback rule (`.env.example` comment + `src/lib/http.ts`): if `VITE_N8N_ANTIGO_BASE_URL` is unset, calls fall back to `VITE_N8N_BASE_URL`.
- Frontend dispatch: `chamarProcesso(processo, path, init, {tipo})` in `src/lib/http.ts` — resolves a per-process mode from `/api/rotas` (cached 60 s, persisted to `localStorage["pi_rotas"]`), then calls either `${N8N_BASE}/${path}` or `/api/${path}`. Reads in `auto` mode fail over to `/api` on timeout (8 s)/5xx/404; writes fail over only on 404 (proof the webhook is gone, not just slow).
- **Not referenced by this repo, but VERIFIED live on 2026-07-28**: the Postgres cluster addressed by `DATABASE_URL` also hosts schema `nocturnalgoose` — the n8n installation's own storage. Confirmed by direct SQL against production: `nocturnalgoose.execution_entity` (10,141 rows; columns `id`, `workflowId`, `status`, `startedAt`, `stoppedAt`, `mode`), `nocturnalgoose.execution_data` (the `data` column is serialized with **`flatted`**, not plain JSON — use `flatted.parse`; it holds `resultData.runData` per node, `lastNodeExecuted`, `resultData.error`) and `nocturnalgoose.workflow_entity` (519 workflows, with `nodes` + `connections`). This makes n8n execution logs and workflow definitions readable by SQL with no n8n API key — the fastest path for incident forensics. Execution retention is short (~6 days). No code, migration, or connection string in this repo targets the schema: it is operational access, not a code dependency.

**Workflow orchestration — Vercel Workflow SDK (durable, in-process):**
- Package `workflow` (`^4.6.0`) + Vite plugin, used for the "Mensal" (monthly payroll) run only. Definition: `workflows/mensal.ts` (12 business steps × ~19 durable steps per contract: validação → Caju → RM → Monday → Solicitação → Drive, run in series per contract).
- Started from `auth-backend/src/routes/mensalOrquestracao.ts` via `start(executarMensalWorkflowClient, [...])` (import from `"workflow/api"`); the actual workflow ID is `workflow//./workflows/mensal//executarMensalWorkflow` (`auth-backend/src/mensal/workflowClient.ts`).
- Triple-gated: `MENSAL_WORKFLOW_ENABLED=0` blocks any start; `MENSAL_MODO=homologacao` simulates all external effects; `MENSAL_PRODUCTION_ENABLED=0` is a second gate before any real money moves. All three are `0`/`homologacao` by default (see `docs/mensal-duravel.md`).
- n8n is explicitly **not called** by this workflow — it remains only as a documented contingency path during the migration.

**Monday.com API v2 (GraphQL + REST file upload) — primary system-of-record view:**
- GraphQL endpoint `https://api.monday.com/v2`; file upload endpoint `https://api.monday.com/v2/file` (multipart, used for `add_file_to_column`).
- Two parallel client wrappers in `auth-backend/src/`:
  - `monday.ts` (root of `src/`) — lighter helper (`mondayGraphql`, `lerColunas`, `criarWebhook`, `listarWebhooks`, `changeColumnValues`, `createItem`, `lerItem`), used by `routes/boards.ts`, `routes/gatilhos.ts`, `routes/atestados.ts`, `routes/descontos.ts`, `routes/intermitente.ts`, `routes/feriados.ts`, `services/driveArquivar.ts`.
  - `clients/monday.ts` — newer typed client (`gql`, `lerItens` cursor-paginated, `lerPorColuna`, `mudarColunas`, `criarItem`, `deletarItem`, `moverParaGrupo`, `anexarArquivo`), re-exports parsing helpers from `clients/monday.parse.ts`. Used by `repo/*.ts` (boardDescontos, feriados, valores, historico) and `routes/descontos.ts`, `routes/espelhoIntermitente.ts`, `routes/pontofac.ts`, `mensal/rmEfeitos.ts`-adjacent modules.
- Auth: single token (cred name "Ray0" in n8n) via `MONDAY_TOKEN` env; header `Authorization: <token>` + `API-Version` header (default `2024-10`, `MONDAY_API_VERSION`).
- Human-facing links back into Monday are built with the workspace subdomain `https://contato-serv.monday.com/...` (e.g. `src/features/preencher/api.ts`, `src/features/atestados/api.ts`, `auth-backend/src/routes/gatilhos.ts`, `auth-backend/src/mensal/mondayEfeitos.ts`) — separate from the API host.
- **Board registry (Postgres-backed, not hardcoded IDs)**: `pi.boards` / `pi.board_colunas` / `pi.board_grupos` (migration `005_boards.sql`) resolve a board's `monday_board_id` by **role** (`atual`/`proximo`/`passado`) or **competência** (`YYYY-MM`), and column IDs by stable **column title** rather than Monday's per-copy column IDs. This is what makes the monthly "board rollover" (Entrada board is recreated/copied each competência) transparent to the rest of the code. Managed via `auth-backend/src/routes/boards.ts`: `POST /api/boards/registrar`, `POST /api/boards/virada` (month rollover — demotes the current `atual` to `passado`, promotes the incoming copy/central pair), `GET /api/boards/resolver`, `POST /api/boards/garantir-webhook` (idempotently creates the Monday→n8n webhook subscription on a board's `ativar` column).
- **Fixed-ID boards** (not subject to rollover, referenced directly by string/number literal in code):
  | Board | ID | Referenced in |
  |---|---|---|
  | Histórico (Ocorrências) | `18411141462` | `auth-backend/src/repo/historico.ts`, `routes/gatilhos.ts`, `routes/finalizar.ts`, `routes/intermitente.ts` |
  | Controle de Atestados | `18298015951` | `auth-backend/src/routes/atestados.ts`, `services/driveArquivar.ts` |
  | Base de Desconto (ledger FIFO) | `18400981023` | `auth-backend/src/routes/descontos.ts`, `routes/finalizar.ts`, `repo/boardDescontos.ts`, `mensal/mondayEfeitos.ts`, `mensal/previa.ts` |
  | Solicitação de Pagamento | `18393673859` | `auth-backend/src/services/driveArquivar.ts`, `mensal/mondayEfeitos.ts`, `mensal/previa.ts` |
  | Valores de Benefícios (VR/VT params) | `18413870370` | `auth-backend/src/repo/valores.ts`, `routes/finalizar.ts`, `mensal/previa.ts`, `calculoBeneficios.ts` |
  | Feriados | `18415442661` | `auth-backend/src/repo/feriados.ts`, `routes/feriados.ts`, `mensal/previa.ts` |
  | Controle Saldo Caju | `7833600425` | `auth-backend/src/mensal/mondayEfeitos.ts`, `mensal/previa.ts` |
  | Entrada (convocações) | *dynamic — resolved via registry by role/competência*, not a fixed literal | `routes/boards.ts`, `routes/gatilhos.ts` |
- **Incoming webhook**: `POST /api/monday/ativar` (`auth-backend/src/routes/gatilhos.ts`) — receives Monday's column-change webhook directly (handles the `{challenge}` handshake Monday sends on subscription, then the real `{event:{boardId,pulseId,columnId,value}}` payload on the `ativar` column). This natively replicates n8n's "WF1 Preparar" inside the backend. A companion endpoint `POST /api/convocar/ativar` exists for a related trigger.
- **Known write-access gap** (documented in `docs/mensal-duravel.md`, not yet fixed): the `MONDAY_TOKEN` identity is only a *subscriber* (not member/owner) on the private "Controle Saldo Caju" board (`7833600425`), so `change_multiple_column_values`/`create_item`-with-columns return `403 UserUnauthorizedException` there. Other boards accept writes fine with the same token.

**RM TOTVS (ERP) — via the "ponte AIONS" HTTP bridge, never called directly:**
- Client: `auth-backend/src/clients/rm.ts`. Base URL `RM_BRIDGE_URL` (historically an ngrok tunnel, e.g. `*.ngrok-free.dev`), auth header `AIONS-AUTH` (`RM_AIONS_AUTH`).
- Endpoints on the bridge: `POST /consultar-rm` (SQL query passthrough — `consultarSql`/`consultarSqlBruto`, e.g. SQL name `"BEN 2"` for intermittent-worker search, `"231375"` for RM units-by-contract, `"2313"` for CLT employee search), `POST /enviar-rm` (`SaveRecord` write — `enviarRm`, body is a pre-built SOAP-shaped `dados_xml` string), `POST /executar-processo-rm` (`executarProcesso`), `POST /deletar-rm` (`deletarRm`), `GET /health`.
- Retries 3× with linear backoff (800 ms × attempt) on any failure, per-request (`post()` helper in `rm.ts`).
- Writes are explicitly called out in code comments as **GATED** — the client only executes the POST; the caller (`mensal/rmEfeitos.ts`, gated behind `MENSAL_PRODUCTION_ENABLED`) decides whether to actually invoke it, and records an idempotency key in `pi.efeitos_externos` first.
- SOAP body construction (RM's WCF-style API: `FopRotinasLancFinanceiroAction`, `ZMDHSTBENFUNC` history writes, `IDFNAN`/`IntegrarBackOffices`) lives in `auth-backend/src/mensal/rmEfeitos.ts` as hand-built XML template strings — no SOAP client library.
- Also consumed read-only via `auth-backend/src/routes/rmLookups.ts` (`GET /api/intermitente-unidades-rm` — SQL `231375`, contract→unit lookup; `GET /api/celetista-buscar-empregado` — SQL `2313`, CLT autocomplete) and `auth-backend/src/routes/rm.ts` (`GET /api/convocar-buscar-empregado` — SQL `BEN 2`, intermittent-worker autocomplete).

**Caju (employee benefits card — VR/VT credit and PIX debit):**
- Client: `auth-backend/src/clients/caju.ts`. Contract validated 1:1 against the legacy n8n "MENSAL FIFO" workflow per an in-code comment.
- Auth: OAuth2 **password grant** — `POST {CAJU_AUTH_URL}` with `client_id`/`client_secret`/`grant_type=password`/`username`/`password` (all env-configured, none hardcoded); access token cached in-memory per process instance with a 5 s expiry margin (`getToken()`); `resetTokenCaju()` clears the cache (called once per contract in the mensal workflow because Caju tokens expire quickly).
- API base: `CAJU_API_BASE`, default `https://services.caju.com.br/partners/v1`. Every request also sends `X-Sponsor-Id`/`X-Integration-Id` headers (`CAJU_SPONSOR_ID`/`CAJU_INTEGRATION_ID`).
- Endpoints: `GET /sponsor/{sponsorId}/employee?cpf=` (`buscarEmployeeId`, read-only), `POST /voucher/allowance_order` (`criarPedido` — **creates real financial order**), `POST /voucher/allowance_order/{id}` (`confirmarPedido` — **real money movement**, payment strategies `EXISTING_BALANCE` for VR credit or `PIX_CODE` for VT boleto/PIX), `GET /voucher/allowance_order/{id}` (`buscarPedido`, polling for boleto/QR — async on Caju's side, so **always polled from a cron job/step, never awaited inline in a request**).
- Human summary link: `https://empresa.caju.com.br/classic/#/order/{orderId}/summary`.
- Categories: `FOOD_AID` for VR; VT category depends on contract — `TRANSPORTATION` (mobility) for `SEDUC INTERIOR`/`TRE PB`/`CETAM` or when `interior=SIM`, else `TRANSPORTATION_VOUCHER` (standard voucher).
- Deliberately **never automated**: credit-order confirmation is documented (both in `caju.ts` header comment and `docs/mensal-duravel.md`) as intentionally left unconfirmed, mirroring a node that stays disabled in the n8n workflow too — a manual/human step in the real payment flow.
- All create/confirm calls are gated by the `pi.efeitos_externos` idempotency ledger to prevent duplicate PIX/credit on retry.

**Google — two independent integrations sharing one library (`google-auth-library ^9.15.1`):**
- **SSO login** — `auth-backend/src/oauth.ts`, `OAuth2Client` (confidential client). Domain-restricted to `AUTH_ALLOWED_DOMAIN` (default `contatoserv.com.br`) both as an account-picker hint (`hd` param) and as a hard server-side check on the verified ID token's email domain after code exchange. Flow: `GET /auth/google/login` (redirects to Google consent) → `GET /auth/google/callback` (exchanges code, verifies ID token, upserts `pi.users`, creates a `pi.sessions` row, sets the `pi_sess` cookie, returns a tiny HTML page that closes the popup / notifies the opener via `localStorage`+`postMessage`).
- **Google Drive** — `auth-backend/src/clients/drive.ts`, REST v3 (`https://www.googleapis.com/drive/v3`, uploads via `https://www.googleapis.com/upload/drive/v3`). Two auth paths, user-OAuth preferred when configured: (1) `GOOGLE_DRIVE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` refresh-token flow against `https://oauth2.googleapis.com/token` — acts as a real user, needed for Shared Drive folders where a service account can't be added as a member; (2) fallback to a service-account JWT (`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` or `..._BASE64`), scope `https://www.googleapis.com/auth/drive`. Used for convocation folder trees, Caju boleto/comprovante/QR archival (`CAJU/BOLETOS`, `CAJU/COMPROVANTES`), and monthly conference spreadsheets.
- **Known access gap** (per `docs/mensal-duravel.md`): the Drive service account had only read access on the Shared Drive "BENEFÍCIOS 01" — needs "Colaborador de conteúdo" to write.

**Nexti (absence/atestado validation) — integration lives entirely in n8n, not in this backend:**
- No `clients/nexti.ts` exists yet. The only trace in `auth-backend` is a reserved-but-unused config value `nextiBasicAuth` (`config.ts`, env `NEXTI_BASIC_AUTH`) and a code comment in `routes/atestados.ts` noting that financial impact of an atestado is "a separate flow, Monday-triggered" via Nexti.
- Actual flow (n8n only, per `CLAUDE.md`): a Monday Automation on the Controle de Atestados board fires when `Validação de documento = VALIDADO`, calling n8n webhook `POST /nexti-validar-atestado`, which checks Nexti absences by CPF and decides `sem_desconto`/`com_desconto`/`sem_absences_nexti`/`ignorar`/`erro`.

## Data Storage

**Databases:**
- **Postgres** (single shared cluster, "Cloudfy") — connection via `DATABASE_URL`, driver `pg` (`Pool`), optional `DB_SSL=1` (`{ rejectUnauthorized: false }`). All application tables live in schema **`pi`**; `pool.on("connect", ...)` sets `search_path TO pi, public` per connection because the cluster is shared with unrelated systems (code comment: "o banco cloudfy é COMPARTILHADO ... pode ter outra tabela `users`").
  - Auth/RBAC: `pi.users`, `pi.sessions`, `pi.service_tokens`, `pi.audit_lancamentos` (prepared, not yet the primary audit path) — `db/migrations/001_init.sql`, `002_perfil.sql`, `003_senha.sql`, `004_atividade.sql`.
  - Monday board registry: `pi.boards`, `pi.board_colunas`, `pi.board_grupos` — `005_boards.sql`, `006_board_grupos.sql`.
  - Business core: `pi.convocacoes` (mirrors the Monday "Histórico" board — chapa, contrato, `ledger_beneficios` jsonb, `respostas` jsonb, `atestados` jsonb, `split` jsonb, aggregates) — `008_convocacoes.sql`; `pi.descontos` (VR/VT ledger) — `011_descontos.sql`.
  - Job queue + idempotency: `pi.jobs`, `pi.efeitos_externos` (the idempotency table gating every Caju/RM write — natural key like `caju:pedido:<uuid>:<comp>` or `rm:lanc:<chapa>:<evento>:<comp>`) — `012_jobs.sql`.
  - Contingency routing: `pi.rotas_processo` (per-process `n8n`/`auto`/`api` switch, seeded with a `'*'` global kill-switch row) — `013_rotas_processo.sql`.
  - Durable "mensal" run state: `pi.mensal_run`, `pi.mensal_run_item`, `pi.mensal_run_event` — `007_mensal_run.sql`, extended by `014_mensal_duravel.sql` (adds `modo`, `etapa_atual`, `snapshot` jsonb, `workflow_run_id`, approval/cancellation audit fields).
  - Postgres advisory lock used to prevent concurrent global "mensal" runs (per `docs/mensal-duravel.md`).
- **Not referenced by this repo, but VERIFIED live on 2026-07-28**: the same Postgres cluster hosts the `nocturnalgoose` schema belonging to the n8n installation itself (`execution_entity`, `execution_data`, `workflow_entity`), reachable by direct SQL with no n8n API key. See the n8n section above for the verified table/column details and the `flatted` serialization caveat. Operational access only — no code, migration, or connection string in this repo targets it. The cluster is shared with unrelated applications (schemas `epi`, `folhas_manuais`, and a large `public`), so scope every query by schema.

**File Storage:**
- Google Drive (see Integrations above) — primary destination for generated/archived files: convocation folders (year/month/contract/person/period), Caju boletos/comprovantes/QR codes, monthly conference spreadsheets (hand-built XLSX, `clients/xlsx.ts`).
- Monday `file`-type columns also store originals directly on items (atestado uploads via `add_file_to_column`, "Termo de Convocação"/"Termo de Insalubridade" uploads) — a second, Monday-native file store used in parallel with Drive.

**Caching:**
- No server-side cache (no Redis/Memcached). The only "cache" on the backend is the in-memory OAuth/Drive access-token cache (module-level variables in `clients/caju.ts` and `clients/drive.ts`) and the routing-mode lookup cache in `src/lib/http.ts` (60 s in-memory + `localStorage["pi_rotas"]` persisted fallback).
- Frontend: `@tanstack/react-query` in-memory cache is the primary client-side cache (per-hook `staleTime`); `localStorage` also used for theme/accent/font preferences (`pi-theme`, `pi-accent`, ...) and protocol history — unrelated to server caching.

## Authentication & Identity

**Auth Provider:**
- Google Workspace SSO (OAuth2 Authorization Code, confidential client), domain-restricted to `AUTH_ALLOWED_DOMAIN`. No password-based login for normal users (a `senha.ts`/`senha_hash` path exists in the schema but is a secondary/legacy mechanism alongside SSO, gated by its own routes in `routes/auth.ts`: `/auth/login`, `/auth/mudar-senha`).
- Session: opaque random UUID stored in `pi.sessions`, sent to the browser only as the cookie value (`pi_sess`, httpOnly, `sameSite=lax`, `secure` gated by `COOKIE_SECURE`, `maxAge` = `SESSION_TTL_DIAS` days, default 10). Server-side revocation is immediate (delete the session row) — used when an Admin deactivates an account.
- Roles: Postgres enum `pi.papel` = `admin > dp > rh/operacional`. First login into an allowed domain self-provisions as `operacional`; DP/Admin can only be pre-seeded (`SEED_ADMIN_EMAIL`) or promoted later by an Admin (`PATCH /api/usuarios/:id`). Onboarding (`POST /auth/completar-cadastro`) fills name/surname/CPF (CPF validated + unique) and lets the user pick RH vs Operacional (DP/Admin cannot self-select).
- Dev-only bypass: `AUTH_DEV_BYPASS=1` enables `GET/POST /auth/dev-login?email=&papel=` to skip the Google flow entirely — must never be `1` in production (enforced only by convention/documentation, not by code).

**Service-to-service auth (n8n/automation calling the backend without a user session):**
- Bearer token against `pi.service_tokens` (revocable via `ativo=false`, optional `expira_em`), checked in `usuarioDaAutorizacao()` (`auth-backend/src/session.ts`) as a fallback when there's no session cookie.
- Separate static-secret mechanisms for specific automation entry points: `SERVICE_TOKEN` + header `X-Service-Token` for board-registry admin endpoints (`/api/boards/registrar`, `/api/boards/virada`), and `CRON_SECRET` + `Authorization: Bearer <secret>` for the jobs tick and mensal-retention cron endpoints.

## Monitoring & Observability

**Error Tracking:**
- None detected — no Sentry/Bugsnag/Rollbar or similar dependency anywhere in either `package.json`.

**Logs:**
- Backend: Fastify's built-in logger (`Fastify({ logger: true })` in `construirApp()`) — structured JSON logs to stdout, captured by Vercel's platform log viewer in production.
- Frontend: `console.warn` only for the contingency-routing failover signal (`[fuga] leitura/escrita '<processo>' caiu pro backend`, `src/lib/http.ts`) — no structured client-side logging/telemetry pipeline.
- Durable workflow: the `workflow` SDK writes its own local dev-time run/step/event log to `.workflow-data/` (gitignored) and a compiled manifest to `.well-known/workflow/v1/` (gitignored) — this is the SDK's own observability surface for the "mensal" workflow, not a general APM.

## CI/CD & Deployment

**Hosting:**
- Vercel — project `plan-intermitente-ocorrencia` (`.vercel/project.json`: `orgId: team_IJnHAWKGZetuBuFs7mJ7AJdd`). Production URL: `https://plan-intermitente-ocorrencia.vercel.app`.
- `vercel.json`: `buildCommand: npm run vercel-build`; rewrites `/auth/:path*` and `/api/:path*` → `/api` (the single serverless function from `api/index.ts`); everything else (excluding `assets/` and `.well-known/`) → `/index.html` (SPA fallback).
- The serverless function reuses one Fastify app instance across warm invocations (`appPromise` module-level cache in `api/index.ts`) to avoid re-opening the Postgres pool on every request.

**CI Pipeline:**
- None — no `.github/workflows` directory. Deploys are manual (`vercel deploy` / `vercel deploy --prod`) or via Vercel's native GitHub push integration; no automated test/lint gate runs before deploy inside this repo.

**Cron (Vercel Cron):**
- **Active** (declared in `vercel.json`): `GET /api/mensal/manutencao/retencao` — schedule `17 3 1 * *` (03:17 on the 1st of each month). Purges "mensal" run history/ledger older than 24 months (`limparHistoricoMensal()`), protected by `CRON_SECRET`.
- **Documented but not wired up** (`auth-backend/vercel.crons.example.json`, explicitly marked as a template — its comment says not to create a root `vercel.json` from it, since the real one already exists): `POST /api/jobs/tick` every minute, plus a daily `POST /api/jobs/tick?tipo=expiracao` — these would drive `auth-backend/src/jobs/runner.ts` (expires stale "Aguardando" convocações; other job types — `pontual`, `mensal`, `virada`, `caju_poll` — are currently stubbed to immediately fail with "handler gated" until idempotent implementations are wired in). Until this cron is added to `vercel.json`, `/api/jobs/tick` must be triggered manually or by an external scheduler.

**Legacy deployment (deactivated, historical only):**
- `docker-compose.yml` + `Dockerfile` (frontend, multi-stage `node:20-alpine` build → `nginx:alpine` runtime) + `auth-backend/Dockerfile` (backend, multi-stage build, runs migrations+seed on container start) + `docker/nginx.conf` (SPA fallback, proxies `/auth/*` and `/api/*` to the `auth` container). Targeted an intranet VM at `192.168.0.41:8081`. `DEPLOY.md` opens with an explicit "DESCONTINUADO" banner; CLAUDE.md confirms the VM was deactivated. Not part of the live deployment path.

## Environment Configuration

**Frontend (`VITE_*`, baked at build time — root `.env`):**
- `VITE_N8N_BASE_URL`, `VITE_N8N_ANTIGO_BASE_URL` — empty means "mock mode" (`mock-*` UUIDs / `PROT-DEMO-*`/`PROT-TEST-*` protocols resolve locally with no network call).

**Backend (runtime — `auth-backend/.env` locally, Vercel project env vars in deployment):**
- Core: `PORT`, `DATABASE_URL`, `DB_SSL`
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `APP_BASE_URL`, `AUTH_ALLOWED_DOMAIN`
- Session: `SESSION_COOKIE_NAME`, `SESSION_TTL_DIAS`, `COOKIE_SECURE`
- Bootstrap/dev: `SEED_ADMIN_EMAIL`, `AUTH_DEV_BYPASS`
- Monday: `MONDAY_TOKEN`, `MONDAY_API_VERSION`, (`MONDAY_API_URL` has a hardcoded-default fallback in `config.ts`)
- RM bridge: `RM_BRIDGE_URL`, `RM_AIONS_AUTH`, `RM_DATA_SERVER`
- Nexti (reserved, unused): `NEXTI_BASIC_AUTH`
- Google Drive: `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`, `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN`
- Caju: `CAJU_AUTH_URL`, `CAJU_API_BASE`, `CAJU_CLIENT_ID`, `CAJU_CLIENT_SECRET`, `CAJU_GRANT_TYPE`, `CAJU_USERNAME`, `CAJU_PASSWORD`, `CAJU_SPONSOR_ID`, `CAJU_INTEGRATION_ID`
- Contingency/routing: `N8N_WEBHOOK_ATIVAR`, `N8N_WEBHOOK_BASE`, `PUBLIC_BASE_URL`, `SERVICE_TOKEN`
- Cron: `CRON_SECRET`
- "Mensal durável" feature flags: `MENSAL_WORKFLOW_ENABLED`, `MENSAL_MODO`, `MENSAL_PRODUCTION_ENABLED`, `MENSAL_TEST_BYPASS_ANTIFRAUDE` (all default to the safest/off setting)

**Secrets location:**
- Local: `.env` (root) and `auth-backend/.env`, both git-ignored (`.gitignore` excludes `.env`, `.env.local`, `.env.*.local`).
- Deployment: Vercel project environment variables (separate Preview/Production values noted in `docs/mensal-duravel.md`, e.g. `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64` present in both, `RM_BRIDGE_URL`/`RM_AIONS_AUTH` present only in Production as of that doc).
- `.gitignore` also excludes an entire class of n8n workflow export/patch files (`scripts/`, `wf_*.json`, `*.backup*.json`, etc.) specifically because historical versions embedded live Monday/RM/Caju tokens inline — a reminder that any new workflow export must not be committed verbatim.

## Webhooks & Callbacks

**Incoming:**
- `POST /api/monday/ativar` (`auth-backend/src/routes/gatilhos.ts`) — Monday column-change webhook on the Entrada board's `ativar` column. Handles Monday's `{challenge}` verification handshake and the real `{event}` payload; creates the "Histórico" record + protocol and returns the `/preencher/<uuid>` link. Native replacement for n8n's WF1.
- `POST /api/convocar/ativar` (same file) — companion trigger for the convocar flow.
- `GET /auth/google/callback` — OAuth2 redirect callback from Google (see Authentication above).
- `POST /api/jobs/tick` — cron-invoked (see CI/CD above), not a third-party webhook but callback-shaped and secret-gated the same way.
- External, not present in this repo: Monday Automation → n8n `POST /nexti-validar-atestado` (Nexti absence validation trigger — lives only in the n8n workflow definition).

**Outgoing:**
- Monday webhook subscription registration: `criarWebhook(boardId, config.n8nWebhookAtivar, columnId)` (`auth-backend/src/monday.ts`, invoked from `POST /api/boards/garantir-webhook`) — this is the backend **registering itself/n8n** as a listener on a Monday board's column, i.e. Monday will call back to `N8N_WEBHOOK_ATIVAR` (or, once cut over, to `/api/monday/ativar`) whenever that column changes.
- Frontend → n8n: roughly 20 distinct webhook paths called directly from `src/features/*/api.ts` via `chamarProcesso()` (e.g. `intermitente-ler`, `intermitente-finalizar`, `intermitente-cancelar-convocacao`, `intermitente-aplicar-split`, `intermitente-lancar-documentos`, `intermitente-convocacoes-empregado`, `intermitente-buscar-protocolo`, `convocar-buscar-empregado`, `intermitente-convocar`, `intermitente-convocar-opcoes`, `ponto-facultativo-opcoes/preview/aplicar`, `intermitente-unidades-rm`, `celetista-buscar-empregado`, `sabados-extras-boleto`, `descontos-ler`/`descontos-registrar-manual`). Each has a **path-identical** mirror under `/api/*` on the backend (see the architectural note at the top of this document), so the "outgoing webhook" today is really a dual-target call whose destination is decided per-process at runtime.

---

*Integration audit: 2026-07-28*
