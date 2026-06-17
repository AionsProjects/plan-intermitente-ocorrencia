-- REFERENCIA do seed (execucao real: src/scripts/seed.ts, le SEED_ADMIN_EMAIL).
-- Semeia SO o 1o Admin (chicken-and-egg). RH/Operacional vem do onboarding;
-- DP/Admin sao promovidos pelo Admin via painel (/api/usuarios).
-- google_sub/cpf ficam NULL: backend linka no 1o login e o onboarding preenche,
-- preservando o papel admin.

INSERT INTO users (email, nome, papel) VALUES
  ('admin@contatoserv.com.br', 'Admin', 'admin')
ON CONFLICT (email) DO NOTHING;
