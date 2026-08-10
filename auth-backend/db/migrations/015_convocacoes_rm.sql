-- Rastro dos registros que ESTE backend gravou no RM (DataServer FopConvocacaoData,
-- PK = CODCOLIGADA + CHAPA + CODCONVOCACAO). Até aqui o C03S###### só vivia na coluna
-- `Código Convocação RM` do board Entrada e no payload de pi.efeitos_externos.
--
-- Coluna de board não serve de fonte de verdade: o board do mês é CÓPIA (o código não
-- atravessa a virada), ela cabe UM código só, e não sabe dizer POR QUE um código sumiu —
-- e sumir um C03S###### é apagar um evento eSocial S-2260.
--
-- 1 linha por REGISTRO NO RM, porque uma convocação do Monday vira N:
--   1 — caso normal;
--   2 — bifurcação (parte1 = início..parte2-1, parte2 = parte2..fim);
--   N — quebra por atestado (05→20 com atestado 10→11 vira 05→09 e 12→20).
--
-- LIGAÇÃO É POR item_origem_id (item do board Entrada), NÃO por uuid: no instante do
-- lançamento a linha de pi.convocacoes ainda não existe — ela nasce no gatilho "ativar"
-- (routes/gatilhos.ts), que roda depois. `uuid_convocacao` é conveniência preenchida a
-- posteriori, FK LÓGICA sem constraint (mesma escolha de pi.descontos.uuid_convocacao).
--
-- LINHA NUNCA É APAGADA. Sair do RM é mudança de `estado` + `motivo_saida`.

CREATE TABLE IF NOT EXISTS pi.convocacoes_rm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ligação
  item_origem_id bigint NOT NULL,        -- item no board Entrada; NOT NULL sustenta o índice de de-dup
  monday_board_id bigint,                -- board do mês (é cópia); forense
  uuid_convocacao text,                  -- FK lógica p/ pi.convocacoes; NULL até o "ativar" rodar

  -- identidade no RM
  coligada int NOT NULL DEFAULT 3,
  chapa text NOT NULL,                   -- FORMATO RM: 6 dígitos (domain chapaRm()).
                                         -- pi.convocacoes.chapa guarda o texto CRU do Monday
                                         -- ("3330") — cruzar os dois exige lpad, senão dá zero
                                         -- linha em silêncio.
  codigo text,                           -- C03S###### (contador do RM). NULL enquanto reservado.
  pk_rm text,                            -- retorno cru do SaveRecord: "3;003330;C03S003758"

  -- o que foi gravado
  contrato text,
  data_inicio date NOT NULL,             -- DTINIPRESTSERV
  data_fim date NOT NULL,                -- DTFIMPRESTSERV
  data_convocacao date,                  -- DTCONVOCACAO (data do ATO; regra dos 3 dias)
  estado_convocacao int,                 -- ESTADOCONVOCACAO enviado (4 = Concluída)

  -- ciclo de vida
  estado text NOT NULL DEFAULT 'reservado'
    CHECK (estado IN ('reservado','no_rm','a_remover','removido','falhou')),
  motivo_saida text
    CHECK (motivo_saida IS NULL OR motivo_saida IN (
      'cancelamento_total','cancelamento_parcial','bifurcacao',
      'quebra_atestado','duplicidade','correcao_manual')),
  origem_lancamento_id uuid REFERENCES pi.convocacoes_rm(id),  -- quem este lançamento substituiu
  indeterminado boolean NOT NULL DEFAULT false,  -- SOAP mudo: PODE ter gravado; segura o slot
  erro text,

  -- auditoria
  origem_acao text,                      -- pontual | mensal | cancelar | split | atestado | backfill
  criado_por text,
  removido_em timestamptz,
  removido_por text,
  observacao text,
  payload jsonb,                         -- XML enviado, retorno do SOAP, retorno do delete
  criado_em timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz,
  atualizado_em timestamptz,

  CONSTRAINT ck_convocacoes_rm_periodo CHECK (data_fim >= data_inicio),
  -- estar (ou ter estado) no RM implica ter o código do contador automático
  CONSTRAINT ck_convocacoes_rm_codigo
    CHECK (estado NOT IN ('no_rm','a_remover','removido') OR codigo IS NOT NULL)
);

-- DE-DUP DE NEGÓCIO. É este índice que substitui a coluna do Monday.
-- No máximo UM lançamento vivo por item da Entrada começando no mesmo dia.
--   * pedaços de quebra/bifurcação são intervalos DISJUNTOS, então nunca dividem o início:
--     a regra não atrapalha o caso legítimo;
--   * `data_fim` fica FORA de propósito — relançar o mesmo início com fim diferente é
--     duplicata de eSocial, não registro novo; incluir o fim deixaria passar;
--   * `a_remover` fica FORA do predicado — o pedaço 05→09 precisa caber ANTES de o
--     DeleteRecordByKey do 05→20 acontecer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_convocacoes_rm_vivo
  ON pi.convocacoes_rm (item_origem_id, data_inicio)
  WHERE estado IN ('reservado','no_rm');

-- duas linhas nossas não podem reivindicar o mesmo registro do RM
CREATE UNIQUE INDEX IF NOT EXISTS uq_convocacoes_rm_codigo
  ON pi.convocacoes_rm (coligada, chapa, codigo) WHERE codigo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_convocacoes_rm_item ON pi.convocacoes_rm (item_origem_id);
CREATE INDEX IF NOT EXISTS idx_convocacoes_rm_uuid
  ON pi.convocacoes_rm (uuid_convocacao) WHERE uuid_convocacao IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_convocacoes_rm_chapa_periodo
  ON pi.convocacoes_rm (coligada, chapa, data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_convocacoes_rm_contrato ON pi.convocacoes_rm (contrato, data_inicio);
-- fila de conferência humana: reserva pendurada (morreu entre reservar e confirmar) e
-- remoção prometida que não foi executada. É a query de plantão.
CREATE INDEX IF NOT EXISTS idx_convocacoes_rm_pendente
  ON pi.convocacoes_rm (criado_em) WHERE estado IN ('reservado','a_remover');

-- pi.convocacoes é lida por item_origem_id em routes/gatilhos.ts SEM índice nenhum, e agora
-- essa coluna vira também a junção do rastro do RM.
-- NÃO é UNIQUE: auditado em 08/08/2026 e existem 18 item_origem_id repetidos em 148 linhas
-- (os SELECTs de lá são LIMIT 1, então as duplicatas são invisíveis hoje). UNIQUE aqui
-- faria esta migration falhar em produção.
CREATE INDEX IF NOT EXISTS idx_convocacoes_item_origem ON pi.convocacoes (item_origem_id);
