-- Schema de autenticacao/usuario. Idempotente (pode rodar no boot toda vez).
-- Hierarquia de papeis: admin > dp > rh/op.
-- TUDO no schema `pi` — o banco cloudfy e compartilhado e ja tem outra tabela `users`.

CREATE SCHEMA IF NOT EXISTS pi;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'papel' AND n.nspname = 'pi'
  ) THEN
    CREATE TYPE pi.papel AS ENUM ('admin','dp','rh','operacional');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS pi.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text UNIQUE,                       -- NULL ate o 1o login (allowlist Admin)
  email text UNIQUE NOT NULL,
  nome text NOT NULL,
  papel pi.papel NOT NULL DEFAULT 'operacional',
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_login timestamptz
);

CREATE TABLE IF NOT EXISTS pi.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- valor opaco que vai no cookie
  user_id uuid NOT NULL REFERENCES pi.users(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON pi.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expira ON pi.sessions (expira_em);

-- OPCIONAL — prepara terreno p/ migracao Monday->Postgres (futuro). Ainda nao usada.
CREATE TABLE IF NOT EXISTS pi.audit_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES pi.users(id),
  operador_email text NOT NULL,
  acao text NOT NULL,
  uuid_alvo text,
  payload_resumo jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
