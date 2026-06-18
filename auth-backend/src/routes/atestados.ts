import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { createItem, uploadFileToColumn } from "../monday.js"
import { usuarioDaSessao } from "../session.js"

// Lançar documentos (atestados/declarações) — substitui WF n8n. Documental puro:
// cria item no Controle de Atestados + anexa arquivo. Sem impacto financeiro (Nexti é
// fluxo separado, Monday-triggered). Multipart: campo "payload" (JSON) + binarios doc_<id>.
const BOARD = "18298015951"
const GROUP = "topics" // ATESTADOS RECEBIDOS
const C = {
  modalidade: "single_select5yq25pm",
  tipoDoc: "sele__o_individual__1",
  dias: "numberjox5johv",
  saidaRetorno: "short_textcpcyzaec",
  emissao: "date",
  almoco: "single_selectkiwkh2d",
  seisHoras: "single_selectcovdz0i",
  acompanhante: "sele__o_individual8__1",
  contrato: "department",
  files: "files",
  observacao: "short_textl33u569o",
  competencia: "dropdown_mkzsebbf",
} as const

interface DocEntrada {
  id: string
  modalidade_contrato?: string
  empregado_nome?: string
  tipo_documentacao_label?: string
  dias_atestado?: number
  data_inicio?: string
  emissao_atestado?: string
  saida_retorno_texto?: string
  horario_almoco_label?: string
  acompanhante_label?: string
  contrato_colaborador?: string
  unidade_label?: string | null
  observacao?: string
  uuid_convocacao?: string | null
}

export async function rotasAtestados(app: FastifyInstance): Promise<void> {
  app.post("/api/atestados/lancar", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await usuarioDaSessao(req))) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })

    // Lê multipart: campo "payload" (JSON) + arquivos doc_<id>.
    let payloadStr = ""
    const arquivos: Record<string, { buffer: Buffer; filename: string; mime: string }> = {}
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          arquivos[part.fieldname] = {
            buffer: await part.toBuffer(),
            filename: part.filename || part.fieldname,
            mime: part.mimetype || "application/octet-stream",
          }
        } else if (part.fieldname === "payload") {
          payloadStr = String(part.value ?? "")
        }
      }
    } catch (e) {
      req.log.error(e, "erro parse multipart atestados")
      return reply.code(400).send({ ok: false, erro: "multipart_invalido" })
    }

    let docs: DocEntrada[]
    try {
      const p = JSON.parse(payloadStr) as { documentos?: DocEntrada[] }
      docs = Array.isArray(p.documentos) ? p.documentos : []
    } catch {
      return reply.code(400).send({ ok: false, erro: "payload_invalido" })
    }
    if (docs.length === 0) return reply.code(400).send({ ok: false, erro: "sem_documentos" })

    const resultados: { id: string; monday_item_id_controle?: string; erro?: string }[] = []
    for (const d of docs) {
      try {
        const competencia = (d.data_inicio || d.emissao_atestado || "").slice(0, 7)
        const obsBase = d.observacao ?? ""
        const obs = d.uuid_convocacao ? `${obsBase} conv:${d.uuid_convocacao}`.trim() : obsBase
        const cv: Record<string, unknown> = {}
        const setStatus = (id: string, label?: string) => { if (label) cv[id] = { label } }
        const setTxt = (id: string, v?: string) => { if (v) cv[id] = v }
        setStatus(C.modalidade, d.modalidade_contrato)
        setStatus(C.tipoDoc, d.tipo_documentacao_label)
        if (typeof d.dias_atestado === "number") cv[C.dias] = d.dias_atestado
        setTxt(C.saidaRetorno, d.saida_retorno_texto)
        if (d.emissao_atestado) cv[C.emissao] = { date: d.emissao_atestado }
        setStatus(C.almoco, d.horario_almoco_label)
        setStatus(C.acompanhante, d.acompanhante_label)
        setStatus(C.contrato, d.contrato_colaborador)
        setTxt(C.observacao, obs)
        if (competencia) cv[C.competencia] = { labels: [competencia] }

        const item = await createItem(BOARD, d.empregado_nome || "ATESTADO", cv, GROUP)

        // Anexa arquivo (best-effort).
        const arq = arquivos[`doc_${d.id}`]
        if (arq) {
          try {
            await uploadFileToColumn(item.id, C.files, arq.buffer, arq.filename, arq.mime)
          } catch (e) {
            req.log.warn(e, `upload atestado ${d.id} falhou`)
          }
        }
        resultados.push({ id: d.id, monday_item_id_controle: item.id })
      } catch (e) {
        req.log.error(e, `erro lancar atestado ${d.id}`)
        resultados.push({ id: d.id, erro: "erro_monday" })
      }
    }
    return { ok: true, resultados }
  })
}
