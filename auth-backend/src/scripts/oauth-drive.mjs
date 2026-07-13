// Obtém um refresh token OAuth do Google Drive para a CONTA DO USUÁRIO.
// Usa o mesmo OAuth client do login (GOOGLE_CLIENT_ID/SECRET), redirect
// http://localhost:5174/auth/google/callback (já registrado no client).
//
// Uso: pare o dev server (porta 5174 livre) e rode:
//   npx tsx --env-file=.env src/scripts/oauth-drive.mjs
// Abra a URL impressa, logue COM SUA CONTA (membro do Shared Drive), aprove.
// O refresh token é impresso ao final — cole em GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN.
import http from "node:http"

const CLIENT_ID = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
const REDIRECT = "http://localhost:5174/auth/google/callback"
if (!CLIENT_ID || !CLIENT_SECRET) { console.error("GOOGLE_CLIENT_ID/SECRET ausentes no .env"); process.exit(1) }

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: "https://www.googleapis.com/auth/drive",
}).toString()

console.log("\n1) Abra esta URL no navegador e logue COM SUA CONTA (a que tem acesso ao Shared Drive):\n")
console.log(authUrl)
console.log("\n2) Aprove. Vai redirecionar pra localhost:5174 — este script captura o código.\n")

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:5174")
  if (!url.pathname.startsWith("/auth/google/callback")) { res.writeHead(404); res.end(); return }
  const code = url.searchParams.get("code")
  const err = url.searchParams.get("error")
  if (err) { res.end("Erro no consentimento: " + err); console.error("ERRO:", err); server.close(); process.exit(1) }
  if (!code) { res.writeHead(400); res.end("sem code"); return }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }).toString(),
    })
    const j = await r.json()
    if (!j.refresh_token) {
      res.end("Sem refresh_token na resposta. Revogue o acesso em myaccount.google.com/permissions e rode de novo (precisa prompt=consent).")
      console.error("Resposta sem refresh_token:", JSON.stringify(j).slice(0, 300)); server.close(); process.exit(1)
    }
    res.end("OK! Refresh token capturado. Volte ao terminal e feche esta aba.")
    console.log("\n=== REFRESH TOKEN (cole em GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN) ===\n")
    console.log(j.refresh_token)
    console.log("\n=================================================================\n")
  } catch (e) {
    res.end("Falha ao trocar código: " + e.message); console.error(e)
  } finally {
    server.close(); setTimeout(() => process.exit(0), 500)
  }
})
server.listen(5174, () => console.log("(aguardando o redirect em localhost:5174…)"))
