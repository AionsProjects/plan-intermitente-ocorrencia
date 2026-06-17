-- Onboarding: dados que a pessoa preenche no 1o login. Idempotente. Schema pi.
ALTER TABLE pi.users ADD COLUMN IF NOT EXISTS sobrenome text;
ALTER TABLE pi.users ADD COLUMN IF NOT EXISTS cpf text;             -- 11 digitos, so numeros
ALTER TABLE pi.users ADD COLUMN IF NOT EXISTS perfil_completo boolean NOT NULL DEFAULT false;

-- CPF unico (quando preenchido). Indice parcial ignora NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cpf ON pi.users (cpf) WHERE cpf IS NOT NULL;
