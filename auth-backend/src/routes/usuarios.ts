import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query, type Papel, type Usuario } from "../db.js"
import { cpfValido, soDigitos } from "../cpf.js"
import { hashSenha, SENHA_MIN } from "../senha.js"
import { revogarSessoesDoUsuario, usuarioDaSessao } from "../session.js"

const PAPEIS_VALIDOS: Papel[] = ["admin", "dp", "rh", "operacional"]

function perfilPublico(u: Usuario) {
  return {
    id: u.id,
    email: u.email,
    nome: u.nome,
    sobrenome: u.sobrenome,
    cpf: u.cpf,
    papel: u.papel,
    ativo: u.ativo,
    ultimo_login: u.ultimo_login,
  }
}

// Guard interno: exige sessao + papel admin.
async function exigirAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Usuario | null> {
  const u = await usuarioDaSessao(req)
  if (!u) {
    reply.code(401).send({ erro: "nao_autenticado" })
    return null
  }
  if (u.papel !== "admin") {
    reply.code(403).send({ erro: "sem_permissao" })
    return null
  }
  return u
}

export async function rotasUsuarios(app: FastifyInstance): Promise<void> {
  app.get("/api/usuarios", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await exigirAdmin(req, reply))) return
    const { rows } = await query<Usuario>(`SELECT * FROM users ORDER BY nome ASC`)
    return { usuarios: rows.map(perfilPublico) }
  })

  // Admin edita usuario: papel/ativo + dados pessoais (nome/sobrenome/cpf).
  // Email NAO e editavel (identidade Google). Desativar revoga sessoes (logout imediato).
  app.patch(
    "/api/usuarios/:id",
    async (
      req: FastifyRequest<{
        Params: { id: string }
        Body: {
          papel?: Papel
          ativo?: boolean
          nome?: string
          sobrenome?: string
          cpf?: string
        }
      }>,
      reply: FastifyReply,
    ) => {
      if (!(await exigirAdmin(req, reply))) return
      const b = req.body ?? {}

      if (b.papel !== undefined && !PAPEIS_VALIDOS.includes(b.papel)) {
        return reply.code(400).send({ erro: "papel_invalido" })
      }
      // CPF: se veio, valida digito. null/"" não permitido (CPF é obrigatório no perfil).
      let cpf: string | undefined
      if (b.cpf !== undefined) {
        cpf = soDigitos(b.cpf)
        if (!cpfValido(cpf)) return reply.code(400).send({ erro: "cpf_invalido" })
      }
      const nome = b.nome?.trim()
      if (b.nome !== undefined && !nome) {
        return reply.code(400).send({ erro: "nome_obrigatorio" })
      }

      try {
        const { rows } = await query<Usuario>(
          `UPDATE users
              SET papel = COALESCE($2, papel),
                  ativo = COALESCE($3, ativo),
                  nome = COALESCE($4, nome),
                  sobrenome = COALESCE($5, sobrenome),
                  cpf = COALESCE($6, cpf)
            WHERE id = $1
            RETURNING *`,
          [
            req.params.id,
            b.papel ?? null,
            b.ativo ?? null,
            nome ?? null,
            b.sobrenome?.trim() ?? null,
            cpf ?? null,
          ],
        )
        const u = rows[0]
        if (!u) return reply.code(404).send({ erro: "nao_encontrado" })
        if (u.ativo === false) await revogarSessoesDoUsuario(u.id)
        return perfilPublico(u)
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          return reply.code(409).send({ erro: "cpf_duplicado" })
        }
        throw e
      }
    },
  )

  // Admin redefine a senha de um usuario.
  app.post(
    "/api/usuarios/:id/senha",
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { nova_senha?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!(await exigirAdmin(req, reply))) return
      const nova = req.body?.nova_senha ?? ""
      if (nova.length < SENHA_MIN) {
        return reply.code(400).send({ erro: "senha_curta" })
      }
      const { rows } = await query<Usuario>(
        `UPDATE users SET senha_hash = $2 WHERE id = $1 RETURNING id`,
        [req.params.id, hashSenha(nova)],
      )
      if (!rows[0]) return reply.code(404).send({ erro: "nao_encontrado" })
      return { ok: true }
    },
  )
}
