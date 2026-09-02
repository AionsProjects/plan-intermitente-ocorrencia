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
import { confirmarEfeito, detalheEfeito, estadoEfeito, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import { abrirExecucao } from "../services/execucao.js"
import { executarPontualWorkflowClient } from "../pontual/workflowClient.js"
import { lerPrePagamentoCompleto, lerPrePagamentoVivo } from "../pontual/prepagamento.js"
import { arquivarRelatorioPontual, lerDadosRelatorioPontual } from "../pontual/relatorioPontual.js"
import { linhasNotaDeRelatorio, registrarNotasCaju } from "../services/notasCaju.js"
import { gerarRelatorioPagamentoPdf, nomeArquivoRelatorio } from "../services/relatorioPagamento.js"
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

/**
 * "Não dispare de novo" — separado e puro porque a regra tem uma exceção que custou dois
 * pagamentos travados.
 *
 * `fechamento` confirmado é o ÚNICO sinal de que o pagamento terminou, e vale sempre.
 *
 * Snapshot `consumido` NÃO significa "o dinheiro saiu": ele é gravado no step do FIFO, no
 * COMEÇO do pagamento. Serve pro webhook (re-marcar SIM não paga de novo) e não pode valer na
 * retomada manual — run que morre depois do FIFO (Caju, Monday, Drive, RM) ficaria irretomável
 * pela rota que existe justamente pra retomá-lo, mesmo com a causa do erro já corrigida. Foi o
 * que travou RAIMUNDA (12940817903) e NATALIA (12951063085) em 09/2026.
 *
 * O que impede pagar duas vezes na retomada é a idempotência por etapa (`efeitos_externos`):
 * ela faz o step PULAR o pedido Caju que já existe e reaproveitar o `orderId` do ledger.
 */
export function jaPago(
  fechamento: "ausente" | "confirmado" | "pendente",
  snapshotEstado: string | null | undefined,
  retomadaManual: boolean,
): boolean {
  if (fechamento === "confirmado") return true
  return !retomadaManual && snapshotEstado === "consumido"
}

async function dispararPagamento(
  itemId: string,
  modo: "producao" | "simulacao",
  operador?: { userId?: string; email?: string; nome?: string },
  retomadaManual = false,
): Promise<{ status: "iniciado" | "em_curso" | "ja_pago"; execucaoId?: string }> {
  if (modo === "producao") {
    const fechamento = await estadoEfeito(`pontual:${itemId}:fechamento`)
    const vivo = fechamento === "confirmado" ? null : await lerPrePagamentoVivo(itemId)
    if (jaPago(fechamento, vivo?.estado, retomadaManual)) return { status: "ja_pago" }
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
      const r = await dispararPagamento(
        itemId,
        simular ? "simulacao" : "producao",
        {
          userId: u.id, email: u.email, nome: [u.nome, u.sobrenome].filter(Boolean).join(" ").trim() || u.email,
        },
        // Retomada de admin ignora o snapshot `consumido` — ver `jaPago`.
        !simular,
      )
      return { ok: true, ...r, simulacao: simular }
    },
  )

  // Relatório de pagamento em PDF, reconstruído do snapshot + artefatos. SÓ LEITURA — nada de
  // Monday, Drive ou Caju. É como se confere o layout (e o valor) de um pagamento já feito
  // antes de o documento começar a ser arquivado automaticamente.
  app.get(
    "/api/pontual/relatorio/:itemId",
    async (req: FastifyRequest<{ Params: { itemId: string } }>, reply: FastifyReply) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin" && u.papel !== "dp") return reply.code(403).send({ erro: "sem_permissao" })
      // Aceita ".pdf" no fim pro navegador nomear o download decentemente.
      const itemId = String(req.params.itemId ?? "").trim().replace(/\.pdf$/i, "")
      if (!/^\d+$/.test(itemId)) return reply.code(400).send({ erro: "item_invalido" })

      const r = await lerDadosRelatorioPontual(
        itemId,
        [u.nome, u.sobrenome].filter(Boolean).join(" ").trim() || u.email,
        new Date(),
      )
      if (!r) return reply.code(404).send({ erro: "sem_prepagamento", item_id: itemId })
      const pdf = gerarRelatorioPagamentoPdf(r.dados)
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${nomeArquivoRelatorio(r.dados)}"`)
        .send(pdf)
    },
  )

  // Back-fill de um pagamento que já saiu: sobe o relatório no Drive e cria as linhas no board
  // de notas. Existe porque os primeiros pagamentos da felipeta (13/08) nasceram antes disto —
  // e porque board registrado depois do pagamento deixa a linha faltando.
  //
  // Idempotente pelas MESMAS chaves do workflow: `monday_notas` é a chave real, então nem o
  // back-fill duplica linha, nem uma retomada do workflow cria de novo o que o back-fill criou.
  app.post(
    "/api/pontual/notas/:itemId",
    async (req: FastifyRequest<{ Params: { itemId: string } }>, reply: FastifyReply) => {
      const u = await usuarioDaSessao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin") return reply.code(403).send({ erro: "sem_permissao" })
      const itemId = String(req.params.itemId ?? "").trim()
      if (!/^\d+$/.test(itemId)) return reply.code(400).send({ erro: "item_invalido" })

      const quem = [u.nome, u.sobrenome].filter(Boolean).join(" ").trim() || u.email
      const r = await lerDadosRelatorioPontual(itemId, `back-fill por ${quem}`, new Date())
      if (!r) return reply.code(404).send({ erro: "sem_prepagamento", item_id: itemId })
      // Confere as linhas que o board REALMENTE vai receber (hoje só crédito) antes de subir
      // arquivo: um pagamento sem crédito nenhum não tem o que registrar aqui.
      const linhas = linhasNotaDeRelatorio(r.dados)
      if (!linhas.length) {
        return reply.code(409).send({
          erro: "sem_pedido_credito",
          mensagem: "pagamento sem pedido de crédito (semSaldo, ou só boleto)",
          pedidos: r.dados.pedidos.map((p) => `${p.natureza} ${p.orderId}`),
        })
      }

      const snapshot = await lerPrePagamentoCompleto(itemId)
      if (!snapshot) return reply.code(404).send({ erro: "sem_prepagamento", item_id: itemId })

      // Drive com chave PRÓPRIA: a chave `drive` do pagamento já está confirmada, e reusá-la
      // faria o back-fill se pular achando que o PDF já subiu.
      let relatorioUrl: string | null = null
      const chaveDrive = `pontual:${itemId}:relatorio_backfill`
      const jaSubiu = await detalheEfeito(chaveDrive)
      if (jaSubiu?.status === "confirmado") {
        relatorioUrl = (jaSubiu.payload as { relatorioUrl?: string } | null)?.relatorioUrl ?? null
      } else {
        await reservarEfeito(chaveDrive, "pontual_relatorio_backfill", { itemId, por: u.email })
        const up = await arquivarRelatorioPontual(snapshot, r.dados)
        relatorioUrl = up.url
        await confirmarEfeito(chaveDrive, `drive:relatorio:${up.pastaId ?? "-"}`, { relatorioUrl })
      }

      const chaveNotas = `pontual:${itemId}:monday_notas`
      const notas = await detalheEfeito(chaveNotas)
      if (notas?.status === "confirmado") {
        return { ok: true, relatorio_url: relatorioUrl, notas: "ja_registradas", ref: notas.refExterna }
      }
      await reservarEfeito(chaveNotas, "pontual_monday_notas", { itemId, por: u.email, backfill: true })
      const res = await registrarNotasCaju(linhas.map((l) => ({ ...l, relatorioUrl })))
      if (res.pulado) {
        // Board ausente: solta a chave pra o back-fill valer de novo depois de registrar o board.
        await liberarEfeito(chaveNotas).catch(() => {})
        return reply.code(409).send({ erro: res.pulado, relatorio_url: relatorioUrl })
      }
      await confirmarEfeito(chaveNotas, `monday:notas:${res.criados.map((c) => c.itemId).join(",")}`)
      return {
        ok: true,
        relatorio_url: relatorioUrl,
        criados: res.criados,
        colunas_faltando: res.faltando,
      }
    },
  )
}
