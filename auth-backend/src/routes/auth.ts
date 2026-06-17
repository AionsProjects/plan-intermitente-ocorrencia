import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { randomUUID } from "node:crypto"
import { config } from "../config.js"
import { query, type Papel, type Usuario } from "../db.js"
import { cpfValido, soDigitos } from "../cpf.js"
import { hashSenha, verificarSenha, SENHA_MIN } from "../senha.js"
import { ErroOAuth, trocarCodePorPerfil, urlConsentimento } from "../oauth.js"
import { criarSessao, destruirSessao, usuarioDaSessao } from "../session.js"

const STATE_COOKIE = "pi_oauth_state"

// HTML servido no fim do fluxo Google. Em popup: fecha (a janela-mae vigia popup.closed
// e revalida a sessao). NAO depende de window.opener — o Google seta COOP e corta o
// opener no retorno, entao postMessage e best-effort. Se nao for popup (close falha),
// redireciona a propria pagina.
function htmlFimOauth(appBaseUrl: string, erro?: string): string {
  const msg = erro ? `{ tipo: "pi-auth", erro: ${JSON.stringify(erro)} }` : `{ tipo: "pi-auth", ok: true }`
  const destino = erro ? "/login" : appBaseUrl
  return `<!doctype html><meta charset="utf-8"><body style="background:#0a0a0a">
<script>
(function(){
  // localStorage e compartilhado na mesma origem e dispara 'storage' na janela-mae.
  // Robusto contra o COOP do Google (que corta window.opener). Valor = resultado:timestamp.
  try { localStorage.setItem("pi-auth-event", ${JSON.stringify(erro ?? "ok")} + ":" + Date.now()); } catch(e){}
  try { if (window.opener) window.opener.postMessage(${msg}, "*"); } catch(e){}
  try { window.close(); } catch(e){}
  // Se ainda aberta (nao era popup ou close bloqueado), redireciona.
  setTimeout(function(){ window.location.replace(${JSON.stringify(destino)}); }, 400);
})();
</script></body>`
}

function perfilPublico(u: Usuario) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    sobrenome: u.sobrenome,
    cpf: u.cpf,
    papel: u.papel,
    ativo: u.ativo,
    perfil_completo: u.perfil_completo,
  }
}

// Upsert por google_sub. 1o login cria como 'operacional'/ativo. Logins seguintes
// atualizam nome + ultimo_login mas PRESERVAM papel/ativo (gerenciados pelo Admin/seed).
async function upsertUsuario(sub: string, email: string, nome: string): Promise<Usuario> {
  const { rows } = await query<Usuario>(
    `INSERT INTO users (google_sub, email, nome, ultimo_login)
       VALUES ($1, $2, $3, now())
     ON CONFLICT (google_sub) DO UPDATE
       SET nome = EXCLUDED.nome, ultimo_login = now()
     RETURNING *`,
    [sub, email, nome],
  )
  return rows[0]!
}

// Para a allowlist (DP/Admin pre-cadastrados via seed SEM google_sub): no 1o login
// casa pelo email e cola o google_sub, preservando o papel cadastrado.
async function vincularPorEmail(
  sub: string,
  email: string,
  nome: string,
): Promise<Usuario | null> {
  const { rows } = await query<Usuario>(
    `UPDATE users SET google_sub = $1, nome = $3, ultimo_login = now()
      WHERE email = $2 AND google_sub IS NULL
      RETURNING *`,
    [sub, email, nome],
  )
  return rows[0] ?? null
}

export async function rotasAuth(app: FastifyInstance): Promise<void> {
  // Inicio do fluxo: redireciona o NAVEGADOR pro consentimento Google (nao e fetch).
  app.get("/auth/google/login", async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = randomUUID()
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      maxAge: 600, // 10 min
    })
    return reply.redirect(urlConsentimento(state))
  })

  // Retorno do Google.
  app.get(
    "/auth/google/callback",
    async (
      req: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
      reply: FastifyReply,
    ) => {
      const { code, state } = req.query
      const stateCookie = req.cookies[STATE_COOKIE]
      reply.clearCookie(STATE_COOKIE, { path: "/" })

      const responderHtml = (erro?: string) =>
        reply.type("text/html").send(htmlFimOauth(config.appBaseUrl, erro))

      if (!code || !state || !stateCookie || state !== stateCookie) {
        return responderHtml("state_invalido")
      }
      try {
        const perfil = await trocarCodePorPerfil(code)
        const usuario =
          (await vincularPorEmail(perfil.sub, perfil.email, perfil.nome)) ??
          (await upsertUsuario(perfil.sub, perfil.email, perfil.nome))
        if (!usuario.ativo) {
          return responderHtml("conta_desativada")
        }
        await criarSessao(reply, usuario.id, req.headers["user-agent"])
        return responderHtml()
      } catch (e) {
        if (e instanceof ErroOAuth) {
          req.log.warn({ codigo: e.codigo }, "falha oauth")
          return responderHtml(e.codigo)
        }
        req.log.error(e, "erro callback oauth")
        return responderHtml("erro_interno")
      }
    },
  )

  // Quem sou eu (consumido pelo AuthContext via react-query). 401 se nao logado.
  app.get("/auth/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const u = await usuarioDaSessao(req)
    if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
    return perfilPublico(u)
  })

  // Login local por email OU CPF + senha. Conta e criada via Google (onboarding define
  // a senha). Sem conta -> 404 (front sugere criar com Google).
  app.post(
    "/auth/login",
    async (
      req: FastifyRequest<{ Body: { identificador?: string; senha?: string } }>,
      reply: FastifyReply,
    ) => {
      const ident = (req.body?.identificador ?? "").trim()
      const senha = req.body?.senha ?? ""
      if (!ident || !senha) {
        return reply.code(400).send({ erro: "campos_obrigatorios" })
      }
      // Tem "@" -> email; senao trata como CPF (so digitos).
      const porEmail = ident.includes("@")
      const valor = porEmail ? ident.toLowerCase() : soDigitos(ident)
      const { rows } = await query<Usuario>(
        porEmail
          ? `SELECT * FROM users WHERE email = $1`
          : `SELECT * FROM users WHERE cpf = $1`,
        [valor],
      )
      const u = rows[0]
      if (!u) return reply.code(404).send({ erro: "conta_inexistente" })
      if (!u.ativo) return reply.code(403).send({ erro: "conta_desativada" })
      if (!u.senha_hash) return reply.code(409).send({ erro: "sem_senha" })
      if (!verificarSenha(senha, u.senha_hash)) {
        return reply.code(401).send({ erro: "credenciais_invalidas" })
      }
      await query(`UPDATE users SET ultimo_login = now() WHERE id = $1`, [u.id])
      await criarSessao(reply, u.id, req.headers["user-agent"])
      return perfilPublico(u)
    },
  )

  app.post("/auth/logout", async (req: FastifyRequest, reply: FastifyReply) => {
    await destruirSessao(req, reply)
    return { ok: true }
  })

  // Trocar a propria senha. Exige sessao + senha atual correta.
  app.post(
    "/auth/mudar-senha",
    async (
      req: FastifyRequest<{ Body: { senha_atual?: string; nova_senha?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      const atual = req.body?.senha_atual ?? ""
      const nova = req.body?.nova_senha ?? ""
      if (!u.senha_hash) return reply.code(409).send({ erro: "sem_senha" })
      if (!verificarSenha(atual, u.senha_hash)) {
        return reply.code(403).send({ erro: "senha_atual_incorreta" })
      }
      if (nova.length < SENHA_MIN) {
        return reply.code(400).send({ erro: "senha_curta" })
      }
      await query(`UPDATE users SET senha_hash = $2 WHERE id = $1`, [u.id, hashSenha(nova)])
      return { ok: true }
    },
  )

  // Onboarding do 1o login: nome, sobrenome, CPF (validado+unico) e papel.
  // Papel auto-escolhivel SO entre rh|operacional. Quem ja e admin/dp mantem o papel
  // (o front esconde a escolha; aqui ignoramos qualquer tentativa de mudar).
  app.post(
    "/auth/completar-cadastro",
    async (
      req: FastifyRequest<{
        Body: { nome?: string; sobrenome?: string; cpf?: string; papel?: Papel; senha?: string }
      }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })

      const nome = (req.body?.nome ?? "").trim()
      const sobrenome = (req.body?.sobrenome ?? "").trim()
      const cpf = soDigitos(req.body?.cpf ?? "")
      const senha = req.body?.senha ?? ""
      if (!nome || !sobrenome) {
        return reply.code(400).send({ erro: "nome_obrigatorio" })
      }
      if (!cpfValido(cpf)) {
        return reply.code(400).send({ erro: "cpf_invalido" })
      }
      if (senha.length < SENHA_MIN) {
        return reply.code(400).send({ erro: "senha_curta" })
      }

      // Papel: usuarios elevados (admin/dp) preservam; demais escolhem rh|operacional.
      const jaElevado = u.papel === "admin" || u.papel === "dp"
      let papel: Papel = u.papel
      if (!jaElevado) {
        const escolha = req.body?.papel
        if (escolha !== "rh" && escolha !== "operacional") {
          return reply.code(400).send({ erro: "papel_invalido" })
        }
        papel = escolha
      }

      try {
        const { rows } = await query<Usuario>(
          `UPDATE users
              SET nome = $2, sobrenome = $3, cpf = $4, papel = $5,
                  senha_hash = $6, perfil_completo = true
            WHERE id = $1
            RETURNING *`,
          [u.id, nome, sobrenome, cpf, papel, hashSenha(senha)],
        )
        return perfilPublico(rows[0]!)
      } catch (e) {
        // Violacao do indice unico de CPF.
        if ((e as { code?: string }).code === "23505") {
          return reply.code(409).send({ erro: "cpf_duplicado" })
        }
        throw e
      }
    },
  )

  // Bypass de dev: cria/loga usuario sem ir ao Google. So com AUTH_DEV_BYPASS=1.
  if (config.devBypass) {
    // Cria/loga um usuario sem ir ao Google. perfil_completo fica no default (false)
    // no 1o uso -> exercita o onboarding. Para resetar, troque o email ou apague no banco.
    async function devLogin(
      email: string,
      papel: Papel,
      reply: FastifyReply,
      userAgent: string | undefined,
    ): Promise<Usuario> {
      const { rows } = await query<Usuario>(
        `INSERT INTO users (google_sub, email, nome, papel, ultimo_login)
           VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (email) DO UPDATE
           SET papel = EXCLUDED.papel, ultimo_login = now()
         RETURNING *`,
        [`dev:${email}`, email, "Dev User", papel],
      )
      const u = rows[0]!
      await criarSessao(reply, u.id, userAgent)
      return u
    }

    app.post(
      "/auth/dev-login",
      async (
        req: FastifyRequest<{ Body: { email?: string; papel?: Papel } }>,
        reply: FastifyReply,
      ) => {
        const email = (req.body?.email ?? `dev@${config.dominioPermitido}`).toLowerCase()
        const u = await devLogin(email, req.body?.papel ?? "operacional", reply, req.headers["user-agent"])
        return perfilPublico(u)
      },
    )

    // Variante GET p/ testar no browser (navegacao seta o cookie e cai no app).
    // Ex: /auth/dev-login?email=fulano@contatoserv.com.br&papel=operacional
    app.get(
      "/auth/dev-login",
      async (
        req: FastifyRequest<{ Querystring: { email?: string; papel?: Papel } }>,
        reply: FastifyReply,
      ) => {
        const email = (req.query.email ?? `dev@${config.dominioPermitido}`).toLowerCase()
        await devLogin(email, req.query.papel ?? "operacional", reply, req.headers["user-agent"])
        return reply.redirect(config.appBaseUrl)
      },
    )
  }
}
