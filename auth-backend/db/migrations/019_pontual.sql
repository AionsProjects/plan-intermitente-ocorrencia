-- Bifurcação do pontual: cálculo na convocação, pagamento na felipeta.
--
-- Hoje o pontual é um WF monolítico do n8n (`E1XAdrEbPy5lZhNS`, 62 nós) disparado por
-- `create_item` no grupo PONTUAL — o pagamento sai no instante em que o item nasce no
-- board, sem ninguém confirmar que o colaborador compareceu. Exigência do Diretor
-- Executivo: o pagamento só segue depois de o operacional marcar a felipeta.
--
-- Isso parte o fluxo em dois momentos separados por DIAS:
--   fase 1 (na convocação) -> calcula, RESERVA o desconto, escreve os valores no item do
--                             Monday e resolve a pasta do Drive. Zero efeito de dinheiro.
--   fase 2 (na felipeta)   -> Caju, RM, financeiro, Solicitação, boleto no Drive.
--
-- Schema pi. Transacional (o runner envolve em BEGIN/COMMIT).

-- ---------------------------------------------------------------------------
-- SNAPSHOT DO PRÉ-PAGAMENTO: o número que a felipeta vai pagar.
--
-- A promessa da bifurcação é que o valor mostrado na convocação seja o valor pago dias
-- depois. Sem snapshot, a felipeta recalcularia contra um FIFO que mudou no meio e o
-- operador veria um número na tela e outro no pagamento — que é exatamente a
-- desconfiança que faz o DP conferir tudo à mão hoje.
--
-- `calculo jsonb` guarda entrada E saída completas: é o que responde "por que essa
-- convocação pagou isso?" meses depois, sem reexecutar nada.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.pontual_prepagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Item do Plano no Monday. É a chave que o webhook da felipeta recebe — ele não
  -- conhece uuid de convocação, só o item que mudou de coluna.
  item_origem_id bigint NOT NULL,
  monday_board_id bigint,
  -- Pode ser NULL: no /convocar o item nasce antes de existir ficha no Histórico.
  uuid_convocacao text,

  chapa text NOT NULL,
  cpf text,
  nome text,
  contrato text,
  -- Seção do RM. `codSecao` vazio foi o que produziu pedido órfão no WF5 (execução
  -- 157795, MARIA AUGUSTA): validado na primeira etapa da fase 2, antes de qualquer efeito.
  cod_secao text,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,

  dias_vr int,
  dias_vt int,
  vr_dia numeric,
  vt_dia numeric,
  bruto_vr numeric,
  bruto_vt numeric,
  desconto_vr numeric,
  desconto_vt numeric,
  liquido_vr numeric,
  liquido_vt numeric,
  -- Crédito do PONTUAL = 2 dias VR + 2 dias VT (decisão de 12/08/2026).
  -- ⚠️ NÃO é a regra do mensal (3 VR / 0 VT): lá o DP credita os 3 primeiros dias à mão na
  -- Caju, e no pontual não há crédito manual. O teto é parametrizado por fluxo em
  -- pontual/calculo.ts — herdar o do mensal é erro de dinheiro em toda convocação.
  credito_vr numeric,
  credito_vt numeric,
  pix_vr numeric,
  pix_vt numeric,
  regra_aplicada text,
  calculo jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Pasta do Drive, resolvida já na fase 1 pra a fase 2 só subir arquivo dentro dela.
  -- IDs, não urls: `https://drive.google.com/drive/folders/<id>` é determinístico, e
  -- guardar a url é duplicar dado derivado.
  --
  -- `pasta_pessoa_drive_id` é o PAI: sem ele, renomear/mover no recálculo exige um
  -- `files.get(fields=parents)` a mais, e checar colisão de nome entre irmãs fica impossível.
  pasta_pessoa_drive_id text,
  pasta_convocacao_drive_id text,
  -- Nome APLICADO ("01 A 05/08/2026"). Transforma "preciso renomear?" em comparação de
  -- string, em vez de ida ao Drive.
  pasta_convocacao_nome text,
  -- Caminho completo resolvido. É o único registro de QUAL CONTRATO_DRIVE_MAP/natureza
  -- foi aplicado — o mapa muda, e a pasta de dezembro não pode ser reinterpretada com o
  -- mapa de março.
  pasta_caminho text,
  -- `divergente` = a pasta existe e é a certa, mas o nome não corresponde ao período
  -- atual (rename recusado por colisão com pasta irmã homônima).
  pasta_estado text NOT NULL DEFAULT 'pendente',
  pasta_resolvida_em timestamptz,

  estado text NOT NULL DEFAULT 'reservado',
  motivo_invalido text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz,

  CONSTRAINT pontual_prepag_estado_ck
    CHECK (estado IN ('reservado', 'consumido', 'liberado', 'invalido')),
  CONSTRAINT pontual_prepag_pasta_estado_ck
    CHECK (pasta_estado IN ('pendente', 'pronta', 'divergente'))
);

-- Um pré-pagamento VIVO por item. Recalcular substitui, não acumula — e
-- 'liberado'/'invalido' saem do índice, então o histórico do item pode ter vários
-- (a cadeia é o que responde "por que essa convocação pagou isso?").
CREATE UNIQUE INDEX IF NOT EXISTS uq_prepag_item_vivo
  ON pi.pontual_prepagamento (item_origem_id)
  WHERE estado IN ('reservado', 'consumido');

-- Fila da expiração: reserva que ficou pra trás porque a felipeta nunca veio.
CREATE INDEX IF NOT EXISTS idx_prepag_expiracao
  ON pi.pontual_prepagamento (data_fim)
  WHERE estado = 'reservado';
CREATE INDEX IF NOT EXISTS idx_prepag_uuid
  ON pi.pontual_prepagamento (uuid_convocacao)
  WHERE uuid_convocacao IS NOT NULL;
-- Fila do back-fill da pasta (Drive falhou ou estourou o teto de tempo na fase 1).
CREATE INDEX IF NOT EXISTS idx_prepag_pasta_pendente
  ON pi.pontual_prepagamento (criado_em)
  WHERE pasta_estado = 'pendente' AND estado IN ('reservado', 'consumido');

-- ---------------------------------------------------------------------------
-- RESERVA DE DESCONTO no ledger FIFO.
--
-- O desconto é dívida da PESSOA (falta, atraso, cancelamento, ponto facultativo), não da
-- convocação, e fica PENDENTE até algum pagamento abater. Com cálculo e pagamento no
-- mesmo instante (o WF5 hoje), ninguém pisa em ninguém. Separados por dias, sim:
--
--   08:00  convocação A calcula, abate os R$ 100 pendentes, mostra "líquido 300"
--   10:00  convocação B da MESMA pessoa vê os MESMOS R$ 100 e abate de novo
--   -> duas convocações prometendo a mesma dívida; uma vai pagar 100 menos do que devia
--
-- ⚠️ A CHAVE É O ITEM DO MONDAY, não uma FK pra pi.descontos. Medido: o FIFO que o mensal
-- consome NÃO vem de pi.descontos — vem do board `18400981023`, lido em `lerApoio()`
-- (mensal/previa.ts) como `descontosItems: RawItem[]` e convertido em `DescontoMensal`
-- cujo `id` é o `item.id` do Monday. `pi.descontos` é dual-write parcial:
-- `upsertDesconto()` nem preenche `monday_item_id`, e finalizar/cancelar rodam no n8n em
-- boa parte dos casos. Reserva gravada lá seria INVISÍVEL ao mensal (ele abateria a mesma
-- dívida de novo) e no-op justamente nos descontos que o n8n criou — a maioria.
--
-- ⚠️ Reserva PRENDE: enquanto marcada, nem outra convocação nem o fechamento mensal
-- abatem. Por isso `lerApoio()` PRECISA subtrair reserva viva do residual antes de
-- entregar ao `calcularMensal` — sem esse ponto a reserva não protege nada. E por isso
-- ela precisa ser SOLTA em três gatilhos: cancelamento, recálculo e expiração
-- (`data_fim + PONTUAL_RESERVA_EXPIRA_DIAS`, default 15). Sem o terceiro, felipeta
-- esquecida trava a dívida pra sempre e o mensal abate menos, sem ninguém perceber.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pi.pontual_reserva_desconto (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prepagamento_id uuid NOT NULL
    REFERENCES pi.pontual_prepagamento(id) ON DELETE CASCADE,
  -- `DescontoMensal.id` = item id do board de Desconto. É a chave que o mensal enxerga.
  desconto_monday_item_id text NOT NULL,
  vr numeric NOT NULL DEFAULT 0,
  vt numeric NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pontual_reserva_valor_ck CHECK (vr >= 0 AND vt >= 0)
);

-- Recalcular não duplica a linha do mesmo desconto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pontual_reserva
  ON pi.pontual_reserva_desconto (prepagamento_id, desconto_monday_item_id);
-- A consulta que `lerApoio()` faz: soma de reserva VIVA por item de desconto.
CREATE INDEX IF NOT EXISTS idx_pontual_reserva_desconto
  ON pi.pontual_reserva_desconto (desconto_monday_item_id);

-- Espelho best-effort em pi.descontos, SÓ pra quando a linha existir por lá (dual-write).
-- Não é fonte de verdade da reserva — a de cima é. Serve pra inspeção manual e pra o dia
-- em que pi.descontos virar a fonte única do ledger.
ALTER TABLE pi.descontos
  ADD COLUMN IF NOT EXISTS reservado_vr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservado_vt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservado_por uuid,
  ADD COLUMN IF NOT EXISTS reservado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_descontos_reservado
  ON pi.descontos (reservado_por)
  WHERE reservado_por IS NOT NULL;

-- Guarda de integridade: reserva nunca passa do que ainda falta abater. Se isto disparar,
-- o cálculo do FIFO tem bug — melhor recusar a gravação do que produzir um pré-pagamento
-- que promete abater dívida inexistente. Tolerância de 0.001 porque o cálculo arredonda em
-- 2 casas e residual 33.33 com reserva 33.33 não pode ser recusado por ruído de float.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'descontos_reserva_ck') THEN
    ALTER TABLE pi.descontos ADD CONSTRAINT descontos_reserva_ck
      CHECK (reservado_vr >= 0 AND reservado_vt >= 0
             AND reservado_vr <= COALESCE(residual_vr, 0) + 0.001
             AND reservado_vt <= COALESCE(residual_vt, 0) + 0.001);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Roteamento: `pontual` passa a existir como processo.
--
-- Entra como 'n8n', que é o executor real de hoje (o WF5). O flip pra 'api' é o ÚLTIMO
-- passo do cutover, depois de o webhook `create_item`→WF5 sair do board — dois executores
-- capazes de pagar a mesma convocação não podem coexistir ligados.
--
-- ⚠️ Sem esta linha o processo cai no '*' = n8n por AUSÊNCIA, que é indistinguível de "não
-- configurado" — foi exatamente o que aconteceu com registro/atestados/descontos/pontofac
-- quando a migration 013 foi editada depois de aplicada (o ledger é por filename, então
-- ela nunca re-rodou).
-- ---------------------------------------------------------------------------
INSERT INTO pi.rotas_processo (processo, modo) VALUES ('pontual', 'n8n')
ON CONFLICT (processo) DO NOTHING;
