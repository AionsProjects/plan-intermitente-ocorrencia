import type { IncomingMessage, ServerResponse } from "node:http"
// Importa a app Fastify JA COMPILADA do backend (auth-backend/dist). O `vercel-build`
// compila o auth-backend antes do frontend. As deps (fastify/pg/...) vêm do package.json
// raiz (Vercel instala na raiz; esbuild da funcao resolve).
import { construirApp } from "../auth-backend/dist/app.js"

// Reusa a app entre invocacoes quentes (evita reabrir pool a cada request).
let appPromise: ReturnType<typeof prepararApp> | null = null

async function prepararApp() {
  const app = await construirApp()
  await app.ready()
  return app
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = prepararApp()
  const app = await appPromise
  app.server.emit("request", req, res)
}
