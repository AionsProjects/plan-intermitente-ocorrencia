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
  rmSqlAtestados: opt("RM_SQL_ATESTADOS", "ATESTADO_INTER"),
  // IntegrarBackOffices roda SyncExecution=true e segura a conexão — timeout próprio, maior.
  rmSoapTimeoutProcessoMs: Number(opt("RM_SOAP_TIMEOUT_PROCESSO_MS", "120000")),
  // Nexti (validação de atestado — OAuth client_credentials, Basic base64).
  nextiBasicAuth: opt("NEXTI_BASIC_AUTH", ""),
  // Verificação de alteração do board (monitor do fechamento). Ver routes/bloqueio.ts.
  monitor: {
    // user_id do Monday por trás do token que o app E os WFs usam. Medido: Isaac 98663994
    // (`me{}` do MONDAY_TOKEN). Enquanto não houver conta de serviço dedicada, tudo que a
    // automação escreve aparece com esse id — a autoria real vem de pi.audit_lancamentos.
    autorAutomacao: opt("MONITOR_AUTOR_AUTOMACAO", "98663994"),
    // Quem é do DP. O DP é o DESTINATÁRIO do alerta: o que ele mesmo edita entra no
    // relatório mas não pinga o WhatsApp dele. Medido: Thifany Castro 41622430.
    autoresDp: opt("MONITOR_AUTORES_DP", "41622430").split(",").map((s) => s.trim()).filter(Boolean),
    // Janela máxima de uma varredura. Sem teto, uma janela esquecida aberta há semanas
    // pediria milhares de páginas ao Monday num tick só.
    maxDiasPorVarredura: Number(opt("MONITOR_MAX_DIAS_VARREDURA", "7")),
    destinoWhatsapp: opt("MONITOR_DESTINO_WHATSAPP", "120363424978312590@g.us"),
    // Debounce do webhook: o Monday dispara um POST por coluna, então uma convocação
    // vira ~12 webhooks em segundos. Sem isso seriam 12 varreduras do mesmo intervalo.
    debounceWebhookSeg: Number(opt("MONITOR_DEBOUNCE_WEBHOOK_SEG", "45")),
    // ⚠️ O `activity_logs` do Monday NÃO é imediato: medido em 08/08/2026, uma escrita
    // só aparece na consulta ~4 s depois. Como o cursor avança até o fim da fatia, varrer
    // até "agora" pula em silêncio tudo que ainda não indexou. A varredura para nesta
    // margem atrás do relógio; o que é mais novo fica pro próximo tick.
    lagSegundos: Number(opt("MONITOR_LAG_SEG", "60")),
  },
  // Evolution API (WhatsApp). Instância `check-intermitente` — dedicada a este monitor;
  // `AIONS-MIKE` é compartilhada com o WF "Notificar Advertência 4 em 3 meses".
  // ⚠️ `habilitado` DESLIGADO por default: mandar mensagem é irreversível. Sem o flag a
  // notificação é montada e gravada, mas não sai — dá pra conferir antes de soltar.
  evolution: {
    habilitado: process.env.MONITOR_ENVIO_HABILITADO === "1",
    url: opt("EVOLUTION_URL", ""),
    apiKey: opt("EVOLUTION_API_KEY", ""),
    instance: opt("EVOLUTION_INSTANCE", "check-intermitente"),
    // Destino do ESCAPE DE ERRO (fase de automação que não concluiu). Separado do
    // `monitor.destinoWhatsapp` de propósito: são públicos e cadências diferentes — o
    // do monitor hoje é o grupo "Operacional" (3 pessoas), e o de erro é o grupo de
    // erros que já recebe falha da virada.
    destinoErros: opt("EVOLUTION_DESTINO_ERROS", "120363400013959285@g.us"),
    // Fusível: mais apertado que os 20/h do monitor de board. Alerta de erro deve ser
    // raro; se passar disso, algo sistêmico está acontecendo e uma mensagem agrupada
    // diz mais que trinta iguais.
    tetoErrosHora: Number(opt("EVOLUTION_TETO_ERROS_HORA", "10")),
  },
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
    // Link de download da NOTA DE DÉBITO do pedido. Template com `{orderId}` (ou `{id}`).
    // Vive em env, não no código, porque o padrão foi descoberto no painel da Caju e pode
    // mudar sem aviso — trocar env não exige deploy, e sem valor a coluna nasce vazia em
    // vez de gravar link quebrado.
    notaUrlTemplate: opt("CAJU_NOTA_URL", ""),
  },
  // Orquestração mensal nova. O default é deliberadamente seguro: homologação
  // e workflow desligado até migration/env/deploy serem validados.
  // Pré-pagamento do pontual junto da convocação (fase 1 da bifurcação).
  //
  // DESLIGADO por default de propósito: enquanto o WF5 do n8n é quem paga, o pré-pagamento
  // é só sombra — calcula, grava e RESERVA. A reserva é o que tem efeito colateral real
  // (prende dívida do FIFO), então ligar é decisão consciente, não default silencioso.
  //
  // ⚠️ Escrever os 7 valores no item do Monday também depende desta flag: com o WF5 ainda
  // pagando, ele reescreve as mesmas colunas no fim do fluxo dele. Os dois escrevendo é o
  // que permite comparar os números na MESMA convocação durante a homologação — mas só faz
  // sentido depois de o DP saber que o feriado passa a filtrar (1 dia menos que hoje).
  pontualPrePagamentoHabilitado: process.env.PONTUAL_PREPAGAMENTO_HABILITADO === "1",
  // Fase 2 (felipeta): marcar "OP - Compareceu?" = SIM dispara o pagamento. Desligada, a
  // rota do webhook responde {ignorado} — o webhook pode existir no Monday sem risco.
  pontualPagamentoHabilitado: process.env.PONTUAL_PAGAMENTO_HABILITADO === "1",
  // Dias após `data_fim` em que a reserva expira e devolve a dívida ao FIFO. Sem expiração,
  // felipeta esquecida trava a dívida pra sempre e o mensal abate menos, sem ninguém notar.
  pontualReservaExpiraDias: Number(opt("PONTUAL_RESERVA_EXPIRA_DIAS", "15")),
  mensalWorkflowEnabled: process.env.MENSAL_WORKFLOW_ENABLED === "1",
  mensalModo: opt("MENSAL_MODO", "homologacao") === "producao" ? "producao" : "homologacao",
  mensalProductionEnabled: process.env.MENSAL_PRODUCTION_ENABLED === "1",
  // ENSAIO CONTROLADO: permite bypassAntifraude também em producao. Remove a proteção
  // contra pagamento duplicado — NUNCA deixar ligada fora de uma janela de teste.
  mensalTestBypassAntifraude: process.env.MENSAL_TEST_BYPASS_ANTIFRAUDE === "1",
  cronSecret: opt("CRON_SECRET", ""),
} as const

export type AppConfig = typeof config
