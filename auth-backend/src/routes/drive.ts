import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { listarPasta, rootFolderId } from "../clients/drive.js"
import { usuarioDaSessao } from "../session.js"
import { arquivarDrive, gerarPlanilhaConferencia } from "../services/driveArquivar.js"

function serviceTokenOk(req: FastifyRequest): boolean {
  const t = String(req.headers["x-service-token"] ?? "").trim()
  return !!config.serviceToken && t === config.serviceToken
}

async function autorizado(req: FastifyRequest): Promise<boolean> {
  if (serviceTokenOk(req)) return true
  return !!(await usuarioDaSessao(req))
}

export async function rotasDrive(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/drive-intermitente-arquivar",
    async (
      req: FastifyRequest<{
        Body: {
          tipo?: string
          nome?: string
          chapa?: string
          cpf?: string
          contrato?: string
          data_inicio?: string
          data_fim?: string
          item_entrada_id?: string
          board_entrada_id?: string
          gerar_planilha_conferencia?: boolean
          atualizar_monday?: boolean
        }
      }>,
      reply: FastifyReply,
    ) => {
      if (!(await autorizado(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
      try {
        return await arquivarDrive({
          tipo: req.body?.tipo,
          nome: String(req.body?.nome ?? ""),
          chapa: req.body?.chapa,
          cpf: req.body?.cpf,
          contrato: String(req.body?.contrato ?? ""),
          data_inicio: String(req.body?.data_inicio ?? ""),
          data_fim: req.body?.data_fim,
          item_entrada_id: req.body?.item_entrada_id,
          board_entrada_id: req.body?.board_entrada_id,
          gerar_planilha_conferencia: req.body?.gerar_planilha_conferencia === true,
          atualizar_monday: req.body?.atualizar_monday === true,
        })
      } catch (e) {
        req.log.error(e, "drive-intermitente-arquivar falhou")
        return reply.code(502).send({ ok: false, erro: "drive_falhou", mensagem: (e as Error).message })
      }
    },
  )

  /**
   * Árvore de pastas/arquivos a partir de uma pasta (ou da raiz). READ-ONLY, admin.
   *
   * Existe porque a credencial do Drive só vive na Vercel: da máquina do dev não há como
   * conferir se o relatório caiu em `OUTROS/` ou se o mensal foi parar dentro de
   * `INTERMITENTE - PONTUAL`. Sem isto, "a árvore está certa?" só se responde abrindo o Drive
   * no navegador e clicando pasta por pasta.
   */
  app.get(
    "/api/drive/arvore",
    async (
      req: FastifyRequest<{ Querystring: { pasta?: string; nivel?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin" && u.papel !== "dp") return reply.code(403).send({ erro: "sem_permissao" })
      const nivelMax = Math.min(Math.max(Number(req.query.nivel ?? "3") || 3, 1), 8)
      let raiz: string
      try {
        raiz = String(req.query.pasta ?? "").trim() || rootFolderId()
      } catch {
        return reply.code(409).send({ erro: "drive_nao_configurado" })
      }

      interface No {
        id: string
        nome: string
        pasta: boolean
        url?: string
        tamanho?: number
        filhos?: No[]
      }
      // Teto de nós: uma raiz com meses × contratos × pessoas × períodos explode fácil, e a
      // resposta é pra leitura humana, não pra inventário.
      const TETO = 2000
      let vistos = 0
      const andar = async (id: string, nivel: number): Promise<No[]> => {
        if (nivel > nivelMax || vistos >= TETO) return []
        const itens = await listarPasta(id)
        const out: No[] = []
        for (const it of itens) {
          if (vistos >= TETO) break
          vistos++
          out.push({
            id: it.id,
            nome: it.name,
            pasta: it.ehPasta,
            ...(it.webViewLink ? { url: it.webViewLink } : {}),
            ...(it.size ? { tamanho: Number(it.size) } : {}),
            ...(it.ehPasta ? { filhos: await andar(it.id, nivel + 1) } : {}),
          })
        }
        return out
      }

      try {
        const filhos = await andar(raiz, 1)
        return { ok: true, raiz, nivel: nivelMax, nos: vistos, truncado: vistos >= TETO, filhos }
      } catch (e) {
        req.log.error(e, "drive/arvore falhou")
        return reply.code(502).send({ erro: "drive_falhou", mensagem: (e as Error).message })
      }
    },
  )

  app.post(
    "/api/gerar-planilha-conferencia",
    async (
      req: FastifyRequest<{ Body: { item_entrada_id?: string; pasta_convocacao_drive_id?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!(await autorizado(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
      const itemId = String(req.body?.item_entrada_id ?? "").trim()
      const folderId = String(req.body?.pasta_convocacao_drive_id ?? "").trim()
      if (!itemId || !folderId)
        return reply.code(400).send({ ok: false, erro: "payload_incompleto" })
      try {
        const planilha = await gerarPlanilhaConferencia({
          item_entrada_id: itemId,
          pasta_convocacao_drive_id: folderId,
        })
        return { ok: true, planilha }
      } catch (e) {
        req.log.error(e, "gerar-planilha-conferencia falhou")
        return reply.code(502).send({ ok: false, erro: "planilha_falhou", mensagem: (e as Error).message })
      }
    },
  )
}
