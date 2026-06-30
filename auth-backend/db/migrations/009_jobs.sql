-- Fila de jobs (serverless + cron tick) + idempotência de efeitos externos.
-- Jobs longos (lote RM, polling boleto Caju, virada) avançam 1 passo por tick.
-- Schema pi. Idempotente.

CREATE TABLE IF NOT EXISTS pi.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,                    -- pontual | mensal | virada | caju_poll | sync_monday | expiracao
  estado text NOT NULL DEFAULT 'pendente', -- pendente | rodando | aguardando_externo | concluido | falhou
  passo int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb,                          -- progresso (lote RM, último chapa, etc)
  tentativas int NOT NULL DEFAULT 0,
  proximo_em timestamptz NOT NULL DEFAULT now(),
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON pi.jobs (estado, proximo_em);

-- Trava "isso já foi feito no mundo real" — antes de qualquer Caju PIX / SOAP RM.
CREATE TABLE IF NOT EXISTS pi.efeitos_externos (
  chave text PRIMARY KEY,                -- ex "caju:pedido:<uuid>:<comp>" | "rm:lanc:<chapa>:<evento>:<comp>"
  tipo text NOT NULL,                    -- caju_pix | rm_soap | drive_upload
  status text NOT NULL DEFAULT 'pendente', -- pendente | confirmado | falhou
  ref_externa text,                      -- id pedido Caju / idVR/idVT do RM
  payload jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz
);
