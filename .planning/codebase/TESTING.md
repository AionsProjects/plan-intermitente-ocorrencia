# Testing Patterns

**Analysis Date:** 2026-07-28

**Headline honesty check:** the frontend SPA (`src/`, 99 `.ts`/`.tsx` files) has **zero** automated tests and **no test runner installed**. All automated testing lives in `auth-backend/` (14 `.test.ts` files out of 84 total `.ts` files there), using Node's built-in test runner. This document describes what genuinely exists — not an aspirational setup.

## Test Framework

**Runner:**
- **Frontend: none.** `package.json` (root) has no `vitest`, `jest`, `@testing-library/*`, `playwright`, or `cypress` as a dependency, and no `test` script. `vite.config.ts` has no `test: {}` block either. `find src -iname "*.test.*" -o -iname "*.spec.*"` returns nothing. The only automated gates that touch `src/` are `npm run lint` (ESLint) and `npm run build` (`tsc -b && vite build`).
- **Backend: Node's built-in test runner (`node:test`)**, executed through `tsx` for on-the-fly TypeScript. No Vitest, Jest, Mocha, or AVA anywhere in the repo. No config file is needed or present — behavior is driven entirely by the `test` script in `auth-backend/package.json:9`:
  ```json
  "test": "node --env-file=.env --import tsx --test src/**/*.test.ts"
  ```
- **Assertion library:** `node:assert/strict`, used in every single test file (`import assert from "node:assert/strict"`), via `assert.equal`, `assert.deepEqual`, `assert.ok`. No Chai, no `expect()`-style library anywhere.

**Run commands:**
```bash
cd auth-backend

npm test
# Runs ALL 14 *.test.ts files via the glob above. Loads auth-backend/.env first.
# One of the 14 files performs real Postgres writes — see "Coverage" below before running
# this against any database you're not sure is safe to mutate.

node --import tsx --test src/domain/fifo.test.ts
# Runs a single pure-logic file directly. No .env loaded, so DATABASE_URL falls back to
# the file's own dummy stub and no network/DB call happens at all.

SERVICE_TOKEN=tok node --env-file=.env --import tsx --test src/routes/mensalRun.test.ts
# The one DB-backed integration file, run exactly as its own header comment documents
# (auth-backend/src/routes/mensalRun.test.ts:2). Needs a reachable DATABASE_URL with the
# pi.mensal_run / pi.mensal_run_item migrations already applied.
```
There is no watch-mode script and no coverage script configured in `auth-backend/package.json`.

## Test File Organization

**Location:** co-located with the module under test, same directory. There is no `__tests__/` or `test/` folder anywhere in the repo (verified by directory search in both stacks).

**Naming:** `<module>.test.ts` — identical basename to the file it tests, `.test.ts` suffix.

**All 14 test files that exist (100% under `auth-backend/src/`; frontend contributes 0):**
```
auth-backend/src/clients/caju.test.ts             -> caju.ts          (Caju payload building: allowance orders, PIX, categories)
auth-backend/src/clients/monday.test.ts           -> monday.parse.ts  (column-value PARSING helpers only — not the HTTP client in monday.ts)
auth-backend/src/domain/antifraude.test.ts        -> antifraude.ts    (convocação overlap/conflict detection)
auth-backend/src/domain/desconto.test.ts          -> desconto.ts      (discount calculation, duplicate-consumption guard)
auth-backend/src/domain/descontoDia.test.ts       -> descontoDia.ts
auth-backend/src/domain/feriado.test.ts           -> feriado.ts       (holiday rules per contrato)
auth-backend/src/domain/fifo.test.ts              -> fifo.ts          (FIFO debt settlement)
auth-backend/src/domain/ledgerBeneficios.test.ts  -> ledgerBeneficios.ts (VR/VT ledger reconstruction + cancellation math)
auth-backend/src/domain/mobilidade.test.ts        -> mobilidade.ts    (mobility vs. transport-voucher VT classification)
auth-backend/src/mensal/calculo.test.ts           -> calculo.ts       (monthly benefit calculation engine)
auth-backend/src/mensal/driveEfeitos.test.ts      -> driveEfeitos.ts  (Drive file-content generation for monthly close)
auth-backend/src/mensal/mondayEfeitos.test.ts     -> mondayEfeitos.ts (Monday column-value payload construction)
auth-backend/src/mensal/rmEfeitos.test.ts         -> rmEfeitos.ts     (RM TOTVS SOAP/XML envelope construction)
auth-backend/src/routes/mensalRun.test.ts         -> mensalRun.ts     (Fastify route — the ONLY integration test, needs a live DB)
```

**Structure:** flat. No subfolders, and grep-verified **zero** occurrences of `describe(`, `before(`, `after(`, `beforeEach(`, `afterEach(`, `.only(`, or `.skip(` anywhere in `auth-backend/src`. Every file is a plain top-to-bottom sequence of `test(name, fn)` calls.

## Test Structure

**Suite organization** — no `describe` nesting, just a flat list of `test()` calls in source order:
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { aplicarFifo, ordenarDividasFifo, type Divida } from "./fifo.js"

test("aplicarFifo: abate dívida mais antiga primeiro, sobra líquido", () => {
  const dividas: Divida[] = [
    { itemId: "1", dataInicio: "2026-04-01", residualVR: 30, residualVT: 0, descontadoVR: 0 },
    { itemId: "2", dataInicio: "2026-05-01", residualVR: 30, residualVT: 0, descontadoVR: 0 },
  ]
  const r = aplicarFifo(50, 0, dividas)
  assert.equal(r.liquidoVR, 0)
  assert.equal(r.totalAplicadoVR, 50)
  assert.equal(r.updates.length, 2)
  assert.equal(r.updates[0]!.novoStatus, "FINALIZADO")
})
```
(`auth-backend/src/domain/fifo.test.ts:15-24`)

**Test names are full Portuguese sentences naming the business rule under test AND the expected outcome** — never a bare "should work" or "test 1". Real examples from the suite:
- `"effectivePeriod: parcial trunca até cancelInicio-1"`
- `"reconstruirLedger: falta desconta VR+VT; atraso desconta VR proporcional"`
- `"aplicarCancelamento: sábado extra pago cobra VT de volta e não desconta VR"`
- `"regra VR Mensal vira valor-dia (mensal/30) x dias trabalhados — estilo pontual"`
- `"matching de função ignora preposições (EM vs DE)"`

New tests should follow this exact style: `"<função/cenário>: <regra de negócio> → <resultado>"`, in Portuguese, specific enough that the test name alone tells you what broke without opening the file.

**Setup/cleanup, only where test order matters:** `node:test`'s lifecycle hooks (`before`/`after`/`beforeEach`/`afterEach`) are never used. The one file with cross-test shared state (`routes/mensalRun.test.ts`, the sole integration test) fakes setup/teardown with plain, explicitly-named test cases instead, relying on `node:test`'s default in-file sequential execution:
```ts
test("setup", async () => { app = await construirApp(); await query("DELETE FROM mensal_run WHERE run_id=$1", [RUN]) })
// ...body tests read/mutate the same `RUN` row in order...
test("cleanup", async () => { await query("DELETE FROM mensal_run WHERE run_id=$1", [RUN]); await app!.close() })
```
(`auth-backend/src/routes/mensalRun.test.ts:16,110`). Every other test file is fully order-independent. **Do not add cross-test state dependencies to a pure domain/logic file** — if a new test genuinely needs shared setup, follow this "setup"/"cleanup" named-test-case pattern rather than introducing `before()`/`after()` (which would be the only file using them and thus inconsistent).

## Mocking

**There is effectively no mocking/stubbing/spying library in the codebase** — no `sinon`, no `jest.mock`/`vi.mock`, no `nock`/`msw` for HTTP interception. This works because nearly everything under test is a **pure function**: plain-object/string input in, plain-object/string output out, no network, filesystem, or timers involved.

**The two "mocking-adjacent" techniques that ARE used:**

1. **Env var stubbing, only to satisfy fail-fast config validation at import time — never to fake a real dependency.** Several tested modules transitively import `auth-backend/src/config.ts`, whose `req(nome)` helper throws synchronously if a required env var is absent. Test files that hit this import chain pre-set the minimum, using `??=` (not `=`) so a real `.env` value (if loaded) always wins:
   ```ts
   process.env.DATABASE_URL ??= "postgres://test"
   process.env.GOOGLE_CLIENT_ID ??= "test"
   process.env.GOOGLE_CLIENT_SECRET ??= "test"
   process.env.OAUTH_REDIRECT_URI ??= "http://localhost/cb"
   process.env.CAJU_SPONSOR_ID ??= "sponsor-test"   // caju.test.ts only — extra var it needs
   const { centsCaju, categoriaVT, montarNomePedido, montarPedidoCaju } = await import("./caju.js")
   ```
   (`auth-backend/src/clients/caju.test.ts:6-15`, same pattern in `driveEfeitos.test.ts`, `mondayEfeitos.test.ts`, `rmEfeitos.test.ts`). **None of these modules ever call `pool.query(...)`, so this never opens a real database connection** — the stubbed `DATABASE_URL` string is never dialed, it only satisfies `config.ts`'s validation so the module can be imported at all.
2. **Fastify's built-in `app.inject()`** for the one route-level test, instead of binding a real HTTP port:
   ```ts
   function post(path: string, body: unknown, tok = TOK) {
     return app!.inject({ method: "POST", url: path, headers: { "content-type": "application/json", ...(tok ? { "x-service-token": tok } : {}) }, payload: body })
   }
   ```
   (`auth-backend/src/routes/mensalRun.test.ts:12-14`)

**What to mock:** nothing, by default — the codebase's actual strategy is to **not need mocks** by keeping the interesting logic in pure, side-effect-free modules separate from the code that performs real I/O. `auth-backend/src/mensal/calculo.ts`, `driveEfeitos.ts`, `mondayEfeitos.ts`, and `rmEfeitos.ts` all exist specifically as "compute the values/payload/XML" modules, decoupled from the route/client code that actually calls Monday/RM/Drive/Caju over the network — this separation is *why* they're unit-testable at all.

**What NOT to mock / what's untestable as a result:** the real network calls — `auth-backend/src/clients/monday.ts`'s GraphQL requests, `clients/rm.ts`'s SOAP transport, `clients/drive.ts`'s Google Drive API calls, and Caju's actual HTTP OAuth + order endpoints — have **no test coverage at all**, mocked or otherwise. See "What is NOT tested" below for the full list.

## Fixtures and Factories

**Local factory functions, defined once per test file, immediately after the imports — never shared or exported across files.** A base object with sensible defaults, merged with a `Partial<T>` override via spread:
```ts
const pessoa = (extra: Partial<ConvocacaoMensal> = {}): ConvocacaoMensal => ({
  itemId: "1", nome: "Teste", chapa: "1", cpf: "1",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO", inicio: "2026-07-01", fim: "2026-07-10",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false, ...extra,
})
```
(`auth-backend/src/mensal/calculo.test.ts:5-7`) — the same shape is reused with different local names across files: `p()` in `clients/caju.test.ts:18-21`, a second, independent `pessoa()` in `mensal/rmEfeitos.test.ts:36-40`, closures like `item(e, a, d)` in `mensal/mondayEfeitos.test.ts:98-100` for row-shaped fixtures.

**Location:** inline at the top of each `.test.ts` file. There is no `fixtures/` directory and no shared builder module anywhere — if two test files both need "a pessoa" fixture, each defines its own local factory. Duplication across files is accepted in exchange for zero cross-file coupling; **do not** extract a shared fixture module as part of an unrelated change, that would break with the grain of the existing suite.

**Test dates:** anchored to real, deliberately-chosen 2026 calendar dates — either a "clean" work week with no holiday overlap (comment: `// Semana útil de referência: 2026-07-06 (seg) a 2026-07-11 (sáb). Sem feriados.`, `auth-backend/src/domain/ledgerBeneficios.test.ts:12`), or a date chosen specifically because it IS a holiday when that's the point of the test (`"2026-09-07"` for Independência, same file, line 23; `"2026-12-25"` for Christmas landing on a Friday, in the `diasUteis` tests run as part of `domain/desconto.test.ts`).

## Coverage

**No coverage tool is configured anywhere** — no `c8`, no `--experimental-test-coverage` flag on the `test` script, no `nyc`, no Istanbul, no threshold/gate in `package.json` or any CI config. Coverage is not measured as a percentage; it has to be reasoned about file-by-file, which is what the rest of this section does.

**Verified current pass state (2026-07-28, actually executed as part of this audit):** the 13 test files that don't touch a real database were run directly —
```bash
node --import tsx --test src/domain/*.test.ts src/mensal/calculo.test.ts src/mensal/driveEfeitos.test.ts \
  src/mensal/mondayEfeitos.test.ts src/mensal/rmEfeitos.test.ts src/clients/caju.test.ts src/clients/monday.test.ts
```
run **without** `--env-file=.env`, so `DATABASE_URL` fell back to each file's own dummy stub and no network/DB call was attempted anywhere. Result: **105/105 tests passing, 0 failures, 0 skipped.**

The 14th file, `routes/mensalRun.test.ts`, was **deliberately not executed** during this audit — it performs real `INSERT`/`UPDATE`/`DELETE` against a live Postgres (`pi.mensal_run` / `pi.mensal_run_item`) via whatever `DATABASE_URL` is configured in `auth-backend/.env`. Per this project's own notes, the underlying `cloudfy` Postgres instance is shared infrastructure, not a disposable test database — running this file is a deliberate, known action (per its own header comment), not something to trigger incidentally.

**What IS tested (13 files, 105 assertions, 100% pure business-logic, zero I/O):**
- Convocação overlap/conflict detection (`domain/antifraude.ts`)
- Discount calculation and duplicate-consumption prevention (`domain/desconto.ts`, `domain/descontoDia.ts`)
- Holiday rules per contrato (`domain/feriado.ts`)
- FIFO debt settlement (`domain/fifo.ts`)
- VR/VT ledger reconstruction, including cancellation dedupe math (`domain/ledgerBeneficios.ts`)
- Mobility vs. transport-voucher VT classification (`domain/mobilidade.ts`)
- The monthly ("mensal") benefit calculation engine, end-to-end (`mensal/calculo.ts`)
- Drive file-content generation for the monthly close (`mensal/driveEfeitos.ts`)
- Monday.com column-value payload construction for the monthly close (`mensal/mondayEfeitos.ts`)
- RM TOTVS SOAP/XML envelope construction (`mensal/rmEfeitos.ts`)
- Caju payload construction — allowance orders, PIX amounts, categories (`clients/caju.ts`)
- Monday column-value **parsing** helpers only (`clients/monday.parse.ts`, exercised via `monday.test.ts`)
- The monthly-run tracking route, `POST`/`GET /api/mensal/run/*`, as a live-DB Fastify integration test (`routes/mensalRun.ts`)

**What is explicitly NOT tested** (confirmed by file listing — every item below has zero corresponding `.test.ts`):
- **The entire frontend.** All 99 files under `src/` — every component, every `api.ts` (including the snake_case/camelCase tolerance mappers described in `CONVENTIONS.md` under "Data Boundary Convention", which is exactly the kind of logic a real production incident already proved worth testing), every hook, `src/lib/theme.ts`, `src/lib/cpf.ts`, and `src/lib/http.ts`'s contingency-routing/failover logic. There is no test infrastructure installed to write these into even if desired.
- **Security-critical backend modules:** `auth-backend/src/senha.ts` (scrypt password hashing + timing-safe comparison), `auth-backend/src/session.ts` (session cookie issuance/lookup), `auth-backend/src/oauth.ts` (Google OAuth code exchange). All three are small and would be straightforward to unit test; none have a test file.
- **`auth-backend/src/cpf.ts`** — CPF check-digit validation. Pure, deterministic, trivially testable, and has zero tests despite being hand-duplicated into `src/lib/cpf.ts` on the frontend (which is also untested). A regression in either copy would silently diverge from the other with no automated signal.
- **22 of 23 route files** under `auth-backend/src/routes/` (only `mensalRun.ts` has any test coverage): `auth.ts`, `convocar.ts`, `finalizar.ts`, `atestados.ts`, `descontos.ts`, `convocacoes.ts`, `boards.ts`, `usuarios.ts`, `gatilhos.ts`, `rm.ts`, `rmLookups.ts`, `drive.ts`, `pontofac.ts`, `mensal.ts`, `mensalOrquestracao.ts`, `espelhoIntermitente.ts`, `feriados.ts`, `atividade.ts`, `jobs.ts`, `rotas.ts`, `contingencia.ts` — none of their validation branches, status-code correctness, or auth-guard behavior is directly verified.
- **All of `auth-backend/src/repo/*.ts`** (`boardDescontos.ts`, `boards.ts`, `descontos.ts`, `feriados.ts`, `historico.ts`, `valores.ts`) — the Postgres/Monday data-access layer.
- **All of `auth-backend/src/scripts/*.ts`** (`migrate.ts`, `seed.ts`, `registrar-boards.ts`, `token-servico.ts`, `importar-convocacoes.ts`, `paridade-mensal.ts`) — one-off/ops scripts. `importar-convocacoes.ts` is also the one file in the whole repo with lint errors (`any` usage, see `CONVENTIONS.md`), reinforcing that this corner gets the least overall scrutiny.
- **The HTTP/SOAP clients themselves:** `auth-backend/src/clients/monday.ts` (only its `monday.parse.ts` helpers are tested, not the request/retry logic that actually talks to the Monday API), `clients/rm.ts` (SOAP transport), `clients/drive.ts` (Google Drive API), `clients/xlsx.ts`.
- `auth-backend/src/mensal/previa.ts`, `mensal/repo.ts`, `mensal/workflowClient.ts`, `services/driveArquivar.ts`, `jobs/repo.ts`, `jobs/runner.ts`, root-level `monday.ts` (distinct from `clients/monday.ts`), root-level `calculoBeneficios.ts` (appears to be an older/parallel implementation to `mensal/calculo.ts`).
- **Every n8n workflow** (~26 workflows per `CLAUDE.md`, e.g. WF3 Finalizar, WF5 Pontual FIFO, WF7 Convocar, WF8 Buscar Empregado RM). These run entirely outside this repository, in n8n Cloud, and have **no automated test coverage whatsoever** — no way to even write one from here. All correctness for the Monday.com / Caju / RM TOTVS / Google Drive integration surface is verified manually, in production, after the fact. This project's own tracked incident log (`pontual-if5-sem-pagamento.md` — "44 convocações sem Solicitação de Pagamento") is precisely the class of regression that automated integration tests would catch and currently cannot, because that logic isn't in a testable repo at all.

**No CI/CD test gate exists.** There is no `.github/workflows/` directory at the repo root (confirmed absent — every `*/workflows/*.yml` match found lives inside third-party packages under `node_modules`, not this project). `package.json`'s `vercel-build` script (`cd auth-backend && npm install && npm run build && cd .. && npm run build`) runs only `tsc`/`vite build` — it never invokes `npm test`. Tests are run manually, locally, by whoever remembers to before or after making a change.

## Test Types

**Unit tests:** the entire suite except one file — pure functions in, plain objects/strings out, no test doubles needed. This is 13 of 14 backend test files (~93%). The frontend has no unit tests, despite having plenty of pure, easily-unit-testable functions (the `map*`/`vtLabel`/`vtOptante` mappers, `src/lib/cpf.ts`, `src/lib/feriadosBr.ts`).

**Integration tests:** exactly one file, `auth-backend/src/routes/mensalRun.test.ts`. It boots a real Fastify app via `construirApp()`, hits routes through `app.inject()` (no real socket/port bound), and reads/writes a real Postgres database to verify state transitions. Requires: a reachable `DATABASE_URL` with the `pi.mensal_run`/`pi.mensal_run_item` migrations already applied, and a `SERVICE_TOKEN` value set consistently in the environment (the test reads the same `process.env.SERVICE_TOKEN` that `config.ts` does, so as long as `.env` defines one, both sides agree) for the service-token-gated endpoints to return anything other than 401.

**E2E tests:** none. No Playwright, Cypress, or Selenium anywhere in the repo or its dependencies (as a direct dependency). Manual QA in the browser, plus manual production monitoring after deploy (see the project's own incident-tracking memory notes), is the only end-to-end verification that exists today.

## Common Patterns

**Async testing** — every `test()` callback touching an async function is itself declared `async` and awaited directly; no `done`-callback style anywhere:
```ts
test("iniciar: cria run + 3 itens pendentes", async () => {
  const r = await post("/api/mensal/run/iniciar", { run_id: RUN, papel: "atual", competencia: "2026-07", contratos: [...] })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().total, 3)
})
```
(`auth-backend/src/routes/mensalRun.test.ts:28-34`)

**Error/edge-case testing** — always asserted as a specific value or status code, never merely "doesn't throw":
```ts
test("aplicarFifo: sem dívidas = tudo líquido, sem updates", () => {
  const r = aplicarFifo(40, 10, [])
  assert.equal(r.liquidoVR, 40)
  assert.equal(r.updates.length, 0)
})

test("status inválido → 400", async () => {
  const r = await post(`/api/mensal/run/${RUN}/contrato`, { contrato: "C", status: "voando" })
  assert.equal(r.statusCode, 400)
})
```
Immutability is explicitly asserted where it matters to the domain contract: `"aplicarFifo: não muta a dívida original"` re-reads the original input object after calling the function and asserts it is byte-for-byte unchanged (`auth-backend/src/domain/fifo.test.ts:58-62`) — follow this whenever a new domain function receives an object it must not mutate.

**Regression-replica pattern** — when a bug lived inside an n8n Code node (i.e., outside this repo entirely), the fix is captured by re-implementing the exact same small function as a local helper directly inside the `.test.ts` file, with a comment pointing back at the real n8n node it mirrors:
```ts
// --- Lógica de detecção de erro do nó Avaliar (resultado esperado ausente) ---
// Réplica da função do WF krRj3 (Avaliar Resultado Contrato) p/ pegar regressão.
function avaliar(c: { totais?: { credito?: number; pix?: number }; pedidoCreditoId?: string | null; pedidoPixId?: string | null; chapas?: string[] }, ac: { idVR?: unknown; idVT?: unknown }, temSol: boolean, driveErro: boolean): string[] {
  const erros: string[] = []
  // ...
  return erros
}
```
(`auth-backend/src/routes/mensalRun.test.ts:71-83`). Use this sparingly — it only proves the *replica* is internally correct, not that the live n8n node still matches it; the two can silently drift apart with no automated warning either way.

## What This Means for New Work

- **Adding backend domain/calculation logic:** put the pure logic under `auth-backend/src/domain/` or `auth-backend/src/mensal/`, and write a co-located `<name>.test.ts` using `node:test` + `node:assert/strict`, following the local-factory-function + flat-`test()`-call style shown above. This is the one place in the whole repo where writing a test is an existing, real, consistently-followed expectation — new pure functions in these two directories without a test file would be the exception, not the norm.
- **Adding a backend route:** there is no existing convention actually *demanding* a test (22 of 23 route files have none) — but if you add one, `routes/mensalRun.test.ts` is the only available template for how to test a route (`construirApp()` + `app.inject()` + real DB assertions).
- **Adding frontend code:** there is no test runner to hook into today. If a phase requires frontend tests, the first real step is choosing and wiring up a runner — Vitest is the natural fit given the existing Vite setup (it can share `vite.config.ts`'s `resolve.alias`/`tsconfig.app.json`'s path mapping), but **it is not installed and no decision to adopt it has been made as of this analysis** — do not assume `vitest` exists or write test files that presuppose it without first adding the dependency, config, and `package.json` script.
- **Touching any `src/features/*/api.ts` mapper function** (the snake_case/camelCase tolerance layer — see `CONVENTIONS.md`): there is currently no regression test protecting this logic at all, even though a real production incident already happened here (the VT boolean/string divergence). Until frontend testing exists, manual verification against both a real n8n response shape and the `auth-backend` mirror response shape is the only safety net — check both before changing a mapper.

---

*Testing analysis: 2026-07-28*
