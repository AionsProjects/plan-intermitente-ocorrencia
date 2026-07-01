-- Ledger financeiro (Base de Desconto, board 18400981023) -> Postgres.
-- 1 linha por desconto de convocação (ou origem ponto_facultativo). Status PENDENTE/
-- PARCIAL/FINALIZADO; FIFO abate residual. Schema pi. Idempotente.

CREATE TABLE IF NOT EXISTS pi.descontos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_item_id bigint,                 -- item no board (dual-write na transição)
  uuid_convocacao text,                  -- FK lógica p/ pi.convocacoes (null em ponto_facultativo)
  protocolo text,
  nome text,
  chapa text,
  cpf text,
  contrato text,
  data_inicio date,
  data_fim date,
  origem text,                           -- ex: convocacao | ponto_facultativo:<contrato>:<unid>:<data>
  dias_perde_vr numeric DEFAULT 0,
  dias_perde_vt numeric DEFAULT 0,
  qtd_atrasos numeric DEFAULT 0,
  desconto_vr numeric DEFAULT 0,         -- valor original devido
  desconto_vt numeric DEFAULT 0,
  residual_vr numeric DEFAULT 0,         -- o que ainda falta abater (FIFO)
  residual_vt numeric DEFAULT 0,
  descontado_vr numeric DEFAULT 0,       -- o que já foi abatido
  descontado_vt numeric DEFAULT 0,
  status text DEFAULT 'PENDENTE',        -- PENDENTE | PARCIAL | FINALIZADO
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_descontos_uuid ON pi.descontos (uuid_convocacao);
CREATE INDEX IF NOT EXISTS idx_descontos_chapa ON pi.descontos (chapa);
CREATE INDEX IF NOT EXISTS idx_descontos_status ON pi.descontos (status);
CREATE INDEX IF NOT EXISTS idx_descontos_periodo ON pi.descontos (chapa, data_inicio, data_fim);
-- evita duplicar o desconto da mesma convocação por origem
CREATE UNIQUE INDEX IF NOT EXISTS uq_descontos_uuid_origem
  ON pi.descontos (uuid_convocacao, origem) WHERE uuid_convocacao IS NOT NULL;
