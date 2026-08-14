-- Modo 'escape': o Vercel vira PRIMÁRIO de verdade e o n8n vira rota de fuga.
--
-- Os três modos anteriores não expressam a premissa registrada em docs/paridade
-- ("o código é o PRINCIPAL, o n8n é a reserva"):
--   n8n  -> só n8n, sem fallback nenhum. n8n é o executor.
--   auto -> n8n PRIMÁRIO com queda pro /api. Invertido em relação à premissa.
--   api  -> só /api, sem fuga. Flipar pra cá REMOVE a rota de fuga em vez de criar uma,
--           e o botão do flip de volta (PATCH /api/rotas/:processo) mora no próprio
--           Vercel — se ele cair, não há como acionar o escape pela API.
--
-- 'escape' fecha esse buraco:
--   LEITURA  -> /api com timeout; rede/timeout/5xx/404 cai pro n8n. Automático.
--   ESCRITA  -> só /api. Erro sobe pro operador. NUNCA repete no n8n, porque 5xx ou
--               timeout não provam que o backend não gravou: repetir duplicaria
--               desconto e pagamento. É a mesma razão pela qual o modo 'auto' só cai
--               na escrita em 404 (webhook ausente é prova; lentidão não é).
--
-- Nenhuma linha muda de modo aqui. Esta migration só ABRE a possibilidade; o flip de
-- cada processo é manual e vem depois da verificação de paridade.

ALTER TABLE pi.rotas_processo DROP CONSTRAINT IF EXISTS rotas_processo_modo_check;
ALTER TABLE pi.rotas_processo ADD CONSTRAINT rotas_processo_modo_check
  CHECK (modo IN ('n8n', 'auto', 'api', 'escape'));

-- Saúde da ponte: o n8n é o relógio do backend (a conta Vercel é HOBBY e só aceita cron
-- diário, então a cadência de 15 min do POST /api/jobs/tick vem do WF Uue6DferTufop3rs).
-- Sem este carimbo, o dia em que essa ponte parar ninguém fica sabendo: as reservas do
-- pontual param de expirar, o sweep do monitor de alteração para, e nada apita.
CREATE TABLE IF NOT EXISTS pi.saude_ponte (
  chave text PRIMARY KEY,
  ultimo_em timestamptz NOT NULL DEFAULT now(),
  origem text,
  alertado_em timestamptz
);
