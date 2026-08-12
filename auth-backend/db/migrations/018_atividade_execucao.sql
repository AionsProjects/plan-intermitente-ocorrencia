-- Log de execução detalhado para TODAS as ações do app, e o escape de erro que
-- depende dele.
--
-- O problema que isto resolve: `registrarAtividade` é chamado no `onSuccess` dos
-- hooks do front (src/lib/atividade.ts, fire-and-forget). Então ação que FALHA não
-- deixa rastro nenhum — não é que o log seja raso, é que ele não existe justamente
-- quando importa. Sem registro de falha não há como avisar o DP antes de o
-- funcionário reclamar que não recebeu o benefício.
--
-- Desenho: pi.audit_lancamentos vira o CABEÇALHO da execução (já é uma linha por
-- ação, com o operador carimbado pela sessão) e ganha dois filhos — as fases em
-- pi.atividade_evento e o que foi gerado em pi.atividade_artefato.
--
-- Por que não alargar pi.mensal_run_event (que já tem o log detalhado que se quer):
-- a FK `run_id NOT NULL REFERENCES mensal_run ON DELETE CASCADE` é o que mantém a
-- poda de `limparHistoricoMensal()` correta. Hospedar convocação ali exigiria
-- derrubar o NOT NULL e a FK, e a poda dos 24 meses do mensal passaria a levar
-- embora eventos de convocação que nada têm a ver com ele.
--
-- Por que não só engordar payload_resumo em jsonb: acrescentar fase exigiria
-- read-modify-write (lost update quando duas fases terminam juntas), não daria
-- cursor `id > after` pro polling, e engordaria o SELECT com LIMIT 200 da lista —
-- que é exatamente o que precisa ficar leve, porque fechada a linha é um resumo.
--
-- Schema pi. Transacional (o runner envolve em BEGIN/COMMIT).

-- ---------------------------------------------------------------------------
-- CABEÇALHO. Passa a ter desfecho, motor e onde quebrou.
--
-- ⚠️ uuid_alvo NÃO MUDA de semântica. É a chave de join da cascata
-- resolverItemDoPlano() do monitor de alteração de board (cobertura medida
-- 101/101): acao='convocacao' guarda o item_id do Monday, 'registro'/'cancelamento'
-- guardam o UUID da convocação. Todo identificador NOVO vai para
-- pi.atividade_artefato — é o que tira a pressão desta coluna.
-- ---------------------------------------------------------------------------
ALTER TABLE pi.audit_lancamentos
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'aberta',
  ADD COLUMN IF NOT EXISTS motor text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS etapa_atual text,
  ADD COLUMN IF NOT EXISTS erro_etapa text,
  ADD COLUMN IF NOT EXISTS erro_msg text,
  -- {run_id, job_id, workflow_run_id} — amarra a execução ao motor que a executou.
  ADD COLUMN IF NOT EXISTS correlacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- teto de 200 eventos por execução; laço de retry incrementa isto em vez de
  -- escrever um milhão de linhas.
  ADD COLUMN IF NOT EXISTS eventos_truncados int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS duracao_ms int;

-- BACKFILL OBRIGATÓRIO. Como hoje só se loga no onSuccess, toda linha que existe é
-- de ação que DEU CERTO. Sem este UPDATE o histórico inteiro leria 'aberta' e —
-- pior — a varredura de abandonadas alertaria sobre ele todo na primeira passada.
-- A segunda trava é no código: a varredura filtra criado_em > data do deploy.
UPDATE pi.audit_lancamentos
   SET estado = 'ok', finalizado_em = criado_em
 WHERE estado = 'aberta';

-- Postgres não tem ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_lancamentos_estado_ck') THEN
    ALTER TABLE pi.audit_lancamentos ADD CONSTRAINT audit_lancamentos_estado_ck
      CHECK (estado IN ('aberta', 'ok', 'erro', 'parcial', 'abandonada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_lancamentos_motor_ck') THEN
    ALTER TABLE pi.audit_lancamentos ADD CONSTRAINT audit_lancamentos_motor_ck
      CHECK (motor IN ('app', 'backend', 'n8n', 'workflow', 'job'));
  END IF;
END $$;

-- Varredura de abandonadas (aba fechada no meio, função congelada).
CREATE INDEX IF NOT EXISTS idx_atividade_aberta
  ON pi.audit_lancamentos (criado_em) WHERE estado = 'aberta';
-- Triagem da lista e fila do alerta.
CREATE INDEX IF NOT EXISTS idx_atividade_falha
  ON pi.audit_lancamentos (criado_em DESC) WHERE estado IN ('erro', 'abandonada');
-- Filtro por tipo de execução na página /atividade.
CREATE INDEX IF NOT EXISTS idx_atividade_acao
  ON pi.audit_lancamentos (acao, criado_em DESC);

-- ---------------------------------------------------------------------------
-- FASES. Os nomes de coluna são DELIBERADAMENTE iguais aos de
-- pi.mensal_run_event (etapa/estado/tentativa/mensagem/metadados/criado_em): o
-- componente de timeline que já existe no acompanhamento do mensal renderiza esta
-- tabela sem alteração, e o cursor `id > after` é o mesmo contrato de API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.atividade_evento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execucao_id uuid NOT NULL REFERENCES pi.audit_lancamentos(id) ON DELETE CASCADE,
  etapa text NOT NULL,
  estado text NOT NULL,
  tentativa int NOT NULL DEFAULT 1,
  duracao_ms int,
  mensagem text,
  -- ⚠️ passa por domain/sanitizar.ts (RECURSIVO) antes de chegar aqui. O corpo do
  -- alerta de WhatsApp é montado a partir daqui — metadado cru vazaria CPF/token.
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atividade_evento_estado_ck
    CHECK (estado IN ('rodando', 'ok', 'erro', 'pulado', 'aviso'))
);

CREATE INDEX IF NOT EXISTS idx_atividade_evento_cursor
  ON pi.atividade_evento (execucao_id, id);
CREATE INDEX IF NOT EXISTS idx_atividade_evento_erro
  ON pi.atividade_evento (criado_em DESC) WHERE estado = 'erro';

-- ---------------------------------------------------------------------------
-- ARTEFATOS: O QUE FOI GERADO. É o que faz o log deixar de ser diário e virar
-- ponto de partida de investigação.
--
-- `url` é OPCIONAL de propósito: só é gravada quando o provedor devolveu a URL
-- canônica (convocar.ts devolve item.url; o Drive devolve webViewLink). O resto é
-- derivado em runtime por domain/artefato.ts, porque o link do Monday redireciona
-- pelo slug da conta de quem está logado (não é estável entre usuários) e
-- rm_idfinanc NÃO TEM URL — renderiza como código copiável, não link falso.
-- Gravar URL congelaria um palpite em milhares de linhas históricas.
--
-- `efeito_chave` aponta pra pi.efeitos_externos SEM FK de propósito: aquela tabela
-- é podada e limpa por fora, e uma FK levaria o artefato embora ou travaria o
-- DELETE. Serve pra UI distinguir "criado agora" de "pulado por idempotência".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.atividade_artefato (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execucao_id uuid NOT NULL REFERENCES pi.audit_lancamentos(id) ON DELETE CASCADE,
  evento_id bigint REFERENCES pi.atividade_evento(id) ON DELETE SET NULL,
  tipo text NOT NULL,
  chave text NOT NULL,
  rotulo text,
  url text,
  efeito_chave text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atividade_artefato_tipo_ck CHECK (tipo IN (
    'monday_item', 'monday_subitem', 'monday_asset',
    'caju_pedido', 'caju_boleto',
    'rm_idfinanc', 'rm_convocacao', 'rm_historico', 'rm_ausencia',
    'drive_pasta', 'drive_arquivo',
    'protocolo', 'convocacao_uuid', 'desconto_item', 'solicitacao', 'job'
  ))
);

-- Retry de step não duplica artefato.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atividade_artefato
  ON pi.atividade_artefato (execucao_id, tipo, chave);
-- Busca REVERSA: "de onde veio este IDFINANC / este pedido Caju?" — a pergunta do
-- caso DETRAN 08/2026, que hoje só se responde garimpando execução do n8n.
CREATE INDEX IF NOT EXISTS idx_atividade_artefato_chave
  ON pi.atividade_artefato (tipo, chave);

-- ---------------------------------------------------------------------------
-- ESCAPE DE ERRO. Grava ANTES de enviar — mesma ordem de
-- services/notificarAlteracao.ts: envio que falha grava o erro em vez de sumir.
--
-- Dispara só quando ESGOTA O RETRY: jobs/repo.ts tenta 5× com backoff linear de
-- 30s porque blip da ponte AIONS (ngrok free) se autocura; alertar na 1ª faria o
-- grupo virar ruído e o fusível engolir as falhas reais. Exceção: FatalError e run
-- de dinheiro pela metade alertam na hora, porque não vão se autocurar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.alerta_falha (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SET NULL, não CASCADE: o alerta sobrevive à poda da execução. `corpo` e `link`
  -- ficam desnormalizados justamente pra degradar com "fora da retenção" em vez de
  -- tela branca.
  execucao_id uuid REFERENCES pi.audit_lancamentos(id) ON DELETE SET NULL,
  -- sem FK: o evento é podado aos 12 meses, o alerta fica.
  evento_id bigint,
  origem text NOT NULL,
  acao text,
  etapa text,
  -- md5(acao|etapa|erro NORMALIZADO). O erro é normalizado (fora dígitos, uuids e
  -- ids de request) ANTES do hash, senão "504 req-id abc" e "504 req-id def" geram
  -- assinaturas distintas e o dedupe nunca dispara.
  assinatura text NOT NULL,
  -- Materializada pelo app/DEFAULT porque date_trunc() é STABLE, não IMMUTABLE, e
  -- por isso não pode entrar em expressão de índice único.
  janela timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
  qtd int NOT NULL DEFAULT 1,
  destino text NOT NULL,
  corpo text NOT NULL,
  link text,
  colapsada boolean NOT NULL DEFAULT false,
  enviado_em timestamptz,
  erro text,
  tentativas int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerta_falha_origem_ck
    CHECK (origem IN ('execucao', 'job', 'workflow', 'abandonada'))
);

-- DEDUPE DA TEMPESTADE, e ele vem ANTES do fusível de msgs/hora.
-- Motivo: RM fora do ar durante o mensal = 1 falha idêntica por contrato (100+). Se
-- o teto agisse primeiro, colapsaria 100 cópias do MESMO erro e engoliria a falha
-- DIFERENTE que veio depois — perdendo exatamente a que importava.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_falha_janela
  ON pi.alerta_falha (assinatura, janela);
-- Fila de reenvio: gravada mas não entregue.
CREATE INDEX IF NOT EXISTS idx_alerta_falha_pendente
  ON pi.alerta_falha (criado_em) WHERE enviado_em IS NULL;

-- ---------------------------------------------------------------------------
-- AMARRAS motor -> execução. É o que faz o alerta de um job morto linkar pro log
-- da CONVOCAÇÃO que o enfileirou, em vez de pra um uuid opaco de job.
-- Sem FK: job e run são podados em cadências próprias.
-- ---------------------------------------------------------------------------
ALTER TABLE pi.mensal_run ADD COLUMN IF NOT EXISTS execucao_id uuid;
ALTER TABLE pi.jobs       ADD COLUMN IF NOT EXISTS execucao_id uuid;

-- ---------------------------------------------------------------------------
-- Conserta um no-op silencioso de 04/07/2026.
--
-- A migration 013 foi aplicada em 01/07 (commit 8c54def) inserindo SÓ a linha '*'.
-- Em 04/07 o commit cdf5ade ("n8n vira reserva — WFs do app traduzidos pra código")
-- editou o arquivo JÁ APLICADO pra acrescentar as 7 linhas de processo. Como o
-- ledger pi.schema_migrations é por FILENAME, a 013 nunca re-rodou e essas linhas
-- nunca entraram no banco. Resultado medido em 12/08/2026: só existem '*',
-- convocar, cancelar e split (estes três inseridos à mão via PATCH /api/rotas).
--
-- Ausência de linha é indistinguível de "não configurado", e cai no '*' = n8n. As 4
-- entram aqui EXPLICITAMENTE como 'n8n', que é o comportamento real de hoje — isto
-- torna o estado legível, NÃO troca executor de nada.
-- ---------------------------------------------------------------------------
INSERT INTO pi.rotas_processo (processo, modo) VALUES
  ('registro',  'n8n'),
  ('atestados', 'n8n'),
  ('descontos', 'n8n'),
  ('pontofac',  'n8n')
ON CONFLICT (processo) DO NOTHING;
