import Fastify, { type FastifyInstance } from "fastify"
import cookie from "@fastify/cookie"
import multipart from "@fastify/multipart"
import { rotasAuth } from "./routes/auth.js"
import { rotasUsuarios } from "./routes/usuarios.js"
import { rotasAtividade } from "./routes/atividade.js"
import { rotasBoards } from "./routes/boards.js"
import { rotasFeriados } from "./routes/feriados.js"
import { rotasIntermitente } from "./routes/intermitente.js"
import { rotasDescontos } from "./routes/descontos.js"
import { rotasConvocar } from "./routes/convocar.js"
import { rotasGatilhos } from "./routes/gatilhos.js"
import { rotasAtestados } from "./routes/atestados.js"
import { rotasFinalizar } from "./routes/finalizar.js"
import { rotasMensal } from "./routes/mensal.js"
import { rotasMensalRun } from "./routes/mensalRun.js"
import { rotasConvocacoes } from "./routes/convocacoes.js"
import { rotasRm } from "./routes/rm.js"
import { rotasJobs } from "./routes/jobs.js"
import { rotasPontoFacultativo } from "./routes/pontofac.js"
import { rotasEspelhoIntermitente } from "./routes/espelhoIntermitente.js"
import { rotasRotas } from "./routes/rotas.js"
import { rotasContingencia } from "./routes/contingencia.js"

// Constroi a app Fastify (sem listen). Usada pelo server.ts (local/Render) e pela
// funcao serverless do Vercel (api/index.ts). Mesma origem -> sem CORS.
export async function construirApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } })
  await app.register(rotasAuth)
  await app.register(rotasUsuarios)
  await app.register(rotasAtividade)
  await app.register(rotasBoards)
  await app.register(rotasFeriados)
  await app.register(rotasIntermitente)
  await app.register(rotasDescontos)
  await app.register(rotasConvocar)
  await app.register(rotasGatilhos)
  await app.register(rotasAtestados)
  await app.register(rotasFinalizar)
  await app.register(rotasMensal)
  await app.register(rotasMensalRun)
  await app.register(rotasConvocacoes)
  await app.register(rotasRm)
  await app.register(rotasJobs)
  await app.register(rotasPontoFacultativo)
  await app.register(rotasEspelhoIntermitente)
  await app.register(rotasRotas)
  await app.register(rotasContingencia)

  app.get("/auth/health", async () => ({ ok: true }))

  // Raiz do backend: ninguem deveria abrir isso no browser. Da uma dica em vez de 404.
  app.get("/", async () => ({
    servico: "plano-intermitentes-auth",
    aviso: "Backend de autenticacao. Acesse o app pelo frontend, nao aqui.",
  }))

  return app
}
