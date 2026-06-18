-- Grupos do board (PONTUAL, MENSAL, etc) — mapeados por TÍTULO (estável), igual colunas.
-- O group_id muda quando o board duplica; o WF resolve pelo título via registry.
CREATE TABLE IF NOT EXISTS pi.board_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_board_id text NOT NULL,
  titulo text NOT NULL,            -- ex: "PONTUAL"
  group_id text NOT NULL,          -- ex: group_mkta43yr
  UNIQUE (monday_board_id, titulo)
);
CREATE INDEX IF NOT EXISTS idx_board_grupos_board ON pi.board_grupos (monday_board_id);
