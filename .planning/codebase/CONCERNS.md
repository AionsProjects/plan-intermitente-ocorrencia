# Codebase Concerns

**Analysis Date:** 2026-07-28

**Scope:** full repo, exceto `src.bak-fase3/`, `dist/`, `node_modules/`, `_wf7tmp/`, `.output/`, `.swc/` (citados abaixo como débito, não usados como fonte). Cobre `src/` (frontend), `auth-backend/` (Fastify+TS, a "fuga" do n8n), workflows/mensal.ts (Workflow DevKit), docs/, scripts/, e os workflows n8n na medida em que são citados por docs versionados ou por evidência indireta (Monday, logs).

## Tech Debt

**Documentação primária corrompida e desatualizada (`CLAUDE.md`, `AGENTS.md`):**
- Issue: `CLAUDE.md` (661 linhas, 71KB) tem mojibake (UTF-8 lido como Latin-1) nas linhas 1–3 e em boa parte do corpo até a linha ~625 — confirmado lendo o arquivo bruto: `# Plano de Intermitentes â€” App web`, `convocaÃ§Ãµes`, `ocorrÃªncias`, `SeguranÃ§a` (linha 617) e diversas outras palavras acentuadas até a linha 625. Só as seções mais novas (a partir de "Estado atual do projeto (2026-07-23)", linha ~7, e a seção "Autenticacao" no fim, escrita sem acentos de propósito) estão limpas. `AGENTS.md` (645 linhas, 66KB) tem a MESMA corrupção herdada (153 ocorrências do padrão em cada arquivo) E está mais desatualizado: sua seção "Estado atual do projeto" ainda diz `(2026-06-15)`, enquanto a de `CLAUDE.md` já está em `(2026-07-23)` — ou seja, `AGENTS.md` está sem pelo menos um mês de mudanças reais (migração mensal, fixes de VT/unidades RM, contrato ADMINISTRATIVO, etc.).
- Files: `CLAUDE.md:1-3,617-625`, `AGENTS.md` (seção "Estado atual do projeto (2026-06-15)")
- Impact: um agente (humano ou LLM) que confia em `AGENTS.md` planeja sobre um estado de ~1.5 mês atrás (ex.: acha que o board de Entrada é fixo `18408773953` quando na verdade já existe registry dinâmico via `/api/boards/resolver`; acha que pontual/mensal são só n8n). A corrupção de encoding piora busca textual por acentos (grep por "não", "coração" etc. não bate com o texto real).
- Fix approach: rodar um fix de encoding único (reler como Latin-1, regravar como UTF-8) nas seções afetadas de `CLAUDE.md` e decidir se `AGENTS.md` deve deixar de ser um fork manual — idealmente um dos dois vira gerado/sincronizado a partir do outro, ou passa a ser só um symlink/import.

**Column IDs do Monday hardcoded nos workflows n8n apesar do registry dinâmico existir:**
- Issue: o board de Entrada duplica todo mês (virada) e o backend já tem um registry por nome de coluna (`auth-backend/src/routes/boards.ts` — `registrarBoard()`, `/api/boards/resolver`, tabelas `boards`/`board_colunas`/`board_grupos`) que resolve `column_id` por TÍTULO, robusto à duplicação. Mesmo assim, os workflows n8n (WF7 Convocar, WF Cancelar, Sábados Extras, Ponto Facultativo antigo, etc. — não versionados neste repo por conterem tokens) continuam com column/board IDs fixos nos nós. A própria evidência versionada mostra o padrão: `docs/n8n/wf2-ler.json` e `docs/n8n/wf3-finalizar.json` (exports de referência, sem credenciais) hardcodam `18411141462` e colunas como `color_mm2xkqpc`, `text_mm2xjend`, `long_text_mm2xtcpw` diretamente nos nós.
- Files: `docs/n8n/wf2-ler.json`, `docs/n8n/wf3-finalizar.json`, `auth-backend/src/routes/boards.ts:42-81,165-204` (o mecanismo correto que os WFs não usam)
- Impact: hoje funciona só porque a virada de mês preserva os column_ids do board Histórico (fixo, "não duplica na virada" — comentário em `auth-backend/src/routes/intermitente.ts:7`) e porque quem gerencia a virada tem cuidado de manter os IDs da cópia. Qualquer mudança de estrutura do board (renomear coluna, adicionar/remover, ou um dia duplicar de um template diferente) quebra os WFs em silêncio — sem erro visível, só dado não gravado ou gravado na coluna errada.
- Fix approach: portar a resolução de coluna dos WFs n8n pra `GET /api/boards/resolver` (já existe e é consumido pelo próprio `auth-backend/src/routes/convocar.ts:87-107` via `resolverBoard()`), ou migrar o processo pro backend (caminho já mapeado em `02-PLANO-DE-FUGA.md`).

**Dois sistemas de orquestração de jobs paralelos e desconectados:**
- Issue: existem DUAS infraestruturas de "job" que não se conhecem. (1) A fila genérica em Postgres desenhada em `02-PLANO-DE-FUGA.md` (`pi.jobs`, migration `auth-backend/db/migrations/012_jobs.sql`) com `auth-backend/src/jobs/repo.ts` (`enfileirar`/`pegarDevidos`/`avancar`/`falhar`) e `auth-backend/src/jobs/runner.ts`. (2) O Vercel Workflow DevKit (pacote `workflow` v4.6.0 no `package.json` raiz) que roda de fato o mensal via `workflows/mensal.ts` (680 linhas, 12 etapas/contrato) chamado por `start()` em `auth-backend/src/routes/mensalOrquestracao.ts:44`. Quem lê só `runner.ts` conclui (erroneamente) que mensal "não está implementado" — na verdade está, só que em outro lugar.
- Files: `auth-backend/src/jobs/runner.ts:24-36` (handlers `pontual`/`mensal`/`virada`/`caju_poll` todos `gated`), `workflows/mensal.ts`, `auth-backend/src/mensal/workflowClient.ts`, `auth-backend/src/routes/mensalOrquestracao.ts:44-51`
- Impact: confusão de manutenção — dois modelos mentais de "como um job roda" no mesmo repo. Além disso, a fila genérica (1) está **completamente inerte em produção**: `enfileirar()` (`auth-backend/src/jobs/repo.ts:15`) não é chamado de lugar nenhum do código, e o cron que avançaria os jobs (`POST /api/jobs/tick`) não está registrado no `vercel.json` real da raiz (que só tem o cron de retenção mensal) — só existe um `auth-backend/vercel.crons.example.json` de referência, nunca copiado pro config ativo.
- Fix approach: decidir explicitamente se a fila genérica (1) é descontinuada (documentar) ou passa a ser realmente usada (registrar o cron, ligar `sync_monday`). Ver também "Missing Critical Features" abaixo.

**`sync_monday` é um stub que reporta sucesso sem fazer nada:**
- Issue: `const syncMonday: Handler = async (job) => { /* TODO */ await avancar(job.id, { estado: "concluido" }) }` — marca QUALQUER job desse tipo como concluído com sucesso sem escrever coluna alguma no Monday.
- Files: `auth-backend/src/jobs/runner.ts:18-22`
- Impact: confirmado como causa raiz de um gap já documentado pelo próprio time: `docs/contingencia/ensaio.md:42` diz explicitamente "**Board Monday:** NÃO atualiza no modo fallback (gap documentado) — é esperado." Ou seja, durante uma contingência (n8n fora, `modo=api`), o registro grava em Postgres mas o board Monday — que o DP olha — fica desatualizado até reconciliação manual (`docs/contingencia/pagamentos.md`, seção 4). Hoje isso é tolerável porque ninguém enfileira `sync_monday` ainda (ver item acima), mas o nome do handler promete uma sincronização que não existe.
- Fix approach: implementar a escrita real por board em `sync_monday` antes de depender dele, ou deixar a lacuna explícita em `docs/mensal-duravel.md`/`docs/contingencia/*` como limitação conhecida (já está, parcialmente).

**Falha silenciosa ao gravar colunas na criação de convocação:**
- Issue: os helpers que montam `column_values` fazem no-op silencioso se o nome da coluna não resolver no registry: `const setTexto = (nome, val) => { const c = id(nome); if (c && val) cv[c] = val }` (mesmo padrão em `setStatus`/`setDate`/`setDropdown`). Não há log, warning nem erro quando `id(nome)` retorna `undefined`.
- Files: `auth-backend/src/routes/convocar.ts:301-327` (definição das 4 funções na linha 302-305; 17 chamadas nas linhas 307-327)
- Impact: se uma virada de mês registrar um board com uma coluna renomeada ou faltante, a convocação é criada normalmente (200 OK) só que sem aquele campo — ninguém percebe até o dado fazer falta no cálculo de VR/VT ou no relatório do DP.
- Fix approach: `req.log.warn` quando `id(nome)` for `undefined` para qualquer um dos 17 campos, listando o nome da coluna não resolvida.

**Board `teste` sem colunas no registry:**
- Issue: o board `teste` (`18421690337`) está cadastrado em `pi.boards` mas não tem nenhuma linha correspondente em `pi.board_colunas`.
- Files: mecanismo afetado em `auth-backend/src/routes/boards.ts:44-81` (`registrarBoard`) e `auth-backend/src/routes/convocar.ts:87-107` (`resolverBoard` — o `idPorNome` fica vazio pra esse board)
- Impact: qualquer criação de item nesse board grava só o nome (todo `setX(...)` acima faz no-op por falta de `column_id`), sem erro.
- Fix approach: rodar `POST /api/boards/registrar` para esse board_id, ou documentar que ele não deve receber writes reais.

**Diretórios de build/backup não versionados poluindo o repositório e o lint:**
- Issue: hoje, no disco, existem `dist/` (1.8MB, build do Vite), `.output/` (9.3MB — saída estilo Nitro/SSR que não corresponde à stack Vite+SPA documentada; provável artefato do toolchain do Workflow DevKit), `.swc/` (4.1MB, cache do compilador SWC) e `_wf7tmp/` (68KB, contém só `full.json` — um dump de workflow esquecido). Todos gitignored, mas presentes localmente. Historicamente o mesmo padrão já existiu de forma pior: `.gitignore` ainda carrega regras mortas pra `src.bak-fase3/` e `*.bak-pretheme` (linhas 40-41), arquivos que não existem mais no disco — evidência de que esse tipo de backup-não-versionado já causou dor o bastante pra ganhar regra permanente.
- Files: `.gitignore:40-41`, diretórios `dist/`, `.output/`, `.swc/`, `_wf7tmp/` na raiz
- Impact: `npm run lint` (ver "Test Coverage Gaps"/lint abaixo) efetivamente varre `auth-backend/dist/` mesmo com `dist` no `globalIgnores` do `eslint.config.js:9-21` — o padrão bare `'dist'` não está cobrindo o `dist` aninhado dentro de `auth-backend/`, e o comando real (`npm run lint` → `eslint .`) reportou warning em `auth-backend\dist\clients\drive.js`. Ruído de lint em código gerado.
- Fix approach: `git clean -ndx` periódico pra visibilidade; ajustar `eslint.config.js` pra `'**/dist'` (não só `'dist'`) pra cobrir subpastas.

**`scripts/*.cjs` — ferramentas de patch de workflows com histórico de segredos hardcoded e de corrupção de encoding:**
- Issue: `scripts/` (inteiro gitignored — comentário no `.gitignore:53-54`: "Tooling n8n (scripts de patch/deploy) — contem tokens/URLs internos. NAO versionar (alguns .cjs tinham JWT do Monday hardcoded). Repo publico.") ainda existe no disco com ~30 arquivos `.cjs`/`.js` que fazem PATCH direto nas definições dos workflows n8n em produção, recebendo token por argv (ex.: `deploy_ponto_facultativo.cjs`, `patch_wf5_aions_to_rm.cjs`, `setup_wf_mensal_fifo.cjs`). Um desses round-trips já destruiu literalmente os acentos das definições dos WFs no Postgres do n8n (bytes `0x3F` substituindo caracteres acentuados em `workflow_entity.nodes`), com efeitos reais em produção: label `AUTOMA??O - OK` nunca é setada (erro engolido por `neverError: true` no nó), `N?O INICIADO` criou labels-lixo `101`/`102`/`103` na coluna STATUS PROCESSO do board Solicitação de Pagamento (`18393673859`), `MAR?O` quebra o mês de março em arrays de competência, e `Regra/Fun??o`/`Vale Refei??o`/`PADR?O` no WF Cancelar Convocação fazem o lookup de coluna no board de Valores falhar (raiz provável do "Sem regra de valores" já visto em SEMSA).
- Files: `scripts/` (diretório completo, ~30 arquivos), `.gitignore:53-54`
- Impact: qualquer novo patch script corre o mesmo risco (token por argv em shell history / processo; corrupção de encoding silenciosa que só aparece quando alguém tenta usar aquela label específica).
- Fix approach: migrar edição de workflow pra uma API versionada com encoding explícito (UTF-8 forçado no client HTTP), nunca reimportar/exportar workflow inteiro via ferramenta que não garanta round-trip de encoding; considerar mover esses scripts pra fora do working tree do app (repo separado de infra) já que nunca deveriam ser publicados.

**Lint com erros reais e ruído de arquivo gerado:**
- Issue: `npm run lint` (raiz, cobre `src/` e `auth-backend/src/`) reporta **2 erros** — `@typescript-eslint/no-explicit-any` em `auth-backend/src/scripts/importar-convocacoes.ts:53` e `:55` — violando a convenção do próprio projeto ("TypeScript strict, sem `any`", `CLAUDE.md` seção Convenções) — mais 12 warnings (react-refresh/exhaustive-deps, majoritariamente cosméticos) e 1 warning vindo de `auth-backend/dist/clients/drive.js` (arquivo gerado, ver item acima).
- Files: `auth-backend/src/scripts/importar-convocacoes.ts:53,55`
- Fix approach: tipar a resposta do GraphQL do Monday nesse script (`{ errors?, data: {...} }`) em vez de `as any`.

**Arquivos temporários de debug esquecidos no working tree:**
- Issue: `auth-backend/tmp_mon_teste.cjs` (script ad-hoc de polling de `mensal_run`/`mensal_run_event` via `DATABASE_URL`, usado na investigação de 28/07/2026) e `auth-backend/tsconfig.tsbuildinfo` (artefato de build do TS) estão no working tree, não rastreados pelo git (`git status` mostra ambos como `??`) e não cobertos por regra de `.gitignore` específica dentro de `auth-backend/`.
- Files: `auth-backend/tmp_mon_teste.cjs`, `auth-backend/tsconfig.tsbuildinfo`
- Impact: baixo (não tem segredo hardcoded — lê `DATABASE_URL` do ambiente), mas é o tipo de arquivo que se comitado por engano via `git add -A` vaza detalhe de schema interno (nomes de tabela/coluna do ledger mensal).
- Fix approach: apagar ou mover pro scratchpad; adicionar `tmp_*.cjs` e `*.tsbuildinfo` ao `.gitignore`.

**Listas hardcoded aguardando endpoint dinâmico (TODOs reais):**
- Issue: `src/features/atestados/opcoesAtestadoForm.ts:10,195` — comentário `TODO: substituir por endpoint dinâmico GET /atestado-form-opcoes`, lista de opções do form de atestado ainda hardcoded no frontend. `src/features/ponto-facultativo/contratosMeta.ts:39` — `TODO Codex: substituir por endpoint /ponto-facultativo-contratos-ativos`.
- Files: `src/features/atestados/opcoesAtestadoForm.ts:10,195`, `src/features/ponto-facultativo/contratosMeta.ts:39`
- Impact: contratos/unidades novos (ex.: o próprio caso ADMINISTRATIVO documentado no `CLAUDE.md`) exigem editar código e fazer deploy em vez de só atualizar dado no Monday/RM.
- Fix approach: já existe o padrão certo em outro lugar do mesmo módulo (`src/lib/useUnidadesRm.ts` busca do RM com fallback hardcoded) — replicar pra essas duas listas.

**Cross-referência de ponto facultativo ausente no mirror novo do backend:**
- Issue: `pontos_facultativos: [] as unknown[], // TODO: cruzar board ponto facultativo (F6)` — o endpoint novo `/api/intermitente-finalizar`/leitura equivalente sempre devolve lista vazia, nunca cruza com o board de Ponto Facultativo.
- Files: `auth-backend/src/routes/intermitente.ts:94`
- Impact: se o processo "registro"/"preencher" for chaveado pro backend (`modo=api`, ver `chamarProcesso` em `src/lib/http.ts`) enquanto esse TODO não for resolvido, o `/preencher/:uuid` deixa de bloquear visualmente dias já descontados via Ponto Facultativo — risco de o operacional lançar falta manual num dia que já foi descontado por outro fluxo (duplo desconto).
- Fix approach: implementar o cruzamento (a tabela/ledger de ponto facultativo já existe e é escrita por `auth-backend/src/routes/pontofac.ts`).

## Known Bugs

**Todo intermitente ia como não-optante de VT (VT nunca era pago) — corrigido, não commitado:**
- Symptoms: WF5 calculava `vtDia=0, diasVT=0, valorFinalVT=0` mesmo pra quem o RM listava `Vale Transporte = "SIM"`.
- Files: `auth-backend/src/routes/rm.ts` e `src/features/convocar/api.ts` — o fix está no working tree AGORA (`git diff` mostra mudança não commitada em ambos os arquivos; `git status` os lista como `M`)
- Trigger: `auth-backend/src/routes/rm.ts` devolvia só `optanteVT: "SIM"` (string), enquanto `src/features/convocar/api.ts` só aceitava `o.optante_vt` (contrato do WF8 antigo) ou `o.optanteVT === true` (boolean) — o `String("SIM" ?? "")` de fallback caía sempre em `"NÃO"`.
- Workaround/fix aplicado: backend agora emite `optante_vt` (linha 44 de `rm.ts`) e o front tolera boolean/string via `vtLabel`/`vtOptante` (`src/features/convocar/api.ts:92-103`). **Ainda não commitado** — confirmar `git commit` antes de considerar resolvido em produção.
- Mesma classe ainda ABERTA: `auth-backend/src/routes/rm.ts:39` devolve `secaoDescricao`, mas `src/features/convocar/api.ts:241-243` lê `o.localUnidade ?? o.local_unidade` — nenhuma dessas chaves existe na resposta desse endpoint, então `localUnidade` fica sempre `undefined` quando os resultados vêm do `auth-backend` (rota `/api/convocar-buscar-empregado`) em vez do n8n. Da mesma forma, `contrato` vem formatado como `"85-SEMSA"` (saída de `parseCodigoContrato()` em `auth-backend/src/domain/mobilidade.ts:33-45`, que sempre monta `base + "-" + nome`, ex. `"04-DETRAN"`, `"79-TRE PB"`), enquanto o resto do app (fallback `OPCOES_CONVOCACAO_FALLBACK.contratos`, `unidadesParaContrato()`) espera só o nome (`"SEMSA"`, `"DETRAN"`). Hoje o impacto é limitado porque `form.contrato` em `src/features/convocar/FormularioConvocacao.tsx:60-76` sempre começa vazio (o operador escolhe manualmente) — mas qualquer código futuro que tente pré-selecionar contrato a partir de `empregado.contrato` herda o bug de formato.
- Nota de exposição: este endpoint (`auth-backend/src/routes/rm.ts`) só é chamado de fato quando o "Plano de Fuga" (`src/lib/http.ts:96-139`, `chamarProcesso`) estiver em modo `auto` (com o n8n falhando) ou `api` pro processo `convocar`. Ou seja, é um bug latente que só aparece justamente durante uma contingência — o peor momento possível, porque some da vista em operação normal e só é descoberto quando já se está lidando com uma falha do n8n.

**WF5 Pontual — convocações de 1–2 dias nunca geram Solicitação de Pagamento (efeito financeiro já ocorreu):**
- Symptoms: convocação pontual concluída, crédito Caju JÁ criado/confirmado e débito no board Controle Caju (`7833600425`) JÁ feito, histórico RM (`ZMDHSTBENFUNC`) JÁ gravado — mas nenhuma Solicitação de Pagamento é criada, o WF6 (integração financeira RM, eventos 100/110) nunca é chamado, e o Drive nunca arquiva.
- Files: workflow n8n `Intermitente — WF5 Pontual FIFO (NOVO)` (id `E1XAdrEbPy5lZhNS`, citado em `docs/contingencia/pagamentos.md:3`) — vive no n8n, não neste repositório git. O handler equivalente no backend está deliberadamente `gated` (`auth-backend/src/jobs/runner.ts:31`).
- Trigger: no nó `Code in JavaScript8` do WF5, `temBoleto = totalBoleto > 0`; o crédito Caju cobre no máximo 2 dias de VR + 2 de VT, então qualquer convocação de 1–2 dias gera `totalBoleto = 0`. O nó `If5` só tem a saída `true` conectada (→ `Preparar Solicitacao Pgto`) — a saída `false` é um beco sem saída. Mesmo problema em `If2` (`valorFinalVR > 0 OR valorFinalVT > 0`) quando o FIFO de desconto zera os dois valores.
- Impact observado: 44 de 66 execuções retidas entre 22/07 e 28/07/2026 ficaram sem Solicitação de Pagamento, quase todas do contrato SEMSA — dinheiro/crédito já efetivado sem o registro contábil correspondente.
- Workaround: nenhum automático hoje; requer reconciliação manual (ver `docs/contingencia/pagamentos.md`, que documenta exatamente esse tipo de cenário — Caju criado mas RM/Solicitação não).

**Corrupção de encoding nas definições dos workflows n8n (produção):**
- Symptoms: labels com `?` literal em vez de caractere acentuado dentro do Monday/n8n.
- Files: `workflow_entity.nodes` no Postgres do n8n (schema `nocturnalgoose`, não neste repo) — casos concretos: `AUTOMA??O - OK` (status nunca setado; erro mascarado por `neverError: true` no nó), `N?O INICIADO` (criou labels-lixo `101`/`102`/`103` na coluna STATUS PROCESSO do board Solicitação de Pagamento `18393673859`), `MAR?O` (quebra a competência de março em arrays de nome de mês), `Regra/Fun??o` / `Vale Refei??o` / `PADR?O` no WF Cancelar Convocação (lookup de coluna no board de Valores falha), `Atestado M?dico` no WF Lançar Documentos.
- Trigger: round-trip de algum `scripts/*.cjs` de patch que não preservou UTF-8 (ver item de Tech Debt acima sobre `scripts/`).
- Workaround: nenhum — precisa reescrever as strings afetadas direto no n8n.

**Task runner do n8n saturado sob carga:**
- Symptoms: Code nodes com `Task request timed out after 20 seconds`.
- Files: n8n (infraestrutura, não código deste repo) — observado em execuções de Finalizar (2×), Cancelar (1×) e Buscar empregado (3×) entre 27/07 12:41–12:49.
- Impact: falhas transitórias de infraestrutura que se manifestam como erro genérico pro usuário final, sem relação com o payload enviado.

**`DP - ATIVAÇÃO CAJU` — 86 erros HTTP 409 "Employee is already active":**
- Symptoms: 86 chamadas de reativação de funcionário na Caju falhando com 409.
- Files: workflow n8n de ativação Caju (não neste repo).
- Trigger: falta um guard checando se o funcionário já está ativo antes de tentar o `unarchive`.
- Impact: ruído de log/monitoramento; não bloqueia o fluxo principal, mas mascara sinais reais de erro no mesmo canal.

**Mensal bloqueado por permissão insuficiente do token Monday em boards privados:**
- Symptoms: `create_item` com `column_values` no board Controle Saldo Caju (`7833600425`) devolve **403 `UserUnauthorizedException`**; `create_item` vazio passa, mas o `change_multiple_column_values` seguinte também dá 403. Resultado observado no ensaio: itens de débito criados só com o nome, colunas vazias.
- Files: `docs/mensal-duravel.md:38-58` (seção "PENDÊNCIA BLOQUEANTE"), efeito implementado em `auth-backend/src/mensal/mondayEfeitos.ts`
- Trigger: o `MONDAY_TOKEN` do backend pertence a um usuário **subscriber** (não membro/owner) do board privado; o WF do pontual funciona porque usa um token de usuário **owner** (hardcoded, "Mike") diferente do token do backend.
- Impact: bloqueante documentado para produção financeira do mensal — sem acesso de escrita, o Controle Saldo Caju não é gravável mesmo com o código 100% pronto e testado (paridade 160/160 registrada no mesmo doc).
- Correlato: a service account do Google Drive (`drive-intermintente@...`) tinha só leitura no Shared Drive "BENEFÍCIOS 01" — mesma classe de problema (infra/permissão, não código) bloqueando o efeito Drive do mensal.
- Fix approach documentado: adicionar o usuário do `MONDAY_TOKEN` como membro/owner dos boards privados (Controle Saldo Caju, Solicitação de Pagamento), OU apontar `MONDAY_TOKEN` pra uma conta já owner (padrão do pontual).

## Security Considerations

**`/api/ponto-facultativo-preview` e `/api/ponto-facultativo-aplicar` sem nenhuma verificação de sessão no backend:**
- Risk: controle de acesso "só DP + Admin" existe APENAS no React Router do frontend (`src/App.tsx:46-51`, `<Route element={<RequireRole nivelMinimo="dp" />}>` envolvendo `/ponto-facultativo`) — o backend não reforça nada. `auth-backend/src/routes/pontofac.ts` registra `app.post("/api/ponto-facultativo-preview", ...)` (linha 375) e `app.post("/api/ponto-facultativo-aplicar", ...)` (linha 396) sem chamar `usuarioDaSessao`/`exigirAdmin`/qualquer guard — e não existe hook global de auth em `auth-backend/src/app.ts` (nenhum `onRequest`/`preHandler` registrado ali; cada arquivo de rota é responsável pelo próprio guard, e este não tem nenhum).
- Files: `auth-backend/src/routes/pontofac.ts:375-410` (falta de guard), `auth-backend/src/app.ts:30-67` (confirma ausência de hook global), `src/App.tsx:40-52` (mostra que o guard "DP+Admin" é só client-side)
- Current mitigation: nenhuma. Diferente de `/preencher/:uuid` e `/descontos/:uuid` (rotas intencionalmente públicas, mas protegidas por um UUID longo e aleatório — "Sem login — segurança = UUID longo aleatório", decisão documentada no `CLAUDE.md`), os parâmetros de `/api/ponto-facultativo-aplicar` são `{contrato, unidade, data, beneficios}` — **nenhum segredo**, apenas valores enumeráveis/adivinháveis (nome de contrato, data). Qualquer requisição HTTP direta (sem cookie de sessão) que chegue no backend consegue disparar desconto real de VR/VT em massa pra todos os intermitentes convocados naquele contrato/unidade/data, e grava no board Base de Desconto (`18400981023`).
- Recommendations: adicionar `usuarioDaSessao` + checagem de papel (`dp`/`admin`) nos dois handlers, no mesmo padrão já usado em `auth-backend/src/routes/mensalOrquestracao.ts:21-26` (`exigirDP`) ou `auth-backend/src/routes/boards.ts:23-34` (`exigirAdmin`). Prioridade alta — é o único módulo de escrita financeira do backend sem qualquer controle de acesso no servidor.

**Segredos compartilhados por chat, pendentes de rotação:**
- Risk: chave da ponte AIONS (RM), token n8n e token Monday foram colados em conversa de chat durante a depuração do mensal (registrado como pendência em 13/07/2026, "Rotacionar segredos colados em chat").
- Files: nenhum arquivo do repo — o risco é o canal de comunicação, não o código. Consumidos via env em `auth-backend/src/config.ts:60-63` (`rmAionsAuth`, `mondayToken` etc., ambos carregados de env, sem hardcode).
- Current mitigation: os valores não estão hardcoded em código versionado (confirmado por busca por padrões de token/URL-com-credencial em `src/`, `auth-backend/src/`, `api/`, `workflows/` — nada encontrado além de nomes de header como `AIONS-AUTH` e comentários "sem hardcode").
- Recommendations: confirmar se a rotação já ocorreu desde 13/07; se não, tratar como prioridade (qualquer pessoa com acesso ao histórico do chat tem essas credenciais).

**`MENSAL_TEST_BYPASS_ANTIFRAUDE` remove a proteção contra pagamento duplicado:**
- Risk: quando `MENSAL_TEST_BYPASS_ANTIFRAUDE=1`, `POST /api/mensal/runs/previa` aceita `bypassAntifraude: true` mesmo em modo `producao` (`auth-backend/src/routes/mensalOrquestracao.ts:70-74`), processando contratos já pagos.
- Files: `auth-backend/src/config.ts:97`, `auth-backend/src/routes/mensalOrquestracao.ts:70-74`
- Current mitigation: comentário explícito no código ("NUNCA deixar ligada fora de uma janela de teste") + é uma env var, não um default ligado (`opt`/`=== "1"`, default off). Mas não há trava automática (ex.: expiração por tempo, ou exigir um segundo flag por request) — a segurança depende 100% de alguém lembrar de desligar a env var no Vercel depois da janela de ensaio.
- Recommendations: preferir um mecanismo com expiração automática (ex.: flag válido só nas N horas seguintes ao set) em vez de on/off manual permanente.

**Endpoints públicos por UUID sem rate limiting visível:**
- Risk: `/preencher/:uuid`, `/descontos/:uuid` e os respectivos endpoints (`auth-backend/src/routes/espelhoIntermitente.ts`, `auth-backend/src/routes/descontos.ts`) são intencionalmente sem login, protegidos só pela entropia do UUID/protocolo. Não foi encontrado nenhum middleware de rate limit (`@fastify/rate-limit` não está entre as dependências do `auth-backend/package.json`).
- Files: `auth-backend/src/app.ts` (sem plugin de rate limit registrado), `auth-backend/src/routes/espelhoIntermitente.ts`, `auth-backend/src/routes/descontos.ts`
- Current mitigation: espaço de busca grande (UUID v4 + protocolo em alfabeto sem ambíguos) torna brute-force impraticável na prática.
- Recommendations: defesa em profundidade — rate limit por IP nesses endpoints públicos custa pouco e reduz superfície de enumeração/DoS.

## Performance Bottlenecks

**Task runner do n8n Cloud saturando sob carga concorrente:**
- Problem: Code nodes excedendo o timeout de 20s do task runner do n8n Cloud.
- Files: infraestrutura n8n (fora deste repo); sintoma observado em Finalizar/Cancelar/Buscar empregado em 27/07/2026.
- Cause: volume de execuções concorrentes acima da capacidade alocada do runner.
- Improvement path: monitorar taxa de erro por timeout; se recorrente, é argumento a favor de acelerar o cutover pro backend (que não depende do task runner do n8n) descrito em `02-PLANO-DE-FUGA.md`.

**`items(ids:)` do Monday em lote grande pode devolver `column.title` nulo:**
- Problem: consultas em lote (muitos IDs de uma vez) ocasionalmente devolvem coluna com `title: null`, quebrando qualquer código que resolva coluna por título nesse ponto específico.
- Files: relevante para qualquer código que use `clients/monday.ts`/`monday.ts` com lookup por título em lote grande.
- Cause: comportamento observado da API do Monday sob volume, não documentado oficialmente.
- Improvement path: auditar/mapear por `column.id` (estável) em vez de `column.title` quando o lote for grande; já é o padrão predominante no registry (`board_colunas` mapeia por nome UMA vez no cadastro, não a cada leitura em lote).

## Fragile Areas

**Divergência de contrato de campo entre backend e frontend — causa raiz sistêmica:**
- Files: `auth-backend/src/routes/rm.ts`, `auth-backend/src/routes/rmLookups.ts`, `src/features/convocar/api.ts`, `src/features/atestados/api.ts`
- Why fragile: não existe validação de schema (zod ou similar) nem tipo compartilhado entre o que o `auth-backend` devolve e o que o frontend espera — cada lado declara seu próprio `type`/`interface` TypeScript, e a única coisa que os mantém sincronizados é disciplina humana. O incidente de VT (ver Known Bugs) e o mismatch `secaoDescricao`/`localUnidade` são dois sintomas do MESMO problema estrutural. `auth-backend/package.json` não lista `zod` nem `ajv` entre as dependências — a validação de payload de entrada nas rotas é manual (`String(x ?? "")`, checagem de campo obrigatório um a um).
- Safe modification: ao adicionar/renomear um campo de resposta em qualquer rota `auth-backend/src/routes/*.ts`, grep explicitamente pelo nome antigo E o novo em `src/features/*/api.ts` antes de considerar a mudança segura — não existe teste de contrato que pegue isso automaticamente hoje.
- Test coverage: nenhuma (ver seção de Test Coverage Gaps).

**Antifraude de período em `/api/convocar/criar` — race condition (check-then-act):**
- Files: `auth-backend/src/routes/convocar.ts:256-298` (busca conflitos) seguido de `createItem(...)` em `:329`
- Why fragile: a checagem de overlap de período (busca convocações existentes por chapa/nome, filtra por status/cancelamento) e a criação do item são duas operações HTTP separadas contra o Monday, sem lock/transação entre elas. Duas submissões quase simultâneas para a mesma chapa (duplo clique, ou dois operadores digitando a mesma convocação) podem ambas passar a checagem antes de qualquer uma criar o item, resultando em duas convocações sobrepostas — exatamente o que a checagem existe para prevenir.
- Safe modification: se for adicionar mais lógica de antifraude, considerar mover pra dentro de uma transação com lock (o padrão já existe em `auth-backend/src/mensal/repo.ts:80-87`, `travarRun()` via `pg_advisory_xact_lock`) — hoje só o mensal tem essa proteção.
- Test coverage: existe teste de domínio para antifraude (`auth-backend/src/domain/antifraude.test.ts`), mas testa a função pura de overlap, não a race condition end-to-end na rota.

**Registro de retirada manual (`/api/descontos/registrar`) — read-modify-write sem lock, impacto financeiro direto:**
- Files: `auth-backend/src/routes/descontos.ts:80-139`
- Why fragile: o handler lê o item do Monday (`acharItensPorColuna`, linha 93), calcula `novoDescVR`/`novoResVR`/etc em memória a partir dos valores lidos, e escreve de volta (`changeColumnValues`, linha 123) — sem transação, sem lock, sem verificação otimista (ex.: comparar um `updated_at`/versão antes de escrever). O guard de "já registrado" (linha 98) só olha o status lido no início da mesma requisição, então duas requisições concorrentes pra o mesmo `uuid` (duplo clique no botão "Confirmar" do wizard `/descontos/:uuid`, ou retry após timeout de rede) podem ambas passar o guard antes de qualquer uma escrever, e a segunda escrita sobrescreve a primeira silenciosamente — potencialmente autorizando duas retiradas quando só uma deveria ser possível.
- Safe modification: adicionar lock (advisory lock por `uuid`, ou idempotency key vinda do cliente) antes de expor esse endpoint a mais tráfego.
- Test coverage: nenhum teste para `descontos.ts` (nenhum `descontos.test.ts` existe).

**`pontofac.ts` aplicar — idempotência protege o espelho Postgres, não a escrita real no Monday:**
- Files: `auth-backend/src/routes/pontofac.ts:470-544`
- Why fragile: a chamada que efetivamente incrementa o desconto no board Monday (linhas 478-517, `change_multiple_column_values`/`create_item` incrementando `diasPerdeVR`/`descontoVR`/etc a partir do valor lido) roda ANTES e SEM relação com o `reservarEfeito()` (linha 526) — que só decide se o **espelho PG** (`upsertDesconto`, linha 528) deve rodar. Ou seja, reenviar a mesma requisição de "aplicar" (mesmo contrato/unidade/data/benefícios) — por retry de rede ou duplo clique — incrementa o desconto no Monday de novo, mesmo que o espelho PG corretamente identifique que aquele efeito já foi "confirmado".
- Safe modification: mover a chave de idempotência (`reservarEfeito`) para ANTES da escrita no Monday, cobrindo o efeito real, não só o espelho.
- Test coverage: nenhum teste para `pontofac.ts`.

**`driveArquivar.ts` — falhas ao atualizar links no Monday são engolidas sem log:**
- Files: `auth-backend/src/services/driveArquivar.ts:201-223` (três chamadas, linhas 207, 216, 222: `.catch(() => undefined)`)
- Why fragile: se `changeColumnValues` falhar ao escrever o link da pasta do Drive de volta no item do Monday (rede, rate limit, coluna renomeada), a função inteira ainda retorna sucesso (`{ok: true, ...}` na linha 225) — quem chama (`auth-backend/src/routes/convocar.ts:368`, que já envolve a chamada inteira num `.catch((e) => req.log.warn(...))`) nunca vê o erro específico, porque ele nunca escapa do `driveArquivar.ts`. Resultado possível: pasta criada e arquivo enviado corretamente, mas o item no Monday nunca mostra o link — sem nenhum log em nenhum lugar apontando a causa.
- Safe modification: logar (mesmo sem um `req.log` disponível nesse módulo de serviço, um `console.error` com contexto já ajudaria) antes de descartar o erro.
- Test coverage: nenhum teste para esse comportamento específico de fallback.

**Dependência do n8n como ponto único de falha para dinheiro real:**
- Files: `docs/contingencia/pagamentos.md`, `docs/contingencia/ensaio.md`, `auth-backend/src/jobs/runner.ts:24-34` (pontual/virada/caju_poll ainda `gated`)
- Why fragile: o pontual (WF5, maior volume financeiro do sistema) roda 100% no n8n hoje; a única contingência documentada é um runbook manual (`docs/contingencia/pagamentos.md`) que pede pra alguém abrir o console da Caju, procurar pedidos por nome determinístico, conferir lançamentos RM por chapa, e registrar manualmente em `pi.efeitos_externos` — processo humano, sujeito a erro, exatamente no cenário (n8n fora) em que a pressão operacional é maior.
- Safe modification: qualquer avanço no roadmap F8 (`02-PLANO-DE-FUGA.md`, "Pontual FIFO — risco ALTO") deve vir com o mesmo nível de teste de paridade que o mensal recebeu antes do cutover.
- Test coverage: o harness de paridade (`auth-backend/src/scripts/paridade-mensal.ts`) cobre mensal; não existe equivalente para pontual ainda.

## Scaling Limits

**Ponte RM via ngrok — lotes obrigatórios:**
- Current capacity: chamadas em lotes de até 50 chapas (`docs/mensal-duravel.md:32`, `RM_BRIDGE_URL`).
- Limit: volume maior que isso derruba o túnel ngrok (`headed-shawl-annex.ngrok-free.dev`).
- Scaling path: já mitigado por design (jobs com cursor por lote, per `02-PLANO-DE-FUGA.md` seção 4) — mas continua sendo um teto duro enquanto a ponte RM depender de ngrok em vez de um endpoint estável.

**Coluna `long_text` do Monday (~2000 caracteres):**
- Current capacity: períodos típicos de `respostas_json`/ledger ficam em ~2KB, perto do limite.
- Limit: convocações muito longas (ex.: MENSAL de um mês inteiro com muitas respostas granulares, ou histórico de correções acumuladas) podem estourar o limite da coluna e truncar dados sem aviso — Monday não retorna erro claro nesse caso, só corta.
- Scaling path: monitorar tamanho do JSON antes de escrever; se aproximar do limite, mover pro modelo `pi.convocacoes` (Postgres, sem limite prático de tamanho de `jsonb`) como fonte de verdade pra esses campos.

**Retenção curta de logs de execução do n8n (~6 dias):**
- Current capacity: `nocturnalgoose.execution_entity`/`execution_data` no Postgres do n8n guardam só os últimos ~6 dias de execuções.
- Limit: qualquer investigação de incidente mais antigo que isso perde a evidência bruta (runData nó-a-nó); a investigação de 28/07/2026 já bateu nesse limite pra incidentes anteriores.
- Scaling path: exportar/arquivar execuções relevantes (ex.: qualquer execução com `status='error'`) pra uma tabela própria antes da poda, se auditoria de médio prazo for necessária.

## Dependencies at Risk

**`workflow` (Vercel Workflow DevKit) v4.6.0 como motor de execução do mensal:**
- Risk: é a dependência que hoje executa dinheiro real (mensal, `workflows/mensal.ts`, 680 linhas/12 etapas) via `start()`/`getStepMetadata`/`sleep` (`auth-backend/src/routes/mensalOrquestracao.ts:2,44`). É um pacote relativamente novo/de nicho (Workflow DevKit da Vercel) comparado a alternativas mais maduras (ex.: filas Postgres simples, Temporal). Não há teste de fallback documentado se a API do pacote mudar entre versões maiores, nem plano B se o pacote for descontinuado.
- Impact: qualquer breaking change na API do `workflow` exige revisão de `workflows/mensal.ts` inteiro antes do próximo ciclo de folha mensal.
- Migration plan: nenhum documentado. A infraestrutura alternativa já desenhada (`pi.jobs` + `runner.ts`, ver Tech Debt) poderia ser o plano B, mas está inerte e não foi validada pra esse volume/complexidade.

**n8n Cloud como espinha dorsal do pontual e de parte do RM/Caju/atestados:**
- Risk: SaaS de terceiro (`aionscorp-n8n.cloudfy.live` / `antigoaionscorp-n8n.cloudfy.live`) com dois hosts coexistindo durante a migração, retenção de log curta (~6 dias, ver Scaling Limits), e já com pelo menos 3 classes de bug ativas nesta análise (task runner saturado, mojibake nas definições, WF5 If5/If2 sem saída) sem que nenhuma delas apareça em CI/teste algum deste repositório (o n8n não é testado por nada versionado aqui).
- Impact: alto — é literalmente o sistema que hoje paga VR/VT/boleto de intermitentes pontuais.
- Migration plan: documentado em `02-PLANO-DE-FUGA.md` (F8 "Pontual FIFO", risco ALTO, pré-requisito F2+idempotência+jobs+caju) — ainda não iniciado (`pontual: gated` em `auth-backend/src/jobs/runner.ts:31`).

## Missing Critical Features

**Sincronização Postgres → Monday (pós-contingência) não implementada:**
- Problem: quando o "Plano de Fuga" cai pro backend (`modo=api`/`auto` com fallback), os writes acontecem só em Postgres; o mecanismo que deveria replicar de volta pro Monday (`sync_monday`) é um stub (ver Tech Debt). O próprio `docs/contingencia/ensaio.md:42` documenta isso como esperado hoje.
- Blocks: uso de contingência por qualquer período mais longo que "o DP aceita reconciliar manualmente depois" — hoje a contingência de escrita é descrita como confiança "média", subindo pra "alta" só depois do ensaio ser rodado com sucesso (`docs/contingencia/ensaio.md:90-92`).

**Cron de jobs (`/api/jobs/tick`) nunca registrado no ambiente real:**
- Problem: `auth-backend/vercel.crons.example.json` (referência) inclui `{ "path": "/api/jobs/tick", "schedule": "* * * * *" }`, mas o `vercel.json` da raiz (o que de fato rege o deploy, com as `rewrites`/`crons` reais) só tem o cron de retenção mensal. O handler `expiracao` (marcar convocações Aguardando vencidas como Expirado em `pi.convocacoes`) está implementado e correto (`auth-backend/src/jobs/runner.ts:9-16`), mas nunca roda.
- Blocks: expiração automática de convocações no modelo Postgres. Hoje isso não é crítico porque o Monday/n8n ainda é primário e calcula expiração on-the-fly na leitura (`WF2 calcula on-the-fly`, per `CLAUDE.md`), mas vira um problema no dia em que `pi.convocacoes` precisar ser fonte de verdade sozinha.

## Test Coverage Gaps

**Frontend inteiro sem nenhum teste automatizado:**
- What's not tested: toda a árvore `src/` — zero arquivos `*.test.*`/`*.spec.*` encontrados em todo o frontend (busca por `find src -name "*.test.*" -o -name "*.spec.*"` não retornou nenhum resultado).
- Files: `src/` (todos os ~15 diretórios de feature)
- Risk: lógica de UI com regras de negócio embutidas (validação do wizard de split, cálculo de dias cortados por cancelamento parcial, regras de bloqueio de atestado/declaração em `src/features/atestados/shared.tsx`, máscara de moeda em `src/features/descontos/shared.ts`) pode regredir silenciosamente em qualquer refactor.
- Priority: Média (a lógica financeira "de verdade" está no backend, que tem alguma cobertura — mas a UI é onde o operador vê e confia no número antes de confirmar).

**Camada HTTP/rotas do backend sem teste, só a lógica de domínio pura é testada:**
- What's not tested: `auth-backend/src/routes/*.ts` — de 23 arquivos de rota, só `mensalRun.ts` tem teste (`mensalRun.test.ts`). Não há teste para `convocar.ts` (onde vive a race de antifraude), `pontofac.ts` (onde vivem o gap de auth e o gap de idempotência), `descontos.ts` (onde vive a race de retirada manual), `finalizar.ts`/`espelhoIntermitente.ts` (o cálculo de desconto na finalização), `rm.ts`/`rmLookups.ts` (onde vive o bug de shape do VT/localUnidade), `atestados.ts`, `boards.ts`, `drive.ts`, `contingencia.ts`.
- Files: `auth-backend/src/routes/` (ausência de `.test.ts` para os arquivos citados)
- Risk: exatamente os bugs encontrados nesta análise (race conditions, gap de auth, mismatch de contrato de campo) são do tipo que teste de integração de rota (subir o Fastify, bater no endpoint, checar side-effect) pegaria — e é exatamente a camada sem cobertura. A cobertura existente (`auth-backend/src/domain/*.test.ts`: `antifraude`, `desconto`, `descontoDia`, `feriado`, `fifo`, `ledgerBeneficios`, `mobilidade`; `auth-backend/src/mensal/*.test.ts`: `calculo`, `driveEfeitos`, `mondayEfeitos`, `rmEfeitos`; `auth-backend/src/clients/*.test.ts`: `caju`, `monday`) é toda em funções puras de domínio — ótima prática, mas deixa a orquestração HTTP (onde os bugs de auth/race vivem) inteiramente descoberta.
- Priority: Alta — cobrir pelo menos `pontofac.ts` (auth) e `descontos.ts`/`convocar.ts` (races) antes de qualquer aumento de tráfego real nesses fluxos.

**Nenhum teste de contrato entre `auth-backend` e frontend:**
- What's not tested: o shape das respostas de `auth-backend/src/routes/rm.ts`/`rmLookups.ts` contra o que `src/features/convocar/api.ts`/`src/features/atestados/api.ts` esperam. Não existe schema compartilhado (zod/OpenAPI) nem teste de snapshot cruzando os dois lados.
- Files: `auth-backend/src/routes/rm.ts`, `src/features/convocar/api.ts`
- Risk: é literalmente o buraco que causou o incidente de VT de 28/07/2026 e que ainda deixa aberto o mismatch `secaoDescricao`/`localUnidade` e o formato de `contrato`. Sem teste de contrato, a próxima mudança de shape em qualquer lado só será descoberta em produção.
- Priority: Alta.

---

*Concerns audit: 2026-07-28*
