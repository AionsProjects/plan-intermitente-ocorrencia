// Cria (ou garante) o usuário de serviço n8n + um Bearer token de serviço.
// Uso: npm run token:servico   (ou node --env-file=.env --import tsx src/scripts/token-servico.ts)
// Imprime o token UMA vez — copie pra credencial/env do n8n. Re-rodar gera token novo (o antigo segue válido até desativar).
import { randomBytes } from "node:crypto"
import { pool } from "../db.js"

const EMAIL = (process.env.N8N_SERVICE_EMAIL ?? "n8n@internal.local").toLowerCase()

async function main() {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, nome, papel)
       VALUES ($1, 'n8n Service', 'admin')
     ON CONFLICT (email) DO UPDATE SET papel = 'admin'
     RETURNING id`,
    [EMAIL],
  )
  const userId = rows[0]!.id
  const token = "svc_" + randomBytes(32).toString("hex")
  await pool.query(
    `INSERT INTO service_tokens (token, user_id, descricao)
       VALUES ($1, $2, 'n8n - convocacoes')`,
    [token, userId],
  )
  console.log("[token-servico] usuário:", EMAIL, "id:", userId)
  console.log("[token-servico] TOKEN (copie agora, não será mostrado de novo):")
  console.log(token)
  await pool.end()
}

main().catch((e) => {
  console.error("[token-servico] falhou:", e)
  process.exit(1)
})
