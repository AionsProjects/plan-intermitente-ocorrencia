# Coding Conventions

**Analysis Date:** 2026-07-28

**Scope:** whole repo, excluding `src.bak-fase3/`, `dist/`, `node_modules/`, `_wf7tmp/`, `.output/`, `.swc/` (backups/build artifacts). Two stacks share this document: the frontend SPA (`src/`, React 19 + Vite + TypeScript strict) and `auth-backend/` (Fastify + TypeScript strict, ESM/NodeNext). Conventions are called out per-stack where they differ.

## Naming Patterns

**Files:**
- React components: `PascalCase.tsx`, one component per file, filename matches the exported function name (`src/features/hub/HubPage.tsx` exports `HubPage`). The shadcn primitives under `src/components/ui/` are the one exception, kept lowercase (`button.tsx`, `dialog.tsx`) per shadcn's own convention.
- Hooks: `use<Feature>.ts`, camelCase, co-located **inside the feature folder** — e.g. `src/features/convocar/useConvocacao.ts`, `src/features/preencher/useProcessamento.ts`. The scaffolded `src/hooks/` directory exists (from `components.json`'s `"hooks": "@/hooks"` alias) but contains only a `.gitkeep` — it is unused; do not put new hooks there.
- Utilities/API/types per feature: camelCase — `api.ts`, `types.ts`, `shared.ts`/`shared.tsx`.
- Backend test files: `<module>.test.ts`, co-located **next to** the module they test, same directory, no `__tests__/`/`test/` folder anywhere in the repo (verified). Example: `auth-backend/src/domain/fifo.ts` + `auth-backend/src/domain/fifo.test.ts`.
- Backend route files: camelCase noun matching the resource — `auth-backend/src/routes/convocar.ts`, `auth-backend/src/routes/mensalRun.ts`, `auth-backend/src/routes/rmLookups.ts`.

**Folders:**
- Feature folders under `src/features/`: lowercase, single word when possible (`atestados`, `convocar`, `preencher`, `descontos`, `mensal`, `correcao`, `auth`, `config`, `hub`); kebab-case only when the domain name has a natural separator — the sole example is `src/features/ponto-facultativo/`.
- `src/components/` = generic/shared pieces used by more than one feature (`SlideStack.tsx`, `PageTransition.tsx`, `NavCluster.tsx`, `ZoomTransition.tsx`, `AuthContext.tsx`). `src/components/ui/` = shadcn primitives only. Feature-specific components stay inside their feature folder — never promoted to `src/components/` just because a file is large.

**Functions:**
- camelCase, Portuguese verbs/nouns naming the business action, not the mechanism: `formatarDiaCompleto`, `gerarProtocolo`, `salvarProtocolo`, `buscarEmpregado`, `criarConvocacao`, `aplicarCancelamento`, `reconstruirLedger`.
- **Backend Fastify plugin registration functions are always named `rotas<Recurso>`** — confirmed across all 23 files in `auth-backend/src/routes/`: `rotasConvocar`, `rotasMensalRun`, `rotasAuth`, `rotasFeriados`, `rotasAtestados`, `rotasDescontos`, `rotasBoards`, `rotasContingencia`, etc. Each has signature `async function rotas<Nome>(app: FastifyInstance): Promise<void>` and is wired into `auth-backend/src/app.ts` via `await app.register(rotas<Nome>)`. New route files must follow this exact naming — `app.ts` is a flat, alphabetically-unsorted list of registrations that relies on the name alone being self-documenting.
- Auth/role guard helpers send the error reply themselves and return `null` (falsy) on failure, so call sites can bail in one line:
  ```ts
  async function exigirDP(req: FastifyRequest, reply: FastifyReply) {
    const u = await usuarioDaSessao(req)
    if (!u) { reply.code(401).send({ erro: "nao_autenticado" }); return null }
    if ((NIVEL[u.papel] ?? 0) < NIVEL.dp) { reply.code(403).send({ erro: "sem_permissao" }); return null }
    return u
  }
  ```
  Call site: `if (!(await exigirDP(req, reply))) return` (`auth-backend/src/routes/mensalRun.ts:11-16,137`).

**Variables:**
- Portuguese domain nouns almost everywhere (`empregado`, `contrato`, `dataInicio`, `respostas`, `desconto`, `ledger`). English is reserved for framework-shaped identifiers (`props`, `children`, generic type params like `T`).
- Local error state in components is always named `erro`/`setErro`: `const [erro, setErro] = useState<string | null>(null)` (`src/features/correcao/CorrecaoPage.tsx:23`, `src/features/atestados/WizardDocumento.tsx:739,1433`).
- Intentionally-unused variables/params are prefixed with `_` rather than deleted or lint-disabled — e.g. a destructured prop renamed `onAbrirPontoInfo: _onAbrirPontoInfo` in `src/features/preencher/FormularioWizard.tsx:1155` (this is exactly how a past real lint error in this file — `'_onAbrirPontoInfo' is defined but never used` — was resolved; do the same for any prop/arg you must keep in a signature but don't use).

**Types:**
- PascalCase for both `type` aliases and `interface`. **`type` is the default** — grep-verified 139 `type` declarations vs. 23 `interface` declarations across `src/`. Reach for `interface` only for small, potentially-extensible object shapes (e.g. `OperadorInfo` in `src/lib/http.ts:11`); use `type` for props, DTOs, unions, and discriminated unions.
- Multi-step UI flows model their step as a string-literal union, not an enum: `type EtapaCancelamento = "fechado" | "escolha" | "calendario" | "confirmar_total" | "confirmar_parcial" | "sucesso_total" | "sucesso_parcial"` (`src/features/preencher/FormularioWizard.tsx:69-76`).
- "Apply vs. revert" payloads are discriminated unions on a `tipo` field: `type PayloadAplicarSplit = { tipo: "aplicar"; dataInicioParte2: string; contratoParte1: string; contratoParte2: string } | { tipo: "reverter" }` (`src/features/preencher/types.ts:100-107`).

## Code Style

**Formatting:**
- **No Prettier anywhere in the repo** (no `.prettierrc*` at root or in `auth-backend/`). Formatting is by convention/discipline only, not enforced by tooling — match the surrounding file exactly instead of reformatting on save.
- No semicolons at statement end (ASI style). Grep-verified: `grep -c ";$"` returns `0` on sampled files in both stacks (`src/features/convocar/api.ts`, `src/lib/theme.ts`, `src/components/ui/button.tsx`, `auth-backend/src/config.ts`). This is a strict, near-universal stylistic choice — new code should not add semicolons.
- Double quotes for strings (grep-verified: 85 double-quote occurrences vs. 0 single-quote in `src/features/convocar/api.ts`), 2-space indentation.

**Linting:**
- **One root `eslint.config.js` (flat config) lints both stacks** — `files: ['**/*.{ts,tsx}']` with no path restriction, so it covers `src/**` and `auth-backend/src/**` in the same run. There is no separate `auth-backend/eslint.config.js`.
- `globalIgnores`: `dist`, `node_modules`, `.claude`, `.n8n_backup`, `.well-known`, `.output`, `src.bak-fase3`, `*.json`, `docs/n8n/*.json`, `scripts`, `determinar.js`.
  - **`src.bak-fase3/` does not currently exist in the working tree** (verified 2026-07-28 — the directory is absent from disk even though `CLAUDE.md`'s history describes it as a large, lint-polluting backup dir). It remains in `globalIgnores` and in `.gitignore:40` as a defensive no-op: if it's ever restored (stash pop, branch merge, etc.) it will **not** re-pollute lint or the build. No action needed — do not remove the ignore entry, and do not assume the directory is present when reasoning about file counts.
- `@typescript-eslint/no-unused-vars` is `error`, with `argsIgnorePattern: '^_'` / `varsIgnorePattern: '^_'` — see the `_`-prefix convention above.
- **Current lint state (verified by actually running `npm run lint` on 2026-07-28): 2 errors, 12 warnings.**
  - Both errors are `@typescript-eslint/no-explicit-any`, both in `auth-backend/src/scripts/importar-convocacoes.ts:53,55` — a one-off Monday.com data-migration script. This is the **only file in the entire repository that uses `any`.**
  - The 12 warnings are all non-blocking: `react-refresh/only-export-components` (files exporting both a component and a constant/hook/context value — `src/components/AuthContext.tsx`, `src/components/NavContext.tsx`, `src/components/ZoomTransition.tsx`, `src/features/mensal/Acompanhamento.tsx`) and `react-hooks/exhaustive-deps` (2 occurrences — `AuthContext.tsx`, `FormularioWizard.tsx`).
- **TypeScript strict, zero `any` in `src/` (frontend) — confirmed by direct grep** (`: any`, `<any>`, `as any` all return zero matches). Backend has exactly the 2 occurrences above; treat any new `any` usage outside a clearly-scoped migration/ops script as a regression.
- `noUnusedLocals` and `noUnusedParameters` are enforced at the **compiler** level too, in both `tsconfig.app.json` and `auth-backend/tsconfig.json` — unused code fails `tsc -b`, not just `eslint .`.

## TypeScript Conventions

- **Frontend** (`tsconfig.app.json`): `strict: true`, `verbatimModuleSyntax: true` — type-only imports **must** use `import type`; this is a compiler error under this flag, not a style suggestion. `moduleResolution: "bundler"`. Path alias `@/*` → `./src/*`.
- **Backend** (`auth-backend/tsconfig.json`): `strict: true`, `module`/`moduleResolution: "NodeNext"` (real ESM — relative imports need an explicit `.js` extension even though the source file is `.ts`, e.g. `import { query } from "../db.js"` in `auth-backend/src/routes/mensalRun.ts:2`). `noImplicitOverride: true`. No `verbatimModuleSyntax` here, but `import type` is still used by convention in most files (e.g. `auth-backend/src/db.ts:1` mixes it inline: `import { Pool, types, type QueryResultRow } from "pg"`). No path alias on the backend — everything is relative.
- Both configs share `strict`, `noUnusedLocals`, `noUnusedParameters` — there is no relaxed-mode file or directory anywhere.

## Import Organization

**Order** (observed consistently, not lint-enforced — see e.g. `src/features/preencher/FormularioWizard.tsx:1-60`):
1. React / React types (`useCallback, useEffect, ...` from `"react"`, `import type { MouseEvent } from "react"`)
2. External libraries (`date-fns`, `date-fns/locale`, `react-router-dom`, `lucide-react`)
3. Blank line
4. `@/components/ui/*` (shadcn primitives)
5. Blank line
6. Other `@/...` absolute imports (`@/features/...`, `@/lib/...`)
7. Relative `./...` imports last (feature-local siblings: `./api`, `./types`, `./useProcessamento`)

**Path Aliases:**
- `@/*` → `./src/*` everywhere on the frontend (`tsconfig.app.json`, `vite.config.ts:18-21`, `components.json`). Use `@/lib/...`, `@/features/...`, `@/components/...` for anything outside the current feature folder; use relative `./...` only for siblings inside the same feature folder.
- The backend has **no** path alias — all backend imports are relative with explicit `.js` extensions (NodeNext ESM requirement).

## Data Boundary Convention: tolerate multiple key formats

**This is the single most important defensive-coding pattern in the codebase.** The app talks to two independently-evolving backends that disagree on field casing: the legacy n8n workflows (mostly `snake_case`, some inconsistently `camelCase`) and `auth-backend` (mostly `camelCase`, matching the TS types). **A production incident happened because of this**: a VT ("optante Vale Transporte") field arrived as a boolean from one path and a string from another; naive handling silently defaulted to `"NÃO"` and zeroed VT for real employees. The fix — and the pattern to replicate for any new field — lives in `src/features/convocar/api.ts:92-103`:

```ts
/** Label de VT vindo do RM, tolerante a boolean (backends divergiram no tipo). */
function vtLabel(v: unknown): string {
  if (v === true) return "SIM"
  if (v === false) return "NÃO"
  // Preserva acento: o label vai pro Monday como está ("NÃO", não "NAO").
  return String(v ?? "").toUpperCase().trim()
}

function vtOptante(v: unknown): boolean {
  const l = normaliza(vtLabel(v))
  return l === "SIM" || l === "SIM*"
}
```
Called as `vtOptante(o.optante_vt ?? o.optanteVT)` (`src/features/convocar/api.ts:248`) — accepting **both** the n8n key and the backend key, and both a boolean and a string shape, in one place.

**Rule for any new field coming from an external API response:** accept both `snake_case` and `camelCase` variants via `??`, and never assume a boolean-looking field is actually typed as a boolean on the wire. The same pattern repeats throughout the codebase:
- `src/features/convocar/api.ts:238-243` — `o.secaoCodigo || o.secao_codigo`, `o.localUnidade || o.local_unidade`
- `src/features/convocar/api.ts:131-166` (`normalizarOpcoes`) — `opcoes.solicitantes ?? opcoes.solicitante`, `opcoes.unidades_por_contrato ?? opcoes.unidadesPorContrato`
- `src/features/preencher/api.ts:353-401` (`mapAtestado`) — every field reads `raw.xCamel ?? raw.x_snake`
- `src/features/preencher/api.ts:332-351` (`mapPontoFacultativo`) — `raw.contrato ?? raw.contrato_colaborador`, `raw.origem ?? raw.origin`
- Outbound payloads do the mirror-image conversion explicitly before sending: `payloadFinalizarSnake` (`src/features/preencher/api.ts:403-428`) builds the exact `snake_case` body n8n expects from the internal camelCase types.

When writing a new mapper for an API response, follow the `mapAtestado`/`mapPontoFacultativo` shape: one `map<Thing>(raw: Record<string, unknown>): Thing` function next to the fetch call, every field defensively cast (`String(...)`, `Number(...)`, explicit boolean checks) with a `??`/`||` fallback chain across both key spellings — never a raw type assertion (`as Thing`) directly on a network response.

## Error Handling

**Frontend — API layer:**
- Each feature's `api.ts` defines its own `Error` subclass when callers need to branch on the failure type: `ConvocacaoApiError` (`src/features/convocar/api.ts:15-34`, fields `status?`, `erro?`, `conflito?`), `CancelarConvocacaoApiError` (`src/features/preencher/api.ts:580-590`), `AplicarSplitApiError` (`src/features/preencher/api.ts:667-677`).
- For simpler one-off failures (no branching needed downstream), cast a plain `Error` instead of subclassing:
  ```ts
  const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
  err.status = res.status
  throw err
  ```
  (`src/features/preencher/api.ts:437-441,450-453,755-759`). Prefer this lighter form when the caller only ever reads `.message`/`.status`; reach for a named subclass when the caller needs to branch on a specific `.erro` code.
- Component-level `catch` blocks always narrow with `instanceof` before falling back to a generic Portuguese message — never let a raw error reach the UI:
  ```ts
  } catch (err) {
    if (err instanceof ConvocacaoApiError && err.status === 409 && err.erro === "convocacao_conflitante") {
      setAlertaConflito({ mensagem: err.message || "Data divergente: ...", conflito: err.conflito })
      return
    }
    setErroGeral((err as Error).message || "Erro ao criar convocação. Tente novamente.")
  }
  ```
  (`src/features/convocar/FormularioConvocacao.tsx:194-216`)
- **There is no top-level React error boundary anywhere in the app** — an uncaught render error currently white-screens the SPA. New risky render paths should catch at the component/mutation level (as above); do not assume a boundary will save you.
- No toast/notification library is a dependency (no `sonner`, `react-hot-toast`, etc.). "Toast" behavior is hand-rolled local state + a `setTimeout` dismiss (e.g. the 2s success screen in `src/features/descontos/DescontosPage.tsx`).

**Frontend — contingency routing ("Plano de Fuga"):**
`src/lib/http.ts` is the error-handling contract for every call that goes through `chamarProcesso(processo, path, init, { tipo })`, and encodes a deliberate, asymmetric fallback policy:
- Routing mode per logical "processo" comes from `GET /api/rotas`, cached 60s in memory then in `localStorage`, defaulting to `{}` (= always n8n) if the backend itself is unreachable — "never worse than today" (`src/lib/http.ts:56-89`).
- **Reads** (`tipo: "leitura"`) in `auto` mode: try n8n with an 8s timeout; **any** network error, timeout, 5xx, or 404 falls back to `/api/<path>` (`src/lib/http.ts:126-138`).
- **Writes** (`tipo: "escrita"`) in `auto` mode: only a **404** (webhook removed/disabled) triggers the fallback — a timeout or 5xx does NOT prove the write didn't already execute server-side, so it is deliberately never retried against the mirror route, to avoid double-writes (`src/lib/http.ts:115-124`).
- **Structural requirement for any new write endpoint:** it must exist at the same relative path under both the n8n webhook base and `/api/<path>` on `auth-backend` for this fallback to be safe to enable later — this is not optional infrastructure, it's the contract this module assumes.

**Backend (Fastify routes):**
- Every error response is `{ erro: "codigo_snake_case" }` (sometimes with `ok: false` alongside), never a bare string or an HTTP-status-only signal. Codes read like `"nao_autenticado"`, `"sem_permissao"`, `"run_id_invalido"`, `"convocacao_conflitante"`, `"cpf_invalido"`, `"conta_desativada"`. This shape is universal across all 23 files in `auth-backend/src/routes/` — grep any of them and every `reply.code(4xx).send(...)` follows it.
- Status codes in active use: `400` (validation — most common, 67 occurrences), `404` (not found, 31), `401` (missing/invalid session or service token, 30), `502` (upstream bridge failure — RM/Monday/Caju, 28), `409` (conflict — duplicate CPF, already cancelled, etc., 18), `403` (role too low / account disabled, 9), `503` (upstream unavailable, 5), `422` (2).
- Service-to-service auth (n8n calling the backend with no user session) uses a header, never a cookie: `X-Service-Token` compared against `config.serviceToken`, always guarded with `!!config.serviceToken &&` so an **unset** token can never accidentally match an empty-string comparison:
  ```ts
  function temServiceToken(req: FastifyRequest): boolean {
    const t = String(req.headers["x-service-token"] ?? "").trim()
    return !!config.serviceToken && t === config.serviceToken
  }
  ```
  (`auth-backend/src/routes/mensalRun.ts:19-22`, same pattern in `auth-backend/src/routes/boards.ts`).
- `auth-backend/src/config.ts` fails fast at **process boot**, not at first use: its `req(nome)` helper throws synchronously on import if a truly-required env var (`DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`) is missing. Integration-specific vars (Monday, RM, Caju, Drive, Nexti) use `opt(nome, fallback)` and default to `""`, so routes that need them check truthiness at call time instead of crashing the whole app when e.g. Caju credentials aren't configured locally.

## Logging

- **No logging framework on the frontend beyond `console.warn`**, and it's used sparingly — exactly 2 call sites in all of `src/`, both in the contingency-routing fallback, tagged `[fuga] ...` (`src/lib/http.ts:120,136`). Do not add ad-hoc `console.log` debugging to committed code; there is no precedent for it.
- Backend: Fastify's built-in logger (`Fastify({ logger: true })`, `auth-backend/src/app.ts:31`) — pino under the hood, but never configured or extended beyond the default. No separate structured-logging setup.
- **Activity/audit logging is a distinct, deliberate concept — not general logging.** `src/lib/atividade.ts` exports `registrarAtividade(acao, meta)`, which POSTs to `/api/atividade` as fire-and-forget and swallows its own errors:
  ```ts
  export function registrarAtividade(acao: TipoAtividade, meta: MetaAtividade = {}): void {
    void fetch("/api/atividade", { method: "POST", credentials: "same-origin", ... })
      .catch(() => { /* silencioso — atividade é secundária ao fluxo de negócio */ })
  }
  ```
  Called from every mutation's `onSuccess` (`src/features/convocar/useConvocacao.ts:89-97`, all 3 mutations in `src/features/preencher/useProcessamento.ts`). **Never `await` this call and never let its failure affect the main flow's success/failure path** — it feeds the Atividade tab in Config (Postgres-backed) and nothing else.

## Comments

- Portuguese, terse, explain **why** (a business rule, or a specific past bug) rather than restating what the code already says. Typical shape:
  ```ts
  // Normaliza "" → null. O monday devolve string vazia em colunas text
  // não preenchidas, e isso quebra o `??` (que só captura null/undefined)
  // no FormularioWizard, fazendo o frontend mandar protocolo: "".
  ```
  (`src/features/preencher/api.ts:465-467`)
- JSDoc-style `/** ... */` appears occasionally, reserved for exported helpers whose contract isn't obvious from the name/signature alone — e.g. `vtLabel` (`src/features/convocar/api.ts:92`), `useThemeState` (`src/lib/theme.ts:152`), the `split?`/`tipoDocumentacaoLabel?` fields in `src/features/preencher/types.ts:33-36,61-64`. It is not required on every export — most functions rely on the Portuguese name being self-explanatory.
- **One inconsistency, not a pattern to copy:** `buscarUuidPorProtocolo` (`src/features/preencher/api.ts:740-744`) has an English JSDoc block ("Mock mode:", "Real mode:", "TODO") — the only English comment found across the sampled frontend code. New comments should stay in Portuguese to match everything else.
- File-header comments explain module-wide intent when the "why" isn't obvious line-by-line — e.g. the 12-line header in `src/lib/theme.ts:1-12` explaining the crossfade/no-FOUC approach, or the 9-line header in `src/lib/http.ts:1-9` explaining why operator identity is injected via a provider/getter (`setOperadorProvider`) instead of importing React directly, specifically to avoid a circular dependency.

## Function Design

- **Size**: no enforced limit, and large stateful components are the norm, not the exception, once a feature owns several internal wizards. `src/features/preencher/FormularioWizard.tsx` is **3530 lines** (main day-by-day panel + cancelamento wizard + sábados-extras wizard + split wizard, each its own `Etapa*` string-union state, all in one file). `src/features/atestados/WizardDocumento.tsx` is **1752 lines**. Backend files stay much smaller — `auth-backend/src/mensal/*.ts` and `auth-backend/src/routes/*.ts` are typically 200–550 lines.
  - **When extending an existing large wizard-style component, follow the existing pattern** — add another `Etapa*` union plus local `useState`/dialogs inside the same file — **rather than unilaterally extracting it into new files.** The codebase has consistently chosen colocation of tightly-related UI state over file-size limits for these flows. Extracting is fine for genuinely new, independently-navigable features.
- **Parameters**: business-logic functions take a single options object with named fields once there are more than ~2-3 parameters — e.g. `aplicarCancelamento({ ledger, diasCancelados, tipo, vrDia, vtDia, optanteVT, trabalhaSabado, sabadosExtras })` (`auth-backend/src/domain/ledgerBeneficios.ts`). Small, unambiguously-ordered helpers stay positional — `addDays(date, delta)`, `overlaps(startA, endA, startB, endB)` (`auth-backend/src/domain/antifraude.ts`).
- **Return values**: pure domain calculators return one result object bundling the outcome *and* any "what to persist next" instructions, and are expected to **not mutate their inputs** — this is explicitly asserted in tests, e.g. `"aplicarFifo: não muta a dívida original"` re-reads the original input object after the call (`auth-backend/src/domain/fifo.test.ts:58-62`). Follow this immutability contract for any new function under `auth-backend/src/domain/` or `auth-backend/src/mensal/`.

## Module Design

**Exports:**
- **Named exports everywhere.** Grep-verified: 87 files use `export function`/`export const`/`export class`/`export type`/`export interface` at top level; **exactly one file, `src/App.tsx`, uses `export default`** (the root routing component). Do not introduce new default exports.
- React components are always declared as `export function ComponentName(...) { ... }` — a plain function declaration, never `export const ComponentName = (...) => ...`. Grep-verified: 51 `.tsx` files match the function-declaration form; 0 match the arrow-const form.

**Barrel Files:**
- **Not used, in either stack.** There is no `index.ts`/`index.tsx` anywhere under `src/` or `auth-backend/src/`. Always import from the concrete file — `@/features/convocar/types`, never `@/features/convocar`.

**Feature module shape** (repeats across every `src/features/<feature>/`):
- `types.ts` — every `type`/`interface` for the feature, plus any `*_FALLBACK` const data the types reference (e.g. `OPCOES_CONVOCACAO_FALLBACK` in `src/features/convocar/types.ts:49-58`).
- `api.ts` — the network layer: a `USE_MOCK` flag derived from an empty env var, an in-file mock dataset, request/response mapper functions (see Data Boundary Convention above), and one exported `async function` per backend operation.
- `use<Feature>.ts` — react-query hooks wrapping the `api.ts` functions (`useQuery`/`useMutation`). Components call these hooks, never `api.ts` functions directly.
- `<Feature>Page.tsx` — the route-level component orchestrating sub-steps, usually via `SlideStack` (`src/components/SlideStack.tsx`) for internal (non-router) step transitions.
- One `.tsx` file per screen/step (`BuscarEmpregado.tsx`, `FormularioConvocacao.tsx`, `TelaSucesso.tsx`, ...).
- `shared.tsx`/`shared.ts` for cross-step helpers, once a feature has enough steps to need them (`src/features/atestados/shared.tsx`, `src/features/descontos/shared.ts`).

New features should be scaffolded with this same file split from the start rather than growing organically into a different shape.

## React Query Conventions

- `queryKey` is always an array: a short tag string, then the discriminating id — `["processamento", uuid]`, `["empregado-rm", debounced]`, `["convocacao-opcoes"]`, `["boards-meses-convocacao"]`.
- Search-as-you-type fields use a small local `useDebounce(value, delay = 250)` hook, re-implemented per feature rather than shared (`src/features/convocar/useConvocacao.ts:28-35`), combined with `enabled: debounced.trim().length >= 3`.
- Endpoints that might not exist yet get `placeholderData` pointing at a local fallback dataset plus `retry: 1`, so the UI is never blocked on a not-yet-implemented endpoint (`useOpcoesConvocacao`, `src/features/convocar/useConvocacao.ts:49-58`).
- `staleTime` is chosen per query's volatility: `0` for the live day-by-day processing panel (`src/features/preencher/useProcessamento.ts:22` — must always be fresh after a mutation), `30_000` for autocomplete search, `60_000`–`5 * 60_000` for rarely-changing option/lookup lists.
- Mutations with side effects worth auditing call `registrarAtividade(...)` inside `onSuccess`, then `invalidateQueries` (see Logging section) — this is the standard shape for every write mutation (`useCriarConvocacao`, `useFinalizarProcessamento`, `useCancelarConvocacao`, `useAplicarSplit`).
- Dialogs are conditionally **rendered**, not conditionally **opened**: `{cond && <Dialog>...</Dialog>}` rather than `<Dialog open={cond}>`, so stacked backdrops never linger. Confirmed pattern across `src/features/preencher/FormularioWizard.tsx` (7+ dialogs, e.g. lines 1015, 1028, 1047, 1059, 1067, 1074, 1081) and `src/features/atestados/WizardDocumento.tsx`.

## UI / Styling Conventions

- **Tailwind v4** (`@import "tailwindcss"`, `src/index.css:6`) + **shadcn/ui**, `new-york` style, `neutral` base color, `cssVariables: true` (`components.json`). Primitives under `src/components/ui/` wrap the consolidated `radix-ui` package (imported as `import { Slot } from "radix-ui"`, not per-primitive `@radix-ui/react-*` packages), use `class-variance-authority` (`cva`) for variants, `cn()` (`src/lib/utils.ts` — `clsx` + `tailwind-merge`) for merging class names, and a `data-slot`/`data-variant`/`data-size` attribute convention for styling hooks (`src/components/ui/button.tsx:56-58`).
- A custom "Liquid Glass" design layer sits on top, in `src/index.css` (4095 lines) and `src/liquid-glass-v2.css` (439 lines, imported at `src/index.css:8`, wrapped in `@layer components` so Tailwind utilities can still override it): `.glass-panel`, `.glass-hero`, `.glass-tile-v2`, `.glass-cta`/`.glass-cta--mini`, `.icon-orb`/`.icon-orb--neutral`, `.eyebrow`, `.tilt-3d`. An older v1 vocabulary (`.glass-strong`, `.glass-tile`, `.liquid-*`) still lives in less-recently-touched screens (the wizard/preencher family) — **prefer v2 classes for any new UI**; migration off v1 is gradual, not required as a side-effect of unrelated changes.
- Theming has **no external library** — `src/lib/theme.ts` hand-rolls mode (light/dark/system) + 6 named color schemes (`aurora`/`seco`/`verde`/`rosa`/`rubi`/`roxo`) via `data-theme`/`data-accent` attributes on `<html>` plus CSS variables (`--accent-rgb`, `--surface-rgb`, etc., `src/index.css:12-73`), persisted to `localStorage` (`pi-theme`/`pi-accent`/`pi-reduce-anim`/`pi-font`). Any new animation must respect both `prefers-reduced-motion` and the app's own "reduzir animações" toggle — follow `applySmooth()` (`src/lib/theme.ts:85-100`) as the reference for how to gate an animated state change behind both checks.
- Icons: `lucide-react` exclusively — no other icon set is a dependency.

## Dates & Numbers

- All date formatting goes through `date-fns` + `date-fns/locale/ptBR`: `format(parseISO(iso), "<pattern>", { locale: ptBR })`. Confirmed consistent across `src/features/preencher/FormularioWizard.tsx`, `TelaObrigado.tsx`, `src/features/correcao/CorrecaoPage.tsx`, `src/features/descontos/TelaRegistrado.tsx`, `src/features/ponto-facultativo/PontoFacultativoPage.tsx`, `src/features/convocar/FormularioConvocacao.tsx`, `src/features/mensal/MensalPage.tsx`.
- Dates are ISO `YYYY-MM-DD` strings end-to-end in state/props/payloads; convert to a `Date` object only at the point of formatting or calendar-widget interop — never store a `Date` in feature state.
- Delay ("atraso") is always **minutes, a non-negative integer**. Field name is `minutos_atraso` on the wire (n8n/backend JSON) and `minutosAtraso` in frontend types (`src/features/preencher/types.ts:48`). Never seconds, never a duration/`Date` object.
- The backend parses Postgres `date` columns back as raw `"YYYY-MM-DD"` strings, never a JS `Date`, specifically to dodge timezone-shift bugs: `types.setTypeParser(1082, (v) => v)` (`auth-backend/src/db.ts:7`). Any new backend code reading a `date` column already has a string; do not wrap it in `new Date(...)` before re-emitting it.

## Commit Conventions

- Portuguese, Conventional-Commits-shaped: `tipo(escopo): descrição curta no imperativo`. Real examples from history: `feat(mensal): botão Interromper durante a execução + parada real entre contratos`, `fix(rm): <Coligada> faltante no XML do IntegrarBackOffices — causa real do "Pendente"`, `docs: CLAUDE.md — unidades do RM (ADMINISTRATIVO + atestados via useUnidadesRm)`, `revert(mensal): create_item com valores num passo só (padrão do pontual)`.
- Types observed in history: `feat`, `fix`, `docs`, `revert`. Scope in parentheses names the feature/module (`mensal`, `rm`, `unidades`, `ui`, `atestados`) and is occasionally omitted for repo-wide `docs:` commits.
- Multi-line commits add a bullet body (`- ...`) elaborating the change, and frequently end with a co-author trailer (`Co-Authored-By: Claude Opus X <noreply@anthropic.com>`) when the commit was AI-assisted — this trailer is additive, not a replacement for a descriptive Portuguese subject line.

---

*Convention analysis: 2026-07-28*
