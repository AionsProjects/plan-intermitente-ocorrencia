// Roda todas as migrations SQL em ordem alfabetica. Idempotente (SQL usa IF NOT EXISTS).
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// dist/scripts -> ../../db/migrations
const dir = join(__dirname, "..", "..", "db", "migrations")

async function main() {
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  for (const f of arquivos) {
    const sql = readFileSync(join(dir, f), "utf8")
    console.log(`[migrate] aplicando ${f}`)
    await pool.query(sql)
  }
  console.log(`[migrate] ok (${arquivos.length} arquivo(s))`)
  await pool.end()
}

main().catch((e) => {
  console.error("[migrate] falhou:", e)
  process.exit(1)
})
