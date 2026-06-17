-- Senha local (login por email/CPF). Hash scrypt em src/senha.ts. Idempotente.
-- NULL = conta criada via Google mas ainda sem senha definida.
ALTER TABLE pi.users ADD COLUMN IF NOT EXISTS senha_hash text;
