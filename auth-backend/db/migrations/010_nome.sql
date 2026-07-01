-- Nome do intermitente (= item.name do board Histórico). O importador inicial
-- não trouxe; o front /preencher precisa exibir. Backfill via importar:convocacoes.
ALTER TABLE pi.convocacoes ADD COLUMN IF NOT EXISTS nome text;
