-- Separa a edição feita pelo DP da feita pelo OP.
--
-- Motivo (medido em 08/08/2026, 5 dias de activity_logs do board 18418191275):
-- com DP e OP no mesmo balde, 402 das 584 alterações entrariam na fila do WhatsApp.
-- Tirando a auto-notificação do DP: 199. Agrupando por ação de negócio: 50 (10/dia).
--
-- O DP é o DESTINATÁRIO do alerta — avisá-lo do que ele mesmo fez é ruído. As edições
-- dele continuam gravadas e vão pro RELATÓRIO: é lá que mora o confronto do caso
-- DETRAN (ID PEDIDO CAJU do board x ref_externa do ledger), que foi justamente uma
-- edição do DP.

ALTER TABLE pi.board_alteracao DROP CONSTRAINT IF EXISTS board_alteracao_origem_ck;
ALTER TABLE pi.board_alteracao ADD CONSTRAINT board_alteracao_origem_ck CHECK (
  origem IN ('app', 'motor', 'api_inexplicada', 'monday_direto', 'dp_direto', 'desconhecida')
);

-- A fila do notificador tem que excluir dp_direto junto com motor, senão o índice
-- devolve linhas que o código vai descartar depois (deveNotificar()).
DROP INDEX IF EXISTS pi.idx_board_alteracao_pendente;
CREATE INDEX IF NOT EXISTS idx_board_alteracao_pendente
  ON pi.board_alteracao (bloqueio_id, ocorrido_em)
  WHERE notificacao_id IS NULL
    AND severidade = 'critica'
    AND origem NOT IN ('motor', 'dp_direto');

-- Uma ação do app (1 clique) vira ~12 activity_logs com o mesmo audit_id. O
-- agrupamento por ação de negócio consulta por aqui.
CREATE INDEX IF NOT EXISTS idx_board_alteracao_audit
  ON pi.board_alteracao (bloqueio_id, audit_id)
  WHERE audit_id IS NOT NULL;
