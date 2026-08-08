-- Verificação de alteração no board do Plano durante o fechamento da folha.
-- O DP abre uma janela por competência; tudo que mexer no board nesse período é
-- registrado, classificado por autoria e notificado no WhatsApp do DP.
-- Schema pi. Transacional (o runner envolve em BEGIN/COMMIT).

-- ---------------------------------------------------------------------------
-- Janela de observação. Aberta e fechada pelo DP (papel dp/admin).
-- Só OBSERVA: não trava escrita no Monday.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.competencia_bloqueio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia text NOT NULL,                 -- 'YYYY-MM'
  status text NOT NULL DEFAULT 'aberto',     -- aberto | fechado
  motivo text,
  aberto_por_user_id uuid,
  aberto_por_email text,
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_por_user_id uuid,
  fechado_por_email text,
  fechado_em timestamptz,
  -- knobs de notificação (ver §cadência): 'imediato' = 1 msg por alteração.
  modo_notificacao text NOT NULL DEFAULT 'imediato',  -- imediato | digest
  digest_min int NOT NULL DEFAULT 15,
  -- fusível: acima disso numa hora, colapsa em digest e avisa que colapsou.
  -- Medido em 30/07/2026: 659 alterações de OP num único dia.
  teto_msgs_hora int NOT NULL DEFAULT 20,
  destino_whatsapp text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competencia_bloqueio_status_ck CHECK (status IN ('aberto', 'fechado')),
  CONSTRAINT competencia_bloqueio_modo_ck CHECK (modo_notificacao IN ('imediato', 'digest'))
);

-- Uma janela aberta por competência. Fechadas podem se repetir (reabertura).
CREATE UNIQUE INDEX IF NOT EXISTS uq_competencia_bloqueio_aberto
  ON pi.competencia_bloqueio (competencia)
  WHERE status = 'aberto';

-- ---------------------------------------------------------------------------
-- Boards vigiados por janela. É tabela (não array) porque a Virada de Board pode
-- rodar no dia 14 com a janela aberta: a competência migra pro board cópia e
-- entra uma linha nova, cada uma com seu próprio cursor de varredura.
-- O board é resolvido por COMPETÊNCIA (/api/boards/resolver?competencia=),
-- nunca por papel=atual — ver "Papéis de Board (virada)".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.bloqueio_board (
  bloqueio_id uuid NOT NULL REFERENCES pi.competencia_bloqueio(id) ON DELETE CASCADE,
  monday_board_id bigint NOT NULL,
  -- até onde o sweep de activity_logs já leu neste board.
  cursor_ate timestamptz,
  -- id do webhook criado no Monday p/ este board (pra remover ao fechar).
  webhook_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bloqueio_id, monday_board_id)
);

-- ---------------------------------------------------------------------------
-- Uma linha por alteração capturada.
-- activity_log_id é UNIQUE: é o guardrail de idempotência entre as duas camadas
-- de captura (webhook em tempo real + sweep de reconciliação). Re-varrer a
-- janela nunca duplica mensagem.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.board_alteracao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bloqueio_id uuid NOT NULL REFERENCES pi.competencia_bloqueio(id) ON DELETE CASCADE,
  activity_log_id text NOT NULL UNIQUE,
  captura text NOT NULL,                     -- webhook | sweep

  monday_board_id bigint NOT NULL,
  item_id bigint,
  item_nome text,
  grupo_id text,

  evento text NOT NULL,                      -- update_column_value | create_pulse | delete_pulse |
                                             -- move_pulse_from_group | archive_pulse |
                                             -- batch_change_pulses_column_value | ...
  coluna_id text,
  coluna_titulo text,
  coluna_tipo text,
  valor_anterior jsonb,
  valor_novo jsonb,

  -- Autoria bruta, como o Monday devolve.
  autor_id text,                             -- user_id do activity_log ('-4' = app nativo do Monday)
  autor_nome text,

  -- Autoria resolvida. O app grava no Monday com o token do Isaac, então o autor
  -- bruto não é quem clicou: o operador real vem de pi.audit_lancamentos.
  origem text NOT NULL DEFAULT 'desconhecida',
    -- app             -> casou no audit; operador_* preenchido
    -- motor           -> token da automação, sem match, coluna do motor (mensal/virada/WF)
    -- api_inexplicada -> token da automação, sem match, coluna FORA do motor  => investigar
    -- monday_direto   -> autor humano != token => contornou o app, severidade alta
    -- desconhecida    -> ainda não classificada
  operador_nome text,
  operador_email text,
  audit_id uuid,                             -- pi.audit_lancamentos.id que casou

  severidade text NOT NULL DEFAULT 'informativa',  -- critica | informativa
  ocorrido_em timestamptz NOT NULL,
  capturado_em timestamptz NOT NULL DEFAULT now(),
  notificacao_id bigint,

  CONSTRAINT board_alteracao_captura_ck CHECK (captura IN ('webhook', 'sweep')),
  CONSTRAINT board_alteracao_severidade_ck CHECK (severidade IN ('critica', 'informativa')),
  CONSTRAINT board_alteracao_origem_ck CHECK (
    origem IN ('app', 'motor', 'api_inexplicada', 'monday_direto', 'desconhecida')
  )
);

CREATE INDEX IF NOT EXISTS idx_board_alteracao_janela
  ON pi.board_alteracao (bloqueio_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_board_alteracao_item
  ON pi.board_alteracao (item_id, ocorrido_em DESC);
-- fila do notificador: crítica, alguém de fora do motor, ainda não avisada.
CREATE INDEX IF NOT EXISTS idx_board_alteracao_pendente
  ON pi.board_alteracao (bloqueio_id, ocorrido_em)
  WHERE notificacao_id IS NULL AND severidade = 'critica' AND origem <> 'motor';

-- ---------------------------------------------------------------------------
-- Mensagens enviadas. Serve os dois modos: no 'imediato' é 1 alteração por
-- mensagem; no 'digest' (ou quando o fusível estoura) qtd_alteracoes > 1.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.board_notificacao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bloqueio_id uuid NOT NULL REFERENCES pi.competencia_bloqueio(id) ON DELETE CASCADE,
  destino text NOT NULL,                     -- JID do grupo WhatsApp
  corpo text NOT NULL,
  qtd_alteracoes int NOT NULL DEFAULT 1,
  colapsada boolean NOT NULL DEFAULT false,  -- true = fusível de teto_msgs_hora estourou
  enviado_em timestamptz,
  erro text,
  tentativas int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_notificacao_janela
  ON pi.board_notificacao (bloqueio_id, criado_em DESC);
-- fila de reenvio: criada mas ainda não entregue.
CREATE INDEX IF NOT EXISTS idx_board_notificacao_pendente
  ON pi.board_notificacao (criado_em)
  WHERE enviado_em IS NULL;

-- FK circular (alteracao -> notificacao) só dá pra amarrar depois das duas tabelas.
-- Postgres não tem ADD CONSTRAINT IF NOT EXISTS, então o DO block mantém a
-- migration re-executável fora do ledger.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_alteracao_notificacao_fk'
  ) THEN
    ALTER TABLE pi.board_alteracao
      ADD CONSTRAINT board_alteracao_notificacao_fk
      FOREIGN KEY (notificacao_id) REFERENCES pi.board_notificacao(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Cache da resolução uuid_alvo -> item do Plano.
-- pi.audit_lancamentos guarda o item_id direto só em acao='convocacao'; em
-- 'registro'/'cancelamento' guarda o UUID da convocação. A cascata é:
--   1) uuid_alvo numérico            -> já é o item          (medido 259/260)
--   2) pi.convocacoes.item_origem_id -> item do Plano        (medido 58/101)
--   3) Monday: Histórico 18411141462, text_mm2xjend = uuid,
--      lê link_mm2x1rk0 e extrai /pulses/(\d+)                (medido 8/8)
-- O nível 2 fura porque pi.rotas_processo está '* = n8n': finalizar/cancelar
-- rodam no n8n e gravam no Monday sem popular o Postgres.
-- Esta tabela guarda o resultado do nível 3 pra não repetir a ida ao Monday.
-- ATENÇÃO: é item_origem_id (board do PLANO), não monday_item_id (Histórico).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.convocacao_item_plano (
  uuid text PRIMARY KEY,
  item_plano_id bigint NOT NULL,
  monday_board_id bigint,
  nivel int NOT NULL,                        -- 1 | 2 | 3 (qual passo da cascata resolveu)
  resolvido_em timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Colunas que importam durante o fechamento.
-- A regra geral (prefixo 'OP -' / 'Op -' = campo do operacional) fica no código;
-- esta tabela cobre as exceções — as colunas de dinheiro que o motor calcula e
-- que, quando editadas à mão, são o sinal que o DP precisa ver.
-- board_id NULL = vale pra qualquer board vigiado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.bloqueio_coluna_critica (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monday_board_id bigint,
  coluna_titulo text NOT NULL,
  coluna_id text,
  severidade text NOT NULL DEFAULT 'critica',
  ativo boolean NOT NULL DEFAULT true,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bloqueio_coluna_critica
  ON pi.bloqueio_coluna_critica (COALESCE(monday_board_id, 0), lower(coluna_titulo));

INSERT INTO pi.bloqueio_coluna_critica (coluna_titulo, observacao) VALUES
  ('VR - MENSAL',        'motor do mensal escreve; edição manual do DP foi o caso DETRAN 08/2026'),
  ('VR - Unitário',      'motor do mensal escreve'),
  ('VT - Diário',        'motor do mensal escreve'),
  ('CREDITO CAJU',       'motor do mensal escreve'),
  ('CREDITO VT',         'motor do mensal escreve'),
  ('DESCONTO - VR',      'ledger de desconto'),
  ('DESCONTO - VT',      'ledger de desconto'),
  ('Dias Úteis/Mês - VR','base de cálculo do VR'),
  ('Dias Úteis/Mês - VT','base de cálculo do VT'),
  ('Status Pedido',      'coluna mais editada pelo DP (211 em 30 dias)'),
  ('Escala',             'muda dias trabalhados'),
  ('Local/Unidade',      'muda a regra de valores'),
  ('Solicitante',        'quem pediu a convocação')
ON CONFLICT DO NOTHING;
