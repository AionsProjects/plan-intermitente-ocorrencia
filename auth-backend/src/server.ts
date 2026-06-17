import Fastify from "fastify"
import cookie from "@fastify/cookie"
import { config } from "./config.js"
import { rotasAuth } from "./routes/auth.js"
import { rotasUsuarios } from "./routes/usuarios.js"
import { rotasAtividade } from "./routes/atividade.js"

const app = Fastify({ logger: true })

await app.register(cookie)
// Mesma origem (nginx faz proxy de /auth e /api) -> nao precisa CORS.
await app.register(rotasAuth)
await app.register(rotasUsuarios)
await app.register(rotasAtividade)

app.get("/auth/health", async () => ({ ok: true }))

// Raiz do backend: ninguem deveria abrir isso no browser. Da uma dica em vez de 404.
app.get("/", async () => ({
  servico: "plano-intermitentes-auth",
  aviso: "Backend de autenticacao. Acesse o app pelo frontend (ex: http://localhost:5174), nao aqui.",
}))

try {
  await app.listen({ port: config.port, host: "0.0.0.0" })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
