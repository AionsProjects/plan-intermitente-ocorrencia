import Fastify, { type FastifyInstance } from "fastify"
import cookie from "@fastify/cookie"
import { rotasAuth } from "./routes/auth.js"
import { rotasUsuarios } from "./routes/usuarios.js"
import { rotasAtividade } from "./routes/atividade.js"
import { rotasBoards } from "./routes/boards.js"
import { rotasFeriados } from "./routes/feriados.js"
import { rotasIntermitente } from "./routes/intermitente.js"
import { rotasDescontos } from "./routes/descontos.js"
import { rotasConvocar } from "./routes/convocar.js"

// Constroi a app Fastify (sem listen). Usada pelo server.ts (local/Render) e pela
// funcao serverless do Vercel (api/index.ts). Mesma origem -> sem CORS.
export async function construirApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie)
  await app.register(rotasAuth)
  await app.register(rotasUsuarios)
  await app.register(rotasAtividade)
  await app.register(rotasBoards)
  await app.register(rotasFeriados)
  await app.register(rotasIntermitente)
  await app.register(rotasDescontos)
  await app.register(rotasConvocar)

  app.get("/auth/health", async () => ({ ok: true }))

  // Raiz do backend: ninguem deveria abrir isso no browser. Da uma dica em vez de 404.
  app.get("/", async () => ({
    servico: "plano-intermitentes-auth",
    aviso: "Backend de autenticacao. Acesse o app pelo frontend, nao aqui.",
  }))

  return app
}
