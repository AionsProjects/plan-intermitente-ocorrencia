import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { randomUUID } from "node:crypto"
import { config } from "../config.js"
import { query } from "../db.js"
import { changeColumnValues, createItem, lerItem } from "../monday.js"
import { usuarioDaSessao } from "../session.js"

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

function textoCol(
  item: { column_values: { id: string; text: string | null; value: string | null }[] },
  columnId: string | undefined,
): string {
  if (!columnId) return ""
  return item.column_values.find((c) => c.id === columnId)?.text ?? ""
}

function sim(v: string): boolean {
  return v.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().startsWith("SIM")
}

export async function ativarConvocacaoEntrada(boardId: string, itemId: string) {
  const colsE = await colunasDoBoard(boardId)
  const idE = (nome: string) => colsE.get(nome)
  const idsLer = Object.values(E)
    .map((n) => idE(n))
    .filter((x): x is string => !!x)
  const origem = await lerItem(itemId, idsLer)
  if (!origem) {
    return { status: 404 as const, body: { erro: "item_origem_nao_encontrado" } }
  }
  const existente = await query<{ uuid: string; protocolo: string | null; monday_item_id: string | null }>(
    `SELECT uuid, protocolo, monday_item_id FROM convocacoes WHERE item_origem_id=$1 LIMIT 1`,
    [itemId],
  )
  if (existente.rows[0]) {
    const row = existente.rows[0]
    const link = `${config.publicBaseUrl.replace(/\/$/, "")}/preencher/${row.uuid}`
    return {
      status: 200 as const,
      body: {
        ok: true,
        existente: true,
        uuid: row.uuid,
        protocolo: row.protocolo,
        link,
        historico_id: row.monday_item_id,
      },
    }
  }

  const uuid = randomUUID()
  const protocolo = gerarProtocolo()
  const agora = new Date()
  const expira = new Date(agora.getTime() + 10 * 24 * 60 * 60 * 1000)
  const nome = textoCol(origem, idE(E.nomeEmpregado)) || origem.name
  const contrato = textoCol(origem, idE(E.contrato))
  const chapa = textoCol(origem, idE(E.chapa))
  const dataInicio = textoCol(origem, idE(E.dataInicio))
  const dataFim = textoCol(origem, idE(E.dataFim))
  const optanteVT = textoCol(origem, idE(E.optanteVT))
  const trabalhaSabado = textoCol(origem, idE(E.sabado))
  const link = `${config.publicBaseUrl.replace(/\/$/, "")}/preencher/${uuid}`

  const cv: Record<string, unknown> = {
    [H.uuid]: uuid,
    [H.protocolo]: protocolo,
    [H.contrato]: contrato,
    [H.chapa]: chapa,
    [H.status]: { label: "Aguardando" },
    [H.expiraEm]: { date: iso(expira) },
    [H.criadoEm]: { date: iso(agora) },
    [H.linkPreencher]: { url: link, text: "Preencher" },
    [H.itemOrigem]: {
      url: `https://contato-serv.monday.com/boards/${boardId}/pulses/${itemId}`,
      text: "Origem",
    },
  }
  if (dataInicio) cv[H.dataInicio] = { date: dataInicio }
  if (dataFim) cv[H.dataFim] = { date: dataFim }
  if (optanteVT) cv[H.optanteVT] = { label: sim(optanteVT) ? "SIM" : "NÃO" }
  if (trabalhaSabado) cv[H.trabalhaSabado] = { label: sim(trabalhaSabado) ? "SIM" : "NÃO" }

  const novo = await createItem(BOARD_HISTORICO, nome, cv)
  const idLink = idE(E.link)
  if (idLink) {
    await changeColumnValues(boardId, itemId, {
      [idLink]: { url: link, text: "Preencher" },
    })
  }

  await query(
    `INSERT INTO convocacoes (
       uuid, monday_item_id, item_origem_id, chapa, contrato, data_inicio, data_fim,
       protocolo, status, optante_vt, trabalha_sabado, nome, atualizado_em
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Aguardando',$9,$10,$11,now())
     ON CONFLICT (uuid) DO UPDATE SET
       monday_item_id = EXCLUDED.monday_item_id,
       item_origem_id = EXCLUDED.item_origem_id,
       chapa = EXCLUDED.chapa,
       contrato = EXCLUDED.contrato,
       data_inicio = EXCLUDED.data_inicio,
       data_fim = EXCLUDED.data_fim,
       protocolo = EXCLUDED.protocolo,
       status = EXCLUDED.status,
       optante_vt = EXCLUDED.optante_vt,
       trabalha_sabado = EXCLUDED.trabalha_sabado,
       nome = EXCLUDED.nome,
       atualizado_em = now()`,
    [
      uuid,
      novo.id,
      itemId,
      chapa,
      contrato || null,
      dataInicio || null,
      dataFim || null,
      protocolo,
      sim(optanteVT),
      sim(trabalhaSabado),
      nome,
    ],
  )

  return { status: 200 as const, body: { ok: true, uuid, protocolo, link, historico_id: novo.id } }
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
        const existente = await query<{ uuid: string; protocolo: string | null; monday_item_id: string | null }>(
          `SELECT uuid, protocolo, monday_item_id FROM convocacoes WHERE item_origem_id=$1 LIMIT 1`,
          [itemId],
        )
        if (existente.rows[0]) {
          const row = existente.rows[0]
          const link = `${config.publicBaseUrl.replace(/\/$/, "")}/preencher/${row.uuid}`
          return {
            ok: true,
            existente: true,
            uuid: row.uuid,
            protocolo: row.protocolo,
            link,
            historico_id: row.monday_item_id,
          }
        }
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

        await query(
          `INSERT INTO convocacoes (
             uuid, monday_item_id, item_origem_id, chapa, contrato, data_inicio, data_fim,
             protocolo, status, optante_vt, trabalha_sabado, nome, atualizado_em
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Aguardando',$9,$10,$11,now())
           ON CONFLICT (uuid) DO UPDATE SET
             monday_item_id = EXCLUDED.monday_item_id,
             item_origem_id = EXCLUDED.item_origem_id,
             chapa = EXCLUDED.chapa,
             contrato = EXCLUDED.contrato,
             data_inicio = EXCLUDED.data_inicio,
             data_fim = EXCLUDED.data_fim,
             protocolo = EXCLUDED.protocolo,
             status = EXCLUDED.status,
             optante_vt = EXCLUDED.optante_vt,
             trabalha_sabado = EXCLUDED.trabalha_sabado,
             nome = EXCLUDED.nome,
             atualizado_em = now()`,
          [
            uuid,
            novo.id,
            itemId,
            txt(E.chapa),
            txt(E.contrato) || null,
            di || null,
            df || null,
            protocolo,
            ehSim(txt(E.optanteVT)),
            ehSim(txt(E.sabado)),
            nome,
          ],
        )

        return { ok: true, uuid, protocolo, link, historico_id: novo.id }
      } catch (e) {
        req.log.error(e, "erro /api/monday/ativar")
        return reply.code(502).send({ erro: "erro_monday" })
      }
    },
  )

  app.post(
    "/api/convocar/ativar",
    async (
      req: FastifyRequest<{ Body: { board_id?: string; item_id?: string } }>,
      reply: FastifyReply,
    ) => {
      const usuario = await usuarioDaSessao(req)
      if (!usuario) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
      const boardId = String(req.body?.board_id ?? "").trim()
      const itemId = String(req.body?.item_id ?? "").trim()
      if (!boardId || !itemId) {
        return reply.code(400).send({ ok: false, erro: "parametros_obrigatorios" })
      }
      try {
        const r = await ativarConvocacaoEntrada(boardId, itemId)
        return reply.code(r.status).send(r.body)
      } catch (e) {
        req.log.error(e, "erro /api/convocar/ativar")
        return reply.code(502).send({ ok: false, erro: "erro_monday" })
      }
    },
  )
}
