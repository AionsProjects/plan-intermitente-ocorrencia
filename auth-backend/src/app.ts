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
import { rotasMensal } from "./routes/mensal.js"
import { rotasMensalRun } from "./routes/mensalRun.js"
import { rotasMensalOrquestracao } from "./routes/mensalOrquestracao.js"
import { rotasConvocacoes } from "./routes/convocacoes.js"
import { rotasRm } from "./routes/rm.js"
import { rotasJobs } from "./routes/jobs.js"
import { rotasPontoFacultativo } from "./routes/pontofac.js"
import { rotasEspelhoIntermitente } from "./routes/espelhoIntermitente.js"
import { rotasRmLookups } from "./routes/rmLookups.js"
import { rotasDrive } from "./routes/drive.js"
import { rotasRotas } from "./routes/rotas.js"
import { rotasContingencia } from "./routes/contingencia.js"
import { rotasBloqueio } from "./routes/bloqueio.js"
import { rotasWebhookAuditoria } from "./routes/webhookAuditoria.js"
import { rotasComparecimento } from "./routes/comparecimento.js"

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
  await app.register(rotasBloqueio)
  await app.register(rotasWebhookAuditoria)
  await app.register(rotasComparecimento)
  await app.register(rotasAtestados)
  await app.register(rotasMensal)
  await app.register(rotasMensalRun)
  await app.register(rotasMensalOrquestracao)
  await app.register(rotasConvocacoes)
  await app.register(rotasRm)
  await app.register(rotasJobs)
  await app.register(rotasPontoFacultativo)
  await app.register(rotasEspelhoIntermitente)
  await app.register(rotasRmLookups)
  await app.register(rotasDrive)
  await app.register(rotasRotas)
  await app.register(rotasContingencia)

  // Rede do escape de erro: 5xx não tratado em rota de ESCRITA.
  //
  // Um lugar só, em vez de mexer no catch de ~12 arquivos de rota. Rota instrumentada
  // com `comExecucao` já alerta pelo desfecho da execução, então o dedupe por assinatura
  // absorve a sobreposição — o que este hook pega é o que escapou de tudo.
  //
  // GET fica de fora de propósito: leitura que falha é problema de disponibilidade, não
  // de automação que não concluiu, e alertar sobre isso enche o grupo de ruído.
  app.setErrorHandler(async (erroBruto: unknown, req, reply) => {
    // O handler recebe `unknown` nesta versão do Fastify; `statusCode`/`code` são
    // convenção de FastifyError, não garantia de tipo.
    const erro = erroBruto as Error & { statusCode?: number; code?: string }
    const status = reply.statusCode >= 400 ? reply.statusCode : (erro.statusCode ?? 500)
    const escrita = req.method !== "GET" && req.method !== "HEAD"
    if (status >= 500 && escrita) {
      req.log.error(erro, "erro nao tratado em rota de escrita")
      try {
        const { alertarFalha } = await import("./services/alertaFalha.js")
        await alertarFalha({
          origem: "execucao",
          // Sem execução amarrada não há ação de negócio conhecida; `sempre` fura o
          // filtro de relevância porque um 5xx em escrita é sempre digno de olhar.
          acao: "rota",
          etapa: `${req.method} ${req.url.split("?")[0]}`,
          erro,
          sempre: true,
        })
      } catch { /* alerta é secundário */ }
    } else {
      req.log.error(erro)
    }
    // Preserva o corpo que as rotas já devolvem quando elas mesmas responderam.
    if (reply.sent) return
    return reply.code(status).send({ erro: status >= 500 ? "erro_interno" : (erro.code ?? "erro") })
  })

  app.get("/auth/health", async () => ({ ok: true }))

  // Raiz do backend: ninguem deveria abrir isso no browser. Da uma dica em vez de 404.
  app.get("/", async () => ({
    servico: "plano-intermitentes-auth",
    aviso: "Backend de autenticacao. Acesse o app pelo frontend, nao aqui.",
  }))

  return app
}
