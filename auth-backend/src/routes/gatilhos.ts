import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { randomUUID } from "node:crypto"
import { config } from "../config.js"
import { query } from "../db.js"
import { changeColumnValues, createItem, lerItem } from "../monday.js"

// WF1 (ativar→link) replicado no código. Webhook do Monday na coluna "ativar" do board
// Entrada (qualquer mês) chama aqui. Cria item no Histórico (FIXO) + patcha Link na Entrada.

const BOARD_HISTORICO = "18411141462"
const COL_ATIVAR = "color_mm2pxmak"

// Colunas FIXAS do Histórico (board não duplica).
const H = {
  uuid: "text_mm2xjend",
  protocolo: "text_mm2xsvg6",
  contrato: "text_mm2x1ktb",
  chapa: "text_mm33v9kp",
  dataInicio: "date_mm2xtp93",
  dataFim: "date_mm2xrr5q",
  expiraEm: "date_mm2xrvt4",
  criadoEm: "date_mm2x115h",
  status: "color_mm2xkqpc",
  optanteVT: "color_mm34ry47",
  trabalhaSabado: "color_mm34yyet",
  linkPreencher: "link_mm2xfay7",
  itemOrigem: "link_mm2x1rk0",
} as const

// Títulos canônicos na Entrada (resolvidos por board_id via registry — robusto à virada).
const E = {
  nomeEmpregado: "Nome do Empregado",
  contrato: "Op - Contrato",
  chapa: "Funcionário",
  dataInicio: "OP - Data/Inicio",
  dataFim: "OP - Data/Fim",
  optanteVT: "Vale Transporte",
  sabado: "OP - Sábado?",
  link: "Link",
} as const

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // sem 0/O/1/I
function gerarProtocolo(): string {
  const bloco = () =>
    Array.from({ length: 4 }, () =>
      ALFABETO[Math.floor(Math.random() * ALFABETO.length)],
    ).join("")
  return `PROT-${bloco()}-${bloco()}`
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function colunasDoBoard(boardId: string): Promise<Map<string, string>> {
  const { rows } = await query<{ nome: string; column_id: string }>(
    `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`,
    [boardId],
  )
  return new Map(rows.map((r) => [r.nome, r.column_id]))
}

export async function rotasGatilhos(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/monday/ativar",
    async (
      req: FastifyRequest<{
        Body: {
          challenge?: string
          event?: {
            boardId?: number | string
            pulseId?: number | string
            columnId?: string
            value?: { label?: { index?: number; text?: string } }
          }
        }
      }>,
      reply: FastifyReply,
    ) => {
      // 1) Handshake de criação do webhook.
      if (req.body?.challenge) return { challenge: req.body.challenge }

      const ev = req.body?.event
      if (!ev?.boardId || !ev?.pulseId) {
        return reply.code(400).send({ erro: "evento_invalido" })
      }
      // 2) Só reage à coluna ativar virando "ativar" (ignora outras mudanças).
      if (ev.columnId && ev.columnId !== COL_ATIVAR) {
        return { ok: true, ignorado: "outra_coluna" }
      }
      const labelTxt = String(ev.value?.label?.text ?? "").toLowerCase()
      const ehAtivar = ev.value?.label?.index === 1 || labelTxt.includes("ativ")
      if (!ehAtivar) return { ok: true, ignorado: "label_nao_ativar" }

      const boardId = String(ev.boardId)
      const itemId = String(ev.pulseId)
      try {
        const colsE = await colunasDoBoard(boardId)
        const idE = (nome: string) => colsE.get(nome)
        // Lê o item de origem (Entrada).
        const idsLer = Object.values(E)
          .map((n) => idE(n))
          .filter((x): x is string => !!x)
        const origem = await lerItem(itemId, idsLer)
        if (!origem) return reply.code(404).send({ erro: "item_origem_nao_encontrado" })
        const m = new Map(origem.column_values.map((c) => [c.id, c.text]))
        const txt = (nome: string) => {
          const cid = idE(nome)
          return cid ? (m.get(cid) ?? "") : ""
        }
        const ehSim = (v: string) => v.trim().toUpperCase().startsWith("SIM")

        const uuid = randomUUID()
        const protocolo = gerarProtocolo()
        const agora = new Date()
        const expira = new Date(agora.getTime() + 10 * 24 * 60 * 60 * 1000)
        const nome = txt(E.nomeEmpregado) || origem.name
        const link = `${config.publicBaseUrl.replace(/\/$/, "")}/preencher/${uuid}`

        // 3) Cria item no Histórico.
        const cv: Record<string, unknown> = {
          [H.uuid]: uuid,
          [H.protocolo]: protocolo,
          [H.contrato]: txt(E.contrato),
          [H.chapa]: txt(E.chapa),
          [H.status]: { label: "Aguardando" },
          [H.expiraEm]: { date: iso(expira) },
          [H.criadoEm]: { date: iso(agora) },
          [H.linkPreencher]: { url: link, text: "Preencher" },
          [H.itemOrigem]: {
            url: `https://contato-serv.monday.com/boards/${boardId}/pulses/${itemId}`,
            text: "Origem",
          },
        }
        const di = txt(E.dataInicio), df = txt(E.dataFim)
        if (di) cv[H.dataInicio] = { date: di }
        if (df) cv[H.dataFim] = { date: df }
        if (txt(E.optanteVT)) cv[H.optanteVT] = { label: ehSim(txt(E.optanteVT)) ? "SIM" : "NÃO" }
        if (txt(E.sabado)) cv[H.trabalhaSabado] = { label: ehSim(txt(E.sabado)) ? "SIM" : "NÃO" }

        const novo = await createItem(BOARD_HISTORICO, nome, cv)

        // 4) Patcha a Link Column no item de origem (Entrada) com a URL do /preencher.
        const idLink = idE(E.link)
        if (idLink) {
          await changeColumnValues(boardId, itemId, {
            [idLink]: { url: link, text: "Preencher" },
          })
        }

        return { ok: true, uuid, protocolo, link, historico_id: novo.id }
      } catch (e) {
        req.log.error(e, "erro /api/monday/ativar")
        return reply.code(502).send({ erro: "erro_monday" })
      }
    },
  )
}
