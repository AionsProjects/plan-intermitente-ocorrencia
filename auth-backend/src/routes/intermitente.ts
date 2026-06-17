import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { acharItensPorColuna, type ItemMonday } from "../monday.js"

// Leituras do board Histórico (Monday ao vivo) — substituem WFs n8n. Público
// (correção/preencher/atestados usam). Histórico é FIXO (não duplica na virada).
const BOARD_HISTORICO = "18411141462"
const C = {
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
  diasExtras: "long_text_mm2x73w6",
  diasDesativados: "long_text_mm2xm820",
  respostas: "long_text_mm2xtcpw",
  atestados: "long_text_mm3cp43g",
  split: "long_text_mm3m8k0m",
  trabalhaSabado: "color_mm34yyet",
  optanteVT: "color_mm34ry47",
  sabadosTxt: "text_mm3bfn6h",
  statusCancel: "color_mm3b9v4n",
  itemOrigem: "link_mm2x1rk0",
} as const

type Mapa = Map<string, string | null>
function mapaCols(it: ItemMonday): Mapa {
  return new Map(it.column_values.map((c) => [c.id, c.text]))
}
function tryJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb
  try { return JSON.parse(s) as T } catch { return fb }
}
const ehSim = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase() === "SIM"

// Gera dias úteis [data_inicio..data_fim] (UTC), pula domingo; sábado só se trabalhaSabado.
function gerarDias(ini: string, fim: string, sabado: boolean): string[] {
  if (!ini || !fim) return []
  const out: string[] = []
  const cur = new Date(ini + "T00:00:00Z")
  const end = new Date(fim + "T00:00:00Z")
  let guard = 0
  while (cur <= end && guard++ < 400) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && (dow !== 6 || sabado)) out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function statusDerivado(statusLabel: string, expiraEm: string): string {
  const s = statusLabel.trim().toLowerCase()
  if (s.startsWith("conclu")) return "concluido"
  if (s.startsWith("expir")) return "expirado"
  if (expiraEm && new Date() > new Date(expiraEm + "T23:59:59Z")) return "expirado"
  return "aguardando"
}

// Monta o payload de leitura (forma do n8n /intermitente-ler, snake_case).
function montarLeitura(it: ItemMonday) {
  const m = mapaCols(it)
  const g = (k: string) => m.get(k) ?? ""
  const dataInicio = g(C.dataInicio)
  const dataFim = g(C.dataFim)
  const trabalhaSabado = ehSim(g(C.trabalhaSabado))
  const sabadosExtras = (g(C.sabadosTxt) || "")
    .split(/[,;\n]/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
  return {
    uuid: g(C.uuid),
    nome: it.name,
    contrato: g(C.contrato) || null,
    data_inicio: dataInicio,
    data_fim: dataFim,
    dias: gerarDias(dataInicio, dataFim, trabalhaSabado),
    status: statusDerivado(g(C.status), g(C.expiraEm)),
    concluido_em: g(C.concluidoEm) || null,
    protocolo: g(C.protocolo) || null,
    editado: String(g(C.editado)).toLowerCase() === "true" || g(C.editado) === "v",
    editado_em: g(C.editadoEm) || null,
    respostas: tryJson(g(C.respostas), [] as unknown[]),
    dias_extras: tryJson(g(C.diasExtras), [] as string[]),
    dias_desativados: tryJson(g(C.diasDesativados), [] as string[]),
    trabalha_sabado: trabalhaSabado ? "SIM" : "NAO",
    optante_vt: ehSim(g(C.optanteVT)) ? "SIM" : "NAO",
    sabados_extras: sabadosExtras,
    atestados: tryJson(g(C.atestados), [] as unknown[]),
    pontos_facultativos: [] as unknown[], // TODO: cruzar board ponto facultativo (F6)
    data_inicio_cancelamento: g("date_mm3b88ta") || null,
    status_cancelamento: g(C.statusCancel) || null,
    split: tryJson(g(C.split), null),
  }
}

export async function rotasIntermitente(app: FastifyInstance): Promise<void> {
  // protocolo -> {uuid, nome}
  app.get(
    "/api/intermitente/buscar-protocolo",
    async (req: FastifyRequest<{ Querystring: { protocolo?: string } }>, reply: FastifyReply) => {
      const protocolo = String(req.query.protocolo ?? "").trim().toUpperCase()
      if (!protocolo) return reply.code(400).send({ erro: "protocolo_obrigatorio" })
      try {
        const itens = await acharItensPorColuna(BOARD_HISTORICO, C.protocolo, protocolo, [C.uuid], 1)
        const it = itens[0]
        if (!it) return reply.code(404).send({ erro: "protocolo_nao_encontrado" })
        const uuid = it.column_values.find((c) => c.id === C.uuid)?.text ?? ""
        return { uuid, nome: it.name }
      } catch (e) {
        req.log.error(e, "erro buscar-protocolo")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )

  // uuid -> ProcessamentoDados (forma snake do n8n). 404 se não acha.
  app.get(
    "/api/intermitente/ler",
    async (req: FastifyRequest<{ Querystring: { uuid?: string } }>, reply: FastifyReply) => {
      const uuid = String(req.query.uuid ?? "").trim()
      if (!uuid) return reply.code(400).send({ erro: "uuid_obrigatorio" })
      try {
        const itens = await acharItensPorColuna(
          BOARD_HISTORICO, C.uuid, uuid,
          Object.values(C), 1,
        )
        const it = itens[0]
        if (!it) return reply.code(404).send({ erro: "nao_encontrado" })
        return montarLeitura(it)
      } catch (e) {
        req.log.error(e, "erro intermitente-ler")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )

  // chapa (+mes opcional) -> {convocacoes:[...]} lidas do Histórico (tem chapa + tudo).
  app.get(
    "/api/intermitente/convocacoes-empregado",
    async (
      req: FastifyRequest<{ Querystring: { chapa?: string; mes?: string } }>,
      reply: FastifyReply,
    ) => {
      const chapa = String(req.query.chapa ?? "").trim()
      const mes = String(req.query.mes ?? "").trim() // YYYY-MM
      if (!chapa) return reply.code(400).send({ erro: "chapa_obrigatoria" })
      try {
        const itens = await acharItensPorColuna(
          BOARD_HISTORICO, C.chapa, chapa, Object.values(C), 50,
        )
        const convocacoes = itens
          .map((it) => {
            const m = mapaCols(it)
            const g = (k: string) => m.get(k) ?? ""
            const di = g(C.dataInicio), df = g(C.dataFim)
            const statusCancel = g(C.statusCancel).toLowerCase()
            return {
              it, di, df,
              data: {
                uuid: g(C.uuid),
                item_entrada_id: "",
                data_inicio: di,
                data_fim: df,
                contrato: g(C.contrato),
                trabalha_sabado: ehSim(g(C.trabalhaSabado)) ? "SIM" : "NAO",
                optante_vt: ehSim(g(C.optanteVT)) ? "SIM" : "NAO",
                status: statusDerivado(g(C.status), g(C.expiraEm)),
                status_convocacao: statusCancel.includes("parcial")
                  ? "Cancelada parcialmente"
                  : statusCancel.includes("cancel") ? "Cancelada" : "Válida",
                data_inicio_cancelamento: g("date_mm3b88ta") || null,
                atestados: tryJson(g(C.atestados), [] as unknown[]),
              },
            }
          })
          // filtra: ignora canceladas/bloqueadas + intersecção com o mês (se passado)
          .filter((x) => {
            const sc = x.data.status_convocacao.toLowerCase()
            if (sc.includes("cancel") || sc.includes("bloque")) return false
            if (!mes) return true
            return (x.di && x.di.startsWith(mes)) || (x.df && x.df.startsWith(mes)) ||
              (x.di <= mes + "-31" && x.df >= mes + "-01")
          })
          .map((x) => x.data)
        return { convocacoes }
      } catch (e) {
        req.log.error(e, "erro convocacoes-empregado")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )
}
