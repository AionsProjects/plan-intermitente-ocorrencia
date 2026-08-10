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
  // Monday API (cred "Ray0" — registry de boards, create_webhook, clients/monday).
  // Opcional no boot; rotas que usam exigem. NUNCA em VITE_*.
  mondayToken: opt("MONDAY_TOKEN", ""),
  mondayApiUrl: opt("MONDAY_API_URL", "https://api.monday.com/v2"),
  mondayApiVersion: opt("MONDAY_API_VERSION", "2024-10"),
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
  // Token de serviço p/ WFs n8n (sem sessão) chamarem endpoints do backend (X-Service-Token).
  // Vazio = endpoints de serviço desabilitados. Setar SERVICE_TOKEN no Vercel + no WF.
  serviceToken: opt("SERVICE_TOKEN", ""),
  // Ponte AIONS RM (header AIONS-AUTH). Extraido dos nos n8n. Tudo via env (sem hardcode).
  rmBridgeUrl: opt("RM_BRIDGE_URL", ""),
  rmAionsAuth: opt("RM_AIONS_AUTH", ""),
  rmDataServer: opt("RM_DATA_SERVER", ""),
  // RM TOTVS DIRETO (Basic Auth) — só LEITURA (API consultaSQLServer/RealizaConsulta).
  // Preferido quando configurado: tira a ponte ngrok do caminho das consultas, que era o
  // ponto único de falha (ver janelas de "rm_indisponivel"). Escrita continua pela ponte.
  rmDiretoUrl: opt("RM_DIRETO_URL", ""),
  rmDiretoUser: opt("RM_DIRETO_USER", ""),
  rmDiretoPass: opt("RM_DIRETO_PASS", ""),
  // ESCRITA direta (SOAP wsDataServer/wsProcess). Default DESLIGADO: até o flip, toda escrita
  // continua pela ponte. Liga com RM_ESCRITA_DIRETA=1 e desliga sem deploy se algo estranhar.
  rmEscritaDireta: process.env.RM_ESCRITA_DIRETA === "1",
  // Convocação no RM (SaveRecord em FopConvocacaoData) = evento eSocial S-2260. Desligada por
  // default: o webhook do Monday responde 200 "ignorado" enquanto isso, pra não perder o webhook.
  convocacaoRmHabilitada: process.env.CONVOCACAO_RM_HABILITADA === "1",
  rmCodUsuario: opt("RM_COD_USUARIO", "003080"),
  rmSoapTimeoutMs: Number(opt("RM_SOAP_TIMEOUT_MS", "45000")),
  // Quebra da convocação por atestado (lê a consulta registrada abaixo). Desligada por default:
  // ligar sem a consulta registrada no RM faria TODA gravação falhar — o serviço falha fechado.
  atestadoQuebraConvocacao: process.env.ATESTADO_QUEBRA_CONVOCACAO === "1",
  // Código da consulta SQL registrada no RM. Env pra poder trocar sem deploy se o DP renomear.
  rmSqlAtestados: opt("RM_SQL_ATESTADOS", "PI ATESTADOS"),
  // IntegrarBackOffices roda SyncExecution=true e segura a conexão — timeout próprio, maior.
  rmSoapTimeoutProcessoMs: Number(opt("RM_SOAP_TIMEOUT_PROCESSO_MS", "120000")),
  // Nexti (validação de atestado — OAuth client_credentials, Basic base64).
  nextiBasicAuth: opt("NEXTI_BASIC_AUTH", ""),
  // Google Drive (arquivamento). Use service account compartilhada na pasta raiz.
  googleDrive: {
    serviceAccountJson: opt("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON", ""),
    serviceAccountJsonBase64: opt("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64", ""),
    rootFolderId: opt("GOOGLE_DRIVE_ROOT_FOLDER_ID", ""),
    // OAuth de usuário (age como a conta real — necessário em Shared Drive quando a
    // service account não pode ser membro). Reusa o client de login (GOOGLE_CLIENT_*).
    // Tem prioridade sobre a service account quando presente.
    oauthClientId: opt("GOOGLE_DRIVE_OAUTH_CLIENT_ID", "") || opt("GOOGLE_CLIENT_ID", ""),
    oauthClientSecret: opt("GOOGLE_DRIVE_OAUTH_CLIENT_SECRET", "") || opt("GOOGLE_CLIENT_SECRET", ""),
    oauthRefreshToken: opt("GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN", ""),
  },
  // Caju (OAuth password grant + headers de sponsor/integration). Extraido dos nos n8n.
  caju: {
    authUrl: opt("CAJU_AUTH_URL", ""),
    apiBase: opt("CAJU_API_BASE", "https://services.caju.com.br/partners/v1"),
    clientId: opt("CAJU_CLIENT_ID", ""),
    clientSecret: opt("CAJU_CLIENT_SECRET", ""),
    grantType: opt("CAJU_GRANT_TYPE", "password"),
    username: opt("CAJU_USERNAME", ""),
    password: opt("CAJU_PASSWORD", ""),
    sponsorId: opt("CAJU_SPONSOR_ID", ""),
    integrationId: opt("CAJU_INTEGRATION_ID", ""),
  },
  // Orquestração mensal nova. O default é deliberadamente seguro: homologação
  // e workflow desligado até migration/env/deploy serem validados.
  mensalWorkflowEnabled: process.env.MENSAL_WORKFLOW_ENABLED === "1",
  mensalModo: opt("MENSAL_MODO", "homologacao") === "producao" ? "producao" : "homologacao",
  mensalProductionEnabled: process.env.MENSAL_PRODUCTION_ENABLED === "1",
  // ENSAIO CONTROLADO: permite bypassAntifraude também em producao. Remove a proteção
  // contra pagamento duplicado — NUNCA deixar ligada fora de uma janela de teste.
  mensalTestBypassAntifraude: process.env.MENSAL_TEST_BYPASS_ANTIFRAUDE === "1",
  cronSecret: opt("CRON_SECRET", ""),
} as const

export type AppConfig = typeof config
