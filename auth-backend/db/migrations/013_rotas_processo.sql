-- Chaveamento por processo do Plano de Fuga (contingência): n8n primário; modo por processo.
--   n8n  = tudo via n8n (default, comportamento atual)
--   auto = leituras com failover automático (n8n falhou -> /api); escrita continua só n8n
--   api  = fallback assumiu (flip manual em contingência); leitura E escrita via backend
-- Linha especial '*' = kill-switch global (sobrepõe as demais quando modo='api').
CREATE TABLE IF NOT EXISTS pi.rotas_processo (
  processo text PRIMARY KEY,
  modo text NOT NULL DEFAULT 'n8n' CHECK (modo IN ('n8n', 'auto', 'api')),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pi.rotas_processo (processo, modo) VALUES ('*', 'n8n')
ON CONFLICT (processo) DO NOTHING;
