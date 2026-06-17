-- Registry de boards Monday (virada de mês). Resolve column_id por TÍTULO (estável entre
-- cópias). Schema pi. Idempotente.

CREATE TABLE IF NOT EXISTS pi.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_board_id text UNIQUE NOT NULL,
  competencia text,                 -- 'YYYY-MM'
  papel text NOT NULL,              -- 'atual' | 'proximo' | 'passado'
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boards_papel ON pi.boards (papel);
CREATE INDEX IF NOT EXISTS idx_boards_competencia ON pi.boards (competencia);

CREATE TABLE IF NOT EXISTS pi.board_colunas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_board_id text NOT NULL,
  nome text NOT NULL,               -- título da coluna (chave canônica, estável)
  column_id text NOT NULL,          -- id real no Monday (muda a cada cópia)
  tipo text,
  UNIQUE (monday_board_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_board_colunas_board ON pi.board_colunas (monday_board_id);
