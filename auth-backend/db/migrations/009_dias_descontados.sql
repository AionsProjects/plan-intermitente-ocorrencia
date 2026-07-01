-- Coluna que registra quais dias JÁ geraram desconto efetivo (por convocação).
-- Fonte de verdade p/ o incremento: ao re-lançar (finalizar/cancelar), o delta =
-- dias com desconto no ledger que NÃO estão aqui -> lança só os novos, sem duplicar.
-- Formato: { "2026-05-17": {"vr": true, "vt": true}, ... }

ALTER TABLE pi.convocacoes ADD COLUMN IF NOT EXISTS dias_descontados jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_convocacoes_dias_descontados ON pi.convocacoes USING gin (dias_descontados);
