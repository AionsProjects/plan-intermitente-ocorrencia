import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { query } from "../db.js"
import {
  acharItensPorColuna,
  createItem,
  lerColunasSettings,
  uploadFileToColumn,
} from "../monday.js"
import { usuarioDaSessao } from "../session.js"

// Opções do form de convocação: labels das colunas status do board Entrada ATUAL
// (resolvido pelo registry, por nome — robusto à virada). unidadesPorContrato vem do RM
// (n8n-thin, F6) — por ora {} e o front usa OPCOES_CONVOCACAO_FALLBACK.
// Nomes canônicos (título) das colunas status no board Entrada:
const NOMES = {
  solicitantes: "Solicitante",
  contratos: "Op - Contrato",
  sabados: "OP - Sábado?",
  insalubridades: "Op - Insalubridade?",
  interiores: "OP - Interior?",
  justificativas: "OP - Justificativa",
} as const
const NOME_UNIDADE = "OP - Local/Unidade"

function extrairLabels(settingsStr: string): string[] {
  try {
    const s = JSON.parse(settingsStr) as { labels?: unknown }
    const labels = s.labels
    if (Array.isArray(labels)) {
      return labels
        .map((l) => (typeof l === "string" ? l : (l as { name?: string })?.name))
        .filter((x): x is string => !!x)
    }
    if (labels && typeof labels === "object") {
      return Object.entries(labels as Record<string, string>)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v)
        .filter(Boolean)
    }
  } catch { /* ignore */ }
  return []
}

// Títulos canônicos das colunas usadas na criação (resolvidos por nome via registry).
const COL = {
  nomeEmpregado: "Nome do Empregado",
  cpf: "CPF",
  chapa: "Funcionário",
  funcao: "Função",
  admissao: "Admissão",
  escala: "Escala",
  solicitante: "Solicitante",
  contrato: "Op - Contrato",
  localTexto: "Local/Unidade",
  localDropdown: "OP - Local/Unidade",
  sabado: "OP - Sábado?",
  insalubridade: "Op - Insalubridade?",
  interior: "OP - Interior?",
  tipoConvocacao: "OP - Tipo Convocação",
  dataInicio: "OP - Data/Inicio",
  dataFim: "OP - Data/Fim",
  justificativa: "OP - Justificativa",
  substituido: "OP - Empregado Substituído",
  statusConvocacao: "Status", // título no board Entrada (= Status Convocação, color_mm3a8ana)
  termoConvocacao: "Termo de Convocação",
  termoInsalubridade: "Termo de Insalubridade",
} as const
const CANCEL_INICIO_ID = "date_mm3b88ta" // Cancelamento Início (id estável)

// Resolve board do mês (registry) + mapa nome->column_id.
async function resolverBoard(papel: string) {
  const { rows: br } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel=$1 AND ativo=true LIMIT 1`,
    [papel],
  )
  const boardId = br[0]?.monday_board_id
  if (!boardId) return null
  const { rows: cols } = await query<{ nome: string; column_id: string }>(
    `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`,
    [boardId],
  )
  return { boardId, idPorNome: new Map(cols.map((c) => [c.nome, c.column_id])) }
}

function overlap(aIni: string, aFim: string, bIni: string, bFim: string): boolean {
  return aIni <= bFim && bIni <= aFim
}

export async function rotasConvocar(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/convocar/opcoes",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        // board atual + mapa nome->column_id do registry
        const { rows: br } = await query<{ monday_board_id: string }>(
          `SELECT monday_board_id FROM boards WHERE papel='atual' AND ativo=true LIMIT 1`,
        )
        const boardId = br[0]?.monday_board_id
        if (!boardId) return reply.code(404).send({ erro: "board_atual_nao_registrado" })
        const { rows: cols } = await query<{ nome: string; column_id: string }>(
          `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`, [boardId],
        )
        const idPorNome = new Map(cols.map((c) => [c.nome, c.column_id]))
        const idsParaLer = Object.values(NOMES)
          .map((n) => idPorNome.get(n)).filter((x): x is string => !!x)
        const colsSettings = await lerColunasSettings(boardId, idsParaLer)
        const settingsPorId = new Map(colsSettings.map((c) => [c.id, c.settings_str]))
        const labelsDe = (nome: string): string[] => {
          const id = idPorNome.get(nome)
          const ss = id ? settingsPorId.get(id) : undefined
          return ss ? extrairLabels(ss) : []
        }
        return {
          ok: true,
          opcoes: {
            solicitantes: labelsDe(NOMES.solicitantes),
            contratos: labelsDe(NOMES.contratos),
            sabados: labelsDe(NOMES.sabados),
            insalubridades: labelsDe(NOMES.insalubridades),
            interiores: labelsDe(NOMES.interiores),
            justificativas: labelsDe(NOMES.justificativas),
            unidades_por_contrato: {}, // RM (n8n-thin) — F6; front usa fallback
            unidade_column_id: idPorNome.get(NOME_UNIDADE) ?? null,
          },
        }
      } catch (e) {
        req.log.error(e, "erro convocar-opcoes")
        return reply.code(502).send({ erro: "monday_falhou" })
      }
    },
  )

  // Cria convocação no board do mês (atual/proximo) — substitui WF7. Multipart
  // (campos + termos opcionais). Antifraude de período + create_item + upload.
  app.post("/api/convocar/criar", async (req: FastifyRequest, reply: FastifyReply) => {
    // Escrita no Monday -> exige sessão (operador logado).
    const usuario = await usuarioDaSessao(req)
    if (!usuario) return reply.code(401).send({ ok: false, erro: "nao_autenticado" })
    // Lê multipart: campos texto em `campos`, arquivos em `arquivos`.
    const campos: Record<string, string> = {}
    const arquivos: Record<string, { buffer: Buffer; filename: string; mime: string }> = {}
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer()
          arquivos[part.fieldname] = {
            buffer: buf,
            filename: part.filename || part.fieldname,
            mime: part.mimetype || "application/octet-stream",
          }
        } else {
          campos[part.fieldname] = String(part.value ?? "")
        }
      }
    } catch (e) {
      req.log.error(e, "erro parse multipart")
      return reply.code(400).send({ ok: false, erro: "multipart_invalido" })
    }

    const obrig = ["empregado_nome", "empregado_chapa", "contrato", "data_inicio", "data_fim"]
    for (const k of obrig) {
      if (!campos[k]) return reply.code(400).send({ ok: false, erro: "campo_obrigatorio", campo: k })
    }
    const dataInicio = campos.data_inicio
    const dataFim = campos.data_fim
    if (dataInicio > dataFim) {
      return reply.code(400).send({ ok: false, erro: "data_invalida" })
    }

    // papel/competência (seletor de mês). Default atual.
    const papel = campos.papel === "proximo" ? "proximo" : "atual"
    const b = await resolverBoard(papel)
    if (!b) return reply.code(404).send({ ok: false, erro: "board_nao_registrado" })
    const id = (nome: string) => b.idPorNome.get(nome)

    try {
      // ANTIFRAUDE: busca convocações da chapa no board, checa overlap de período efetivo.
      const colChapa = id(COL.chapa)
      if (colChapa) {
        const existentes = await acharItensPorColuna(
          b.boardId, colChapa, campos.empregado_chapa,
          [id(COL.dataInicio)!, id(COL.dataFim)!, COL.statusConvocacao && id(COL.statusConvocacao)!, CANCEL_INICIO_ID].filter(Boolean) as string[],
          50,
        )
        for (const it of existentes) {
          const m = new Map(it.column_values.map((c) => [c.id, c.text]))
          const statusConv = String(m.get(id(COL.statusConvocacao) ?? "") ?? "").toLowerCase()
          if (statusConv.includes("cancelada") && !statusConv.includes("parcial")) continue
          if (statusConv.includes("bloque")) continue
          const eIni = m.get(id(COL.dataInicio) ?? "") ?? ""
          let eFim = m.get(id(COL.dataFim) ?? "") ?? ""
          const cancelIni = m.get(CANCEL_INICIO_ID) ?? ""
          if (statusConv.includes("parcial") && cancelIni) {
            // fim efetivo = cancelamento_inicio - 1 dia
            const d = new Date(cancelIni + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1)
            eFim = d.toISOString().slice(0, 10)
          }
          if (eIni && eFim && overlap(dataInicio, dataFim, eIni, eFim)) {
            return reply.code(409).send({
              ok: false, erro: "convocacao_conflitante",
              conflito: {
                item_id: it.id,
                item_url: `https://contato-serv.monday.com/boards/${b.boardId}/pulses/${it.id}`,
                nome: it.name, chapa: campos.empregado_chapa,
                data_inicio: eIni, data_fim: eFim, status_convocacao: statusConv,
                data_inicio_cancelamento: cancelIni || null,
              },
            })
          }
        }
      }

      // CREATE: monta column_values resolvendo cada campo por nome.
      const cv: Record<string, unknown> = {}
      const setTexto = (nome: string, val: string | undefined) => { const c = id(nome); if (c && val) cv[c] = val }
      const setStatus = (nome: string, label: string | undefined) => { const c = id(nome); if (c && label) cv[c] = { label } }
      const setDate = (nome: string, d: string | undefined) => { const c = id(nome); if (c && d) cv[c] = { date: d } }
      const setDropdown = (nome: string, label: string | undefined) => { const c = id(nome); if (c && label) cv[c] = { labels: [label] } }

      setDropdown(COL.nomeEmpregado, campos.empregado_nome)
      setTexto(COL.cpf, campos.empregado_cpf)
      setTexto(COL.chapa, campos.empregado_chapa)
      setTexto(COL.funcao, campos.empregado_funcao)
      setTexto(COL.admissao, campos.empregado_admissao)
      setTexto(COL.escala, campos.escala)
      setStatus(COL.solicitante, campos.solicitante)
      setStatus(COL.contrato, campos.contrato)
      setTexto(COL.localTexto, campos.local_unidade)
      setDropdown(COL.localDropdown, campos.local_unidade)
      setStatus(COL.sabado, campos.sabado)
      setStatus(COL.insalubridade, campos.insalubridade)
      setStatus(COL.interior, campos.interior)
      setStatus(COL.tipoConvocacao, "PONTUAL")
      setDate(COL.dataInicio, dataInicio)
      setDate(COL.dataFim, dataFim)
      setStatus(COL.justificativa, campos.justificativa)
      setTexto(COL.substituido, campos.empregado_substituido)
      setStatus(COL.statusConvocacao, "Válida")

      const item = await createItem(b.boardId, campos.name || `INTERMITENTE - ${campos.empregado_nome}`, cv)

      // UPLOAD termos (best-effort: não derruba a criação se falhar).
      const uploads: [string, string][] = [
        ["termo_convocacao", COL.termoConvocacao],
        ["termo_insalubridade", COL.termoInsalubridade],
      ]
      for (const [campo, colNome] of uploads) {
        const arq = arquivos[campo]
        const colId = id(colNome)
        if (arq && colId) {
          try {
            await uploadFileToColumn(item.id, colId, arq.buffer, arq.filename, arq.mime)
          } catch (e) {
            req.log.warn(e, `upload ${campo} falhou`)
          }
        }
      }

      return { ok: true, item_id: item.id, item_url: item.url }
    } catch (e) {
      req.log.error(e, "erro criar convocacao")
      return reply.code(502).send({ ok: false, erro: "erro_monday" })
    }
  })
}
