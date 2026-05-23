# Plano de Intermitentes â€” App web

App web pra **gerenciar convocaÃ§Ãµes de intermitentes** no monday: cria convocaÃ§Ã£o, registra ocorrÃªncias dia-a-dia (faltou/atrasou) e permite correÃ§Ã£o via protocolo. Acesso via link Ãºnico da convocaÃ§Ã£o (registrar ocorrÃªncia) ou via **hub principal** (criar convocaÃ§Ã£o / corrigir).

## Estado atual do projeto (2026-05-23)

- **Ponto facultativo atualizado**: `/ponto-facultativo` no Hub, endpoints n8n `GET /ponto-facultativo-opcoes`, `POST /ponto-facultativo-preview` e `POST /ponto-facultativo-aplicar`, unidades oficiais vindas do RM (`GET /intermitente-unidades-rm`, SQL `231375`/`UNIDADES`), filtro por contrato + unidade (`dropdown_mm3mcnmn`, fallback `texto75`), ledger com origem `ponto_facultativo:<contrato>:<unidade_normalizada>:<data>` e `/preencher` bloqueando dias vindos de `pontos_facultativos[]`.

### Mapa atual resumido

- **Atestados/declaracoes**: `POST /intermitente-lancar-documentos` e documental. Cria item no Controle de Atestados (`18298015951`) e anexa arquivo; nao deve atualizar Historico, ledger ou Base de Desconto diretamente.
- **Financeiro de atestados**: fica desacoplado do envio documental e passa pelo fluxo `Nexti - Validar Atestado`, usando o Nexti como fonte de verdade antes de gerar qualquer impacto financeiro.
- **WF3 Finalizar**: continua responsavel por falta/atraso/desconsiderado do registro manual. Valores de VR/VT vÃªm do board de parametros (`18413870370`).
- **Ponto facultativo**: fluxo novo para descontar VR/VT de todos os intermitentes convocados em contrato/unidade/data especificos. Ele grava ledger para impedir duplicidade no `/preencher`.

### IteraÃ§Ãµes recentes consolidadas

- **`/atestados` standalone** com modos Intermitente e CLT, ambos via busca RM. Form alinhado ao board Atestado Ponta (`18298015951`, view `223887647`) â€” 13 campos + CPF (front mostra `formatCpf` no header RM). Header RM mostra CÃ³d. seÃ§Ã£o (font-mono) + chip CPF (`empregado.cpf` formatado `000.000.000-00`). Payload `lancarDocumentos` envia `empregado_cpf` snake_case.
- **CLT consome campos novos do RM**: `codigo` / `secaoCodigo` (cÃ³digo da seÃ§Ã£o, ex: `01.01.0004.01.0001`), `localUnidade` (descriÃ§Ã£o amigÃ¡vel, ex: "DETRAN - MANAUS"), `contrato` (jÃ¡ inferido pelo n8n). CPF idem (mesmo endpoint `celetista-buscar-empregado`).
- **Mapa SeÃ§Ã£oâ†’Contrato determinÃ­stico** (`src/features/atestados/mapaSecaoContrato.ts`): 3Âº octeto do `Codigo` da seÃ§Ã£o define contrato. Derivado do dump completo de celetistas (`todos.CSV`, 1132 funcionÃ¡rios). Mapa: `0004`â†’DETRAN, `0010`â†’SEDUC SEDE, `0011.01`â†’SEDUC ESCOLA, `0011.02`â†’SEDUC INTERIOR, `0074`â†’CETAM, `0079`â†’TRE PB, `0085`â†’SEMSA. SQL no RM agora sÃ³ retorna esses 7 contratos.
- **Contrato readonly no WizardDocumento**: campo `contrato_colaborador` chip Ã¢mbar read-only `[RM] <contrato>` jÃ¡ inferido. Fallback select sÃ³ se mapa retornar vazio.
- **Cancelamento parcial NÃƒO finaliza** (`/preencher`). Cancelamento TOTAL continua finalizando direto. Bug DP resolvido: cancelar parcial dia 2-10 com atraso lanÃ§ado dia 1 = preserva atraso. Tile cancelado: tile escuro `rgba(12,10,10,0.92)` + `<CancelXIcon />` (2 linhas vermelhas + breath sutil) + "Dia cancelado". Click abre `DialogReverterCancelamento`. AnimaÃ§Ã£o header "Cancelar convocaÃ§Ã£o": metamorfose X â†’ âŠ˜ + 6 partÃ­culas radiais.
- **Split de convocaÃ§Ã£o** (`/preencher`): divide convocaÃ§Ã£o em 2 partes com contratos diferentes. BotÃ£o violeta "Dividir convocaÃ§Ã£o" / "Editar divisÃ£o" no header (Ã­cone `SplitIcon` â€” 2 retÃ¢ngulos + lÃ¢mina rosa + sparkles). Wizard 4 etapas: calendÃ¡rio 7 cols com nav mÃªs (refatorado de grid de botÃµes), 2 GlassSelect P1â‰ P2, confirmaÃ§Ã£o, sucesso. Render do grid quando ativo se divide em 2 `<SplitSection>` (border-left tonal Ã¢mbar/sky + header eyebrow + nome contrato). PersistÃªncia via `POST /intermitente-aplicar-split` (coluna Split JSON no item ENTRADA). Finalizar com split â†’ WF3 cria 2 subitems no item ENTRADA.
- **Atestados dia coberto bloqueado** no `/preencher`: `respostasIniciais` forÃ§a `sem_ocorrencia` em dia com atestado vindo do WF2; `enviar()` filtra dia coberto antes do envio. `DialogDiaComDocumento` usa `tipoDocumentacaoLabel` granular (Atestado MÃ©dico, LicenÃ§a-Maternidade etc) quando backend devolve.
- **Feriados nacionais BR** (`src/lib/feriadosBr.ts`): 8 fixos + Sexta-feira Santa via algoritmo Meeus/Jones/Butcher. Hardcoded (descartei `date-holidays` que pesava 1.9MB â€” implementaÃ§Ã£o local +7KB). Aplicado em: tile do grid `/preencher` (visual emerald `.glass-tile-feriado` + bloqueio click + Ã­cone estrela â˜…), `CalendarioCancelamento`, `DialogSelecionarSabados`, `CalendarioSplit`, `GlassDatePicker` (props `isDateDisabled` + `getDateLabel` com defaults), `WizardDocumento` calendÃ¡rio atestado. Payload finalize filtra feriado.
- **Tela `/descontos/:uuid`** â€” nova rota pra registro de retirada manual da conta Caju. Wizard 4 etapas (VR â†’ VT â†’ confirmar â†’ sucesso toast 2s). Paleta sky (azul financeiro). 1 retirada por item (sem ledger). Mock: `mock-pendente`, `mock-registrado`, `mock-zerar`. Endpoints `/descontos-ler` e `/descontos-registrar-manual` (pendÃªncia Codex).
- **Dialog stacking fix**: 8 dialogs do FormularioWizard com conditional render (`{cond && <Dialog>}`) em vez de `<Dialog open={cond}>`. Sem backdrops empilhados.
- **DialogSplit useEffect cleanup**: timer auto-close 1500ms agora cancela se user navega entre etapas durante sucesso.
- **prefers-reduced-motion** kill final cobrindo `bg-hue-cycle`, `lamp-flicker`, `*-dash-svg`, `flame-flicker`, `flame-base-pulse`, `dash-walk-*`.
- **Erro envio em `/atestados`** renderiza dentro do dialog Resumo (nÃ£o atrÃ¡s do backdrop). Auto-clear 5s + abre dialog automÃ¡tico quando erro aparece.
- **Slide flicker** root cause resolvido: regra antiga `.slide-stack-animating * { animation-duration: 0s }` reiniciava `.fade-up` ao fim do slide â†’ pisca. SubstituÃ­da por `animation-play-state: paused` especÃ­fico em animations infinitas (dash/flame/lamp). Plus removido `fade-up` dos wrappers raiz das 5 pÃ¡ginas (HubPage, AtestadosPage, ConvocarPage, CorrecaoPage, TestePage) â€” slide jÃ¡ Ã© a entrada.
- **2 envs n8n**: `.env` documenta `VITE_N8N_BASE_URL` (novo `aionscorp-n8n.cloudfy.live`) + `VITE_N8N_ANTIGO_BASE_URL` (antigo, RM-dependent). Features que precisam de RM tÃªm fallback automÃ¡tico em `api.ts`.
- **BuscarPessoa otimizado**: hook do modo NÃƒO ativo passa query vazia â†’ sÃ³ endpoint do modo ativo dispara.

### Endpoints n8n consolidados (2026-05-23)

**Host novo** (`aionscorp-n8n.cloudfy.live/webhook`):

Ponto Facultativo ativo:
- `GET /ponto-facultativo-opcoes` (`JXpJ6xuSZMcu2IVn`) - retorna `unidades_por_contrato` a partir do RM antigo (`/intermitente-unidades-rm`, SQL `231375`/`UNIDADES`). O Plan usa `OP - Local/Unidade` (`dropdown_mm3mcnmn`) e `texto75` fica fallback para itens legados.
- `POST /ponto-facultativo-preview` (`7gHmbLcZ5r6D5sXz`) - chamado por `/ponto-facultativo`; seleciona convocacoes do board Entrada por contrato/unidade/data, cruza Historico/ledger, resolve valores pelo board `18413870370` e retorna afetados/totais sem gravar Monday.
- `POST /ponto-facultativo-aplicar` (`XybrfnzI11Fw5sX4`) - chamado por `/ponto-facultativo`; recalcula a selecao, grava ledger `ponto_facultativo:<contrato>:<unidade_normalizada>:<data>` e cria/atualiza Desconto com `Origem do Desconto = PONTO FACULTATIVO`.
- WF2 `GET /intermitente-ler` tambem devolve `pontos_facultativos[]` para bloquear os dias no `/preencher`.
- Caveat atual: preview SEMSA `2026-05-20` encontrou 5 convocados, mas valores vieram zerados porque o board de valores `18413870370` nao retornou regra compativel (`regra_valores = "Sem regra de valores"`). Confirmar regra SEMSA/padrao ativa antes de aplicar em producao com afetados reais.

| Endpoint | WF ID | Quem chama | Estado |
|---|---|---|---|
| `GET /intermitente-ler` | `WHtIQDf8oOWinGyx` | `/preencher` | WF2. Devolve dados + atestados[] (`tipo_documentacao_label` granular suportado) + `data_inicio_cancelamento`/`status_cancelamento`. **PendÃªncia**: devolver `split` parseado da coluna nova. |
| `POST /intermitente-finalizar` | `rlxTk4VZLM2gTzx7` | `/preencher` | WF3 JSON-only. Filtra atestado/feriado/cancelado no frontend. **PendÃªncias**: ler `payload.split` e criar 2 subitems; filtrar feriado nacional no cÃ¡lculo VR/VT. |
| `POST /intermitente-cancelar-convocacao` | `sbKoeewbkS7LNORH` | `/preencher` | Aceita `tipo: "total" \| "parcial"`. **PendÃªncia**: aceitar `tipo: "reverter"`. |
| `POST /intermitente-aplicar-split` | `ZagUa2yuP6BsAE9i` | `/preencher` (wizard Dividir) | **PendÃªncia Codex**: aceita `{tipo:"aplicar"\|"reverter"...}`, escreve `Split JSON` no item ENTRADA. Frontend mock-pronto-split disponÃ­vel. |
| `GET /intermitente-convocacoes-empregado` | `8l69E6Z9ouZAL027` | `/atestados` (intermitente, visual only) | Funcionando. Ponto verde no calendÃ¡rio. |
| `POST /intermitente-lancar-documentos` (multipart) | `kVpn69JFUJfR7T7U` | `/atestados` (ambos modos) | Funcionando. Cria item Controle de Atestados + arquivo. Payload inclui `empregado_cpf`. |
| `GET /intermitente-buscar-protocolo` | `m5GIJMo0ghgSGbh2` | `/corrigir` | WF4 estÃ¡vel. |
| `POST /nexti-validar-atestado` | `6efSZQYzLaP304rn` | Monday Automation (board Controle Atestados quando label `ValidaÃ§Ã£o de documento = VALIDADO`) | Valida atestado contra ausÃªncias Nexti via CPF. DecisÃ£o: `sem_desconto`/`com_desconto`/`sem_absences_nexti`/`ignorar`/`erro`. |
| `POST /descontos-ler` *(planejado)* | â€” | `/descontos/:uuid` | **PendÃªncia Codex**: novo WF lÃª item Monday do board Desconto (`18400981023`) pelo UUID. Retorna `{empregado, periodo, vr_devido, vt_devido, retirada_anterior, status}`. |
| `POST /descontos-registrar-manual` *(planejado)* | â€” | `/descontos/:uuid` | **PendÃªncia Codex**: registra `{vr_retirado, vt_retirado}` no item, marca Status=Registrado, retorna `{ok, vr_restante, vt_restante}`. |

**Host antigo** (`antigoaionscorp-n8n.cloudfy.live/webhook`, RM-dependent â€” cred `rm mike`):

| Endpoint | WF ID | Quem chama | Estado |
|---|---|---|---|
| `GET /convocar-buscar-empregado?nome=` | `7BkWfOF3uKUafkef` | `/convocar` + `/atestados` (intermitente) | WF8 estÃ¡vel (`BEN 2`, `CODCATEGORIAESOCIAL=111`). **PendÃªncia**: estender SQL pra incluir CPF. |
| `GET /celetista-buscar-empregado?nome=` | `mLoSKtGr1dLivME4` | `/atestados` (CLT) | Funcionando. Retorna `codigo`/`secaoCodigo`/`localUnidade`/`contrato`/`cpf`. |
| `GET /intermitente-convocar-opcoes` | `fBlqA5MUBpJS1kYl` | `/convocar` (lazy) | WF9. Frontend usa fallback local se falhar. |
| `POST /sabados-extras-boleto` | `GTt6aqGlhotxoGyY` | WF3 cross-n8n | LanÃ§amento SÃ¡bados Extras (boleto VT). |
| `POST /intermitente-convocar` (multipart) | (no antigo) | `/convocar` | WF7 estÃ¡vel. Trava antifraude perÃ­odo. |

### Funcionando end-to-end (mock + real, produÃ§Ã£o na VM):

### Frontend (SPA React)
- **Hub principal** (`/`) â€” eyebrow `ClipboardCheck` + tÃ­tulo display "Escolha o prÃ³ximo passo" + 3 tiles `glass-tile-3d` (Nova convocaÃ§Ã£o / Atestados e declaraÃ§Ãµes / Atualizar ocorrÃªncia) com tilt 3D no mousemove. RodapÃ© com link discreto "Abrir testes" â†’ `/teste`. Actions vÃªm de array tipado com `tone: "blue" | "amber" | "gold"`.
- **Convocar** (`/convocar`) â€” substitui o form nativo do monday do board de entrada. SlideStack ancorado **dentro** do card glass-strong, botÃ£o Voltar fixo fora do slide. Etapas internas:
  1. **Buscar empregado** â€” autocomplete por nome (search-as-you-type, debounce 250ms, min 3 chars, highlight das letras buscadas, 3 visÃ­veis + "ver todos")
  2. **FormulÃ¡rio convocaÃ§Ã£o** â€” 15 campos + bloco read-only com dados do RM (Nome, Chapa, CPF, FunÃ§Ã£o, AdmissÃ£o, SeÃ§Ã£o). Selects e DatePicker custom via Dialog (mesmo padrÃ£o visual do `DialogDia` de registrar ocorrÃªncia). OpÃ§Ãµes dos selects vÃªm de `useOpcoesConvocacao()` (lazy load do n8n com fallback local).
  3. **Tela sucesso** â€” ID do item + URL do board monday + CTA "Nova convocaÃ§Ã£o"
- **Preencher** (`/preencher/:uuid`) â€” painel com modal por dia, perguntas no positivo ("foi trabalhar?", "chegou no horÃ¡rio?"), adicionar/apagar dias com bolha estourando, fluxo de correÃ§Ã£o via protocolo `PROT-XXXX-XXXX`. **Cancelar convocaÃ§Ã£o** (Ã­cone fogo no header) abre wizard: parcial (calendÃ¡rio â†’ escolhe data â†’ tela `confirmar_parcial` exige clique "Confirmar") ou total (data = primeiro dia â†’ tela `confirmar_total`). **Cancelamento parcial NÃƒO finaliza o registro** â€” fecha dialog, painel continua aberto, operacional ainda precisa lanÃ§ar respostas dos dias nÃ£o-cancelados e clicar "Finalizar". Cancelamento total continua finalizando direto. Dias `>= dataInicioCancelamento` ficam visualmente "cortados ao meio" (`.dia-cortado` + 2 `.dia-meia-left/right` com `clip-path` diagonal, tilt 3D independente por metade, glow Ã¢mbar via `::after`, sombra difusa via 3 drop-shadows empilhados). Click em qualquer metade abre `DialogReverterCancelamento` â€” confirmar reverte cancelamento (envia `tipo: "reverter"` ao backend). **Adicionar sÃ¡bados extras** (botÃ£o azul `CalendarPlus`, sÃ³ aparece se `trabalhaSabado=NÃƒO`) â€” calendÃ¡rio multi-seleÃ§Ã£o dos sÃ¡bados do perÃ­odo; tiles ficam com borda azul tracejada animada (`.glass-tile-extra` + `.extra-dash-svg`); remoÃ§Ã£o individual com confirmaÃ§Ã£o; finalizar dispara boleto VT extra. **Atestados/declaraÃ§Ãµes** lanÃ§ados via `/atestados` aparecem como tiles read-only (`glass-tile-atestado` + `atestado-dash-svg`); click abre `DialogDiaComDocumento` com link pro item no board Controle de Atestados.
- **Atestados e declaraÃ§Ãµes** (`/atestados`) â€” feature standalone (sem dependÃªncia de link Ãºnico de convocaÃ§Ã£o). Fluxo: Hub â†’ tile â†’ escolhe tipo trabalhador (Intermitente / CLT em breve) â†’ autocomplete RM (mesmo WF8 do `/convocar`) â†’ painel de convocaÃ§Ãµes do mÃªs via `GET /intermitente-convocacoes-empregado?chapa=â€¦` â†’ escolhe convocaÃ§Ã£o â†’ WizardDocumento interno (tipo atestado vs declaraÃ§Ã£o â†’ calendÃ¡rio com regras de bloqueio â†’ turnos sÃ³ pra declaraÃ§Ã£o â†’ perguntas condicionais â†’ upload â†’ preview). Adicionar Ã  sessÃ£o â†’ abre `ResumoSessao` modal listando todos os docs acumulados (cross-pessoa). BotÃ£o flutuante "Resumo (N)" sempre visÃ­vel. Concluir = POST batch `intermitente-lancar-documentos` (multipart `payload` JSON + binÃ¡rios `doc_<id>`). Regras de bloqueio no frontend: atestado bloqueia qualquer doc nas datas, declaraÃ§Ã£o nÃ£o em dia com atestado, declaraÃ§Ã£o 1 dia, declaraÃ§Ã£o nÃ£o duplica turno, sÃ¡bado sÃ³ se ativo, atestado multi-dia nÃ£o cruza sÃ¡bado inativo.
- **Corrigir** (`/corrigir`) â€” input do protocolo + lista de recentes (localStorage) + atalho flask pro `PROT-DEMO-1234`.
- **Descontos** (`/descontos/:uuid`) â€” registro de retirada manual da conta Caju. Link Ãºnico gerado por Monday Automation no item do board Desconto. Wizard 4 etapas (VR â†’ VT â†’ confirmar â†’ sucesso toast 2s). Paleta sky. Mock: `mock-pendente`, `mock-registrado`, `mock-zerar`. Status `pendente` abre wizard; `registrado` abre tela read-only.
- **Teste** (`/teste`) â€” Ã¡rea de mocks (4 UUIDs `mock-*` + chave demo). AcessÃ­vel sÃ³ via link "Abrir testes" no rodapÃ© do hub.

### Feriados nacionais BR

`src/lib/feriadosBr.ts`: lista hardcoded (descartei `date-holidays` por pesar 1.9MB). 8 fixos (Ano Novo, Tiradentes, Trabalho, IndependÃªncia, N.S. Aparecida, Finados, ProclamaÃ§Ã£o, ConsciÃªncia Negra, Natal) + Sexta-feira Santa via algoritmo Meeus/Jones/Butcher. Aplicado em todos calendÃ¡rios do app + payload finalize.

### TransiÃ§Ãµes globais (Liquid Glass)
- **PageTransition** (`src/components/PageTransition.tsx`) â€” wrapper de `<Routes>` que detecta path change e aplica slide carrossel direcional. Hierarquia: `/` = 0; `/teste|convocar|corrigir|atestados` = 1; `/preencher/*` e `/descontos/*` = 2. Forward = nÃ­vel â†‘ (slide saÃ­ esquerda + entra direita); backward = nÃ­vel â†“ (inverso).
- **SlideStack** (`src/components/SlideStack.tsx`) â€” carrossel genÃ©rico reutilizÃ¡vel (trilho 200% + 2 slots Ã— 50%, translateX 0â†”-50%, **680ms cubic-bezier(0.2, 0.84, 0.2, 1)**, overflow sÃ³ durante anim, preserva sombras em idle). Slot puro sem opacity/scale (iOS Settings pattern â€” slide horizontal puro, sem ghosting). Consumido por `PageTransition` (rotas) e `ConvocarPage`/`AtestadosPage`/`DescontosPage` (etapas internas).
- **Background animado** â€” keyframe `bg-hue-cycle` (120s ease-in-out infinite) no `<html>`: navy â†’ pÃºrpura-fumÃª â†’ preto puro â†’ azul-preto â†’ navy. Sutil, nÃ£o rouba atenÃ§Ã£o.

### Backend n8n (workflows principais)
- **WF1 Preparar** â€” webhook do monday quando coluna `ativar` muda. Gera UUID, cria item no board HistÃ³rico (`18411141462`), patch Link Column no item de origem.
- **WF2 Ler** â€” `GET /intermitente-ler?uuid=â€¦`. Busca item por UUID via `getByColumnValue`, parseia respostas_json/dias_extras/dias_desativados.
- **WF Ponto Facultativo Opcoes/Preview/Aplicar** â€” `GET /ponto-facultativo-opcoes`, `POST /ponto-facultativo-preview` e `POST /ponto-facultativo-aplicar` no n8n novo. Opcoes agrupa unidades reais do Plan; Preview calcula afetados por contrato/unidade/data sem gravar; Aplicar recalcula, mescla ledger `Beneficios Descontados JSON`, cria/atualiza Base de Desconto e marca `Origem do Desconto = PONTO FACULTATIVO`.
- **WF3 Finalizar** â€” `POST /intermitente-finalizar` (JSON simples â€” sem multipart desde a separaÃ§Ã£o do fluxo de atestados). Valida payload, agrega (qtd_faltas/atrasos/total_minutos), grava respostas_json, marca status=ConcluÃ­do. Trava antifraude se desconto jÃ¡ consumido. **Idempotente** (1 item, `change_multiple_column_values`). TambÃ©m grava `sabados_extras` em `numeric_mm3bvgy` + `text_mm3bfn6h` quando aplicÃ¡vel, e dispara WF "LanÃ§amento SÃ¡bados Extras" via webhook cross-n8n. **Atestado/declaraÃ§Ã£o saÃ­ram do WF3** â€” feature standalone agora; ver Â§atestados abaixo.
- **WF Lancar Documentos** â€” `POST /intermitente-lancar-documentos` multipart (`payload` JSON com array `documentos[]` + binarios `doc_<id>`). Fluxo documental: cria item no board Controle de Atestados (`18298015951`) e anexa arquivo na coluna `files`. Nao atualiza Historico, ledger ou Base de Desconto diretamente; impacto financeiro de atestado fica desacoplado e passa pelo fluxo Nexti.
- **WF Buscar Convocacoes Empregado** *(novo)* â€” `GET /intermitente-convocacoes-empregado?chapa=â€¦&mes=YYYY-MM`. Busca board ENTRADA (`18408773953`) por chapa, filtra por intersecÃ§Ã£o com o mÃªs solicitado, ignora `Status ConvocaÃ§Ã£o` cancelado/bloqueado, cross-references HistÃ³rico pra trazer `uuid`, `trabalhaSabado`, `optanteVT`, `status` e `documentos_existentes` (do `Atestados JSON`). Retorna `{convocacoes: ConvocacaoResumida[]}`.
- **WF4 Buscar protocolo** â€” `GET /intermitente-buscar-protocolo?protocolo=â€¦` â†’ `{uuid, nome}`.
- **WF5 Pontual FIFO** â€” convoca pontual: calcula benefÃ­cio do perÃ­odo, abate descontos pendentes FIFO no board Desconto, gera order Caju (crÃ©dito + boleto PIX), SOAPs RM, cria item SolicitaÃ§Ã£o Pagamento (board `18393673859`). Documentado completo no `Mapeamento.md`.
- **WF6 Gerar LanÃ§amento Financeiro** â€” subworkflow (`executeWorkflow`) chamado pelo WF5. SOAP RM `FopRotinasLancFinanceiroAction` + `FopLancIntegraFinanceiroTerceiroAction` por evento (100=VR, 110=VT).
- **WF7 Convocar** *(novo)* â€” `POST /intermitente-convocar` (multipart). **Trava antifraude de perÃ­odo**: antes de criar item, busca convocaÃ§Ãµes conflitantes no board ENTRADA filtrando por chapa (ou nome, fallback), considera perÃ­odo efetivo (respeitando `STATUS_CONVOCACAO` e `CANCELAMENTO_INICIO`), retorna 409 `convocacao_conflitante` se overlap. Quando OK, cria item no board ENTRADA (`18408773953`) com `Tipo ConvocaÃ§Ã£o=PONTUAL` e `Status ConvocaÃ§Ã£o=VÃ¡lida` fixos. Upload de Termo de ConvocaÃ§Ã£o + Termo de Insalubridade via `add_file_to_column` no `/v2/file` (com IF "Tem upload?" pra pular HTTP quando sem binÃ¡rio). Reutiliza credencial `Ray0`.
- **WF8 Buscar empregado RM** *(novo)* â€” `GET /convocar-buscar-empregado?nome=â€¦` (min 3 chars). Consulta SQL `BEN 2` do RM TOTVS via `consultaSQLServer/RealizaConsulta` (mesmo endpoint usado pelo WF5 de pagamento). Retorna array `[{nome, chapa, cpf, funcao, admissao, secao, codcoligada}]`. Cred basic auth `rm mike`. **CPF nÃ£o retornado pela `BEN 2` atual** â€” fica vazio atÃ© estender SQL no RM.
- **WF Cancelar ConvocaÃ§Ã£o** *(novo)* â€” `POST /intermitente-cancelar-convocacao?uuid=â€¦`. Criado no n8n novo. Busca o item no HistÃ³rico por UUID, localiza o item de origem na Entrada, atualiza `Status ConvocaÃ§Ã£o` (`color_mm3a8ana`) para `Cancelada` ou `Cancelada parcialmente`, grava `Cancelamento InÃ­cio` (`date_mm3b88ta`) no parcial, atualiza `Status Cancelamento` (`color_mm3b9v4n`) no HistÃ³rico e gera/atualiza desconto na Base de Desconto (`18400981023`) tratando dias cancelados como falta.
- **OpÃ§Ãµes de convocaÃ§Ã£o** *(planejado)* â€” `GET /intermitente-convocar-opcoes` retorna `{opcoes: {solicitantes, contratos, sabados, insalubridades, interiores, justificativas}}` extraÃ­do dos status do board ENTRADA. Frontend (`useOpcoesConvocacao`) consome com `OPCOES_CONVOCACAO_FALLBACK` local enquanto endpoint nÃ£o estiver pronto.
- **WF LanÃ§amento SÃ¡bados Extras (boleto VT)** *(novo, 2026-05)* â€” `POST /sabados-extras-boleto` no n8n antigo (`antigoaionscorp-n8n.cloudfy.live`). Disparado por WF3 (cross-n8n) quando `qtd_sabados_extras > 0`. Calcula `vtDia` por contrato (DETRAN/TRE PB/PadrÃ£o), busca empregado RM (BEN 2), cria order Caju sÃ³ VT + confirma PIX, grava `ZMDHSTBENFUNC` (CODBENEFICIO=2, TPBEN=0) via SOAP direto, executeWorkflow WF6 com evento 110.
- **AIONS API** â€” middleware HTTP pro RM TOTVS (`https://headed-shawl-annex.ngrok-free.dev`, header `X-API-Key`). WF8 e parte do WF6 jÃ¡ migrados; WF5 SOAPs adaptados mas inativos. **Bloqueio atual**: writes nÃ£o persistem em produÃ§Ã£o. Time AIONS investigando. AtÃ© resolver, WFs que tocam RM ficam no antigo n8n.

### Deploy
- Container Docker rodando na VM `192.168.0.41:80` (intranet, sem domÃ­nio pÃºblico).
- Stack: Dockerfile multi-stage (node:20-alpine build â†’ nginx:alpine runtime), `docker-compose.yml`, `docker/nginx.conf` (catch-all server_name).
- Atualizar: `git pull && docker compose up -d --build`.

**Pendente:**

**Split de convocaÃ§Ã£o (alta prioridade â€” frontend 100% pronto):**
1. **Monday â€” board ENTRADA `18408773953`**:
   - Adicionar coluna `Split JSON` (`long_text`). Anotar `column_id` gerado.
   - Habilitar subitems no board.
   - Template colunas subitem: `Name`, Data InÃ­cio, Data Fim, Contrato, Respostas JSON, Qtd Faltas/Atrasos, Total Minutos, Dias Extras, Dias Desativados, SÃ¡bados Extras, Status.
2. **WF2 `intermitente-ler`**: devolver `split` parseado.
3. **WF novo `intermitente-aplicar-split`**: aceita `{tipo:"aplicar"|"reverter", ...}`. Escreve Split JSON.
4. **WF3 `intermitente-finalizar`**: ler Split JSON, particionar respostas, criar 2 subitems (idempotente).

**Desconto manual (alta prioridade â€” frontend 100% pronto):**
1. **Monday â€” board Desconto `18400981023`**: colunas `UUID Retirada Manual`, `Link Retirada Manual`, `Retirada Manual VR/VT`, `Status Retirada Manual` (Pendente/Registrado), `Registrado Em`, `Ativar Retirada Manual` (trigger button).
2. **WF Monday Automation** "Gerar Link": ao ativar trigger, gera UUID + link `http://192.168.0.41/descontos/<uuid>` + Status=Pendente.
3. **WF novo `GET /descontos-ler?uuid=`**: busca item pelo UUID, cross-ref HistÃ³rico, retorna `{empregado_nome, chapa, contrato, periodo, vr_devido, vt_devido, retirada_anterior, status}`.
4. **WF novo `POST /descontos-registrar-manual?uuid=`**: valida `vr_retirado<=vr_devido` + idem VT, atualiza item Monday, retorna `{ok, vr_restante, vt_restante}`.

**Cancelamento parcial (mÃ©dia prioridade):**
- WF2 devolver `data_inicio_cancelamento` (`date_mm3b88ta`) + `status_cancelamento`.
- WF cancelar aceitar `tipo: "reverter"` â†’ limpar Cancelamento InÃ­cio, set Status=VÃ¡lida, reverter desconto.

**Feriados nacionais (mÃ©dia prioridade):**
- WF3 finalizar filtrar dia feriado no cÃ¡lculo VR/VT (replicar `src/lib/feriadosBr.ts` em Code node).
- WF Cancelar ConvocaÃ§Ã£o pular feriado no cÃ¡lculo de falta.
- Algoritmo PÃ¡scoa (Meeus/Jones/Butcher) + 9 fixos. Match bilateral com frontend.

**RM TOTVS:**
- Estender SQL `BEN 2` pra incluir CPF (hoje vem vazio em intermitente; celetista jÃ¡ tem).

**Outros:**
- Configurar job de expiraÃ§Ã£o: monday Automation no HistÃ³rico ou n8n cron.
- Endpoint `GET /intermitente-convocar-opcoes` (frontend jÃ¡ fallback local).
- UI do erro 409 conflito no `/convocar` (api.ts jÃ¡ lanÃ§a `ConvocacaoApiError` com `.conflito`).
- Confirmar labels `STATUS_CONVOCACAO` board ENTRADA (`VÃ¡lida`, `Cancelada(/o)`, `Cancelada parcialmente`, `Bloqueada - conflito`).

## Fluxos

```
NOVO: Hub web â†’ cria convocaÃ§Ã£o fora do monday
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  Hub `/` â†’ click "Nova convocaÃ§Ã£o"
            â†“
  [Web app /convocar]
            â”œâ”€ Busca: GET WF8 (BEN 2 LIKE %nome%) â†’ lista de empregados
            â”œâ”€ Form: 15 campos + dados RM readonly
            â””â”€ POST WF7 (multipart) â†’ monday create_item board ENTRADA + upload files
            â†“
  Item no board 18408773953 (Tipo ConvocaÃ§Ã£o=PONTUAL, ativar=vazio)
  Operacional/RH muda "ativar" â†’ dispara WF1 â†’ fluxo histÃ³rico normal


CLÃSSICO: Registrar ocorrÃªncias (link Ãºnico)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  [monday board ENTRADA] â†’ muda coluna "ativar"
            â†“
  WF1 Preparar â†’ cria item HistÃ³rico + Link Column
            â†“
  RH clica no link â†’ [Web app /preencher/:uuid]
            â”œâ”€ GET WF2 â†’ dados + dias[] + respostas anteriores (se correÃ§Ã£o)
            â”œâ”€ Painel: modal por dia (positivo: "foi trabalhar?" / "chegou no horÃ¡rio?")
            â””â”€ POST WF3 â†’ change_multiple_column_values + status=ConcluÃ­do
            â†“
  Tela "Obrigado" com protocolo PROT-XXXX-XXXX


CORREÃ‡ÃƒO: via protocolo
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  Hub `/` â†’ click "Atualizar ocorrÃªncia" â†’ [/corrigir]
            â”œâ”€ Digita PROT-XXXX-XXXX
            â”œâ”€ GET WF4 â†’ resolve protocolo â†’ UUID
            â””â”€ Navega /preencher/<uuid>?modo=correcao â†’ WF2 com respostas anteriores
            â†“
  POST WF3 com eh_correcao=true â†’ marca editado=true
```

## DecisÃµes-chave

- **Hub principal em `/`** â€” substitui DevIndex antigo. Operacional bate em `http://192.168.0.41` e vÃª opÃ§Ãµes claras (Convocar / Corrigir). Mocks acessÃ­veis via `/teste` (entrada discreta).
- **Frontend nunca conversa com monday direto** â€” toda I/O via n8n.
- **Sem login** â€” seguranÃ§a = UUID longo aleatÃ³rio + expiraÃ§Ã£o 30 dias. Protocolo `PROT-XXXX-XXXX` em alfabeto sem ambÃ­guos.
- **IdempotÃªncia WF3** â€” `change_multiple_column_values` em 1 item. Pode chamar NÃ— sem efeito colateral.
- **Painel + modal** (nÃ£o wizard sequencial) â€” RH sÃ³ interage com dias problemÃ¡ticos.
- **/convocar etapas internas em state** (nÃ£o rotas) â€” back do browser fecha /convocar inteiro. SlideStack interno cuida da transiÃ§Ã£o.
- **PONTUAL fixo no /convocar** â€” MENSAL/MOP/DEMISSÃƒO ficam pra depois.
- **Estado armazenado no monday** â€” board HistÃ³rico tem 1 item por convocaÃ§Ã£o. Detalhe dia-a-dia em `respostas_json` (long_text). Agregados em colunas dedicadas pra dashboards.

## Stack

- **Frontend**: Vite + React 19 + TypeScript (strict)
- **UI**: Tailwind v4 + shadcn/ui (new-york, neutral) â€” Dialog, Card, Button, Input, Label, Separator
- **Estado server**: @tanstack/react-query (staleTime 0 no preencher)
- **Roteamento**: react-router-dom v7
- **Datas**: date-fns + locale pt-BR
- **Backend de orquestraÃ§Ã£o**: n8n Cloud (`https://antigoaionscorp-n8n.cloudfy.live`)
- **Storage**: monday.com â€” boards `18408773953` (entrada) e `18411141462` (histÃ³rico), workspace `DEPARTAMENTO PESSOAL`. Acesso via n8n com cred "Ray0".
- **IntegraÃ§Ã£o externa**: monday.com API v2; RM TOTVS via SQL `BEN 2` (cred "rm mike")
- **Idioma da UI**: pt-BR

## Comandos

- `npm run dev` â€” dev server Vite (porta 5173). Modo mock se `VITE_N8N_BASE_URL` vazio.
- `npm run build` â€” `tsc -b && vite build`
- `npm run lint` â€” ESLint
- `npx tsc -b` â€” sÃ³ typecheck
- `docker compose up -d --build` â€” sobe container (na VM ou local). LÃª `.env` na raiz.
- `docker compose logs -f app` â€” logs nginx do container.

## VariÃ¡veis de ambiente

**`.env` do frontend:**
```
VITE_N8N_BASE_URL=https://aionscorp-n8n.cloudfy.live/webhook
VITE_N8N_ANTIGO_BASE_URL=https://antigoaionscorp-n8n.cloudfy.live/webhook
```
- `VITE_N8N_BASE_URL` = host novo. WFs migrados (ler, finalizar, cancelar, atestados, split, descontos, nexti).
- `VITE_N8N_ANTIGO_BASE_URL` = host antigo, RM-dependent (busca empregado, opÃ§Ãµes convocar, sÃ¡bados extras boleto, convocar WF7).
- Vazio = modo mock (UUIDs `mock-*` e protocolos `PROT-TEST-*`/`PROT-DEMO-*` resolvem local mesmo com n8n real).

> Vite resolve `import.meta.env.*` em **build-time** (bundle baked). Mudou `.env`? Tem que `docker compose up -d --build` (sem `--build` o bundle antigo continua).

**Credenciais no n8n:**
- **Monday API**: nome "Ray0" (id `6I0ycSr6PQJkBYpc`) â€” Ãºnico token usado em todos os WFs do monday.
- **RM TOTVS (basic auth)**: nome "rm mike" (id `S3pKAv6O75vlOFh8`) â€” consulta SQL e SOAP.

## Estrutura de arquivos

```
src/
â”œâ”€ App.tsx                          rotas + PageTransition wrapper
â”œâ”€ main.tsx                         providers (QueryClient + BrowserRouter)
â”œâ”€ index.css                        Tailwind + glass classes + keyframes + bg-hue-cycle
â”œâ”€ components/
â”‚  â”œâ”€ AuroraBackground.tsx          fundo com orbes + filtros SVG (#liquid-glass, #liquid-glass-soft)
â”‚  â”œâ”€ SlideStack.tsx                carrossel horizontal genÃ©rico (200% trilho + 2 slots)
â”‚  â”œâ”€ PageTransition.tsx            wrapper de Routes que detecta path change e direÃ§Ã£o
â”‚  â””â”€ ui/                           shadcn customizado (dialog c/ overlayClassName, button, input, label, select, separator, badge, card, table)
â”œâ”€ features/hub/
â”‚  â”œâ”€ HubPage.tsx                   rota `/` â€” 3 tiles (Convocar / Atestados / Corrigir) + link teste no rodapÃ©
â”‚  â””â”€ TestePage.tsx                 rota `/teste` â€” 4 UUIDs mock + chave PROT-DEMO-1234
â”œâ”€ features/atestados/
â”‚  â”œâ”€ AtestadosPage.tsx             rota `/atestados` â€” orquestra etapas via SlideStack + ResumoSessao flutuante
â”‚  â”œâ”€ EscolhaTipoTrabalhador.tsx    tile Intermitente / tile CLT (em breve)
â”‚  â”œâ”€ BuscarPessoa.tsx              autocomplete RM (reusa `useBuscarEmpregado` do convocar)
â”‚  â”œâ”€ PainelConvocacoes.tsx         lista convocaÃ§Ãµes do mÃªs via `useConvocacoesEmpregado`
â”‚  â”œâ”€ WizardDocumento.tsx           sub-fluxo: tipo-doc â†’ calendÃ¡rio â†’ turnos â†’ perguntas â†’ upload â†’ preview
â”‚  â”œâ”€ ResumoSessao.tsx              botÃ£o flutuante "Resumo (N)" + Dialog modal com lista + Concluir
â”‚  â”œâ”€ TelaSucesso.tsx               sucesso pÃ³s-envio batch
â”‚  â”œâ”€ ChoiceButton.tsx              botÃ£o tilt 3D variants ghost/primary/danger/warning
â”‚  â”œâ”€ shared.tsx                    helpers (datas, periodos, rotuloDocumento, validaÃ§Ãµes de turno)
â”‚  â”œâ”€ api.ts                        buscarConvocacoesEmpregado + lancarDocumentos (multipart); re-exporta buscarEmpregado
â”‚  â”œâ”€ types.ts                      TipoDocumento, PeriodoTurno, DocumentoLancamento, ConvocacaoResumida, SessaoLancamento
â”‚  â””â”€ useAtestados.ts               hooks react-query
â”œâ”€ features/convocar/
â”‚  â”œâ”€ ConvocarPage.tsx              orquestra busca/form/sucesso via SlideStack interno
â”‚  â”œâ”€ BuscarEmpregado.tsx           autocomplete com highlight + 3 visÃ­veis + expandir
â”‚  â”œâ”€ FormularioConvocacao.tsx      15 campos + bloco RM readonly + botÃ£o Convocar com aviÃ£o decolando
â”‚  â”œâ”€ TelaSucesso.tsx               item ID + URL board + CTA "Nova convocaÃ§Ã£o"
â”‚  â”œâ”€ GlassSelect.tsx               Select via Dialog (mesma cara do DialogDia)
â”‚  â”œâ”€ GlassDatePicker.tsx           DatePicker via Dialog (calendÃ¡rio glass)
â”‚  â”œâ”€ api.ts                        buscarEmpregado + criarConvocacao + buscarOpcoesConvocacao (mock + n8n real); classe ConvocacaoApiError com payload de conflito
â”‚  â”œâ”€ types.ts                      EmpregadoRM, ConvocacaoPayload, ConvocacaoConflito, ConvocacaoOpcoes, OPCOES_CONVOCACAO_FALLBACK
â”‚  â””â”€ useConvocacao.ts              hooks react-query (useBuscarEmpregado debounced, useOpcoesConvocacao c/ fallback, useCriarConvocacao mutation)
â”œâ”€ features/preencher/
â”‚  â”œâ”€ api.ts                        fetch n8n + mocks (seed + lookup por protocolo)
â”‚  â”œâ”€ types.ts                      StatusProcessamento, TipoOcorrencia, RespostaDia, ProcessamentoDados
â”‚  â”œâ”€ useProcessamento.ts           hooks react-query
â”‚  â”œâ”€ PreencherPage.tsx             orquestra loading / 404 / expirado / concluido / aguardando + ?modo=correcao
â”‚  â”œâ”€ FormularioWizard.tsx          painel principal + DialogDia + DialogAdicionarDias
â”‚  â”œâ”€ TelaCarregando.tsx
â”‚  â”œâ”€ TelaObrigado.tsx              exibe protocolo + indica se foi editado
â”‚  â””â”€ TelaErro.tsx
â”œâ”€ features/correcao/
â”‚  â”œâ”€ CorrecaoPage.tsx              input do protocolo + lista recentes + atalho PROT-DEMO-1234
â”‚  â””â”€ protocoloStorage.ts           helpers localStorage
â”œâ”€ features/descontos/
â”‚  â”œâ”€ DescontosPage.tsx             rota `/descontos/:uuid` â€” wizard VR â†’ VT â†’ confirmar â†’ sucesso toast
â”‚  â”œâ”€ EtapaValorBeneficio.tsx       input grande mÃ¡scara R$ + validaÃ§Ã£o â‰¤ devido (reusÃ¡vel VR/VT)
â”‚  â”œâ”€ EtapaConfirmar.tsx            resumo final + mutation
â”‚  â”œâ”€ TelaRegistrado.tsx            read-only quando status `registrado`
â”‚  â”œâ”€ HeaderEmpregado.tsx           chip sky + nome + chapa + contrato + perÃ­odo
â”‚  â”œâ”€ TelaCarregando.tsx + TelaErro.tsx
â”‚  â”œâ”€ api.ts                        buscarDesconto + registrarRetiradaManual + mocks
â”‚  â”œâ”€ types.ts                      DescontoDados, PayloadRegistrarRetirada
â”‚  â”œâ”€ useDescontos.ts               hooks react-query
â”‚  â””â”€ shared.ts                     helpers mÃ¡scara R$ (digitosParaReal, digitosParaDisplay, formatarReal)
â””â”€ lib/
   â”œâ”€ feriadosBr.ts                 8 fixos + Sexta-feira Santa (Meeus/Jones/Butcher) + cache por ano
   â””â”€ utils.ts

docs/
â”œâ”€ especificacao.md
â”œâ”€ monday-board-schema.md           schema completo do board histÃ³rico
â””â”€ n8n/
   â”œâ”€ wf1-preparar.json
   â”œâ”€ wf2-ler.json
   â”œâ”€ wf3-finalizar.json
   â””â”€ wf4-buscar-protocolo.json
   (WF7 e WF8 vivem em C:\Users\NOTECS-89\Downloads\CALCULO INTERMITENTE\)

docker/
â””â”€ nginx.conf                       catch-all server_name, SPA fallback, gzip, cache

Dockerfile                          multi-stage: node:20-alpine (build) â†’ nginx:alpine (runtime)
docker-compose.yml                  serviÃ§o Ãºnico, restart unless-stopped, porta 80
.dockerignore

CLAUDE.md, README.md, DEPLOY.md, .env, .env.example, components.json, package.json, tsconfig.*.json
```

## Schema dos boards monday

### Board Entrada `18408773953` â€” Plan. de Intermitentes (mensal/pontual)

Origem das convocaÃ§Ãµes. Form `/convocar` cria itens aqui. WF1 dispara quando coluna `ativar` muda.

| Coluna | Column ID | Tipo | Notas |
|---|---|---|---|
| Name | `name` | name | PadrÃ£o: "INTERMITENTE - NOME" |
| Nome do Empregado | `dropdown_mktadatt` | dropdown | Last chosenValue = intermitente |
| CPF | `dup__of_matr_cula` | text | |
| FuncionÃ¡rio (Chapa) | `texto` | text | |
| AdmissÃ£o | `text_mkzh8jhn` | text | Data string |
| FunÃ§Ã£o | `texto0` | text | |
| Escala | `text_mkvn2cmr` | text | |
| Local/Unidade | `texto75` | text | Legado/fallback; manter preenchido por compatibilidade |
| OP - Local/Unidade | `dropdown_mm3mcnmn` | dropdown | Fonte operacional nova; lista global filtrada por contrato no frontend |
| Solicitante | `color_mktc9q29` | status | OPERACIONAL / RH |
| Op - Contrato | `color_mktcnxwn` | status | 10 opÃ§Ãµes (SEDUC SEDE/ESCOLA/INTERIOR, DETRAN, CETAM, SEMSA, TRE PB, URUGUAIANA, ADMINISTRATIVO) |
| OP - SÃ¡bado? | `color_mktaavmp` | status | SIM(0) / NÃƒO(5) |
| Op - Insalubridade? | `color_mktq63xa` | status | SIM(1) / NÃƒO(2) / NÃƒO INFORMADO(5) |
| OP - Interior? | `color__1` | status | SIM(0) / NÃƒO(5) |
| OP - Tipo ConvocaÃ§Ã£o | `color_mkta71ex` | status | PONTUAL(0) / MOP(1) / DEMISSÃƒO(2) / NÃƒO CONVOCADO(5) / MENSAL(12) |
| OP - VT sÃ³ volta? | `color_mkwaw840` | status | SIM(2) / NÃƒO(5) |
| OP - Justificativa | `color_mktarrgs` | status | 13 opÃ§Ãµes (AFASTAMENTO, ATESTADO, FÃ‰RIAS, ..., DEMITIDO) |
| OP - Data/InÃ­cio | `date_mktayxhb` | date | |
| OP - Data/Fim | `date_mktasnwq` | date | |
| OP - Empregado SubstituÃ­do | `text_mktc23av` | text | |
| Termo de ConvocaÃ§Ã£o | `file_mm21x463` | file | Upload via WF7 (`add_file_to_column`) |
| Termo de Insalubridade | `file_mm21457r` | file | Upload via WF7 |
| Status ConvocaÃ§Ã£o | `color_mm3a8ana` | status | VÃ¡lida / Cancelada / Cancelada parcialmente / Bloqueada - conflito. WF7 cria item como "VÃ¡lida"; trava antifraude do WF7 ignora itens "Cancelada"/"Bloqueada" e trunca perÃ­odo se "Cancelada parcialmente" |
| Cancelamento InÃ­cio | `date_mm3b88ta` | date | Data inÃ­cio do cancelamento parcial. Usada pelo WF7 pra calcular fim efetivo (= `CANCELAMENTO_INICIO - 1`) ao checar conflito |
| Link | `link_mm2pn9kg` | link | Preenchido pelo WF1 com URL do `/preencher/<uuid>` |
| **ativar** | `color_mm2pxmak` | status | `ativar(1)` = trigger do WF1 |

### Board HistÃ³rico `18411141462` â€” OcorrÃªncias (WF2/WF3)

1 item por convocaÃ§Ã£o. Detalhe dia-a-dia em `long_text_mm2xtcpw`.

| Coluna | Column ID | Tipo | ConteÃºdo |
|---|---|---|---|
| Name | `name` | name | Nome do intermitente |
| UUID | `text_mm2xjend` | text | Mesmo UUID do link `/preencher/<uuid>` |
| Protocolo | `text_mm2xsvg6` | text | `PROT-XXXX-XXXX` (gerado no frontend) |
| Contrato | `text_mm2x1ktb` | text | Copiado do board origem |
| Chapa | `text_mm33v9kp` | text | FuncionÃ¡rio (chapa RM) |
| Solicitante | `text_mm2xxkm8` | text | Quem disparou o WF1 |
| Data InÃ­cio | `date_mm2xtp93` | date | |
| Data Fim | `date_mm2xrr5q` | date | |
| Expira Em | `date_mm2xrvt4` | date | criado_em + 10 dias |
| Criado Em | `date_mm2x115h` | date | Timestamp WF1 |
| ConcluÃ­do Em | `date_mm2xh1vm` | date | Timestamp WF3 |
| Editado Em | `date_mm2x62fq` | date | Timestamp Ãºltima correÃ§Ã£o |
| Status | `color_mm2xkqpc` | status | Aguardando(0) / ConcluÃ­do(1) / Expirado(17) |
| Status Cancelamento | `color_mm3b9v4n` | status | Cancelada / Cancelada parcialmente. Atualizado pelo WF Cancelar ConvocaÃ§Ã£o |
| Editado | `boolean_mm2x1aa4` | checkbox | true se alterado pÃ³s-finalizaÃ§Ã£o |
| Qtd. Faltas | `numeric_mm2xe2zk` | numbers | Agregado WF3 |
| Qtd. Atrasos | `numeric_mm2x18hh` | numbers | Agregado WF3 |
| Total Minutos Atraso | `numeric_mm2x4fjj` | numbers | Agregado WF3 |
| Dias Extras | `long_text_mm2x73w6` | long_text | JSON: array YYYY-MM-DD |
| Dias Desativados | `long_text_mm2xm820` | long_text | JSON: array YYYY-MM-DD |
| Respostas JSON | `long_text_mm2xtcpw` | long_text | JSON `[{data, tipo, minutos_atraso}]` (core) |
| Optante VT | `color_mm34ry47` | status | SIM/NÃƒO |
| Trabalha SÃ¡bado | `color_mm34yyet` | status | SIM/NÃƒO |
| Item Origem | `link_mm2x1rk0` | link | URL item no board origem |
| Link Preencher | `link_mm2xfay7` | link | URL pÃºblica do form |

**AtenÃ§Ã£o**: label "Expirado" tem ID interno `17` (nÃ£o `2`). Aguardando=`0`, ConcluÃ­do=`1`. Use `{label: "..."}` em mutations.

### Board Controle de Atestados `18298015951` â€” Controle de atestados - Ponta

Arquivo detalhado: `docs/n8n/controle-atestados-board.md`.

| Coluna | Column ID | Tipo | Uso no fluxo de intermitentes |
|---|---|---|---|
| Nome do Colaborador | `name` | name | Nome do intermitente |
| Modalidade de contrato | `single_select5yq25pm` | status | `INTERMITENTE` |
| Tipo da DocumentaÃ§Ã£o | `sele__o_individual__1` | status | `Atestado MÃ©dico` por padrÃ£o |
| Dias de Atestado? | `numberjox5johv` | numbers | Quantidade de dias do atestado |
| SaÃ­da e ou/ Retorno ao trabalho | `short_textcpcyzaec` | text | PerÃ­odo do atestado em texto |
| EmissÃ£o do Atestado | `date` | date | Data inicial do atestado, salvo ajuste operacional |
| HorÃ¡rio de almoÃ§o | `single_selectkiwkh2d` | status | `NDA` |
| Trabalhou +6 / -6 horas? | `single_selectcovdz0i` | status | `Trabalhou +6h`, `Trabalhou -6h` ou `NÃ£o se aplica` |
| Acompanhante? | `sele__o_individual8__1` | status | `Sem acompanhamento` |
| Contrato do Colaborador | `department` | status | Contrato Monday (`SEMSA`, `DETRAN`, etc.) |
| Arquivos | `files` | file | Anexo do atestado |
| ObservaÃ§Ã£o | `short_textl33u569o` | text | UUID/perÃ­odo/origem |
| ValidaÃ§Ã£o de documento | `color_mky1mjh7` | status | SugestÃ£o: `VALIDADO` |
| LanÃ§amento DP | `status` | status | SugestÃ£o: `VERIFICAR` |
| ValidaÃ§Ã£o de lanÃ§amento | `color_mkzbgzc6` | status | SugestÃ£o: `AGUARDANDO RETORNO` |
| CompetÃªncia | `dropdown_mkzsebbf` | dropdown | MÃªs do inÃ­cio do atestado |

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
  // Cancelamento parcial (pendÃªncia Codex incluir no payload):
  data_inicio_cancelamento?: string | null,  // do board ENTRADA, col date_mm3b88ta
  status_cancelamento?: "valida" | "cancelada_parcial" | "cancelada"
}
```
- 200 â†’ renderiza painel (`aguardando`), tela obrigado (`concluido`), tela erro (`expirado`). Dias `>= data_inicio_cancelamento` pintados com visual cortado (`.dia-cortado` no front).
- 404 â†’ "Link nÃ£o encontrado"

### POST `/webhook/intermitente-finalizar?uuid=<uuid>` (WF3)

JSON simples â€” sem multipart. Atestados/declaraÃ§Ãµes foram extraÃ­dos pra feature standalone `/atestados` (ver Â§`intermitente-lancar-documentos` abaixo).

Body:
```ts
{
  uuid, respostas: [{data, tipo, minutos_atraso: number | null}],
  protocolo, dias_extras, dias_desativados, sabados_extras, eh_correcao: boolean
}
```
- 200 `{ok, uuid, protocolo, editado, concluido_em}` â†’ frontend invalida query
- 400 validaÃ§Ã£o | 404 nÃ£o existe | 409 jÃ¡ concluÃ­do (se `eh_correcao=false`) | 410 expirado

### POST `/webhook/intermitente-lancar-documentos`

Multipart `payload` JSON + binarios `doc_<id>` (PDF/JPG/PNG/HEIC, max 15MB cada).

Fluxo atual: documental. Aceita Intermitente e Celetista do mesmo jeito, cria item no board Controle de Atestados (`18298015951`) e anexa arquivo em `files`. Nao cruza convocacao, nao atualiza Historico, nao altera ledger e nao cria Base de Desconto.

Body JSON simplificado:
```ts
{
  documentos: [{
    id,
    modalidade_contrato: "INTERMITENTE" | "CELETISTA",
    empregado_nome,
    empregado_cpf?,
    chapa,
    tipo_documentacao_label,
    dias_atestado,
    data_inicio,
    data_fim,
    emissao_atestado,
    saida_retorno_texto,
    horario_almoco_label,
    acompanhante_label,
    contrato_colaborador,
    unidade_label?,
    unidade_dropdown_column_id?,
    unidade_nao_encontrada_texto?,
    observacao?,
    nome_arquivo,
    tamanho_arquivo,
    periodos?: []
  }]
}
```

Resposta `{ok, resultados: [{id, monday_item_id_controle, monday_item_url_controle, erro?}]}`.

### GET `/webhook/intermitente-convocacoes-empregado?chapa=<chapa>&mes=<YYYY-MM>` *(novo)*

Lookup de convocaÃ§Ãµes de uma chapa no board ENTRADA (`18408773953`). Filtra por intersecÃ§Ã£o com o mÃªs solicitado; ignora `Status ConvocaÃ§Ã£o` cancelado/bloqueado. Cross-reference HistÃ³rico pra `uuid`, `trabalhaSabado`, `optanteVT`, `status` e `documentos_existentes`.

Resposta `{convocacoes: ConvocacaoResumida[]}`. Consumido por `/atestados` no painel pÃ³s-busca da pessoa.

### GET `/webhook/intermitente-buscar-protocolo?protocolo=<PROT-XXXX-XXXX>` (WF4)

Retorna `{uuid, nome}` ou 404.

### GET `/webhook/convocar-buscar-empregado?nome=<string>` (WF8, novo)

Retorna `{resultados: EmpregadoRM[]}`. MÃ­nimo 3 chars no nome. Consulta `BEN 2` no RM com `LIKE %nome%`. CPF vazio atÃ© estender SQL.

### POST `/webhook/intermitente-cancelar-convocacao?uuid=<uuid>` (WF Cancelar ConvocaÃ§Ã£o)

Body:
- **Total**: `{tipo: "total", data_inicio_cancelamento: null}` â€” finaliza convocaÃ§Ã£o. Renderiza `TelaCancelamentoConvocacao` no frontend.
- **Parcial**: `{tipo: "parcial", data_inicio_cancelamento: "YYYY-MM-DD"}` â€” **NÃƒO finaliza**. Frontend fecha dialog e mantÃ©m painel aberto pra operacional lanÃ§ar respostas dos dias nÃ£o-cancelados antes de clicar "Finalizar". Backend sÃ³ atualiza data + status.
- **Reverter** (pendÃªncia Codex implementar): `{tipo: "reverter", data_inicio_cancelamento: null}` â€” limpa `Cancelamento InÃ­cio` (`date_mm3b88ta`) = null, set `Status ConvocaÃ§Ã£o` (`color_mm3a8ana`) = "VÃ¡lida", `Status Cancelamento` (`color_mm3b9v4n` no HistÃ³rico) = null, reverter (deletar ou marcar cancelado) item criado na Base de Desconto (`18400981023`).

Retorna `{ok, tipo, data_inicio_cancelamento, desconto}`. Atualiza Entrada (`color_mm3a8ana`, e `date_mm3b88ta` no parcial), HistÃ³rico (`color_mm3b9v4n`) e Base de Desconto (`18400981023`). Bloqueia duplicidade de cancelamento â€” retorna `409` se houver desconto existente `PARCIAL` ou `FINALIZADO`.

### POST `/webhook/intermitente-convocar` (WF7) â€” multipart/form-data

Body: name, empregado_{nome,chapa,cpf,funcao,admissao,secao,codcoligada}, escala, solicitante, contrato, local_unidade, sabado, insalubridade, interior, data_inicio, data_fim, justificativa, empregado_substituido, termo_convocacao? (file), termo_insalubridade? (file). `local_unidade` e validado contra o contrato e gravado em `texto75` + `dropdown_mm3mcnmn`.

Respostas:
- **200** `{ok: true, item_id, item_url}` â†’ criou item no board ENTRADA + upload files (se houver)
- **400** `{ok: false, erro: "campo_obrigatorio" | "data_invalida", mensagem}` â€” payload mal-formado
- **409** `{ok: false, erro: "convocacao_conflitante", mensagem, conflito: {item_id, item_url, nome, chapa, data_inicio, data_fim, data_inicio_original, data_fim_original, status_convocacao, data_inicio_cancelamento}}` â€” jÃ¡ existe convocaÃ§Ã£o no perÃ­odo (considerando trava de perÃ­odo efetivo)
- **500** `{ok: false, erro: "erro_monday_conflitos", mensagem}` â€” falha no GraphQL do monday ao buscar conflitos

Frontend (`features/convocar/api.ts`): lanÃ§a `ConvocacaoApiError` com `.status`/`.erro`/`.conflito` pra UI poder renderizar info do item conflitante (link pro monday + datas + status).

### GET `/webhook/intermitente-convocar-opcoes` *(planejado)*

Retorna lista de labels dos status do board ENTRADA pros selects do form `/convocar`:
```ts
{ opcoes: { solicitantes: string[], contratos: string[], sabados: string[],
            insalubridades: string[], interiores: string[], justificativas: string[] } }
```
Frontend `useOpcoesConvocacao()` consome com `placeholderData` (fallback local) + staleTime 60s. Sem dependÃªncia forte â€” UI funciona com fallback enquanto o endpoint nÃ£o estiver no ar.

## ConvenÃ§Ãµes

- TypeScript strict, sem `any`
- Components de feature em `src/features/<feature>/`
- Components genÃ©ricos em `src/components/` (SlideStack, PageTransition, AuroraBackground, ui/)
- Datas exibidas com `format(parseISO(iso), "...", { locale: ptBR })`
- Atrasos sempre em **minutos** (int positivo)
- Commits em portuguÃªs, imperativo curto
- Tilt 3D em superfÃ­cies clicÃ¡veis (`--mx`/`--my` via `mousemove`)

## Notas operacionais aprendidas

- **n8n Cloud Code node nÃ£o expÃµe `crypto`** â€” UUIDv4 manual com `Math.random` (jÃ¡ no WF1).
- **Webhook responde vazio** se `Respond` nÃ£o estiver em `Using 'Respond to Webhook' Node` â€” sempre verificar.
- **Reimport JSON perde credenciais** â€” todo monday node fica Ã³rfÃ£o; reseleÃ§Ã£o manual de "Ray0" e "rm mike".
- **n8n HTTP node fragmenta JSON array** â€” resposta `[{...}, {...}]` do RM vira N items. Code subsequente deve usar `$input.all()`, nÃ£o `$input.first()`.
- **Long text monday** ~2000 chars. PerÃ­odos tÃ­picos ~2KB.
- **Status label IDs** auto-atribuÃ­dos: Aguardando=0, ConcluÃ­do=1, **Expirado=17** (nÃ£o=2). Use `{label}` em mutations.
- **`getByColumnValue`** retorna array vazio quando nada acha. Checar `j.id && (j.column_values || j.name)`.
- **Datas com hora monday** = `{date: "YYYY-MM-DD", time: "HH:mm:ss"}` (UTC).
- **`ConcluÃ­do Em` preservado** em re-ediÃ§Ã£o â€” sÃ³ `Editado Em` atualiza.
- **`VITE_N8N_BASE_URL` Ã© baked no bundle** em build-time. Mudar `.env` exige `--build` no compose.
- **Sem domÃ­nio + IP privado** â†’ HTTP puro intranet. BotÃ£o Copiar usa fallback `execCommand`.
- **Liquid glass: distorÃ§Ã£o sÃ³ na quina** â€” `feDisplacementMap` direto no `.glass-modal` vira Ã¡gua, nÃ£o lente. SoluÃ§Ã£o: `::after` com mask radial carregando filtro.
- **Cutout de blur via mask-composite** nÃ£o funcionou em Chromium â€” overlay simples sÃ³ com tint escuro.
- **Scrollbar nÃ£o pode aplicar width em html/body** â€” sempre separar regras de `*::-webkit-scrollbar` das de `html`/`body`.
- **DialogContent ganhou prop `overlayClassName`** â€” permite usos futuros nÃ£o-bloqueantes (`pointer-events-none`) sem afetar o `DialogDia` original.
- **Refs durante render geram lint** (`react-hooks/refs`). Pra detectar "valor anterior" em `PageTransition`, usar padrÃ£o setState during render (docs do React) ao invÃ©s de `useRef`.
- **`add_file_to_column` monday** = POST `https://api.monday.com/v2/file` com GraphQL multipart (campos `query` + `variables` + `map` + `0`=binary). AutorizaÃ§Ã£o via Header `Authorization: <token>`.
- **AviÃ£o decolando**: keyframe `plane-takeoff` translada (40, -40) â†’ salto pra (-40, 40) â†’ volta (0, 0); button `.plane-btn` com `overflow:hidden` clipa sÃ³ conteÃºdo, glow externo (box-shadow) **nÃ£o Ã© afetado**.
- **Lixeira (Desconsiderar dia)**: SVG inline `TrashCanIcon` (alÃ§a curta no topo + barra grossa da tampa + corpo trapezoidal com 3 ribs verticais). Tampa pivota com `rotate(-22deg)` + leve translate ao hover; easing overshoot `cubic-bezier(0.34, 1.4, 0.5, 1)`.
- **Chama (Cancelar convocaÃ§Ã£o)**: SVG `CancelFlameIcon` com 3 camadas concÃªntricas (outer/mid/inner). AnimaÃ§Ã£o sÃ³ anima no `:hover` â€” 3 keyframes (`flame-flicker-outer/mid/inner`) com 9â€“10 stops cada, duraÃ§Ãµes primas relativas (740/980/1320ms) â†’ padrÃ£o nunca alinha, parece fogo real. `transform-origin: 50% 100%` pivota da base; combinaÃ§Ãµes `skewX Â± 14Â°` + `rotate Â± 7Â°` + `scale` assimÃ©trico simulam fogo dobrando pra esquerda/direita com crescimento desigual.

## SeguranÃ§a

- UUIDs aleatÃ³rios via `Math.random` UUIDv4 â€” impossÃ­vel adivinhar.
- Protocolo `PROT-XXXX-XXXX` (alfabeto sem ambÃ­guos `0/O/1/I`) â€” nÃ£o Ã© segredo, mas nÃ£o trivial de chutar.
- Link expira em 10 dias (coluna `Expira Em`); WF2 calcula on-the-fly.
- Job de expiraÃ§Ã£o: monday Automation OU n8n cron diÃ¡rio (pendente).
- `MONDAY_API_TOKEN` apenas dentro do n8n (cred "Ray0"). RM token apenas em cred "rm mike".
- Frontend expÃµe sÃ³ `VITE_N8N_BASE_URL`.
- `.env` no `.gitignore`. `.env.local` forÃ§a modo mock em dev.
