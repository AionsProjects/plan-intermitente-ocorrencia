-- Orquestração durável do pagamento mensal.
-- Mantém compatibilidade com as rotas legadas usadas pelo n8n durante o cutover.

ALTER TABLE pi.mensal_run
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'homologacao',
  ADD COLUMN IF NOT EXISTS etapa_atual text NOT NULL DEFAULT 'previa',
  ADD COLUMN IF NOT EXISTS snapshot jsonb,
  ADD COLUMN IF NOT EXISTS alertas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_run_id text,
  ADD COLUMN IF NOT EXISTS aprovado_por text,
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_por text,
  ADD COLUMN IF NOT EXISTS cancelado_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS efeito_irreversivel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tentativas int NOT NULL DEFAULT 0;

ALTER TABLE pi.mensal_run_item
  ADD COLUMN IF NOT EXISTS etapa_atual text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS tentativas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshot jsonb,
  ADD COLUMN IF NOT EXISTS referencias_externas jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio text,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS pi.mensal_run_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES pi.mensal_run(run_id) ON DELETE CASCADE,
  contrato text,
  etapa text NOT NULL,
  estado text NOT NULL,
  tentativa int NOT NULL DEFAULT 1,
  mensagem text,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensal_run_event_cursor
  ON pi.mensal_run_event (run_id, id);
CREATE INDEX IF NOT EXISTS idx_mensal_run_event_contrato
  ON pi.mensal_run_event (run_id, contrato, criado_em);
CREATE INDEX IF NOT EXISTS idx_mensal_run_ativo
  ON pi.mensal_run (status, atualizado_em)
  WHERE status IN ('aguardando_aprovacao','fila','rodando','recuperando');

-- A mesma chave de negócio deve continuar protegida mesmo quando um novo run for criado.
CREATE INDEX IF NOT EXISTS idx_efeitos_externos_criado
  ON pi.efeitos_externos (criado_em);

