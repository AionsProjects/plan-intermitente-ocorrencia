// Config lida em RUNTIME (env do container) — diferente do Vite, que baka em build-time.
// NUNCA expor GOOGLE_CLIENT_SECRET no frontend (VITE_*); ele vive so aqui.

function req(nome: string): string {
  const v = process.env[nome]
  if (!v) throw new Error(`Variavel de ambiente obrigatoria ausente: ${nome}`)
  return v
}

function opt(nome: string, fallback: string): string {
  return process.env[nome] ?? fallback
}

// Dominio do Workspace que pode logar. Auto-provisao: qualquer email deste dominio
// entra como 'operacional'. DP/Admin/RH vem do seed (allowlist) ou promocao.
export const DOMINIO_PERMITIDO = opt("AUTH_ALLOWED_DOMAIN", "contatoserv.com.br")

// Bypass de login Google p/ testes locais (NUNCA ligar em producao).
export const DEV_BYPASS = process.env.AUTH_DEV_BYPASS === "1"

export const config = {
  port: Number(opt("PORT", "3000")),
  // Postgres
  databaseUrl: req("DATABASE_URL"),
  // Google OAuth (confidential client)
  googleClientId: req("GOOGLE_CLIENT_ID"),
  googleClientSecret: req("GOOGLE_CLIENT_SECRET"),
  // URL publica de retorno do OAuth. Ex local: http://localhost/auth/google/callback
  // Ex prod:  http://192.168.0.41/auth/google/callback
  oauthRedirectUri: req("OAUTH_REDIRECT_URI"),
  // Pra onde mandar o usuario apos login OK (front)
  appBaseUrl: opt("APP_BASE_URL", "/"),
  dominioPermitido: DOMINIO_PERMITIDO,
  devBypass: DEV_BYPASS,
  // Sessao
  sessionCookieName: opt("SESSION_COOKIE_NAME", "pi_sess"),
  sessionTtlDias: Number(opt("SESSION_TTL_DIAS", "10")),
  // Cookie Secure: VM intranet e HTTP puro -> default false. Ligar quando tiver TLS.
  cookieSecure: process.env.COOKIE_SECURE === "1",
  // SSL no Postgres (remoto/cloudfy costuma exigir). DB_SSL=1 -> ssl sem verificar CA.
  dbSsl: process.env.DB_SSL === "1",
  // Monday API (registry de boards + create_webhook). Opcional no boot; rotas /api/boards
  // exigem. NUNCA em VITE_*.
  mondayToken: opt("MONDAY_TOKEN", ""),
  mondayApiUrl: opt("MONDAY_API_URL", "https://api.monday.com/v2"),
  // URL base do webhook n8n que recebe o gatilho "ativar" (create_webhook aponta pra ca).
  n8nWebhookAtivar: opt(
    "N8N_WEBHOOK_ATIVAR",
    "https://aionscorp-n8n.cloudfy.live/webhook/Intermitentehaha",
  ),
  // URL pública ABSOLUTA do app (pros links /preencher gravados no Monday). Default =
  // domínio Vercel; sobrescreve com PUBLIC_BASE_URL se mudar de domínio.
  publicBaseUrl: opt("PUBLIC_BASE_URL", "https://plan-intermitente-ocorrencia.vercel.app"),
  // Base dos webhooks n8n (conectores externos RM/Caju/Drive). Ex: unidades RM.
  n8nWebhookBase: opt("N8N_WEBHOOK_BASE", "https://aionscorp-n8n.cloudfy.live/webhook"),
} as const

export type AppConfig = typeof config
