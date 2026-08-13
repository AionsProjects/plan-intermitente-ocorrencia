-- Reconhecer erro no log de atividade: "eu vi, está tratado".
--
-- Por que: a página abre com um banner vermelho contando os lançamentos que não
-- concluíram, e ele não distingue "quebrou agora" de "quebrou ontem e já resolvi". Com uma
-- falha antiga parada ali, o banner passa a ser paisagem — e quando aparece uma quebra de
-- verdade, ninguém repara. Foi exatamente o caso da execução fantasma da KETLEM (12/08):
-- resolvida, anotada à mão, e ainda contando como erro em aberto.
--
-- Reconhecer NÃO apaga nem conserta nada: o erro segue no log, com estado 'erro', visível
-- no filtro e no relatório. Só sai da CONTAGEM que pede atenção.

ALTER TABLE audit_lancamentos
  ADD COLUMN IF NOT EXISTS erro_reconhecido_em timestamptz,
  -- Quem reconheceu, por email: o log é lido por várias pessoas (OP, DP, admin) e "quem
  -- disse que estava ok" é a primeira pergunta quando o problema volta.
  ADD COLUMN IF NOT EXISTS erro_reconhecido_por text,
  -- Motivo opcional, curto. Sem ele o reconhecimento vira um "ok" sem memória — e daqui a
  -- um mês ninguém sabe se foi resolvido, se era falso alarme ou se ficou pendente.
  ADD COLUMN IF NOT EXISTS erro_reconhecido_nota text;

-- Índice parcial: a listagem pergunta "quais erros AINDA pedem atenção", nunca "quais foram
-- reconhecidos". Só as linhas em aberto entram no índice.
CREATE INDEX IF NOT EXISTS idx_audit_erro_em_aberto
  ON audit_lancamentos (criado_em DESC)
  WHERE estado IN ('erro', 'abandonada') AND erro_reconhecido_em IS NULL;
