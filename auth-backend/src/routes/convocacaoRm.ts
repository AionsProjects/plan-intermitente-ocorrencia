import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { query } from "../db.js"
import { acharItensPorColuna, changeColumnValues, lerItem } from "../monday.js"
import { usuarioDaAutorizacao } from "../session.js"
import { executarLoteConvocacaoRm, type LoteConvocacaoRmResultado } from "../services/convocacaoRm.js"
import type { ItemConvocacaoMonday } from "../domain/convocacaoRm.js"

// Convocação no RM disparada pelo DP no Monday — 1 clique por CONTRATO, não por pessoa.
//
// O gatilho vive num grupo com um item por contrato, no mesmo board Entrada. Mudar o status desse
// item lança no RM todas as convocações daquele contrato. Os itens de gatilho não têm chapa, e é
// por isso que `classificarItensConvocacaoRm` os descarta como `sem_chapa`.
//
// GRAVA NO RM (evento eSocial S-2260) -> atrás de flag `CONVOCACAO_RM_HABILITADA`, com prévia
// read-only e ledger `pi.efeitos_externos` por pessoa.

/**
 * Colunas resolvidas por TÍTULO no registry (`board_colunas`) — o board do mês é cópia, os
 * `column_id` mudam na virada; os títulos, em teoria, não.
 *
 * Em teoria. Na prática os títulos DERIVARAM entre cópias: no board de 2026-08 a coluna de status
 * da convocação se chama `Status` (não "Status Convocação") e a data de cancelamento é
 * `inicio do cancelamento` (não "Cancelamento Início"). Daí a lista de candidatos por campo — o
 * primeiro título que existir no board vence.
 */
const T = {
  contrato: ["Op - Contrato"],
  chapa: ["Funcionário"],
  dataInicio: ["OP - Data/Inicio"],
  dataFim: ["OP - Data/Fim"],
  admissao: ["Admissão"],
  tipoConvocacao: ["OP - Tipo Convocação"],
  statusConvocacao: ["Status Convocação", "Status"],
  cancelamentoInicio: ["Cancelamento Início", "inicio do cancelamento"],
  /** COLUNA NOVA no board (text): guarda o `C03S######` que o RM gerou. */
  codRm: ["Código Convocação RM"],
  /** COLUNA NOVA no board (status): é o gatilho no item do contrato. */
  gatilho: ["Lançar no RM"],
} as const

type CampoColuna = keyof typeof T

/**
 * Campos SEM os quais a rota não roda.
 *
 * `statusConvocacao` e `cancelamentoInicio` estão aqui por segurança, não por conveniência: sem o
 * status, convocação **cancelada** vira convocação no RM; sem a data do cancelamento, a parcial vai
 * com o período inteiro. Os dois erros gravam eSocial S-2260 que não devia existir.
 */
const OBRIGATORIAS: CampoColuna[] = [
  "contrato",
  "chapa",
  "dataInicio",
  "dataFim",
  "statusConvocacao",
  "cancelamentoInicio",
  "codRm",
]

/**
 * Label que dispara, JÁ NORMALIZADA (sem cedilha).
 *
 * `normalizar()` tira os diacríticos do label que vem do Monday, então "LANÇAR" chega como
 * "LANCAR". Comparar com a constante acentuada nunca casava e o gatilho morria em
 * `label_nao_gatilho` — falha silenciosa, porque a resposta é 200 igual.
 */
const LABEL_GATILHO = "LANCAR"

async function colunasDoBoard(boardId: string): Promise<Map<string, string>> {
  const { rows } = await query<{ nome: string; column_id: string }>(
    `SELECT nome, column_id FROM board_colunas WHERE monday_board_id=$1`,
    [boardId],
  )
  return new Map(rows.map((r) => [r.nome, r.column_id]))
}

function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
}

/**
 * O label do evento é o gatilho?
 *
 * Os DOIS lados passam pela mesma normalização — foi comparar normalizado contra acentuado que
 * fez o gatilho morrer calado (resposta 200, `label_nao_gatilho`, nada acontecendo).
 * Label vazio conta como gatilho: o Monday não manda `value.label` em todo formato de evento, e
 * ali o filtro de coluna já garantiu que a mudança foi na coluna certa.
 */
export function ehLabelGatilho(texto: unknown): boolean {
  const label = normalizar(texto)
  return label === "" || label.includes(LABEL_GATILHO)
}

/** Resolve cada campo pro `column_id` do board, tentando os títulos candidatos em ordem. */
export function resolverColunas(cols: Map<string, string>): {
  id: (campo: CampoColuna) => string | undefined
  faltando: string[]
} {
  const mapa = new Map<CampoColuna, string>()
  for (const campo of Object.keys(T) as CampoColuna[]) {
    for (const titulo of T[campo]) {
      const cid = cols.get(titulo)
      if (cid) {
        mapa.set(campo, cid)
        break
      }
    }
  }
  const faltando = OBRIGATORIAS.filter((c) => !mapa.has(c)).map((c) => `${c} (${T[c].join(" | ")})`)
  return { id: (campo) => mapa.get(campo), faltando }
}

/**
 * Monta o lote a partir do board. Falha se faltar qualquer coluna de `OBRIGATORIAS` — ver o porquê
 * de status/cancelamento estarem lá.
 */
export async function montarLote(
  boardId: string,
  contrato: string,
): Promise<
  | { itens: ItemConvocacaoMonday[]; colCodRm: string; colGatilho: string | undefined }
  | { erro: string; faltando: string[] }
> {
  const cols = await colunasDoBoard(boardId)
  const { id, faltando } = resolverColunas(cols)
  if (faltando.length) return { erro: "colunas_ausentes_no_board", faltando }

  const idContrato = id("contrato")!
  const colCodRm = id("codRm")!
  const idsRetorno = (Object.keys(T) as CampoColuna[])
    .map((c) => id(c))
    .filter((x): x is string => !!x)

  const itensMonday = await acharItensPorColuna(boardId, idContrato, contrato, idsRetorno, 500)
  const itens: ItemConvocacaoMonday[] = itensMonday.map((it) => {
    const m = new Map(it.column_values.map((c) => [c.id, c.text ?? ""]))
    const txt = (campo: CampoColuna): string => {
      const cid = id(campo)
      return cid ? (m.get(cid) ?? "") : ""
    }
    return {
      itemId: it.id,
      nome: it.name,
      chapa: txt("chapa"),
      contrato: txt("contrato") || contrato,
      dataInicio: txt("dataInicio"),
      dataFim: txt("dataFim"),
      dataAdmissao: txt("admissao") || undefined,
      tipoConvocacao: txt("tipoConvocacao") || undefined,
      statusConvocacao: txt("statusConvocacao") || undefined,
      cancelamentoInicio: txt("cancelamentoInicio") || null,
      codRmExistente: txt("codRm") || undefined,
    }
  })
  return { itens, colCodRm, colGatilho: id("gatilho") }
}

/**
 * Labels de retorno no próprio item do contrato — é o que o DP vê sem abrir log nenhum.
 *
 * Nenhum deles pode conter `LANCAR` normalizado: escrever nesta coluna re-dispara o webhook, e um
 * label que passasse por `ehLabelGatilho` viraria loop infinito de lançamento.
 */
export const LABEL_CONCLUIDO = "AUTOMAÇÃO FINALIZADA"
export const LABEL_ERRO = "ERRO NA AUTOMAÇÃO"

/** Houve algo que exige olho humano? (erro, reserva pendente, RM gravado sem eco no Monday) */
export function loteExigeAtencao(r: LoteConvocacaoRmResultado): boolean {
  return r.resultados.some(
    (x) => x.estado === "erro" || x.estado === "reserva_pendente" || x.estado === "gravado_monday_pendente",
  )
}

async function rodarLote(
  boardId: string,
  contrato: string,
  previa: boolean,
  /** Item de gatilho, pra devolver o status quando o lote termina. Só no caminho do webhook. */
  itemGatilhoId?: string,
): Promise<{ status: number; body: LoteConvocacaoRmResultado | { erro: string; faltando?: string[] } }> {
  const lote = await montarLote(boardId, contrato)
  if ("erro" in lote) return { status: 400, body: lote }

  const resultado = await executarLoteConvocacaoRm({
    contrato,
    itens: lote.itens,
    previa,
    gravarNoMonday: previa
      ? undefined
      : async (item, codConvocacao) => {
          await changeColumnValues(boardId, item.itemId, { [lote.colCodRm]: codConvocacao })
        },
  })

  // Devolve o status no item do contrato, pro DP ver o fim sem abrir log.
  // NÃO é fatal: o lote já rodou e o ledger é a fonte de verdade — falhar aqui só deixa o item
  // com o label antigo, e reprocessar por causa disso duplicaria trabalho sem motivo.
  if (!previa && itemGatilhoId && lote.colGatilho) {
    const label = loteExigeAtencao(resultado) ? LABEL_ERRO : LABEL_CONCLUIDO
    try {
      await changeColumnValues(boardId, itemGatilhoId, { [lote.colGatilho]: { label } })
    } catch {
      /* ignora de propósito — ver comentário acima */
    }
  }
  return { status: 200, body: resultado }
}

export async function rotasConvocacaoRm(app: FastifyInstance): Promise<void> {
  /**
   * Webhook do Monday na coluna-gatilho do item de CONTRATO.
   *
   * Sem `CONVOCACAO_RM_HABILITADA=1` responde 200 com `ignorado: "desligado"` de propósito: o
   * Monday desativa webhook que responde erro, e não queremos perder o webhook só porque a flag
   * está desligada.
   */
  app.post(
    "/api/monday/convocacao-rm",
    async (
      req: FastifyRequest<{
        Body: {
          challenge?: string
          event?: {
            boardId?: number | string
            pulseId?: number | string
            pulseName?: string
            columnId?: string
            value?: { label?: { text?: string } }
          }
        }
      }>,
      reply: FastifyReply,
    ) => {
      if (req.body?.challenge) return { challenge: req.body.challenge }

      const ev = req.body?.event
      if (!ev?.boardId || !ev?.pulseId) return reply.code(400).send({ erro: "evento_invalido" })

      const boardId = String(ev.boardId)
      const cols = await colunasDoBoard(boardId)
      const { id } = resolverColunas(cols)
      const idGatilho = id("gatilho")
      if (idGatilho && ev.columnId && ev.columnId !== idGatilho) {
        return { ok: true, ignorado: "outra_coluna" }
      }
      if (!ehLabelGatilho(ev.value?.label?.text)) return { ok: true, ignorado: "label_nao_gatilho" }

      // Contrato = coluna `Op - Contrato` do item de gatilho. Nome do item é fallback, pro caso
      // do DP montar o grupo só com o nome do contrato no título.
      const idContrato = id("contrato")
      const itemGatilho = idContrato ? await lerItem(String(ev.pulseId), [idContrato]) : null
      const contrato =
        (itemGatilho?.column_values.find((c) => c.id === idContrato)?.text ?? "").trim() ||
        String(ev.pulseName ?? itemGatilho?.name ?? "").trim()
      if (!contrato) return reply.code(400).send({ erro: "contrato_nao_identificado" })

      if (!config.convocacaoRmHabilitada) {
        return { ok: true, ignorado: "desligado", contrato, dica: "CONVOCACAO_RM_HABILITADA=1" }
      }
      try {
        const r = await rodarLote(boardId, contrato, false, String(ev.pulseId))
        return reply.code(r.status).send(r.body)
      } catch (e) {
        req.log.error(e, "erro /api/monday/convocacao-rm")
        return reply.code(502).send({ erro: "erro_convocacao_rm", mensagem: (e as Error).message })
      }
    },
  )

  /**
   * Prévia do lote — READ-ONLY (não grava no RM nem reserva chave no ledger). É o que o DP olha
   * antes de clicar, e o que a gente olha antes de ligar a flag. Só admin/DP.
   */
  app.post(
    "/api/convocacao-rm/previa",
    async (
      req: FastifyRequest<{ Body: { board_id?: string; contrato?: string } }>,
      reply: FastifyReply,
    ) => {
      const u = await usuarioDaAutorizacao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin" && u.papel !== "dp") return reply.code(403).send({ erro: "sem_permissao" })

      const boardId = String(req.body?.board_id ?? "").trim()
      const contrato = String(req.body?.contrato ?? "").trim()
      if (!boardId || !contrato) return reply.code(400).send({ erro: "board_id_e_contrato_obrigatorios" })
      try {
        const r = await rodarLote(boardId, contrato, true)
        return reply.code(r.status).send(r.body)
      } catch (e) {
        req.log.error(e, "erro /api/convocacao-rm/previa")
        return reply.code(502).send({ erro: "erro_convocacao_rm", mensagem: (e as Error).message })
      }
    },
  )
}
