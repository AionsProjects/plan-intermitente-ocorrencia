// Gatilho da felipeta: webhook do Monday quando "OP - Compareceu?" muda.
//
// A rota é GATILHO, não executor: valida, trava a chave de idempotência e dá start() no
// workflow durável — quem paga é ele. Doutrina herdada do receptor do monitor
// (webhookAuditoria.ts): responder 200 SEMPRE em produção (o Monday desativa webhook que
// erra demais) e nunca confiar em índice de label (a virada recria a coluna com ids novos —
// coluna resolvida por NOME via registry, label por TEXTO).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { start } from "workflow/api"
import { config } from "../config.js"
import { query } from "../db.js"
import { estadoEfeito, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import { abrirExecucao } from "../services/execucao.js"
import { executarPontualWorkflowClient } from "../pontual/workflowClient.js"
import { lerPrePagamentoVivo } from "../pontual/prepagamento.js"
import { usuarioDaSessao } from "../session.js"

export const COLUNA_COMPARECEU = "OP - Compareceu?"

const norm = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

interface EventoMonday {
  boardId?: number | string
  pulseId?: number | string
  columnId?: string
  value?: { label?: { text?: string; index?: number } } | null
}

/** Resolve o column_id da coluna do comparecimento NO BOARD DO EVENTO, pelo registry. */
async function colunaCompareceuDoBoard(boardId: string): Promise<string | null> {
  const { rows } = await query<{ column_id: string }>(
    `SELECT column_id FROM board_colunas WHERE monday_board_id = $1 AND nome = $2`,
    [boardId, COLUNA_COMPARECEU],
  )
  return rows[0]?.column_id ?? null
}

async function dispararPagamento(
  itemId: string,
  modo: "producao" | "simulacao",
  operador?: { userId?: string; email?: string; nome?: string },
): Promise<{ status: "iniciado" | "em_curso" | "ja_pago"; execucaoId?: string }> {
  // No-op de re-marcação: fechamento confirmado OU snapshot consumido = já pago.
  if (modo === "producao") {
    if ((await estadoEfeito(`pontual:${itemId}:fechamento`)) === "confirmado") return { status: "ja_pago" }
    const vivo = await lerPrePagamentoVivo(itemId)
    if (vivo?.estado === "consumido") return { status: "ja_pago" }
    // Dedupe de concorrência (webhook duplicado, SIM→NÃO→SIM em segundos).
    const gatilho = await reservarEfeito(`pontual:gatilho:${itemId}`, "pontual_gatilho", { modo })
    if (gatilho === "confirmado") return { status: "ja_pago" }
    if (gatilho === "pendente") return { status: "em_curso" }
  }

  const ex = await abrirExecucao({
    acao: "pontual_pagamento",
    motor: "workflow",
    alvo: itemId,
    operador,
    resumo: { item_origem_id: itemId, modo },
  })
  try {
    await start(executarPontualWorkflowClient, [{ itemOrigemId: itemId, execucaoId: ex.id, modo }])
  } catch (e) {
    // start() falhou = workflow nem nasceu. Solta o gatilho pro retry e registra o erro
    // (fechar erro → alerta WhatsApp).
    if (modo === "producao") await liberarEfeito(`pontual:gatilho:${itemId}`).catch(() => {})
    await ex.fechar("erro", { erro: e, etapaErro: "start_workflow" })
    throw e
  }
  return { status: "iniciado", execucaoId: ex.id }
}

export async function rotasComparecimento(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/monday/comparecimento",
    async (
      req: FastifyRequest<{ Body: { challenge?: string; event?: EventoMonday } }>,
      _reply: FastifyReply,
    ) => {
      // Handshake de criação do webhook — devolve o challenge cru.
      if (req.body?.challenge) return { challenge: req.body.challenge }

      const ev = req.body?.event
      const boardId = String(ev?.boardId ?? "").trim()
      const itemId = String(ev?.pulseId ?? "").trim()
      if (!boardId || !itemId) return { ok: true, ignorado: "evento_incompleto" }

      if (!config.pontualPagamentoHabilitado) return { ok: true, ignorado: "desligado" }

      // Coluna por NOME via registry — nunca por id chumbado (a virada troca os ids).
      const colId = await colunaCompareceuDoBoard(boardId).catch(() => null)
      if (!colId || ev?.columnId !== colId) return { ok: true, ignorado: "outra_coluna" }

      // Label por TEXTO, nunca por index: "NÃO" não dispara; limpar a célula não dispara.
      const label = norm(ev?.value?.label?.text)
      if (label !== "SIM") return { ok: true, ignorado: "label_nao_sim", label }

      try {
        const r = await dispararPagamento(itemId, "producao")
        return { ok: true, ...r }
      } catch (e) {
        // 200 mesmo em erro: o Monday desativa webhook que falha repetido, e o erro já
        // ficou na execução + alerta. O corpo diz o que houve pra debug manual.
        req.log.error(e, "comparecimento: start do pagamento falhou")
        return { ok: false, erro: (e as Error).message?.slice(0, 200) ?? "erro" }
      }
    },
  )

  // Retomada/ensaio manual (admin): redispara o pagamento de um item — solta gatilho preso
  // (workflow que morreu sem liberar) e, com ?simular=1, roda o ensaio a seco (chaves
  // pontual-sim:*, zero efeito externo).
  app.post(
    "/api/pontual/pagamentos/:itemId/retomar",
    async (
      req: FastifyRequest<{ Params: { itemId: string }; Querystring: { simular?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin") return reply.code(403).send({ erro: "sem_permissao" })
      const itemId = String(req.params.itemId ?? "").trim()
      if (!/^\d+$/.test(itemId)) return reply.code(400).send({ erro: "item_invalido" })
      const simular = req.query.simular === "1"

      if (!simular) {
        if (!config.pontualPagamentoHabilitado) {
          return reply.code(409).send({ erro: "pagamento_desligado", mensagem: "PONTUAL_PAGAMENTO_HABILITADO=0" })
        }
        // Solta gatilho órfão (nunca solta confirmado) — é o destravamento manual.
        await liberarEfeito(`pontual:gatilho:${itemId}`).catch(() => {})
      }
      const r = await dispararPagamento(itemId, simular ? "simulacao" : "producao", {
        userId: u.id, email: u.email, nome: [u.nome, u.sobrenome].filter(Boolean).join(" ").trim() || u.email,
      })
      return { ok: true, ...r, simulacao: simular }
    },
  )
}
