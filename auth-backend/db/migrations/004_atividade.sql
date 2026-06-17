-- Atividade (histórico de ações no Postgres). Estende audit_lancamentos. Schema pi.
ALTER TABLE pi.audit_lancamentos ADD COLUMN IF NOT EXISTS operador_nome text;
ALTER TABLE pi.audit_lancamentos ADD COLUMN IF NOT EXISTS pessoa_nome text;
ALTER TABLE pi.audit_lancamentos ADD COLUMN IF NOT EXISTS contrato text;

-- operador_email aceita NULL (futuro: import do board sem operador).
ALTER TABLE pi.audit_lancamentos ALTER COLUMN operador_email DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atividade_user ON pi.audit_lancamentos (user_id);
CREATE INDEX IF NOT EXISTS idx_atividade_criado ON pi.audit_lancamentos (criado_em DESC);
