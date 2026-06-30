import type { FastifyInstance, FastifyRequest } from "fastify"
import { criarItem } from "../clients/monday.js"

// Lançar Documentos (WF) — POST /api/intermitente-lancar-documentos.
// Cria 1 item por documento no board Controle de Atestados (18298015951).
// Anexo de arquivo (coluna files) = gated/opcional aqui (multipart binário tratado
// quando o front enviar via FormData; esta versão JSON cria o item documental).
// NÃO toca Histórico/ledger (impacto financeiro de atestado passa pelo Nexti, à parte).

const BOARD_CONTROLE = 18298015951
const COL = {
  modalidade: "single_select5yq25pm",
  tipoDoc: "sele__o_individual__1",
  dias: "numberjox5johv",
  saidaRetorno: "short_textcpcyzaec",
  emissao: "date",
  almoco: "single_selectkiwkh2d",
  seisHoras: "single_selectcovdz0i",
  acompanhante: "sele__o_individual8__1",
  contrato: "department",
  observacao: "short_textl33u569o",
  competencia: "dropdown_mkzsebbf",
}

interface DocLanc {
  id?: string
  modalidade_contrato?: string
  empregado_nome?: string
  tipo_documentacao_label?: string
  dias_atestado?: number
  data_inicio?: string
  emissao_atestado?: string
  saida_retorno_texto?: string
  contrato_colaborador?: string
  observacao?: string
}

export async function rotasAtestados(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/intermitente-lancar-documentos",
    async (req: FastifyRequest<{ Body: { documentos?: DocLanc[] } }>, reply) => {
      const docs = Array.isArray(req.body?.documentos) ? req.body!.documentos! : []
      if (!docs.length) return reply.code(400).send({ ok: false, erro: "sem_documentos" })
      const resultados: Array<{ id: string; monday_item_id_controle?: string; monday_item_url_controle?: string; erro?: string }> = []
      for (const d of docs) {
        const nome = String(d.empregado_nome ?? "").trim()
        if (!nome) {
          resultados.push({ id: d.id ?? "", erro: "nome_obrigatorio" })
          continue
        }
        const cols: Record<string, unknown> = {
          [COL.modalidade]: { label: d.modalidade_contrato || "INTERMITENTE" },
          [COL.tipoDoc]: { label: d.tipo_documentacao_label || "Atestado Médico" },
          [COL.almoco]: { label: "NDA" },
          [COL.acompanhante]: { label: "Sem acompanhamento" },
        }
        if (d.dias_atestado != null) cols[COL.dias] = String(d.dias_atestado)
        if (d.saida_retorno_texto) cols[COL.saidaRetorno] = d.saida_retorno_texto
        if (d.emissao_atestado || d.data_inicio) cols[COL.emissao] = { date: (d.emissao_atestado || d.data_inicio)!.slice(0, 10) }
        if (d.contrato_colaborador) cols[COL.contrato] = { label: d.contrato_colaborador }
        if (d.observacao) cols[COL.observacao] = d.observacao
        try {
          const itemId = await criarItem(BOARD_CONTROLE, nome, cols)
          resultados.push({
            id: d.id ?? itemId,
            monday_item_id_controle: itemId,
            monday_item_url_controle: `https://contato-serv.monday.com/boards/${BOARD_CONTROLE}/pulses/${itemId}`,
          })
        } catch (e) {
          resultados.push({ id: d.id ?? "", erro: (e as Error).message })
        }
      }
      return { ok: resultados.every((r) => !r.erro), resultados }
    },
  )
}
