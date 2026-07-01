-- Acompanhamento ao vivo do pagamento mensal de intermitentes.
-- run_id vem do front (crypto.randomUUID). n8n (WF krRj3) escreve o progresso via X-Service-Token;
-- o front lê via sessão DP e faz polling. Schema pi. Idempotente (pode rodar toda vez).

CREATE TABLE IF NOT EXISTS pi.mensal_run (
  run_id uuid PRIMARY KEY,
  papel text NOT NULL,
  competencia text,
  status text NOT NULL DEFAULT 'preparando',  -- preparando | rodando | concluido | concluido_com_erro | falhou
  total_contratos int NOT NULL DEFAULT 0,
  ok_contratos int NOT NULL DEFAULT 0,
  erro_contratos int NOT NULL DEFAULT 0,
  operador_email text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz
);

CREATE TABLE IF NOT EXISTS pi.mensal_run_item (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES pi.mensal_run(run_id) ON DELETE CASCADE,
  ordem int NOT NULL,
  contrato text NOT NULL,
  qtd int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',   -- pendente | rodando | ok | erro
  erro_msg text,
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  UNIQUE (run_id, contrato)
);

CREATE INDEX IF NOT EXISTS idx_mensal_run_item_run ON pi.mensal_run_item (run_id, ordem);
