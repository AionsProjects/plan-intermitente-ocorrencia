-- 016: modo desenvolvedor do mensal — famílias de efeito que vão REAIS num run de teste.
--
-- NULL = run normal (comportamento de sempre). Array JSON = run de desenvolvedor: o modo do run
-- é forçado pra 'homologacao' (chave de idempotência POR RUN — teste real jamais pode marcar
-- etapa como feita pra competência, lição do incidente e173b1ef) e o reservarOuPular do workflow
-- consulta esta lista pra decidir o que executa de verdade em vez de simular.
ALTER TABLE pi.mensal_run ADD COLUMN IF NOT EXISTS dev_familias_reais jsonb;
