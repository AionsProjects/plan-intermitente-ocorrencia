-- Espelho do item na CÓPIA da virada de mês.
--
-- A virada (WF n8n "DP - Plan. de Intermitentes (BENAUT)", cron `0 17 14 * *`) duplica o board
-- central COM os itens, ARQUIVA todos os itens do central e recria a folha do mês seguinte.
-- Uma convocação que atravessa o dia 14 passa a existir em DOIS itens:
--
--   * o original, ARQUIVADO no central — é pra ele que o link `Item Origem` do board Histórico
--     continua apontando (medido: dos 13 Históricos criados em 01–13/07, 7 apontam hoje para
--     itens `18418191275/archived`);
--   * a cópia, ATIVA no board do mês — é nela que o DP trabalha e onde ele reativa.
--
-- Trocar `item_origem_id` pela cópia consertaria o segundo caminho e QUEBRARIA o primeiro. Então
-- o original continua sendo a âncora (é a verdade forense de onde o S-2260 nasceu) e a cópia
-- entra aqui ao lado. `lancamentosDoItem` casa pelos dois.
BEGIN;

ALTER TABLE pi.convocacoes_rm
  ADD COLUMN IF NOT EXISTS item_espelho_id bigint;

COMMENT ON COLUMN pi.convocacoes_rm.item_espelho_id IS
  'Item equivalente na cópia da virada (mesmo Código Convocação RM). Preenchido por /api/boards/virada.';

CREATE INDEX IF NOT EXISTS ix_convocacoes_rm_espelho
  ON pi.convocacoes_rm (item_espelho_id)
  WHERE item_espelho_id IS NOT NULL;

COMMIT;
