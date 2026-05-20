# Plano de Intermitentes — App web

App web pra **gerenciar convocações de intermitentes** no monday: cria convocação, registra ocorrências dia-a-dia (faltou/atrasou) e permite correção via protocolo. Acesso via link único da convocação (registrar ocorrência) ou via **hub principal** (criar convocação / corrigir).

## Estado atual do projeto (2026-05-20)

### Iterações recentes consolidadas

- **`/atestados` standalone** com modos Intermitente e CLT, ambos via busca RM. Form alinhado ao board Atestado Ponta (`18298015951`, view `223887647`) — 13 campos. Header RM mostra Cód. seção (font-mono).
- **CLT consome campos novos do RM**: `codigo` / `secaoCodigo` (código da seção, ex: `01.01.0004.01.0001`), `localUnidade` (descrição amigável, ex: "DETRAN - MANAUS"), `contrato` (já inferido pelo n8n).
- **Mapa Seção→Contrato determinístico** (`src/features/atestados/mapaSecaoContrato.ts`): 3º octeto do `Codigo` da seção define contrato. Derivado do dump completo de celetistas (`todos.CSV`, 1132 funcionários). Mapa: `0004`→DETRAN, `0010`→SEDUC SEDE, `0011.01`→SEDUC ESCOLA, `0011.02`→SEDUC INTERIOR, `0074`→CETAM, `0079`→TRE PB, `0085`→SEMSA. Seções fora do mapa (estagiários, aprendizes, afastados) ficam vazias — operacional escolhe manual (SQL no RM agora só retorna esses 7 contratos, então fallback inalcançável na prática).
- **Contrato readonly no WizardDocumento**: campo `contrato_colaborador` deixa de ser SelectGlass editável — vira chip âmbar read-only `[RM] <contrato>` já inferido. Fallback select só aparece se mapa retornar vazio.
- **Bug 2x Voltar resolvido**: AtestadosPage renderizava Voltar global + WizardDocumento Voltar interno duplicado. Global escondido quando etapa = `wizard-intermitente`|`wizard-clt`.
- **Cálculo de desconto VR/VT saiu do WF Lancar Documentos** — apenas cria item no board Controle de Atestados + anexa arquivo. Automação futura cruzará atestado×convocação.
- **Calendário restrito ao mês corrente** (sem nav prev/next). Click data inicial → dialog "quantos dias?" 1-60. Dias com convocação ativa ganham ponto verde (intermitente only).
- **Resumo flutuante (dock macOS-like)** + badge bounce no contador `{N}` ao adicionar doc (scale 1→1.45→1 spring overshoot 480ms).
- **Cancelamento parcial NÃO finaliza mais** (`/preencher`). Bug reportado pelo DP: lançou atraso 420min dia 1 + cancelamento parcial dias 2-10. Só cancelamento foi persistido — atraso perdido (porque cancelamento renderizava TelaCancelamentoConvocacao em tela cheia, desmontando painel antes de Finalizar). Agora cancelamento parcial fecha dialog e mantém painel aberto. Cancelamento TOTAL continua finalizando direto (comportamento preservado).
- **Tile cancelado parcialmente**: visual simples — tile escuro `rgba(12,10,10,0.92)` + `<CancelXIcon />` (2 linhas vermelhas formando ✕ com breath sutil contínuo) + texto "Dia cancelado". Mantém `glass-tile-3d` (tilt mousemove preservado). Click abre `DialogReverterCancelamento`. Animação no botão "Cancelar convocação" do header: metamorfose X → ⊘ (sinal de proibido) com circle se desenhando + 6 partículas radiais.
- **Split de convocação** (`/preencher`): operacional pode dividir convocação em 2 partes com contratos diferentes (ex: 01-07/05 CETAM + 08-20/05 SEDUC). Botão violeta "Dividir convocação" / "Editar divisão" no header com ícone `SplitIcon` (2 retângulos que se afastam + lâmina rosa rasga + sparkles). Wizard 4 etapas (calendário com bloqueio de primeiro/último/cancelado → 2 GlassSelect P1≠P2 → confirmação → sucesso). Quando split ativo: render do grid se divide em 2 `<SplitSection>` (border-left tonal âmbar/sky + header eyebrow + nome contrato + grid de dias). Persistência via `POST /intermitente-aplicar-split` (coluna Split JSON no item ENTRADA). Ao Finalizar: WF3 estendido cria 2 subitems no item ENTRADA com agregados separados por parte (item Histórico parent mantém agregados consolidados). Coexiste com cancelamento parcial.
- **Flicker fixes consolidados** (`src/index.css`):
  - SlideStack sem opacity/scale no Slot — slide horizontal puro (iOS Settings pattern). Eliminou ghosting em texto Instrument Serif.
  - Google Fonts URL com `display=optional` (era `swap`) — sem FOUT mid-slide.
  - `prefers-reduced-motion` global — zera animations + mantém 80ms em transitions de hover.
  - `.choice-btn > *` com `translateZ(0)` + `backface-visibility: hidden` — texto não pisca quando pai tilta 3D.
  - `.slide-stack-animating *` mata animation em todos descendentes.
  - `.icon-3d-only` drop-shadow estático (era recalculado a cada frame).
- **BuscarPessoa otimizado**: hook do modo NÃO ativo passa query vazia → só endpoint do modo ativo dispara request.

### Endpoints n8n consolidados (2026-05-20)

| Endpoint | Quem chama | Estado |
|---|---|---|
| `GET /convocar-buscar-empregado?nome=` | `/convocar` e `/atestados` (intermitente) | WF8 estável (`BEN 2`, `CODCATEGORIAESOCIAL=111`) |
| `GET /celetista-buscar-empregado?nome=` | `/atestados` (CLT) | Funcionando. SQL no RM filtra os 7 contratos válidos. Retorna `codigo`/`secaoCodigo`/`localUnidade`/`contrato` extras (frontend usa pra auto-preencher). |
| `GET /intermitente-convocacoes-empregado?chapa=&mes=` | `/atestados` (intermitente, visual only) | Funcionando. Frontend usa só pra ponto verde no calendário. |
| `POST /intermitente-lancar-documentos` (multipart) | `/atestados` (ambos modos) | Funcionando. Só cria item Controle de Atestados + anexa arquivo. Desconto = automação futura. |
| `POST /intermitente-finalizar` (JSON) | `/preencher` | JSON-only sem atestado. **Pendência Codex (split)**: ler `payload.split` (já enviado); se presente, particionar respostas/dias por data corte, calcular agregados por parte, criar 2 subitems no item ENTRADA via `create_subitem` (idempotente via lookup por `name`). Item Histórico parent mantém agregados consolidados (comportamento atual). |
| `POST /intermitente-convocar` (multipart) | `/convocar` | WF7 estável. |
| `POST /intermitente-cancelar-convocacao` | `/preencher` cancelamento | Aceita `tipo: "total"` \| `"parcial"`. **Pendência Codex**: aceitar `tipo: "reverter"` → limpar `Cancelamento Início`, set `Status Convocação=Válida`, `Status Cancelamento=null`, reverter desconto criado. |
| `POST /intermitente-aplicar-split` *(novo)* | `/preencher` (wizard Dividir) | **Pendência Codex**: criar WF que aceita `{tipo: "aplicar", data_inicio_parte2, contrato_parte1, contrato_parte2}` ou `{tipo: "reverter"}`. Escreve coluna `Split JSON` (long_text, criar) no item ENTRADA via `change_simple_column_value`. Retorna `{ok, split}`. Frontend já chama (mock-pronto-split disponível). |
| `GET /intermitente-ler` (WF2) | `/preencher` | **Pendência Codex**: (1) devolver `data_inicio_cancelamento` (`date_mm3b88ta`) + `status_cancelamento` (mapeado de `color_mm3a8ana`) pro tile cancelado. (2) devolver `split` parseado da nova coluna `Split JSON` pro tile split (`{data_inicio_parte2, contrato_parte1, contrato_parte2}` ou null). |

### Funcionando end-to-end (mock + real, produção na VM):

### Frontend (SPA React)
- **Hub principal** (`/`) — eyebrow `ClipboardCheck` + título display "Escolha o próximo passo" + 3 tiles `glass-tile-3d` (Nova convocação / Atestados e declarações / Atualizar ocorrência) com tilt 3D no mousemove. Rodapé com link discreto "Abrir testes" → `/teste`. Actions vêm de array tipado com `tone: "blue" | "amber" | "gold"`.
- **Convocar** (`/convocar`) — substitui o form nativo do monday do board de entrada. SlideStack ancorado **dentro** do card glass-strong, botão Voltar fixo fora do slide. Etapas internas:
  1. **Buscar empregado** — autocomplete por nome (search-as-you-type, debounce 250ms, min 3 chars, highlight das letras buscadas, 3 visíveis + "ver todos")
  2. **Formulário convocação** — 15 campos + bloco read-only com dados do RM (Nome, Chapa, CPF, Função, Admissão, Seção). Selects e DatePicker custom via Dialog (mesmo padrão visual do `DialogDia` de registrar ocorrência). Opções dos selects vêm de `useOpcoesConvocacao()` (lazy load do n8n com fallback local).
  3. **Tela sucesso** — ID do item + URL do board monday + CTA "Nova convocação"
- **Preencher** (`/preencher/:uuid`) — painel com modal por dia, perguntas no positivo ("foi trabalhar?", "chegou no horário?"), adicionar/apagar dias com bolha estourando, fluxo de correção via protocolo `PROT-XXXX-XXXX`. **Cancelar convocação** (ícone fogo no header) abre wizard: parcial (calendário → escolhe data → tela `confirmar_parcial` exige clique "Confirmar") ou total (data = primeiro dia → tela `confirmar_total`). **Cancelamento parcial NÃO finaliza o registro** — fecha dialog, painel continua aberto, operacional ainda precisa lançar respostas dos dias não-cancelados e clicar "Finalizar". Cancelamento total continua finalizando direto. Dias `>= dataInicioCancelamento` ficam visualmente "cortados ao meio" (`.dia-cortado` + 2 `.dia-meia-left/right` com `clip-path` diagonal, tilt 3D independente por metade, glow âmbar via `::after`, sombra difusa via 3 drop-shadows empilhados). Click em qualquer metade abre `DialogReverterCancelamento` — confirmar reverte cancelamento (envia `tipo: "reverter"` ao backend). **Adicionar sábados extras** (botão azul `CalendarPlus`, só aparece se `trabalhaSabado=NÃO`) — calendário multi-seleção dos sábados do período; tiles ficam com borda azul tracejada animada (`.glass-tile-extra` + `.extra-dash-svg`); remoção individual com confirmação; finalizar dispara boleto VT extra. **Atestados/declarações** lançados via `/atestados` aparecem como tiles read-only (`glass-tile-atestado` + `atestado-dash-svg`); click abre `DialogDiaComDocumento` com link pro item no board Controle de Atestados.
- **Atestados e declarações** (`/atestados`) — feature standalone (sem dependência de link único de convocação). Fluxo: Hub → tile → escolhe tipo trabalhador (Intermitente / CLT em breve) → autocomplete RM (mesmo WF8 do `/convocar`) → painel de convocações do mês via `GET /intermitente-convocacoes-empregado?chapa=…` → escolhe convocação → WizardDocumento interno (tipo atestado vs declaração → calendário com regras de bloqueio → turnos só pra declaração → perguntas condicionais → upload → preview). Adicionar à sessão → abre `ResumoSessao` modal listando todos os docs acumulados (cross-pessoa). Botão flutuante "Resumo (N)" sempre visível. Concluir = POST batch `intermitente-lancar-documentos` (multipart `payload` JSON + binários `doc_<id>`). Regras de bloqueio no frontend: atestado bloqueia qualquer doc nas datas, declaração não em dia com atestado, declaração 1 dia, declaração não duplica turno, sábado só se ativo, atestado multi-dia não cruza sábado inativo.
- **Corrigir** (`/corrigir`) — input do protocolo + lista de recentes (localStorage) + atalho flask pro `PROT-DEMO-1234`.
- **Teste** (`/teste`) — área de mocks (4 UUIDs `mock-*` + chave demo). Acessível só via link "Abrir testes" no rodapé do hub.

### Transições globais (Liquid Glass)
- **PageTransition** (`src/components/PageTransition.tsx`) — wrapper de `<Routes>` que detecta path change e aplica slide carrossel direcional. Hierarquia: `/` = 0; `/teste|convocar|corrigir|atestados` = 1; `/preencher/*` = 2. Forward = nível ↑ (slide saí esquerda + entra direita); backward = nível ↓ (inverso).
- **SlideStack** (`src/components/SlideStack.tsx`) — carrossel genérico reutilizável (trilho 200% + 2 slots × 50%, translateX 0↔-50%, **680ms cubic-bezier(0.2, 0.84, 0.2, 1)**, overflow só durante anim, preserva sombras em idle). Cada Slot ganha estado `active | enter | exit`; slots não-ativos ficam com `opacity 0.18 + scale 0.985` durante a transição (efeito cinemático). Captura do conteúdo anterior via `useLayoutEffect`. Consumido por `PageTransition` (rotas) e `ConvocarPage` (etapas internas).
- **Background animado** — keyframe `bg-hue-cycle` (120s ease-in-out infinite) no `<html>`: navy → púrpura-fumê → preto puro → azul-preto → navy. Sutil, não rouba atenção.

### Backend n8n (9 workflows principais)
- **WF1 Preparar** — webhook do monday quando coluna `ativar` muda. Gera UUID, cria item no board Histórico (`18411141462`), patch Link Column no item de origem.
- **WF2 Ler** — `GET /intermitente-ler?uuid=…`. Busca item por UUID via `getByColumnValue`, parseia respostas_json/dias_extras/dias_desativados.
- **WF3 Finalizar** — `POST /intermitente-finalizar` (JSON simples — sem multipart desde a separação do fluxo de atestados). Valida payload, agrega (qtd_faltas/atrasos/total_minutos), grava respostas_json, marca status=Concluído. Trava antifraude se desconto já consumido. **Idempotente** (1 item, `change_multiple_column_values`). Também grava `sabados_extras` em `numeric_mm3bvgy` + `text_mm3bfn6h` quando aplicável, e dispara WF "Lançamento Sábados Extras" via webhook cross-n8n. **Atestado/declaração saíram do WF3** — feature standalone agora; ver §atestados abaixo.
- **WF Lancar Documentos** *(novo, substitui parte atestado do WF3)* — `POST /intermitente-lancar-documentos` multipart (`payload` JSON com array `documentos[]` + binários `doc_<id>`). Pra cada doc: cria item no board Controle de Atestados (`18298015951`, grupo `topics`, label `Tipo da Documentação = Atestado Médico | Declaração de Comparecimento`), anexa arquivo na coluna `files`, atualiza `Atestados JSON` (`long_text_mm3cp43g`) + ledger `Beneficios Descontados JSON` (`long_text_mm3ct3hg`) + `Arquivos de Atestado` (`file_mm3cvt54`) do Histórico, e cria/atualiza item Desconto (board `18400981023`) respeitando o ledger pra não duplicar com falta manual já consumida.
- **WF Buscar Convocacoes Empregado** *(novo)* — `GET /intermitente-convocacoes-empregado?chapa=…&mes=YYYY-MM`. Busca board ENTRADA (`18408773953`) por chapa, filtra por intersecção com o mês solicitado, ignora `Status Convocação` cancelado/bloqueado, cross-references Histórico pra trazer `uuid`, `trabalhaSabado`, `optanteVT`, `status` e `documentos_existentes` (do `Atestados JSON`). Retorna `{convocacoes: ConvocacaoResumida[]}`.
- **WF4 Buscar protocolo** — `GET /intermitente-buscar-protocolo?protocolo=…` → `{uuid, nome}`.
- **WF5 Pontual FIFO** — convoca pontual: calcula benefício do período, abate descontos pendentes FIFO no board Desconto, gera order Caju (crédito + boleto PIX), SOAPs RM, cria item Solicitação Pagamento (board `18393673859`). Documentado completo no `Mapeamento.md`.
- **WF6 Gerar Lançamento Financeiro** — subworkflow (`executeWorkflow`) chamado pelo WF5. SOAP RM `FopRotinasLancFinanceiroAction` + `FopLancIntegraFinanceiroTerceiroAction` por evento (100=VR, 110=VT).
- **WF7 Convocar** *(novo)* — `POST /intermitente-convocar` (multipart). **Trava antifraude de período**: antes de criar item, busca convocações conflitantes no board ENTRADA filtrando por chapa (ou nome, fallback), considera período efetivo (respeitando `STATUS_CONVOCACAO` e `CANCELAMENTO_INICIO`), retorna 409 `convocacao_conflitante` se overlap. Quando OK, cria item no board ENTRADA (`18408773953`) com `Tipo Convocação=PONTUAL` e `Status Convocação=Válida` fixos. Upload de Termo de Convocação + Termo de Insalubridade via `add_file_to_column` no `/v2/file` (com IF "Tem upload?" pra pular HTTP quando sem binário). Reutiliza credencial `Ray0`.
- **WF8 Buscar empregado RM** *(novo)* — `GET /convocar-buscar-empregado?nome=…` (min 3 chars). Consulta SQL `BEN 2` do RM TOTVS via `consultaSQLServer/RealizaConsulta` (mesmo endpoint usado pelo WF5 de pagamento). Retorna array `[{nome, chapa, cpf, funcao, admissao, secao, codcoligada}]`. Cred basic auth `rm mike`. **CPF não retornado pela `BEN 2` atual** — fica vazio até estender SQL no RM.
- **WF Cancelar Convocação** *(novo)* — `POST /intermitente-cancelar-convocacao?uuid=…`. Criado no n8n novo. Busca o item no Histórico por UUID, localiza o item de origem na Entrada, atualiza `Status Convocação` (`color_mm3a8ana`) para `Cancelada` ou `Cancelada parcialmente`, grava `Cancelamento Início` (`date_mm3b88ta`) no parcial, atualiza `Status Cancelamento` (`color_mm3b9v4n`) no Histórico e gera/atualiza desconto na Base de Desconto (`18400981023`) tratando dias cancelados como falta.
- **Opções de convocação** *(planejado)* — `GET /intermitente-convocar-opcoes` retorna `{opcoes: {solicitantes, contratos, sabados, insalubridades, interiores, justificativas}}` extraído dos status do board ENTRADA. Frontend (`useOpcoesConvocacao`) consome com `OPCOES_CONVOCACAO_FALLBACK` local enquanto endpoint não estiver pronto.
- **WF Lançamento Sábados Extras (boleto VT)** *(novo, 2026-05)* — `POST /sabados-extras-boleto` no n8n antigo (`antigoaionscorp-n8n.cloudfy.live`). Disparado por WF3 (cross-n8n) quando `qtd_sabados_extras > 0`. Calcula `vtDia` por contrato (DETRAN/TRE PB/Padrão), busca empregado RM (BEN 2), cria order Caju só VT + confirma PIX, grava `ZMDHSTBENFUNC` (CODBENEFICIO=2, TPBEN=0) via SOAP direto, executeWorkflow WF6 com evento 110.
- **AIONS API** — middleware HTTP pro RM TOTVS (`https://headed-shawl-annex.ngrok-free.dev`, header `X-API-Key`). WF8 e parte do WF6 já migrados; WF5 SOAPs adaptados mas inativos. **Bloqueio atual**: writes não persistem em produção. Time AIONS investigando. Até resolver, WFs que tocam RM ficam no antigo n8n.

### Deploy
- Container Docker rodando na VM `192.168.0.41:80` (intranet, sem domínio público).
- Stack: Dockerfile multi-stage (node:20-alpine build → nginx:alpine runtime), `docker-compose.yml`, `docker/nginx.conf` (catch-all server_name).
- Atualizar: `git pull && docker compose up -d --build`.

**Pendente:**

**Split de convocação (alta prioridade — frontend pronto, esperando backend):**
1. **Monday — board ENTRADA `18408773953`** (bloqueante):
   - Adicionar coluna `Split JSON` (`long_text`). Anotar `column_id` gerado.
   - Habilitar subitems no board.
   - Criar template de colunas dos subitems: `Name`, Data Início, Data Fim, Contrato, Respostas JSON, Qtd Faltas, Qtd Atrasos, Total Minutos Atraso, Dias Extras, Dias Desativados, Sábados Extras, Status.
2. **WF2 `intermitente-ler` estender**: devolver `split` parseado da coluna nova.
3. **WF novo `intermitente-aplicar-split`**: `POST /intermitente-aplicar-split?uuid=<uuid>` aceita `{tipo: "aplicar"|"reverter"}`, escreve Split JSON via `change_simple_column_value`. Resposta `{ok, split}`.
4. **WF3 `intermitente-finalizar` estender**: ler Split JSON, particionar respostas/dias por data, criar 2 subitems no item ENTRADA via `create_subitem`. Idempotente (lookup por `name`).

**Cancelamento parcial (média prioridade):**
- WF2 devolver `data_inicio_cancelamento` (`date_mm3b88ta`) + `status_cancelamento` (mapeado de `color_mm3a8ana`).
- WF `intermitente-cancelar-convocacao` aceitar `tipo: "reverter"` → limpar Cancelamento Início, set Status=Válida, reverter desconto.

**Outros:**
- Configurar job de expiração: monday Automation no board histórico → *"When Expira Em arrives → Change Status to Expirado"* OU n8n cron diário.
- Estender SQL `BEN 2` no RM TOTVS pra incluir CPF (hoje vem vazio).
- Implementar endpoint n8n `GET /intermitente-convocar-opcoes` (frontend já consome com fallback local).
- Renderizar UI do erro 409 conflito no `/convocar` (api.ts já lança `ConvocacaoApiError` com `.conflito` — falta painel mostrando link do item existente + datas + status).
- Confirmar labels do `STATUS_CONVOCACAO` no board ENTRADA (mapeados hoje: `Válida`, `Cancelada`/`Cancelado`, `Cancelada parcialmente`/`Cancelado parcialmente`, `Bloqueada - conflito`).

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
│  ├─ HubPage.tsx                   rota `/` — 3 tiles (Convocar / Atestados / Corrigir) + link teste no rodapé
│  └─ TestePage.tsx                 rota `/teste` — 4 UUIDs mock + chave PROT-DEMO-1234
├─ features/atestados/
│  ├─ AtestadosPage.tsx             rota `/atestados` — orquestra etapas via SlideStack + ResumoSessao flutuante
│  ├─ EscolhaTipoTrabalhador.tsx    tile Intermitente / tile CLT (em breve)
│  ├─ BuscarPessoa.tsx              autocomplete RM (reusa `useBuscarEmpregado` do convocar)
│  ├─ PainelConvocacoes.tsx         lista convocações do mês via `useConvocacoesEmpregado`
│  ├─ WizardDocumento.tsx           sub-fluxo: tipo-doc → calendário → turnos → perguntas → upload → preview
│  ├─ ResumoSessao.tsx              botão flutuante "Resumo (N)" + Dialog modal com lista + Concluir
│  ├─ TelaSucesso.tsx               sucesso pós-envio batch
│  ├─ ChoiceButton.tsx              botão tilt 3D variants ghost/primary/danger/warning
│  ├─ shared.tsx                    helpers (datas, periodos, rotuloDocumento, validações de turno)
│  ├─ api.ts                        buscarConvocacoesEmpregado + lancarDocumentos (multipart); re-exporta buscarEmpregado
│  ├─ types.ts                      TipoDocumento, PeriodoTurno, DocumentoLancamento, ConvocacaoResumida, SessaoLancamento
│  └─ useAtestados.ts               hooks react-query
├─ features/convocar/
│  ├─ ConvocarPage.tsx              orquestra busca/form/sucesso via SlideStack interno
│  ├─ BuscarEmpregado.tsx           autocomplete com highlight + 3 visíveis + expandir
│  ├─ FormularioConvocacao.tsx      15 campos + bloco RM readonly + botão Convocar com avião decolando
│  ├─ TelaSucesso.tsx               item ID + URL board + CTA "Nova convocação"
│  ├─ GlassSelect.tsx               Select via Dialog (mesma cara do DialogDia)
│  ├─ GlassDatePicker.tsx           DatePicker via Dialog (calendário glass)
│  ├─ api.ts                        buscarEmpregado + criarConvocacao + buscarOpcoesConvocacao (mock + n8n real); classe ConvocacaoApiError com payload de conflito
│  ├─ types.ts                      EmpregadoRM, ConvocacaoPayload, ConvocacaoConflito, ConvocacaoOpcoes, OPCOES_CONVOCACAO_FALLBACK
│  └─ useConvocacao.ts              hooks react-query (useBuscarEmpregado debounced, useOpcoesConvocacao c/ fallback, useCriarConvocacao mutation)
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
| Status Convocação | `color_mm3a8ana` | status | Válida / Cancelada / Cancelada parcialmente / Bloqueada - conflito. WF7 cria item como "Válida"; trava antifraude do WF7 ignora itens "Cancelada"/"Bloqueada" e trunca período se "Cancelada parcialmente" |
| Cancelamento Início | `date_mm3b88ta` | date | Data início do cancelamento parcial. Usada pelo WF7 pra calcular fim efetivo (= `CANCELAMENTO_INICIO - 1`) ao checar conflito |
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
| Status Cancelamento | `color_mm3b9v4n` | status | Cancelada / Cancelada parcialmente. Atualizado pelo WF Cancelar Convocação |
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

### Board Controle de Atestados `18298015951` — Controle de atestados - Ponta

Arquivo detalhado: `docs/n8n/controle-atestados-board.md`.

| Coluna | Column ID | Tipo | Uso no fluxo de intermitentes |
|---|---|---|---|
| Nome do Colaborador | `name` | name | Nome do intermitente |
| Modalidade de contrato | `single_select5yq25pm` | status | `INTERMITENTE` |
| Tipo da Documentação | `sele__o_individual__1` | status | `Atestado Médico` por padrão |
| Dias de Atestado? | `numberjox5johv` | numbers | Quantidade de dias do atestado |
| Saída e ou/ Retorno ao trabalho | `short_textcpcyzaec` | text | Período do atestado em texto |
| Emissão do Atestado | `date` | date | Data inicial do atestado, salvo ajuste operacional |
| Horário de almoço | `single_selectkiwkh2d` | status | `NDA` |
| Trabalhou +6 / -6 horas? | `single_selectcovdz0i` | status | `Trabalhou +6h`, `Trabalhou -6h` ou `Não se aplica` |
| Acompanhante? | `sele__o_individual8__1` | status | `Sem acompanhamento` |
| Contrato do Colaborador | `department` | status | Contrato Monday (`SEMSA`, `DETRAN`, etc.) |
| Arquivos | `files` | file | Anexo do atestado |
| Observação | `short_textl33u569o` | text | UUID/período/origem |
| Validação de documento | `color_mky1mjh7` | status | Sugestão: `VALIDADO` |
| Lançamento DP | `status` | status | Sugestão: `VERIFICAR` |
| Validação de lançamento | `color_mkzbgzc6` | status | Sugestão: `AGUARDANDO RETORNO` |
| Competência | `dropdown_mkzsebbf` | dropdown | Mês do início do atestado |

## Contratos n8n

### GET `/webhook/intermitente-ler?uuid=<uuid>` (WF2)

Retorna (snake_case, convertido pra camelCase em `features/preencher/api.ts`):
```ts
{
  uuid, status: "aguardando" | "concluido" | "expirado",
  nome, contrato, data_inicio, data_fim, dias: string[],
  expira_em, concluido_em, protocolo, editado, editado_em,
  respostas: [{data, tipo, minutos_atraso?}],
  dias_extras: string[], dias_desativados: string[],
  // Cancelamento parcial (pendência Codex incluir no payload):
  data_inicio_cancelamento?: string | null,  // do board ENTRADA, col date_mm3b88ta
  status_cancelamento?: "valida" | "cancelada_parcial" | "cancelada"
}
```
- 200 → renderiza painel (`aguardando`), tela obrigado (`concluido`), tela erro (`expirado`). Dias `>= data_inicio_cancelamento` pintados com visual cortado (`.dia-cortado` no front).
- 404 → "Link não encontrado"

### POST `/webhook/intermitente-finalizar?uuid=<uuid>` (WF3)

JSON simples — sem multipart. Atestados/declarações foram extraídos pra feature standalone `/atestados` (ver §`intermitente-lancar-documentos` abaixo).

Body:
```ts
{
  uuid, respostas: [{data, tipo, minutos_atraso: number | null}],
  protocolo, dias_extras, dias_desativados, sabados_extras, eh_correcao: boolean
}
```
- 200 `{ok, uuid, protocolo, editado, concluido_em}` → frontend invalida query
- 400 validação | 404 não existe | 409 já concluído (se `eh_correcao=false`) | 410 expirado

### POST `/webhook/intermitente-lancar-documentos` *(novo, substitui parte atestado do WF3)*

Multipart `payload` JSON + binários `doc_<id>` (PDF/JPG/PNG/HEIC, máx 15MB cada).

Body JSON:
```ts
{
  documentos: [{
    id, tipo_documento: "atestado" | "declaracao",
    uuid_convocacao, item_entrada_id?, chapa, empregado_nome,
    contrato, trabalha_sabado, optante_vt,
    data_inicio, data_fim,
    periodos: ("manha" | "tarde")[],  // [] pra atestado; 1 ou 2 pra declaração
    primeiro_dia_foi_trabalhar, primeiro_dia_trabalhou_seis_horas: boolean | null,
    nome_arquivo, tamanho_arquivo
  }]
}
```

Pra cada doc: cria item no board Controle de Atestados (`18298015951`) com label correto (Atestado Médico / Declaração de Comparecimento), anexa arquivo em `files`, atualiza `Atestados JSON` + ledger `Beneficios Descontados JSON` + `Arquivos de Atestado` do Histórico, e cria/atualiza item Desconto considerando ledger.

Resposta `{ok, resultados: [{id, monday_item_id_controle, desconto_id, erro?}]}`.

### GET `/webhook/intermitente-convocacoes-empregado?chapa=<chapa>&mes=<YYYY-MM>` *(novo)*

Lookup de convocações de uma chapa no board ENTRADA (`18408773953`). Filtra por intersecção com o mês solicitado; ignora `Status Convocação` cancelado/bloqueado. Cross-reference Histórico pra `uuid`, `trabalhaSabado`, `optanteVT`, `status` e `documentos_existentes`.

Resposta `{convocacoes: ConvocacaoResumida[]}`. Consumido por `/atestados` no painel pós-busca da pessoa.

### GET `/webhook/intermitente-buscar-protocolo?protocolo=<PROT-XXXX-XXXX>` (WF4)

Retorna `{uuid, nome}` ou 404.

### GET `/webhook/convocar-buscar-empregado?nome=<string>` (WF8, novo)

Retorna `{resultados: EmpregadoRM[]}`. Mínimo 3 chars no nome. Consulta `BEN 2` no RM com `LIKE %nome%`. CPF vazio até estender SQL.

### POST `/webhook/intermitente-cancelar-convocacao?uuid=<uuid>` (WF Cancelar Convocação)

Body:
- **Total**: `{tipo: "total", data_inicio_cancelamento: null}` — finaliza convocação. Renderiza `TelaCancelamentoConvocacao` no frontend.
- **Parcial**: `{tipo: "parcial", data_inicio_cancelamento: "YYYY-MM-DD"}` — **NÃO finaliza**. Frontend fecha dialog e mantém painel aberto pra operacional lançar respostas dos dias não-cancelados antes de clicar "Finalizar". Backend só atualiza data + status.
- **Reverter** (pendência Codex implementar): `{tipo: "reverter", data_inicio_cancelamento: null}` — limpa `Cancelamento Início` (`date_mm3b88ta`) = null, set `Status Convocação` (`color_mm3a8ana`) = "Válida", `Status Cancelamento` (`color_mm3b9v4n` no Histórico) = null, reverter (deletar ou marcar cancelado) item criado na Base de Desconto (`18400981023`).

Retorna `{ok, tipo, data_inicio_cancelamento, desconto}`. Atualiza Entrada (`color_mm3a8ana`, e `date_mm3b88ta` no parcial), Histórico (`color_mm3b9v4n`) e Base de Desconto (`18400981023`). Bloqueia duplicidade de cancelamento — retorna `409` se houver desconto existente `PARCIAL` ou `FINALIZADO`.

### POST `/webhook/intermitente-convocar` (WF7) — multipart/form-data

Body: name, empregado_{nome,chapa,cpf,funcao,admissao,secao,codcoligada}, escala, solicitante, contrato, local_unidade, sabado, insalubridade, interior, data_inicio, data_fim, justificativa, empregado_substituido, termo_convocacao? (file), termo_insalubridade? (file)

Respostas:
- **200** `{ok: true, item_id, item_url}` → criou item no board ENTRADA + upload files (se houver)
- **400** `{ok: false, erro: "campo_obrigatorio" | "data_invalida", mensagem}` — payload mal-formado
- **409** `{ok: false, erro: "convocacao_conflitante", mensagem, conflito: {item_id, item_url, nome, chapa, data_inicio, data_fim, data_inicio_original, data_fim_original, status_convocacao, data_inicio_cancelamento}}` — já existe convocação no período (considerando trava de período efetivo)
- **500** `{ok: false, erro: "erro_monday_conflitos", mensagem}` — falha no GraphQL do monday ao buscar conflitos

Frontend (`features/convocar/api.ts`): lança `ConvocacaoApiError` com `.status`/`.erro`/`.conflito` pra UI poder renderizar info do item conflitante (link pro monday + datas + status).

### GET `/webhook/intermitente-convocar-opcoes` *(planejado)*

Retorna lista de labels dos status do board ENTRADA pros selects do form `/convocar`:
```ts
{ opcoes: { solicitantes: string[], contratos: string[], sabados: string[],
            insalubridades: string[], interiores: string[], justificativas: string[] } }
```
Frontend `useOpcoesConvocacao()` consome com `placeholderData` (fallback local) + staleTime 60s. Sem dependência forte — UI funciona com fallback enquanto o endpoint não estiver no ar.

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
- **Lixeira (Desconsiderar dia)**: SVG inline `TrashCanIcon` (alça curta no topo + barra grossa da tampa + corpo trapezoidal com 3 ribs verticais). Tampa pivota com `rotate(-22deg)` + leve translate ao hover; easing overshoot `cubic-bezier(0.34, 1.4, 0.5, 1)`.
- **Chama (Cancelar convocação)**: SVG `CancelFlameIcon` com 3 camadas concêntricas (outer/mid/inner). Animação só anima no `:hover` — 3 keyframes (`flame-flicker-outer/mid/inner`) com 9–10 stops cada, durações primas relativas (740/980/1320ms) → padrão nunca alinha, parece fogo real. `transform-origin: 50% 100%` pivota da base; combinações `skewX ± 14°` + `rotate ± 7°` + `scale` assimétrico simulam fogo dobrando pra esquerda/direita com crescimento desigual.

## Segurança

- UUIDs aleatórios via `Math.random` UUIDv4 — impossível adivinhar.
- Protocolo `PROT-XXXX-XXXX` (alfabeto sem ambíguos `0/O/1/I`) — não é segredo, mas não trivial de chutar.
- Link expira em 10 dias (coluna `Expira Em`); WF2 calcula on-the-fly.
- Job de expiração: monday Automation OU n8n cron diário (pendente).
- `MONDAY_API_TOKEN` apenas dentro do n8n (cred "Ray0"). RM token apenas em cred "rm mike".
- Frontend expõe só `VITE_N8N_BASE_URL`.
- `.env` no `.gitignore`. `.env.local` força modo mock em dev.
