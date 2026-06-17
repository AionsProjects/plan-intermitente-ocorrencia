// Seed do 1o Admin (chicken-and-egg: alguem precisa promover os demais pelo painel).
//   SEED_ADMIN_EMAIL -> 1 email @dominio (papel admin)
// DP/RH/Operacional NAO sao semeados: RH/OP vem do onboarding (auto-escolha),
// DP/Admin sao promovidos pelo Admin via /api/usuarios.
// O admin semeado entra sem google_sub/cpf; no 1o login linka e passa pelo onboarding
// (preenche nome/sobrenome/cpf) PRESERVANDO o papel admin.
import { config } from "../config.js"
import { pool } from "../db.js"

const dom = config.dominioPermitido
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? `admin@${dom}`).toLowerCase()

async function main() {
  await pool.query(
    `INSERT INTO users (email, nome, papel)
       VALUES ($1, $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET papel = 'admin'`,
    [adminEmail, "Admin"],
  )
  console.log(`[seed] admin: ${adminEmail}`)
  console.log("[seed] ok")
  await pool.end()
}

main().catch((e) => {
  console.error("[seed] falhou:", e)
  process.exit(1)
})
