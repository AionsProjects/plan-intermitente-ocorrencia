import type { FastifyReply, FastifyRequest } from "fastify"
import { config } from "./config.js"
import { query, type Usuario } from "./db.js"

// Sessao = registro opaco no Postgres. O cookie carrega so o id (uuid) — sem dados.
// Permite revogacao imediata (Admin desativa -> apaga sessao -> logout na hora).

export async function criarSessao(
  reply: FastifyReply,
  userId: string,
  userAgent: string | undefined,
): Promise<void> {
  const expiraEm = new Date(Date.now() + config.sessionTtlDias * 24 * 60 * 60 * 1000)
  const { rows } = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, expira_em, user_agent)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, expiraEm.toISOString(), userAgent ?? null],
  )
  const sessionId = rows[0]!.id
  reply.setCookie(config.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure, // false na VM HTTP; ligar so com TLS
    path: "/",
    maxAge: config.sessionTtlDias * 24 * 60 * 60,
  })
}

// Le o cookie, valida a sessao (existe + nao expirou) e devolve o usuario (se ativo).
export async function usuarioDaSessao(req: FastifyRequest): Promise<Usuario | null> {
  const sessionId = req.cookies[config.sessionCookieName]
  if (!sessionId) return null
  const { rows } = await query<Usuario>(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expira_em > now() AND u.ativo = true`,
    [sessionId],
  )
  return rows[0] ?? null
}

// Autoriza por cookie (frontend) OU Bearer token de servico (n8n/integracao).
// O n8n nao tem sessao de usuario -> manda `Authorization: Bearer <token>`,
// validado contra service_tokens (revogavel via ativo=false). Frontend segue no cookie.
export async function usuarioDaAutorizacao(req: FastifyRequest): Promise<Usuario | null> {
  const porCookie = await usuarioDaSessao(req)
  if (porCookie) return porCookie

  const auth = req.headers.authorization
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim()
    if (!token) return null
    const { rows } = await query<Usuario>(
      `SELECT u.* FROM service_tokens st
         JOIN users u ON u.id = st.user_id
        WHERE st.token = $1 AND st.ativo = true AND u.ativo = true
          AND (st.expira_em IS NULL OR st.expira_em > now())`,
      [token],
    )
    return rows[0] ?? null
  }
  return null
}

export async function destruirSessao(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionId = req.cookies[config.sessionCookieName]
  if (sessionId) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sessionId])
  }
  reply.clearCookie(config.sessionCookieName, { path: "/" })
}

// Apaga todas as sessoes de um usuario (usado quando Admin desativa a conta).
export async function revogarSessoesDoUsuario(userId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId])
}
