import { construirApp } from "./app.js"
import { config } from "./config.js"

// Servidor persistente (dev local / Render / VM). No Vercel NAO usa isso — la a app
// roda como funcao serverless (api/index.ts).
const app = await construirApp()
try {
  await app.listen({ port: config.port, host: "0.0.0.0" })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
