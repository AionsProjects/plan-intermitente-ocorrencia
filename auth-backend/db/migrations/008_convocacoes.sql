-- Migração do board Monday de Histórico de Ocorrências (18411141462) -> Postgres.
-- A "ficha" de cada convocação de intermitente. Schema pi. Idempotente.

CREATE TABLE IF NOT EXISTS pi.convocacoes (
  uuid text PRIMARY KEY,                       -- uuid do board (text_mm2xjend); chave natural
  monday_item_id bigint,                       -- id do item no board (p/ dual-write na transição)
  item_origem_id bigint,                       -- item no board Entrada (18413180912)
  chapa text NOT NULL,
  contrato text,
  data_inicio date,
  data_fim date,
  protocolo text,
  status text,                                 -- Aguardando / Concluido / Expirado
  status_cancelamento text,                    -- NULL / Cancelada / Cancelada parcialmente
  data_inicio_cancelamento date,
  optante_vt boolean,
  trabalha_sabado boolean,
  -- campos JSON (long_text no board)
  ledger_beneficios jsonb,                     -- desconto VR/VT por dia + origens (crítico)
  respostas jsonb,                             -- dias com tipo falta/atraso/sem_ocorrencia
  dias_desativados jsonb,
  atestados jsonb,
  split jsonb,
  sabados_extras text[],
  -- agregados calculados
  qtd_faltas int,
  qtd_atrasos int,
  total_minutos int,
  dias_perde_vr numeric,
  dias_perde_vt numeric,
  -- auditoria
  concluido_em timestamptz,
  editado boolean,
  editado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_convocacoes_chapa ON pi.convocacoes (chapa, data_inicio);
CREATE INDEX IF NOT EXISTS idx_convocacoes_protocolo ON pi.convocacoes (protocolo);
CREATE INDEX IF NOT EXISTS idx_convocacoes_status ON pi.convocacoes (status);
CREATE INDEX IF NOT EXISTS idx_convocacoes_status_cancel ON pi.convocacoes (status_cancelamento);
CREATE INDEX IF NOT EXISTS idx_convocacoes_ledger ON pi.convocacoes USING gin (ledger_beneficios);

-- Tokens de serviço (n8n chama os endpoints sem sessão de usuário).
-- Bearer token validado em session.ts (usuarioDaAutorizacao). Revogável (ativo=false).
CREATE TABLE IF NOT EXISTS pi.service_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES pi.users(id) ON DELETE CASCADE,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  expira_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_tokens_user ON pi.service_tokens (user_id);
