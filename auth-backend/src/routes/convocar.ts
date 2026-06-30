import type { FastifyInstance, FastifyRequest } from "fastify"
import { lerPorColuna, criarItem, texto, dataApenas } from "../clients/monday.js"
import { acharConflito, type ConvocacaoExistente } from "../domain/antifraude.js"
import { boardAtual } from "../repo/boards.js"

// Convocar (WF7) — POST /api/intermitente-convocar. Resolve board atual (registry),
// trava antifraude de período (lê Entrada via Monday), cria item no grupo PONTUAL.
// ESCRITA Monday (cria item) — em teste, criar e APAGAR logo após.

// Colunas do board Entrada (estáveis na duplicação).
const COL = {
  chapa: "texto",
  cpf: "dup__of_matr_cula",
  funcao: "texto0",
  admissao: "text_mkzh8jhn",
  contrato: "color_mktcnxwn",
  dataInicio: "date_mktayxhb",
  dataFim: "date_mktasnwq",
  tipo: "color_mkta71ex",
  status: "color_mm3a8ana",
  cancelInicio: "date_mm3b88ta",
  sabado: "color_mktaavmp",
  interior: "color__1",
  solicitante: "color_mktc9q29",
  justificativa: "color_mktarrgs",
  unidadeTexto: "texto75",
  ativar: "color_mm2pxmak",
}
const GRUPO_PONTUAL = "group_mkta43yr"

export async function rotasConvocar(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/intermitente-convocar",
    async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
      const b = req.body ?? {}
      const nome = String(b.empregado_nome ?? b.name ?? "").trim()
      const chapa = String(b.empregado_chapa ?? b.chapa ?? "").trim()
      const dataInicio = String(b.data_inicio ?? "").trim()
      const dataFim = String(b.data_fim ?? "").trim()
      if (!nome || !chapa) return reply.code(400).send({ ok: false, erro: "campo_obrigatorio", mensagem: "nome/chapa" })
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim))
        return reply.code(400).send({ ok: false, erro: "data_invalida" })
      if (dataInicio > dataFim) return reply.code(400).send({ ok: false, erro: "data_invalida", mensagem: "início > fim" })

      const board = await boardAtual()
      if (!board) return reply.code(500).send({ ok: false, erro: "board_nao_resolvido" })

      // Antifraude: convocações existentes da chapa no board Entrada.
      let existentes: ConvocacaoExistente[] = []
      try {
        const itens = await lerPorColuna(board, COL.chapa, [chapa])
        existentes = itens.map((it) => ({
          itemId: it.id,
          nome: it.name,
          chapa,
          dataInicio: dataApenas(texto(it.cv, COL.dataInicio)),
          dataFim: dataApenas(texto(it.cv, COL.dataFim)),
          statusConvocacao: texto(it.cv, COL.status),
          cancelamentoInicio: dataApenas(texto(it.cv, COL.cancelInicio)),
        }))
      } catch (e) {
        return reply.code(502).send({ ok: false, erro: "erro_monday_conflitos", mensagem: (e as Error).message })
      }
      const conflito = acharConflito({ dataInicio, dataFim }, existentes)
      if (conflito) {
        return reply.code(409).send({
          ok: false, erro: "convocacao_conflitante",
          mensagem: "Já existe convocação no período.",
          conflito: {
            item_id: conflito.itemId, nome: conflito.nome,
            data_inicio: conflito.data_inicio, data_fim: conflito.data_fim,
            status_convocacao: conflito.status_convocacao,
            data_inicio_cancelamento: conflito.data_inicio_cancelamento,
          },
        })
      }

      // Cria item no grupo PONTUAL.
      const labelOrNull = (v: unknown) => (v ? { label: String(v) } : undefined)
      const cols: Record<string, unknown> = {
        [COL.chapa]: chapa,
        [COL.cpf]: String(b.empregado_cpf ?? b.cpf ?? ""),
        [COL.funcao]: String(b.empregado_funcao ?? b.funcao ?? ""),
        [COL.admissao]: String(b.empregado_admissao ?? b.admissao ?? ""),
        [COL.dataInicio]: { date: dataInicio },
        [COL.dataFim]: { date: dataFim },
        [COL.tipo]: { label: "PONTUAL" },
        [COL.status]: { label: "Válida" },
        [COL.unidadeTexto]: String(b.local_unidade ?? ""),
      }
      const contrato = labelOrNull(b.contrato)
      if (contrato) cols[COL.contrato] = contrato
      const sabado = labelOrNull(b.sabado)
      if (sabado) cols[COL.sabado] = sabado
      const interior = labelOrNull(b.interior)
      if (interior) cols[COL.interior] = interior
      const solicitante = labelOrNull(b.solicitante)
      if (solicitante) cols[COL.solicitante] = solicitante
      const justificativa = labelOrNull(b.justificativa)
      if (justificativa) cols[COL.justificativa] = justificativa

      let itemId: string
      try {
        itemId = await criarItem(board, nome, cols, GRUPO_PONTUAL)
      } catch (e) {
        return reply.code(502).send({ ok: false, erro: "erro_criar_item", mensagem: (e as Error).message })
      }
      return {
        ok: true,
        item_id: itemId,
        item_url: `https://contato-serv.monday.com/boards/${board}/pulses/${itemId}`,
        board_id: board,
      }
    },
  )
}
