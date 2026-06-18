import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  acharItensPorColuna,
  changeColumnValues,
  createItem,
  lerItens,
  type ItemMonday,
} from "../monday.js"
import { usuarioDaSessao } from "../session.js"
import {
  calcularDesconto,
  isDomingo,
  isFeriadoNacional,
  isSabado,
  resolverValores,
  type LinhaValor,
  type Resposta,
} from "../calculoBeneficios.js"

const BOARD_HISTORICO = "18411141462"
const BOARD_DESCONTO = "18400981023"
const BOARD_VALORES = "18413870370"

// Histórico
const H = {
  uuid: "text_mm2xjend",
  protocolo: "text_mm2xsvg6",
  contrato: "text_mm2x1ktb",
  chapa: "text_mm33v9kp",
  dataInicio: "date_mm2xtp93",
  dataFim: "date_mm2xrr5q",
  expiraEm: "date_mm2xrvt4",
  concluidoEm: "date_mm2xh1vm",
  editadoEm: "date_mm2x62fq",
  status: "color_mm2xkqpc",
  editado: "boolean_mm2x1aa4",
  statusCancel: "color_mm3b9v4n",
  qtdFaltas: "numeric_mm2xe2zk",
  qtdAtrasos: "numeric_mm2x18hh",
  totalMin: "numeric_mm2x4fjj",
  diasPerdeVR: "numeric_mm34a3ph",
  diasPerdeVT: "numeric_mm345xb6",
  diasExtras: "long_text_mm2x73w6",
  diasDesativados: "long_text_mm2xm820",
  respostas: "long_text_mm2xtcpw",
  ledger: "long_text_mm3ct3hg",
  sabadosTxt: "text_mm3bfn6h",
  trabalhaSabado: "color_mm34yyet",
  optanteVT: "color_mm34ry47",
} as const
const COL_CANCEL_INICIO_ENTRADA = "date_mm3b88ta"
const COL_STATUS_CONV_ENTRADA = "color_mm3a8ana"
// Base Desconto
const D = {
  nome: "dropdown_mm0rgfrx",
  matricula: "text_mm0rpqxs",
  dataInicio: "date_mm0r6tyr",
  dataFim: "date_mm0rzpyv",
  diasPerdeVT: "numeric_mm3428yj",
  diasPerdeVR: "numeric_mm34p6p7",
  descontoVR: "numeric_mm0rgsaw",
  descontoVT: "numeric_mm0r5tca",
  status: "color_mm0r8mjr",
  residualVR: "numeric_mm0r1691",
  residualVT: "numeric_mm0rtwwg",
} as const
// Valores
const V = { contrato: "text_mm3gn84d", regra: "text_mm3g467p", vr: "numeric_mm3gyypd", vt: "numeric_mm3gqnde", ativo: "color_mm3gqqdk" }

let cacheValores: { em: number; linhas: LinhaValor[] } | null = null
async function carregarValores(): Promise<LinhaValor[]> {
  if (cacheValores && Date.now() - cacheValores.em < 5 * 60 * 1000) return cacheValores.linhas
  const itens = await lerItens(BOARD_VALORES, Object.values(V))
  const num = (s: string | null | undefined) => Number(String(s ?? "0").replace(",", ".")) || 0
  const linhas = itens.map((it) => {
    const m = new Map(it.column_values.map((c) => [c.id, c.text]))
    return {
      contrato: m.get(V.contrato) ?? "",
      regra: m.get(V.regra) ?? "",
      vr: num(m.get(V.vr)),
      vt: num(m.get(V.vt)),
      ativo: true,
    }
  })
  cacheValores = { em: Date.now(), linhas }
  return linhas
}

function txt(it: ItemMonday, id: string): string {
  return it.column_values.find((c) => c.id === id)?.text ?? ""
}
const ehSim = (v: string) => v.trim().toUpperCase().startsWith("SIM")
function optanteDe(it: ItemMonday): boolean | "SIM*" {
  const v = txt(it, H.optanteVT).trim().toUpperCase()
  if (v === "SIM*" || v.includes("VOLTA")) return "SIM*"
  return ehSim(v)
}
function iso(d: Date) { return d.toISOString().slice(0, 10) }

// Cria/atualiza item na Base Desconto (por matrícula + período). Status PENDENTE.
async function gravarDesconto(args: {
  nome: string; chapa: string; dataInicio: string; dataFim: string
  descontoVR: number; descontoVT: number; diasPerdeVR: number; diasPerdeVT: number
}) {
  if (args.descontoVR <= 0 && args.descontoVT <= 0) return { acao: "skip" as const }
  const cv: Record<string, unknown> = {
    [D.nome]: { labels: [args.nome] },
    [D.matricula]: args.chapa,
    [D.dataInicio]: { date: args.dataInicio },
    [D.dataFim]: { date: args.dataFim },
    [D.descontoVR]: args.descontoVR,
    [D.descontoVT]: args.descontoVT,
    [D.diasPerdeVR]: args.diasPerdeVR,
    [D.diasPerdeVT]: args.diasPerdeVT,
    [D.residualVR]: args.descontoVR,
    [D.residualVT]: args.descontoVT,
    [D.status]: { label: "PENDENTE" },
  }
  // busca existente por matrícula + mesmo período
  const existentes = await acharItensPorColuna(BOARD_DESCONTO, D.matricula, args.chapa, [D.dataInicio, D.dataFim], 20)
  const achado = existentes.find(
    (it) => txt(it, D.dataInicio) === args.dataInicio && txt(it, D.dataFim) === args.dataFim,
  )
  if (achado) {
    await changeColumnValues(BOARD_DESCONTO, achado.id, cv)
    return { acao: "update" as const, id: achado.id }
  }
  const novo = await createItem(BOARD_DESCONTO, args.nome, cv)
  return { acao: "create" as const, id: novo.id }
}

// Gera dias do período (UTC), pula domingo + feriado; sábado só se trabalhaSabado.
function gerarDias(ini: string, fim: string, trabalhaSabado: boolean): string[] {
  if (!ini || !fim) return []
  const out: string[] = []
  const cur = new Date(ini + "T00:00:00Z")
  const end = new Date(fim + "T00:00:00Z")
  let guard = 0
  while (cur <= end && guard++ < 400) {
    const d = iso(cur)
    if (!isDomingo(d) && !isFeriadoNacional(d) && (!isSabado(d) || trabalhaSabado)) out.push(d)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

export async function rotasFinalizar(app: FastifyInstance): Promise<void> {
  // FINALIZAR — calcula desconto (board Valores), grava Histórico + Base Desconto.
  app.post(
    "/api/intermitente/finalizar",
    async (
      req: FastifyRequest<{
        Body: {
          uuid?: string
          respostas?: Resposta[]
          protocolo?: string
          dias_extras?: string[]
          dias_desativados?: string[]
          sabados_extras?: string[]
          eh_correcao?: boolean
        }
      }>,
      reply: FastifyReply,
    ) => {
      if (!(await usuarioDaSessao(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
      const uuid = String(req.body?.uuid ?? "").trim()
      const respostas = Array.isArray(req.body?.respostas) ? req.body!.respostas! : []
      const protocolo = String(req.body?.protocolo ?? "").trim()
      const ehCorrecao = req.body?.eh_correcao === true
      if (!uuid || !protocolo) return reply.code(400).send({ ok: false, erro: "payload_invalido" })
      try {
        const itens = await acharItensPorColuna(BOARD_HISTORICO, H.uuid, uuid, Object.values(H), 1)
        const it = itens[0]
        if (!it) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })
        const statusAtual = txt(it, H.status)
        if (statusAtual === "Concluído" && !ehCorrecao) return reply.code(409).send({ ok: false, erro: "ja_concluido" })

        const contrato = txt(it, H.contrato)
        const trabalhaSabado = ehSim(txt(it, H.trabalhaSabado))
        const optante = optanteDe(it)
        const valores = await carregarValores()
        const rv = resolverValores(valores, contrato, "")
        if ("erro" in rv) return reply.code(422).send({ ok: false, erro: rv.erro, contrato })

        const calc = calcularDesconto({
          respostas,
          diasDesativados: req.body?.dias_desativados ?? [],
          sabadosExtras: req.body?.sabados_extras ?? [],
          trabalhaSabado,
          optanteVT: optante,
          vrDia: rv.vrDia,
          vtDia: rv.vtDia,
        })

        const agora = iso(new Date())
        const cvHist: Record<string, unknown> = {
          [H.status]: { label: "Concluído" },
          [H.protocolo]: protocolo,
          [H.concluidoEm]: { date: agora },
          [H.qtdFaltas]: calc.qtdFaltas,
          [H.qtdAtrasos]: calc.qtdAtrasos,
          [H.totalMin]: calc.totalMinAtraso,
          [H.diasPerdeVR]: calc.diasPerdeVR,
          [H.diasPerdeVT]: calc.diasPerdeVT,
          [H.respostas]: JSON.stringify(respostas),
          [H.diasExtras]: JSON.stringify(req.body?.dias_extras ?? []),
          [H.diasDesativados]: JSON.stringify(req.body?.dias_desativados ?? []),
          [H.ledger]: JSON.stringify(calc.ledger),
          [H.sabadosTxt]: (req.body?.sabados_extras ?? []).join(", "),
        }
        if (ehCorrecao) {
          cvHist[H.editado] = true
          cvHist[H.editadoEm] = { date: agora }
        }
        await changeColumnValues(BOARD_HISTORICO, it.id, cvHist)

        const desconto = await gravarDesconto({
          nome: it.name,
          chapa: txt(it, H.chapa),
          dataInicio: txt(it, H.dataInicio),
          dataFim: txt(it, H.dataFim),
          descontoVR: calc.descontoVR,
          descontoVT: calc.descontoVT,
          diasPerdeVR: calc.diasPerdeVR,
          diasPerdeVT: calc.diasPerdeVT,
        })

        return {
          ok: true, protocolo, editado: ehCorrecao,
          desconto_vr: calc.descontoVR, desconto_vt: calc.descontoVT, desconto,
        }
      } catch (e) {
        req.log.error(e, "erro finalizar")
        return reply.code(502).send({ ok: false, erro: "erro_monday" })
      }
    },
  )

  // CANCELAR — total/parcial/reverter. Dias cancelados viram falta → desconto.
  app.post(
    "/api/intermitente/cancelar",
    async (
      req: FastifyRequest<{
        Body: { uuid?: string; tipo?: "total" | "parcial" | "reverter"; data_inicio_cancelamento?: string | null }
      }>,
      reply: FastifyReply,
    ) => {
      if (!(await usuarioDaSessao(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
      const uuid = String(req.body?.uuid ?? "").trim()
      const tipo = req.body?.tipo
      if (!uuid || !tipo) return reply.code(400).send({ ok: false, erro: "payload_invalido" })
      try {
        const itens = await acharItensPorColuna(BOARD_HISTORICO, H.uuid, uuid, Object.values(H), 1)
        const it = itens[0]
        if (!it) return reply.code(404).send({ ok: false, erro: "nao_encontrado" })

        // acha item de origem (Entrada) pra atualizar Status/Cancelamento Início
        const origemUrl = it.column_values.find((c) => c.id === "link_mm2x1rk0")?.text ?? ""
        const mBoard = origemUrl.match(/boards\/(\d+)\/pulses\/(\d+)/)
        const entradaBoard = mBoard?.[1]
        const entradaItem = mBoard?.[2]

        if (tipo === "reverter") {
          await changeColumnValues(BOARD_HISTORICO, it.id, { [H.statusCancel]: { label: " " } })
          if (entradaBoard && entradaItem) {
            await changeColumnValues(entradaBoard, entradaItem, {
              [COL_STATUS_CONV_ENTRADA]: { label: "Válida" },
              [COL_CANCEL_INICIO_ENTRADA]: { date: null },
            })
          }
          return { ok: true, tipo, desconto: { acao: "skip" } }
        }

        const dataInicio = txt(it, H.dataInicio)
        const dataFim = txt(it, H.dataFim)
        const trabalhaSabado = ehSim(txt(it, H.trabalhaSabado))
        const optante = optanteDe(it)
        const cancelIni = tipo === "parcial" ? String(req.body?.data_inicio_cancelamento ?? "") : dataInicio
        if (tipo === "parcial" && !/^\d{4}-\d{2}-\d{2}$/.test(cancelIni)) {
          return reply.code(400).send({ ok: false, erro: "data_cancelamento_invalida" })
        }
        // dias cancelados = dias do período >= cancelIni, como falta
        const dias = gerarDias(dataInicio, dataFim, trabalhaSabado).filter((d) => d >= cancelIni)
        const respostas: Resposta[] = dias.map((d) => ({ data: d, tipo: "falta" }))
        const valores = await carregarValores()
        const rv = resolverValores(valores, txt(it, H.contrato), "")
        if ("erro" in rv) return reply.code(422).send({ ok: false, erro: rv.erro })
        const calc = calcularDesconto({
          respostas, trabalhaSabado, optanteVT: optante, vrDia: rv.vrDia, vtDia: rv.vtDia,
        })

        const labelStatus = tipo === "parcial" ? "Cancelada parcialmente" : "Cancelada"
        await changeColumnValues(BOARD_HISTORICO, it.id, { [H.statusCancel]: { label: labelStatus } })
        if (entradaBoard && entradaItem) {
          const cvEnt: Record<string, unknown> = { [COL_STATUS_CONV_ENTRADA]: { label: labelStatus } }
          if (tipo === "parcial") cvEnt[COL_CANCEL_INICIO_ENTRADA] = { date: cancelIni }
          await changeColumnValues(entradaBoard, entradaItem, cvEnt)
        }
        const desconto = await gravarDesconto({
          nome: it.name, chapa: txt(it, H.chapa), dataInicio: cancelIni, dataFim,
          descontoVR: calc.descontoVR, descontoVT: calc.descontoVT,
          diasPerdeVR: calc.diasPerdeVR, diasPerdeVT: calc.diasPerdeVT,
        })
        return { ok: true, tipo, data_inicio_cancelamento: tipo === "parcial" ? cancelIni : null, desconto }
      } catch (e) {
        req.log.error(e, "erro cancelar")
        return reply.code(502).send({ ok: false, erro: "erro_monday" })
      }
    },
  )
}
