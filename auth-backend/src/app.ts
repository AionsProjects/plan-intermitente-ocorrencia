import Fastify, { type FastifyInstance } from "fastify"
import cookie from "@fastify/cookie"
import { rotasAuth } from "./routes/auth.js"
import { rotasUsuarios } from "./routes/usuarios.js"
import { rotasAtividade } from "./routes/atividade.js"

// Constroi a app Fastify (sem listen). Usada pelo server.ts (local/Render) e pela
// funcao serverless do Vercel (api/index.ts). Mesma origem -> sem CORS.
export async function construirApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie)
  await app.register(rotasAuth)
  await app.register(rotasUsuarios)
  await app.register(rotasAtividade)

  app.get("/auth/health", async () => ({ ok: true }))

  // Raiz do backend: ninguem deveria abrir isso no browser. Da uma dica em vez de 404.
  app.get("/", async () => ({
    servico: "plano-intermitentes-auth",
    aviso: "Backend de autenticacao. Acesse o app pelo frontend, nao aqui.",
  }))

  return app
}
