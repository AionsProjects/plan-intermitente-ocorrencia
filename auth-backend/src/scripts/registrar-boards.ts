// Registra boards no registry pi (lê colunas do Monday, grava title->id). Roda local
// contra cloudfy. Uso: node --env-file=.env --import tsx src/scripts/registrar-boards.ts
// Edite a lista BOARDS abaixo (board_id, competencia, papel) conforme os boards vivos.
import { pool } from "../db.js"
import { lerColunas, lerGrupos } from "../monday.js"

const BOARDS: { id: string; competencia: string; papel: string }[] = [
  { id: "18408773953", competencia: "2026-05", papel: "passado" },
  { id: "18413180912", competencia: "2026-06", papel: "atual" },
  { id: "18418191275", competencia: "2026-07", papel: "proximo" },
]

async function registrar(b: { id: string; competencia: string; papel: string }) {
  const colunas = await lerColunas(b.id)
  if (colunas.length === 0) {
    console.log(`[boards] ${b.id} SEM colunas (token/acesso?) — pulando`)
    return
  }
  await pool.query(
    `INSERT INTO boards (monday_board_id, competencia, papel)
       VALUES ($1,$2,$3)
     ON CONFLICT (monday_board_id) DO UPDATE
       SET competencia=EXCLUDED.competencia, papel=EXCLUDED.papel, ativo=true, atualizado_em=now()`,
    [b.id, b.competencia, b.papel],
  )
  await pool.query(`DELETE FROM board_colunas WHERE monday_board_id=$1`, [b.id])
  for (const c of colunas) {
    await pool.query(
      `INSERT INTO board_colunas (monday_board_id, nome, column_id, tipo)
         VALUES ($1,$2,$3,$4)
       ON CONFLICT (monday_board_id, nome) DO UPDATE SET column_id=EXCLUDED.column_id, tipo=EXCLUDED.tipo`,
      [b.id, c.title, c.id, c.type],
    )
  }
  const grupos = await lerGrupos(b.id)
  await pool.query(`DELETE FROM board_grupos WHERE monday_board_id=$1`, [b.id])
  for (const g of grupos) {
    await pool.query(
      `INSERT INTO board_grupos (monday_board_id, titulo, group_id)
         VALUES ($1,$2,$3)
       ON CONFLICT (monday_board_id, titulo) DO UPDATE SET group_id=EXCLUDED.group_id`,
      [b.id, g.title, g.id],
    )
  }
  console.log(`[boards] ${b.id} (${b.papel}/${b.competencia}): ${colunas.length} colunas, ${grupos.length} grupos`)
}

async function main() {
  for (const b of BOARDS) await registrar(b)
  console.log("[boards] ok")
  await pool.end()
}
main().catch((e) => {
  console.error("[boards] falhou:", e)
  process.exit(1)
})
