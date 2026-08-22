-- Estado 'recusado': desfecho de NEGÓCIO, não falha técnica.
--
-- A trava antifraude do /convocar fechava a execução como 'erro'. Nada quebrou —
-- a regra funcionou e recusou uma convocação sobreposta — mas 'erro' é o único
-- estado que dispara o alerta de WhatsApp (services/execucao.ts), então o grupo
-- recebia "*Falha na automação — Convocação*" para comportamento correto.
--
-- 'recusado' = a automação rodou até o fim, decidiu não fazer, e o motivo é
-- regra de negócio. Não alerta. Diferente de:
--   'ok'         -> fez o que foi pedido
--   'parcial'    -> fez, com pendência que a fila resolve (não alerta)
--   'erro'       -> quebrou (alerta)
--   'abandonada' -> abriu e nunca fechou (alerta, via varredura)

ALTER TABLE pi.audit_lancamentos DROP CONSTRAINT IF EXISTS audit_lancamentos_estado_ck;
ALTER TABLE pi.audit_lancamentos ADD CONSTRAINT audit_lancamentos_estado_ck
  CHECK (estado IN ('aberta', 'ok', 'erro', 'parcial', 'abandonada', 'recusado'));

-- Backfill: as recusas já gravadas como 'erro' viram 'recusado', pra parar de
-- aparecer em vermelho no /atividade e de contar no badge de falhas.
-- Predicado estreito de propósito — só a etapa 'antifraude' com a mensagem do
-- conflito. Não toca em nenhum erro real.
UPDATE pi.audit_lancamentos
   SET estado = 'recusado'
 WHERE estado = 'erro'
   AND erro_etapa = 'antifraude'
   AND erro_msg LIKE 'convocacao_conflitante%';

-- pi.alerta_falha NÃO é mexida de propósito: ela é o registro do que o grupo
-- REALMENTE recebeu, e reescrever isso apagaria histórico verdadeiro. Não há
-- fila a suprimir — o envio é síncrono dentro de alertarFalha(), e linha com
-- enviado_em NULL é alerta que já não saiu e não tem quem reenvie.
