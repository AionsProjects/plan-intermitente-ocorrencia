import type { FastifyReply, FastifyRequest } from "fastify"
import { config } from "./config.js"
import { query, type Usuario } from "./db.js"
import { proximaExpiracao } from "./domain/sessao.js"

// Sessao = registro opaco no Postgres. O cookie carrega so o id (uuid) — sem dados.
// Permite revogacao imediata (Admin desativa -> apaga sessao -> logout na hora).
//
// Deslizante: cada uso renova o vencimento (ver domain/sessao.ts). O banco e renovado em
// `usuarioDaSessao`; o cookie do navegador e reemitido no `onSend` (app.ts), porque o
// navegador tambem descarta o cookie no vencimento original — renovar so o banco nao basta.

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido quando a sessao foi renovada nesta requisicao; o onSend reemite o cookie. */
    sessaoRenovada?: { id: string; expiraEm: Date }
  }
}

function opcoesCookie(maxAgeSegundos: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.cookieSecure, // false na VM HTTP; ligar so com TLS
    path: "/",
    maxAge: maxAgeSegundos,
  }
}

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
  reply.setCookie(
    config.sessionCookieName,
    sessionId,
    opcoesCookie(config.sessionTtlDias * 24 * 60 * 60),
  )
}

type LinhaSessao = Usuario & { sessao_expira_em: Date; sessao_criada_em: Date }

// Le o cookie, valida a sessao (existe + nao expirou) e devolve o usuario (se ativo).
// Sessao valida e velha o bastante e renovada aqui mesmo.
export async function usuarioDaSessao(req: FastifyRequest): Promise<Usuario | null> {
  const sessionId = req.cookies[config.sessionCookieName]
  if (!sessionId) return null
  const { rows } = await query<LinhaSessao>(
    `SELECT u.*, s.expira_em AS sessao_expira_em, s.criado_em AS sessao_criada_em
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expira_em > now() AND u.ativo = true`,
    [sessionId],
  )
  const linha = rows[0]
  if (!linha) return null
  const { sessao_expira_em: expiraEm, sessao_criada_em: criadaEm, ...usuario } = linha

  const novaExpiracao = proximaExpiracao({
    agora: new Date(),
    expiraEm,
    criadaEm,
    ttlDias: config.sessionTtlDias,
    tetoDias: config.sessionMaxDias,
  })
  if (novaExpiracao) {
    try {
      // `expira_em < $2`: duas requisicoes simultaneas nao se atropelam e nada encurta.
      await query(`UPDATE sessions SET expira_em = $2 WHERE id = $1 AND expira_em < $2`, [
        sessionId,
        novaExpiracao.toISOString(),
      ])
      req.sessaoRenovada = { id: sessionId, expiraEm: novaExpiracao }
    } catch (e) {
      // Renovar e conforto, nao requisito: a sessao ainda e valida ate o vencimento antigo.
      req.log.warn({ err: e }, "falha ao renovar sessao")
    }
  }
  return usuario as Usuario
}

// onSend global: se a sessao foi renovada, reemite o cookie com o novo maxAge.
export function reemitirCookieDeSessao(req: FastifyRequest, reply: FastifyReply): void {
  const r = req.sessaoRenovada
  if (!r) return
  const segundos = Math.max(1, Math.floor((r.expiraEm.getTime() - Date.now()) / 1000))
  reply.setCookie(config.sessionCookieName, r.id, opcoesCookie(segundos))
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
