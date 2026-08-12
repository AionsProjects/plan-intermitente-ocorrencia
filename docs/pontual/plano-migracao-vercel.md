# Pontual — bifurcação, saída do n8n e log detalhado

Tira o pontual do n8n (`E1XAdrEbPy5lZhNS`, 62 nós) e o parte em dois momentos separados por uma
felipeta que o operacional aciona. Fecha, no caminho, os 5 ajustes de
`docs/pontual/ajustes-sem-aprovacao.md` (vault: *Pontual — Ajustes pra rodar sem aprovação*).

## Decisão (Isaac, 12/08/2026)

O pontual deixa de ser um WF monolítico disparado por `create_item` e passa a ser:

| momento | quando | onde | o que faz |
|---|---|---|---|
| **pré-pagamento** | junto da criação da convocação | `POST /api/convocar/criar` | cálculo VR/VT + busca de desconto. **Nenhum efeito externo.** |
| **pagamento + pós** | quando o OP marca a felipeta | webhook Monday → workflow durável na Vercel | Caju, histórico RM, financeiro, Monday, Drive, boleto |

O gatilho do pagamento passa a ser **a confirmação humana de que o colaborador compareceu à
unidade** — exigência do Diretor Executivo. Hoje o pagamento sai no instante em que o item nasce no
board, sem ninguém confirmar nada.

## Antes / depois

```
HOJE
  create_item (grupo PONTUAL)
      └─> WF5 n8n (62 nós): calcula + FIFO + Caju + RM + Monday + Drive   [tudo de uma vez]

DEPOIS
  POST /api/convocar/criar
      └─> antifraude -> createItem -> convocação no RM -> PRÉ-PAGAMENTO (calcula + reserva FIFO)
                                                              └─> snapshot em pi.pontual_prepagamento
  OP marca "OP - Compareceu?" = SIM
      └─> webhook Monday -> POST /api/monday/comparecimento
              └─> workflows/pontual.ts  ("use workflow", durável, ledger por etapa)
                    validação -> employeeId Caju -> consome FIFO -> Caju (crédito+boleto)
                    -> RM histórico PIX -> FopRotinas -> integrar -> RM histórico CRÉDITO
                    -> Monday Plano -> Solicitação -> automação-ok -> balãozinho -> Drive
```

## Restrições medidas (não são suposição)

| Fato | Onde foi medido | Consequência |
|---|---|---|
| **Não existe rota de pontual no backend** | `auth-backend/src/routes/*` — só `ponto-facultativo`, que é outra coisa | WF5 não é reserva, é o único executor. Não há espelho pra flipar: tem que ser escrito. |
| `pi.rotas_processo` não tem linha `pontual` → cai no `*` = `n8n` | migration 013 | precisa de linha nova + flip pra `api` **no mesmo deploy** da rota |
| WF5 dispara em `create_item` no grupo PONTUAL | `If3` do WF, webhook `/intermitentes/pontual` | o gatilho do dinheiro é a criação do item. Trocar isso É o ponto 1. |
| A [[Virada de Board]] recria **3** webhooks na cópia (`ativar`, `create_item`→WF5, monitor) | `gm2Ie8pbR2rOK5id`, 25 nós | webhook novo precisa ser o **4º**, e o `create_item`→WF5 precisa **sair** |
| Board tem **6 webhooks `create_item`** | auditoria registrada no nó do WF5 | sair do `create_item` mata de lado o risco de boleto duplicado |
| `calcularMensal()` já implementa dias elegíveis "estilo pontual" + FIFO + crédito/PIX + planUpdates | `auth-backend/src/mensal/calculo.ts` | o cálculo do pré-pagamento **não é código novo** — é `calcularMensal` com 1 pessoa |
| `HTTP Request5` (confirma crédito Caju) está DISABLED de propósito no WF5 | vault §WF5 | o crédito nasce Rascunho. **Sem confirmação não existe nota de débito** (ponto 3) |
| `Code in JavaScript10` valida `codSecao`/`chapas`/`eventos` (linhas 22–25) **depois** do boleto criado | execs 28/07 e `157795` | validação tardia = pedido órfão. No workflow isso vira `etapaValidacao`, primeira etapa |
| `items[0]` da busca Caju sem guarda custou execs `161125`/`161909` | corrigido no WF em 05/08 | a porta em código nasce com a guarda (`pessoa_nao_cadastrada_na_caju`) |
| Conta Vercel é **HOBBY** → cron só diário | deploy recusou `*/15 * * * *` | cadência curta sai da ponte n8n `Uue6DferTufop3rs` chamando `POST /api/jobs/tick` |
| `create_update`/`add_update` = **zero ocorrências no repo** | grep | o balãozinho (ponto 4) é código novo, sem precedente no projeto |
| `pi.audit_lancamentos` é o join que des-anonimiza o token do Isaac no monitor de alteração | vault §`resolverItemDoPlano`, cascata 3 níveis, 101/101 | mexer no log **não pode** mudar a semântica de `uuid_alvo` |
| Ledger de migration é **por filename**, não por número | `auth-backend/src/scripts/migrate.ts` | 015/016 duplicados entre branches são inofensivos. Próximo número livre em `codigo-principal`: **018** |
| WF5 **não tem** split VR/VT (08/2026) | vault §Split VR/VT | a porta em código nasce com o split, então o pontual passa a ter até 4 pedidos Caju |

---

# P0 — Pré-voo (nada de novo em produção)

**P0.1** Coluna nova no board do Plano: `OP - Compareceu?` (status, `SIM` / `NÃO` / vazio).
Registrar no registry (`POST /api/boards/registrar`) para o `column_id` ser resolvido por nome —
nunca chumbado (a virada troca o board todo mês).

**P0.2** Linha `pontual` em `pi.rotas_processo`, criada como `n8n` (o valor atual de fato).

**P0.3** `COLUNAS_MOTOR` do monitor de alteração ganha `OP - Compareceu?`, os updates do balãozinho e
as colunas que o pontual em código passa a escrever. Sem isso cada pagamento vira alarme falso
`api_inexplicada` no WhatsApp — foi exatamente o que a Convocação no RM causou (11 alarmes falsos).

**P0.4** Migration `018_pontual.sql`:

```sql
-- Snapshot do pré-pagamento: o número que a felipeta vai pagar.
CREATE TABLE IF NOT EXISTS pi.pontual_prepagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_origem_id bigint NOT NULL,          -- item do Plano (chave que o webhook recebe)
  uuid_convocacao text,                    -- quando já existe ficha (pode ser null no create)
  chapa text NOT NULL, cpf text, nome text, contrato text, cod_secao text,
  data_inicio date NOT NULL, data_fim date NOT NULL,
  dias_vr int, dias_vt int, vr_dia numeric, vt_dia numeric,
  bruto_vr numeric, bruto_vt numeric,
  desconto_vr numeric, desconto_vt numeric,
  liquido_vr numeric, liquido_vt numeric,
  credito_vr numeric, credito_vt numeric,
  pix_vr numeric, pix_vt numeric,
  regra_aplicada text,
  calculo jsonb NOT NULL,                  -- entrada + saída completas, pra auditoria
  estado text NOT NULL DEFAULT 'reservado',-- reservado | consumido | liberado | invalido
  motivo_invalido text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz
);
-- Um pré-pagamento vivo por item. Recalcular substitui; não acumula.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prepag_item_vivo
  ON pi.pontual_prepagamento (item_origem_id) WHERE estado IN ('reservado','consumido');

-- Reserva de desconto: o FIFO fica preso ao pré-pagamento até a felipeta consumir ou soltar.
ALTER TABLE pi.descontos
  ADD COLUMN IF NOT EXISTS reservado_vr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservado_vt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservado_por uuid;   -- -> pi.pontual_prepagamento.id
CREATE INDEX IF NOT EXISTS idx_descontos_reservado ON pi.descontos (reservado_por)
  WHERE reservado_por IS NOT NULL;
```

**P0.5** Flags novas em `config.ts`:
`PONTUAL_CODIGO_HABILITADO` (rota + webhook respondem), `PONTUAL_PAGAMENTO_HABILITADO`
(kill switch do dinheiro, **default DESLIGADO**, mesmo padrão de `MENSAL_PRODUCTION_ENABLED`),
`PONTUAL_PREPAGAMENTO_HABILITADO`.

---

# P1 — Pré-pagamento junto da convocação

## P1.1 `calcularPontual()` — reuso, não reescrita

`auth-backend/src/pontual/calculo.ts` chama `calcularMensal([convocacao], regras, feriados, descontos)`
com uma pessoa e devolve `PessoaCalculadaMensal` + `PlanUpdateMensal`.

**Três divergências conhecidas entre WF5 e `calcularMensal` — resolver ANTES, por escrito:**

1. **Feriado.** O mensal filtra pelo board FERIADOS; o WF5 **não filtra**. Convocação que cruza
   feriado passa a pagar menos que hoje. Regra do mensal é a correta (`docs` do DP), mas é mudança
   de valor — o DP precisa saber.
2. **Teto do dia 31.** Aplicado no WF5 em 07/08 (`__vrForaDoTeto`) e presente no mensal. O comentário
   de `calculo.ts` ("o WF5 NÃO tem esse teto") está **stale** — corrigir junto.
3. **Crédito.** Mensal = 3 dias VR + 0 VT. WF5 = 2 dias VR + 2 dias VT. A regra dos 3 dias nasceu de
   conferência contra pagamento oficial (pedido Caju `622cd7d3`). Alinhar o pontual nos 3 dias e
   **um só** lugar decidindo isso.

Sem esse alinhamento a migração vira "o valor mudou e ninguém sabe por quê".

## P1.2 `reservarPrePagamento()`

Roda dentro de `criarConvocacaoHandler`, **depois** do `createItem` e da convocação no RM, **antes**
do `arquivarDrive` (mesma lógica do posicionamento já documentada ali: o que persiste tem que vir
antes do que custa segundos).

Transação única: grava `pi.pontual_prepagamento` + marca `reservado_vr/vt` + `reservado_por` nas
linhas de `pi.descontos` que o FIFO tocou.

`try/catch` próprio, como o do RM: **falhar aqui não pode virar 502.** O item já existe no Monday.
Falha grava `estado='invalido'` com motivo e a felipeta recalcula.

## P1.3 Por que RESERVA e não simulação

O ponto da bifurcação é que **o número mostrado na convocação seja o número pago na felipeta**. Se o
pré-pagamento só simular, duas convocações da mesma pessoa criadas no mesmo dia calculam contra o
mesmo residual e a felipeta paga a soma errada — e o DP volta a conferir à mão, que é justamente o
que estamos matando.

Preço da reserva: precisa **soltar**. Solta em 3 lugares:
- cancelamento (total/parcial) da convocação → `estado='liberado'`, zera reserva;
- recálculo do pré-pagamento → libera o anterior antes de reservar o novo;
- **expiração** — job varre `reservado` com `data_fim < hoje - N dias` e libera. Sem isso, felipeta
  que nunca é marcada prende dívida pra sempre e o mensal passa a abater menos do que deveria.

## P1.4 O que o operador vê

`POST /api/convocar/criar` passa a responder `prepagamento: {…}` do lado do `rm: {…}` que já existe.
A tela de sucesso do `/convocar` mostra dias, VR/VT, desconto abatido e o líquido — o operador sai
sabendo quanto aquela convocação vai pagar.

---

# P2 — Felipeta: pagamento e pós-pagamento

## P2.1 `POST /api/monday/comparecimento`

Espelho fiel de `/api/monday/ativar` (`gatilhos.ts`), que já resolveu todos os detalhes chatos:
handshake `challenge` devolvido cru, filtro por `columnId`, filtro por label, `200` sempre (o Monday
desativa webhook que erra demais).

Diferenças:
- resolve o `column_id` de `OP - Compareceu?` **pelo registry por nome**, não por id chumbado;
- ignora tudo que não seja label `SIM`;
- reserva o efeito em `pi.efeitos_externos` com chave `pontual:pagamento:<item_origem_id>` **antes**
  de qualquer coisa. Webhook duplicado (e o board tem histórico disso) não paga duas vezes;
- dispara o workflow e responde na hora. Nada de dinheiro no request.

## P2.2 `workflows/pontual.ts` — durável, espelhando `workflows/mensal.ts`

Cada etapa é `"use step"` + `reservarEfeito`/`confirmarEfeito` + `maxRetries`, igual ao mensal.

| # | etapa | notas |
|---|---|---|
| 1 | `etapaValidacao` | `codSecao`, `chapa`, `eventos`, período, pré-pagamento vivo. **Antes de qualquer efeito.** É o conserto do padrão de falha do WF5 |
| 2 | `resolverEmployeeCaju` | `buscarEmployeeId(cpf)` com guarda de `items: []` → `pessoa_nao_cadastrada_na_caju: chapa=… nome=…` |
| 3 | `etapaConsumirFifo` | reserva → consumo. Postgres + board Base de Desconto. Idempotente por `uq_descontos_uuid_origem` |
| 4 | `etapaPedidoCaju(credito, vr\|vt)` | split VR/VT. Crédito **não confirma** (regra vigente) |
| 5 | `etapaPedidoCaju(boleto, vr\|vt)` | confirma PIX + poll do QR. **Dinheiro real — gated** |
| 6 | `etapaRmHistorico("pix")` | ZMDHSTBENFUNC |
| 7 | `etapaRmFopRotinas` + `etapaRmAguardar` + `etapaRmIntegrar` | eventos 100/110; IDFNAN → integra |
| 8 | `etapaRmHistorico("credito")` | **ordem obrigatória** (regra DP): o crédito não pode existir no ZMD quando o FopRotinas roda |
| 9 | `etapaMondayPlano` | espelha dias/VR/VT/crédito/desconto no item do Plano |
| 10 | `etapaMondaySolicitacao` | cria item no board `18393673859` |
| 11 | `etapaMondayStatusOk` | **ponto 2** — `setarStatusAutomacaoOk()` já existe (`mondayEfeitos.ts:344`). Só depois de tudo |
| 12 | `etapaMondayBalao` | **ponto 4** — `create_update` no item com o desconto e link da Base de Desconto |
| 13 | `etapaDrive` | **ponto 3** — boleto/comprovante/QR + nota de débito + relatório |
| 14 | `etapaAlertaFalha` | **ponto 5** — Evolution, grupo de erros `120363400013959285@g.us` |

Reuso direto, sem reescrever: `clients/caju.ts`, `clients/rm.ts`, `mensal/rmEfeitos.ts`,
`mensal/mondayEfeitos.ts`, `services/driveArquivar.ts`, `jobs/repo.ts`.

## P2.3 Ponto 3 — o bloqueio que sobra

Nota de débito **depende de o crédito ser confirmado**, e hoje ele não é (por decisão). Duas saídas,
e é decisão de negócio:

- **(a)** o pontual passa a confirmar o crédito → existe nota de débito de verdade, e o DP para de
  creditar os 3 dias à mão. Mexe em regra de dinheiro.
- **(b)** o crédito segue Rascunho e o "relatório" é gerado por nós (TXT/XLSX com pessoa, dias,
  valores, ids de pedido, IDFINANC, links de summary) — comprova o pagamento sem depender de
  documento da Caju.

**(b)** é o que dá pra fazer sem mudar dinheiro. Fica registrado que não é a nota de débito da Caju.

---

# P3 — Log de histórico detalhado (todas as funções)

## Estado hoje

| peça | o que é | limitação |
|---|---|---|
| `pi.audit_lancamentos` | 1 linha rasa por ação, `payload_resumo jsonb` | não diz o que foi gerado nem em quantos passos |
| `src/lib/atividade.ts` | `fetch` fire-and-forget do **browser** | fecha a aba no meio → não existe log |
| `AtividadeTab.tsx` | chips planos; `detalhes()` só é rico pra `mensal` | cada ação nova exige `if` novo na função |
| `pi.mensal_run_event` | log detalhado de verdade (etapa/estado/tentativa/metadados) | **só mensal**, tabela e UI separadas |

O detalhe que ele quer **já existe** — só existe para o mensal. P3 é generalizar `mensal_run_event`
para todas as ações e trazer para a mesma tela.

## P3.1 Migration `019_atividade_detalhe.sql`

```sql
-- Timeline por ação (generaliza pi.mensal_run_event para qualquer função do app).
CREATE TABLE IF NOT EXISTS pi.atividade_evento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  atividade_id uuid NOT NULL REFERENCES pi.audit_lancamentos(id) ON DELETE CASCADE,
  etapa text NOT NULL, estado text NOT NULL,        -- iniciado|concluido|erro|pulado|simulado
  tentativa int NOT NULL DEFAULT 1,
  mensagem text, metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  duracao_ms int, criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ativ_evento ON pi.atividade_evento (atividade_id, id);

-- O QUE FOI GERADO — a parte que hoje não existe em lugar nenhum.
CREATE TABLE IF NOT EXISTS pi.atividade_artefato (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  atividade_id uuid NOT NULL REFERENCES pi.audit_lancamentos(id) ON DELETE CASCADE,
  tipo text NOT NULL,        -- monday_item|caju_pedido|rm_idfinanc|rm_convocacao|drive_pasta
                             -- |arquivo|protocolo|uuid|desconto|solicitacao|boleto
  ref text NOT NULL,         -- o id cru
  url text, rotulo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ativ_artefato ON pi.atividade_artefato (atividade_id);
CREATE INDEX IF NOT EXISTS idx_ativ_artefato_ref ON pi.atividade_artefato (tipo, ref);
```

`idx_ativ_artefato_ref` não é enfeite: é o caminho de "quem gerou o pedido Caju `0748a3d5`?", que
hoje se responde garimpando execução do n8n.

## P3.2 O log passa a ser escrito no servidor

`registrarAtividadeServidor` deixa de ser exceção das ações de dinheiro e vira a regra, em toda rota
de escrita. Um handle por ação:

```ts
const log = await abrirAtividade({ acao, alvo, pessoa, contrato, resumo })
await log.etapa("monday_create", "concluido", { itemId })
log.artefato("monday_item", itemId, url, "Item no Plano")
await log.fechar("concluido")   // ou .fechar("erro", motivo)
```

Regras que vêm de graça ao mover pro servidor:
- **`limparMetadados`/`limparTexto` obrigatórios** (`mensal/repo.ts`) — mais detalhe = mais chance de
  token vazar pro log. Nunca gravar metadados crus;
- `uuid_alvo` **mantém a semântica atual**, sem exceção: é a chave da cascata `resolverItemDoPlano`
  do monitor de alteração (`registro`/`cancelamento` = uuid da convocação, `convocacao` = item_id).
  Mudar isso quebra o monitor em silêncio;
- **retenção desde o dia 1** — detalhe de todas as funções cresce muito mais rápido que
  `audit_lancamentos`. Estender `limparHistoricoMensal()` para os eventos/artefatos;
- a chamada do browser (`src/lib/atividade.ts`) fica só como redundância, ou sai — hoje ela é a
  única fonte de 6 das 8 ações, e é a que perde log quando a aba fecha.

## P3.3 `mensal_run_event` não é duplicado

O mensal continua com a tabela dele (é o que alimenta o anel de progresso e a timeline do
`Acompanhamento.tsx`). Ele passa a **abrir uma atividade** no início do run e a espelhar as etapas
em `atividade_evento` — assim o mensal aparece na mesma tela que o resto, sem perder a tela própria.

## P3.4 UI

`AtividadeTab.tsx`: linha vira expansível. Fechada = igual hoje. Aberta = timeline das etapas
(estado, tentativa, duração) + artefatos como **links clicáveis** (item do Monday, pedido Caju,
IDFINANC, pasta do Drive, boleto).

`detalhes()` deixa de ter `if (a.acao === "mensal")`: o renderizador passa a ser genérico sobre
`atividade_evento`/`atividade_artefato`. Ação nova entra sem tocar na UI.

Novo: `GET /api/atividade/:id` devolve a ação + eventos + artefatos.

---

# Cutover — a parte perigosa

Dois executores capazes de pagar a mesma convocação **não podem coexistir ligados**.

| passo | ação | reversível? |
|---|---|---|
| 1 | P0 + P1 em produção com `PONTUAL_PAGAMENTO_HABILITADO=0`. Pré-pagamento roda e grava; **nada paga**. WF5 segue pagando como hoje | sim |
| 2 | Conferir o pré-pagamento contra o que o WF5 pagou, **na mesma convocação**, por N dias. É o portão: se os números não fecham, a migração para aqui | sim |
| 3 | Coluna `OP - Compareceu?` + webhook novo no board. Workflow ligado, **`PONTUAL_PAGAMENTO_HABILITADO=0`** → percorre tudo e simula | sim |
| 4 | **Uma** convocação real, com o DP avisado, `PONTUAL_PAGAMENTO_HABILITADO=1` | não (dinheiro) |
| 5 | **Remover** o webhook `create_item`→WF5 do board **e** o nó que o recria na Virada. Desativar o WF5 | sim (recriar) |
| 6 | Flip `pi.rotas_processo.pontual` → `api` | sim |

⚠️ **Passo 5 e a Virada**: enquanto o nó `Criar webhook create_item na copia` existir, a virada do
dia 14 **ressuscita o WF5** na cópia do mês. Passo 5 tem que sair antes da virada seguinte, ou o
pontual paga duas vezes em setembro.

⚠️ A Virada **nunca teve um run agendado bem-sucedido**. Encostar nela é encostar em algo que já
falha — o 4º webhook (`OP - Compareceu?`) entra no mesmo passe, com `onError:
continueRegularOutput` como os irmãos, e a falha silenciosa deles fica registrada como risco aceito.

---

# Verificação

1. **Cálculo**: pré-pagamento × WF5 na mesma convocação, ≥ 10 casos reais cobrindo DETRAN (VR
   mensal, dias corridos), TRE PB (não desconta), SEMSA (desconta), interior (mobilidade), período
   cruzando feriado, período cruzando dia 31, não-optante de VT, `SIM*` (VT só volta). Divergência
   explicada **antes** de virar autorização.
2. **Reserva FIFO**: duas convocações da mesma pessoa no mesmo dia → a segunda vê residual já
   reservado. Cancelar a primeira devolve. Expiração devolve.
3. **Idempotência**: mesmo webhook 3×; `pi.efeitos_externos` barra. Marcar `NÃO` e `SIM` de novo não
   paga duas vezes.
4. **Validação antes do efeito**: item sem unidade (o caso MARIA AUGUSTA, `01.01.0007.04.0001`) →
   aborta em `etapaValidacao` com **zero** pedido na Caju. É o teste que prova o conserto.
5. **Pessoa ausente na Caju** (chapa `007406`, MISSILENE): erro nomeado, sem efeito órfão.
6. **Log**: uma convocação e um pagamento completos → a linha abre e mostra todas as etapas e todos
   os artefatos, com link. Nenhum segredo no `metadados` (grep no JSON gravado).
7. **Monitor de alteração**: rodar o sweep depois de um pagamento → `api_inexplicada` = **0**.
8. **Ordem RM**: conferir que o histórico de crédito entrou **depois** do FopRotinas.

# Desfazer

- Pagamento: `PONTUAL_PAGAMENTO_HABILITADO=0` (kill switch sem deploy).
- Executor: reativar WF5 + recriar o webhook `create_item` + `rotas_processo.pontual` → `n8n`.
- Efeito solto na Caju: cancelar o pedido no painel (não há API de cancelamento no cliente hoje) e
  limpar a chave em `pi.efeitos_externos`.
- Reserva presa: `estado='liberado'` + zerar `reservado_*`.

# Decisões abertas (precisam do Isaac / do DP)

1. **Feriado no pontual** — passa a filtrar (regra do mensal) ou mantém o comportamento do WF5? Muda
   valor pago.
2. **Crédito: 3 dias VR / 0 VT (mensal) ou 2+2 (WF5)?** Recomendação: 3/0, que é o conferido contra
   pagamento oficial.
3. **Nota de débito** — confirmar o crédito na Caju (a) ou relatório próprio (b)?
4. **Reserva de FIFO** — aceita a reserva com expiração, ou prefere simulação simples (mais barato,
   mas o valor pode mudar entre convocação e felipeta)?
5. **Prazo de expiração da reserva** — sugestão: `data_fim + 15 dias`.
6. **Rótulo da felipeta** — `OP - Compareceu?` com `SIM`/`NÃO`, ou nome/labels que o operacional já
   usa na planilha dele?
