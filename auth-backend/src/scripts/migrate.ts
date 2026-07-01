// Roda as migrations SQL em ordem alfabetica, com LEDGER (pi.schema_migrations):
// cada arquivo roda UMA vez; re-execucao pula os ja registrados.
// REGRAS: (1) NUNCA renomear arquivo ja registrado no ledger (viraria "novo" e re-rodaria);
// (2) migrations novas devem ser transacionais (rodam dentro de BEGIN/COMMIT);
// (3) as 001-012 sao idempotentes (IF NOT EXISTS) — legado de quando nao havia ledger.
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// dist/scripts -> ../../db/migrations
const dir = join(__dirname, "..", "..", "db", "migrations")

async function main() {
  // Bootstrap do ledger inline (nao via .sql — evita ovo-e-galinha).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS pi.schema_migrations (
       filename text PRIMARY KEY,
       aplicado_em timestamptz NOT NULL DEFAULT now()
     )`,
  )
  const { rows } = await pool.query<{ filename: string }>(`SELECT filename FROM pi.schema_migrations`)
  const aplicadas = new Set(rows.map((r) => r.filename))

  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  let novas = 0
  for (const f of arquivos) {
    if (aplicadas.has(f)) {
      console.log(`[migrate] pulando ${f} (ja aplicada)`)
      continue
    }
    const sql = readFileSync(join(dir, f), "utf8")
    console.log(`[migrate] aplicando ${f}`)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(sql)
      await client.query(`INSERT INTO pi.schema_migrations (filename) VALUES ($1)`, [f])
      await client.query("COMMIT")
      novas++
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  }
  console.log(`[migrate] ok (${novas} nova(s) de ${arquivos.length} arquivo(s))`)
  await pool.end()
}

main().catch((e) => {
  console.error("[migrate] falhou:", e)
  process.exit(1)
})
