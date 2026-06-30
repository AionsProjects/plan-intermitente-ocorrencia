import Fastify from "fastify"
import cookie from "@fastify/cookie"
import { config } from "./config.js"
import { rotasAuth } from "./routes/auth.js"
import { rotasUsuarios } from "./routes/usuarios.js"
import { rotasAtividade } from "./routes/atividade.js"
import { rotasConvocacoes } from "./routes/convocacoes.js"
import { rotasIntermitente } from "./routes/intermitente.js"
import { rotasRm } from "./routes/rm.js"
import { rotasConvocar } from "./routes/convocar.js"
import { rotasJobs } from "./routes/jobs.js"
import { rotasPontoFacultativo } from "./routes/pontofac.js"
import { rotasAtestados } from "./routes/atestados.js"

const app = Fastify({ logger: true })

await app.register(cookie)
// Mesma origem (nginx faz proxy de /auth e /api) -> nao precisa CORS.
await app.register(rotasAuth)
await app.register(rotasUsuarios)
await app.register(rotasAtividade)
await app.register(rotasConvocacoes)
await app.register(rotasIntermitente)
await app.register(rotasRm)
await app.register(rotasConvocar)
await app.register(rotasJobs)
await app.register(rotasPontoFacultativo)
await app.register(rotasAtestados)

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
