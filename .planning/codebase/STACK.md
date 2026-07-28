# Technology Stack

**Analysis Date:** 2026-07-28

This repo contains **two separate Node/TypeScript projects deployed as one Vercel project**:

- **Frontend SPA** — root of the repo (`src/`, `package.json`, `vite.config.ts`).
- **Auth/orchestration backend** — `auth-backend/` (own `package.json`, own `tsconfig.json`), a Fastify app compiled to `auth-backend/dist/` and wrapped by `api/index.ts` as a single Vercel serverless function.

The root `package.json` duplicates several backend runtime deps (`fastify`, `pg`, `google-auth-library`, `@fastify/cookie`, `@fastify/multipart`) — not dead weight: Vercel installs deps from the **root** `package.json` and the serverless function's bundler resolves `auth-backend/dist/app.js`'s imports from there (see comment in `api/index.ts`).

## Languages

**Primary:**
- TypeScript (strict) — frontend (`src/`), target `es2023`, see `tsconfig.app.json`
- TypeScript (strict) — backend (`auth-backend/src/`), target `ES2022`/`NodeNext`, see `auth-backend/tsconfig.json`

**Note — two different TypeScript majors in the same repo:**
- Root `devDependencies`: `"typescript": "~6.0.2"` (frontend build, `tsc -b`)
- `auth-backend/devDependencies`: `"typescript": "^5.7.3"` (backend build, `tsc -p tsconfig.json`)
- Each project has its own `node_modules`/lockfile, so this is not a conflict today, but any code shared directly between them (e.g. `workflows/mensal.ts` imports straight from `../auth-backend/src/...`, compiled by the **root** toolchain via the `workflow`/`nitro` Vite plugins) is type-checked against the frontend's TS 6, not backend's TS 5.7.

**Secondary:**
- SQL — Postgres migrations, `auth-backend/db/migrations/*.sql` (14 files, plain SQL, hand-numbered, idempotent `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE ADD COLUMN IF NOT EXISTS`)
- XML (hand-built SOAP payloads) — `auth-backend/src/mensal/rmEfeitos.ts` constructs RM TOTVS `SaveRecord`/`FopRotinas` SOAP envelopes (WCF-style namespaces `www.totvs.com`, `schemas.microsoft.com`) as template strings; no SOAP client library
- OOXML (hand-built XLSX) — `auth-backend/src/clients/xlsx.ts` writes the `.xlsx` sheet XML directly (no `xlsx`/`exceljs` dependency)

## Runtime

**Environment:**
- Node.js — Dockerfiles pin `node:20-alpine` (`Dockerfile`, `auth-backend/Dockerfile`); no `.nvmrc` and no `engines` field in either `package.json`, so the pin only applies to the (deactivated) Docker path. Vercel serverless uses its project-level Node runtime setting (not version-pinned in this repo).
- Local dev environment observed: Node v24.14.0 / npm 11.9.0 (not enforced by config — informational only).

**Package Manager:**
- npm for both projects — `package-lock.json` present at repo root **and** inside `auth-backend/` (two independent lockfiles/installs)
- No yarn/pnpm lockfiles anywhere in the repo

## Frameworks

**Frontend core:**
- Vite 8 (`^8.0.9`) + `@vitejs/plugin-react` (`^6.0.1`) — dev server on fixed port `5174` (`strictPort: true`, required because Google OAuth's redirect URI is pinned to it), see `vite.config.ts`
- React 19 (`^19.2.5`) + `react-dom` (`^19.2.5`)
- React Router DOM v7 (`^7.14.2`)
- Tailwind CSS v4 (`^4.2.4`) via `@tailwindcss/vite` plugin (no `tailwind.config.js` — v4 CSS-first config lives in `src/index.css`/`src/liquid-glass-v2.css`)
- shadcn/ui, `"new-york"` style, `neutral` base color (`components.json`), built on the unified `radix-ui` package (`^1.4.3`) — Dialog, Card, Button, Input, Label, Separator, Select, combobox
- `react-day-picker` (`^9.14.0`) for calendar UI

**Backend core:**
- Fastify 5 (`^5.2.1`) — `auth-backend/src/app.ts` `construirApp()` builds the app (no `.listen()`; reused across both `auth-backend/src/server.ts` for local/legacy Docker and `api/index.ts` for Vercel serverless)
- `@fastify/cookie` (`^11.0.2`) — session cookie (`pi_sess`)
- `@fastify/multipart` (`^9.4.0`) — file uploads, 15 MB limit (`limits: { fileSize: 15 * 1024 * 1024 }`)

**Durable orchestration (monthly payroll):**
- `workflow` (`^4.6.0`, package name `workflow`, published by `vercel/workflow`) — "Workflow SDK - Build durable, resilient, and observable workflows." Drives `workflows/mensal.ts`: 12 business steps × ~19 durable steps per contract, using `"use step"` function bodies, `getStepMetadata()`, `sleep()`, and `start()` (from `workflow/api`) to kick off runs from `auth-backend/src/routes/mensalOrquestracao.ts`.
- `nitro` (`^3.0.260610-beta`, nitro.build) — used only as a Vite plugin (`nitro/vite`) to map `/api/**` and `/auth/**` to `api/index.ts` during `vite dev`/local build; production routing is actually handled by `vercel.json` rewrites + the Vercel Node function, not by a deployed Nitro server.
- Both are wired into `vite.config.ts` as plugins: `[nitro(), workflow(), react(), tailwindcss()]`.
- Build artifacts: `.well-known/workflow/v1/*` (compiled step/webhook manifests) and `.workflow-data/` (local run/step/event log, dev-only) — both gitignored.

**State/data fetching:**
- `@tanstack/react-query` (`^5.99.2`) — server-state cache on the frontend (`staleTime` tuned per hook; `0` on `/preencher`, 5 min on RM unit lookups, etc.)

**Build/Dev tooling:**
- ESLint 9 flat config (`eslint.config.js`) — `@eslint/js`, `typescript-eslint` (`^8.58.2`), `eslint-plugin-react-hooks` (`^7.1.1`), `eslint-plugin-react-refresh`; ignores `dist`, `.output`, `src.bak-fase3`, `scripts`, `.claude`, JSON files
- `tsc -b` (project references: `tsconfig.app.json` + `tsconfig.node.json`) for frontend typecheck; `tsc -p tsconfig.json` for backend
- `tsx` (`^4.19.2`, backend devDependency) — runs TS directly for `dev`/scripts/migrations without a separate build step

**Testing:**
- Backend: Node.js **built-in test runner** (`node:test`), invoked as `node --env-file=.env --import tsx --test src/**/*.test.ts` — no Jest/Vitest/Mocha dependency. ~14 `*.test.ts` files colocated with source across `domain/`, `clients/`, `mensal/`, `repo/`-adjacent modules.
- Frontend: **no test runner configured** — no test script, no `*.test.tsx` files, no Vitest/Jest/Testing Library dependency found.

## Key Dependencies

**Critical (backend runtime):**
- `fastify` (`^5.2.1`) — HTTP framework, single app instance shared between local server and Vercel function
- `pg` (`^8.13.1`) — Postgres driver (`Pool`), custom OID-1082 (`date`) type parser to avoid timezone-shift bugs, see `auth-backend/src/db.ts`
- `google-auth-library` (`^9.15.1`) — `OAuth2Client` for SSO login (`auth-backend/src/oauth.ts`) **and** `JWT` service-account client for Google Drive (`auth-backend/src/clients/drive.ts`) — two distinct uses of the same package

**Critical (frontend runtime):**
- `react` / `react-dom` (`19.2.5`) — no other UI framework
- `@tanstack/react-query` (`5.99.2`) — all server-state; no Redux/Zustand/Context-based data cache
- `date-fns` (`^4.1.0`) + `date-fns/locale/pt-BR` — all date formatting/parsing; no `moment`/`dayjs`
- `radix-ui` (`^1.4.3`) unified package — primitive components behind shadcn/ui wrappers in `src/components/ui/`

**Infrastructure/utility:**
- `class-variance-authority` (`^0.7.1`), `clsx` (`^2.1.1`), `tailwind-merge` (`^3.5.0`) — shadcn/ui variant + className plumbing (`src/lib/utils.ts`)
- `tw-animate-css` (`^1.4.0`) — Tailwind animation utilities
- `lucide-react` (`^1.8.0`) — icon set (note: major version 1.x, not the more commonly seen 0.x line)
- `rollup` (`^4.62.2`) — explicit direct dependency (peer requirement of `nitro`/`workflow`'s Vite integration), not invoked directly by app code

**Deliberately avoided (documented in CLAUDE.md):**
- No holiday-calculation library (`date-holidays` was evaluated and rejected — 1.9 MB — replaced by an ~7 KB hand-rolled implementation, `src/lib/feriadosBr.ts`, using the Meeus/Jones/Butcher algorithm for Easter-based holidays)
- No XLSX-writing library — `auth-backend/src/clients/xlsx.ts` emits raw OOXML
- `@supabase/supabase-js` has been removed (was previously listed as an unused/dead dependency; not present in the current `package.json`)

## Configuration

**Environment (two independent tiers — do not confuse):**
- **Frontend `VITE_*` vars** — read at **build time** by Vite and baked into the JS bundle. Defined in root `.env`/`.env.example`. Only two vars: `VITE_N8N_BASE_URL`, `VITE_N8N_ANTIGO_BASE_URL`. Changing them requires a rebuild (`docker compose up -d --build` in the legacy path, or a new Vercel deploy).
- **Backend runtime vars** — read at **runtime** by Fastify (`auth-backend/src/config.ts`), never bundled into frontend JS. Defined in `auth-backend/.env`/`auth-backend/.env.example` locally, or as Vercel project environment variables (Preview/Production) in deployment. ~30 vars covering Postgres, Google OAuth, Monday, RM bridge, Caju, Google Drive, cron secret, and the "mensal durável" feature flags.
- Dev scripts load backend env via Node's native `--env-file=.env` flag (no `dotenv` dependency).

**Build:**
- `vite.config.ts` — plugins `[nitro(), workflow(), react(), tailwindcss()]`; path alias `@` → `./src`; dev proxy `/auth` and `/api` → `http://127.0.0.1:3000` (backend must run separately in dev); `build.minify: false` (deliberate — preserves `backdrop-filter`/SVG filter syntax used by the "liquid glass" UI, per code comment)
- `tsconfig.json` (root) — project references only, path alias `@/*` → `./src/*`
- `tsconfig.app.json` — `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, bundler module resolution, `verbatimModuleSyntax`
- `auth-backend/tsconfig.json` — `strict`, `NodeNext` module/resolution, `noImplicitOverride`, excludes `*.test.ts` and `scripts/_*.ts` from the compiled `dist/`
- `components.json` — shadcn/ui generator config (new-york/neutral/lucide)
- Root `vercel-build` script: `cd auth-backend && npm install && npm run build && cd .. && npm run build` — backend is compiled to `auth-backend/dist/` **before** the frontend Vite build runs

**Linting:**
- ESLint flat config, TypeScript-aware, React Hooks + React Refresh plugins; backend has no separate ESLint config (relies on `tsc --strict` only)

## Platform Requirements

**Development:**
- Node.js (no enforced minimum) + npm
- A reachable Postgres instance (`DATABASE_URL`) — dev typically points at the same shared Cloudfy Postgres used in production (schema `pi`); migrations are idempotent and safe to re-run
- Backend running locally on port `3000` for the Vite dev proxy to work (`npm run dev` in `auth-backend/`, separately from the frontend `npm run dev`)
- Google Cloud OAuth Client ID (Web application) with redirect URI matching the fixed dev port (`5174`)
- Optional: Docker Desktop, only needed for the deactivated legacy VM deployment path

**Production:**
- Vercel (serverless Node function + static hosting + Vercel Cron) — see INTEGRATIONS.md for deployment specifics
- Shared Postgres cluster (Cloudfy), schema `pi`, reachable from Vercel's serverless network
- No self-hosted server component required for the current deployment; the `docker-compose.yml`/`Dockerfile`/`docker/nginx.conf` path targeting an intranet VM (`192.168.0.41`) is explicitly deactivated (see `DEPLOY.md` banner) and kept only as historical reference

---

*Stack analysis: 2026-07-28*
