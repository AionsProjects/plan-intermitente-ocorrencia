import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { createItem, uploadFileToColumn } from "../monday.js"
import { usuarioDaSessao } from "../session.js"
import { abrirExecucao, comEtapa } from "../services/execucao.js"
import { arquivarDrive } from "../services/driveArquivar.js"

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
  empregado_cpf?: string | null
  chapa?: string | null
  tipo_documentacao_label?: string
  dias_atestado?: number
  data_inicio?: string
  data_fim?: string
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
  const lancarDocumentosHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const usuario = await usuarioDaSessao(req)
    if (!usuario) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
    const operador = { userId: usuario.id, email: usuario.email, nome: usuario.nome ?? null }

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
      // UMA execução POR DOCUMENTO (decisão de 14/08): mantém o formato que o DP já lê no
      // /atividade, e passa a registrar o documento que falha no meio do lote — hoje o
      // `registrarAtividade` do front só grava sucesso, então a falha some.
      //
      // Aberta aqui dentro, e não pelo front: o lote é UMA requisição, então o front não
      // teria como carimbar N ids. Por isso o front deixou de logar `atestado` — senão
      // cada documento renderia duas linhas.
      const ex = await abrirExecucao({
        acao: "atestado",
        motor: "backend",
        operador,
        alvo: d.chapa ?? null,
        pessoa: d.empregado_nome ?? null,
        contrato: d.contrato_colaborador ?? null,
        resumo: {
          tipo_doc: d.tipo_documentacao_label,
          dias: d.dias_atestado,
          data_inicio: d.data_inicio,
          data_fim: d.data_fim,
          uuid_convocacao: d.uuid_convocacao ?? null,
        },
      })
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

        const item = await comEtapa(ex, "criar_item", () =>
          createItem(BOARD, d.empregado_nome || "ATESTADO", cv, GROUP),
        )
        await ex.artefato({
          tipo: "monday_item",
          chave: item.id,
          rotulo: `${d.tipo_documentacao_label ?? "Documento"} — ${d.empregado_nome ?? d.chapa ?? ""}`.trim(),
          url: `https://contato-serv.monday.com/boards/${BOARD}/pulses/${item.id}`,
        })

        // Anexa arquivo (best-effort).
        const arq = arquivos[`doc_${d.id}`]
        if (arq) {
          try {
            await uploadFileToColumn(item.id, C.files, arq.buffer, arq.filename, arq.mime)
            await ex.etapa("anexar_arquivo", "ok", {
              metadados: { nome: arq.filename, bytes: arq.buffer.length },
            })
          } catch (e) {
            req.log.warn(e, `upload atestado ${d.id} falhou`)
            // 'aviso' e não 'erro': o item existe no board e o lançamento vale; o que falta
            // é o anexo, que o DP resolve à mão. Fechar como erro chamaria refazimento do
            // documento inteiro e criaria item duplicado.
            await ex.etapa("anexar_arquivo", "aviso", {
              mensagem: e instanceof Error ? e.message : e,
              metadados: { nome: arq.filename },
            })
          }
        } else {
          await ex.etapa("anexar_arquivo", "pulado", { mensagem: "documento sem arquivo" })
        }
        await arquivarDrive({
          tipo: "atestado",
          nome: d.empregado_nome || "ATESTADO",
          chapa: d.chapa ?? undefined,
          cpf: d.empregado_cpf ?? undefined,
          contrato: d.contrato_colaborador || "ATESTADOS",
          data_inicio: d.data_inicio || d.emissao_atestado || new Date().toISOString().slice(0, 10),
          data_fim: d.data_fim || d.data_inicio || d.emissao_atestado,
          item_controle_id: item.id,
          atualizar_monday: true,
          arquivos: arq ? [arq] : [],
        }).catch((e) => req.log.warn(e, `drive atestado ${d.id} falhou`))
        resultados.push({ id: d.id, monday_item_id_controle: item.id })
        await ex.fechar("ok", { resumo: { monday_item_id: item.id } })
      } catch (e) {
        req.log.error(e, `erro lancar atestado ${d.id}`)
        resultados.push({ id: d.id, erro: "erro_monday" })
        // O lote continua (o `for` não quebra) — este documento é que fica marcado como
        // erro, com o motivo. É a linha que hoje simplesmente não existe.
        await ex.fechar("erro", { etapaErro: "criar_item", erro: e })
      }
    }
    return { ok: true, resultados }
  }

  app.post("/api/atestados/lancar", lancarDocumentosHandler)
  app.post("/api/intermitente-lancar-documentos", lancarDocumentosHandler)
}
