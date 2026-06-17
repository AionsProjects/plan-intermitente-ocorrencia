import { OAuth2Client } from "google-auth-library"
import { config } from "./config.js"

const client = new OAuth2Client({
  clientId: config.googleClientId,
  clientSecret: config.googleClientSecret,
  redirectUri: config.oauthRedirectUri,
})

const SCOPES = ["openid", "email", "profile"]

// Monta a URL de consentimento do Google. `state` = anti-CSRF (validado no callback).
// `hd` restringe o seletor de conta ao dominio do Workspace (dica, NAO garantia —
// a validacao real do dominio acontece no callback).
export function urlConsentimento(state: string): string {
  return client.generateAuthUrl({
    access_type: "online",
    scope: SCOPES,
    state,
    hd: config.dominioPermitido,
    prompt: "select_account",
  })
}

export interface PerfilGoogle {
  sub: string
  email: string
  nome: string
}

// Troca o `code` por tokens e valida o ID token (assinatura + iss + aud via Google).
// Aplica a restricao de dominio: email verificado E pertence ao dominio permitido.
export async function trocarCodePorPerfil(code: string): Promise<PerfilGoogle> {
  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) throw new ErroOAuth("sem_id_token", "Google nao retornou id_token")

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.googleClientId,
  })
  const p = ticket.getPayload()
  if (!p || !p.sub || !p.email) {
    throw new ErroOAuth("payload_invalido", "ID token sem sub/email")
  }
  if (!p.email_verified) {
    throw new ErroOAuth("email_nao_verificado", "Email Google nao verificado")
  }

  const email = p.email.toLowerCase()
  const dominioOk =
    p.hd === config.dominioPermitido ||
    email.endsWith(`@${config.dominioPermitido}`)
  if (!dominioOk) {
    throw new ErroOAuth(
      "dominio_nao_permitido",
      `Apenas contas @${config.dominioPermitido} podem acessar`,
    )
  }

  return { sub: p.sub, email, nome: p.name ?? email }
}

export class ErroOAuth extends Error {
  constructor(
    public codigo: string,
    mensagem: string,
  ) {
    super(mensagem)
    this.name = "ErroOAuth"
  }
}
