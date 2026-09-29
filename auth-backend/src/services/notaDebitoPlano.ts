// Nota de débito do crédito Caju no item do Plano.
//
// Decisão do Isaac (29/09/2026): o Plano ganha duas colunas de texto, "CREDITO VR NOTA" e
// "CREDITO VT NOTA", com o id do pedido de CRÉDITO de cada benefício, gravado sempre que um pedido
// de crédito é feito (pagamento pontual e sábado extra). Baixar a nota — medido pelo Isaac:
// `https://empresa.caju.com.br/classic/#/debit_note/<id do pedido>` — fica com outra frente; aqui
// só se grava o id.
//
// Só crédito (EXISTING_BALANCE): é o pedido que emite nota de débito. O boleto (PIX) tem o QR e o
// comprovante, que já vão pro Drive.
import { SEP_IDS_CAJU } from "../clients/caju.js"
import { mondayGraphql } from "../monday.js"

export const COLUNA_NOTA_VR = "CREDITO VR NOTA"
export const COLUNA_NOTA_VT = "CREDITO VT NOTA"

/**
 * Id do pedido que vale como nota de cada benefício.
 *
 * No formato JUNTO (gaveta até 08/2026) um pedido só paga VR e VT e o id mora no slot do VR: a nota
 * dele é a nota dos dois. No formato separado cada benefício tem o seu. Benefício sem crédito não
 * tem nota.
 */
export function idsNotaCredito(p: {
  pedidoVR: string | null | undefined
  pedidoVT: string | null | undefined
  creditoVR: number
  creditoVT: number
  junto: boolean
}): { vr: string | null; vt: string | null } {
  const vr = Number(p.creditoVR) > 0 ? (p.pedidoVR || null) : null
  const vt = Number(p.creditoVT) > 0 ? ((p.junto ? p.pedidoVR : p.pedidoVT) || null) : null
  return { vr, vt }
}

/**
 * Acrescenta o id à célula sem repetir — o mesmo item pode ter mais de um pedido de crédito do
 * mesmo benefício (pontual e depois sábado extra). Mesmo separador do resto do app (`; `).
 */
export function juntarNota(atual: string | null | undefined, novo: string | null | undefined): string {
  const ids = String(atual ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean)
  const id = String(novo ?? "").trim()
  if (id && !ids.includes(id)) ids.push(id)
  return ids.join(SEP_IDS_CAJU)
}

const norm = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

export interface ColunasNota {
  vr: string | null
  vt: string | null
}

/**
 * column_id das duas colunas no board. Primeiro o registry (`porNome`, título normalizado ->
 * id); coluna criada depois do último registro do board não está lá, então cai numa leitura das
 * colunas no próprio Monday.
 */
export async function colunasNotaDoBoard(
  boardId: string,
  porNome: Map<string, string> = new Map(),
  lerColunas: (boardId: string) => Promise<Array<{ id: string; title: string }>> = lerColunasMonday,
): Promise<ColunasNota> {
  let vr = porNome.get(norm(COLUNA_NOTA_VR)) ?? null
  let vt = porNome.get(norm(COLUNA_NOTA_VT)) ?? null
  if (!vr || !vt) {
    const cols = await lerColunas(boardId)
    const achar = (t: string) => cols.find((c) => norm(c.title) === norm(t))?.id ?? null
    vr = vr ?? achar(COLUNA_NOTA_VR)
    vt = vt ?? achar(COLUNA_NOTA_VT)
  }
  return { vr, vt }
}

async function lerColunasMonday(boardId: string): Promise<Array<{ id: string; title: string }>> {
  const d = await mondayGraphql<{ boards: Array<{ columns: Array<{ id: string; title: string }> }> }>(
    `query($b:[ID!]){ boards(ids:$b){ columns { id title } } }`,
    { b: [String(boardId)] },
  )
  return d.boards?.[0]?.columns ?? []
}

/**
 * Valores pra `change_multiple_column_values`, acrescentando aos que o item já tem. Só entra a
 * coluna que existe no board e que tem id novo — coluna ausente não vira erro: o board de um mês
 * antigo simplesmente não tem onde gravar.
 */
export function valoresNota(
  colunas: ColunasNota,
  ids: { vr: string | null; vt: string | null },
  atuais: { vr?: string | null; vt?: string | null } = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  if (colunas.vr && ids.vr) out[colunas.vr] = juntarNota(atuais.vr, ids.vr)
  if (colunas.vt && ids.vt) out[colunas.vt] = juntarNota(atuais.vt, ids.vt)
  return out
}

/** Texto atual das duas colunas no item (pra acrescentar em vez de sobrescrever). */
export async function lerNotasDoItem(
  itemId: string,
  colunas: ColunasNota,
): Promise<{ vr: string | null; vt: string | null }> {
  const ids = [colunas.vr, colunas.vt].filter((x): x is string => !!x)
  if (!ids.length) return { vr: null, vt: null }
  const d = await mondayGraphql<{ items: Array<{ column_values: Array<{ id: string; text: string | null }> }> }>(
    `query($i:[ID!],$c:[String!]){ items(ids:$i){ column_values(ids:$c){ id text } } }`,
    { i: [String(itemId)], c: ids },
  )
  const cv = new Map((d.items?.[0]?.column_values ?? []).map((c) => [c.id, c.text]))
  return { vr: colunas.vr ? cv.get(colunas.vr) ?? null : null, vt: colunas.vt ? cv.get(colunas.vt) ?? null : null }
}

/**
 * Grava a nota de um benefício no item (usado pelo sábado extra, que só paga VT). Lê o board do
 * próprio item, acha a coluna e acrescenta o id. Devolve o que gravou, ou o motivo de não gravar.
 */
export async function gravarNotaCreditoNoItem(
  itemId: string,
  beneficio: "vr" | "vt",
  orderId: string,
): Promise<{ gravado: string } | { pulado: string }> {
  const d = await mondayGraphql<{ items: Array<{ board: { id: string } | null }> }>(
    `query($i:[ID!]){ items(ids:$i){ board { id } } }`,
    { i: [String(itemId)] },
  )
  const boardId = d.items?.[0]?.board?.id
  if (!boardId) return { pulado: "item_sem_board" }
  const colunas = await colunasNotaDoBoard(boardId)
  const col = colunas[beneficio]
  if (!col) return { pulado: `board_sem_coluna_${beneficio === "vr" ? COLUNA_NOTA_VR : COLUNA_NOTA_VT}` }
  const atuais = await lerNotasDoItem(itemId, colunas)
  const valores = valoresNota(colunas, { vr: beneficio === "vr" ? orderId : null, vt: beneficio === "vt" ? orderId : null }, atuais)
  await mondayGraphql(
    `mutation($b:ID!,$i:ID!,$v:JSON!){ change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v){ id } }`,
    { b: boardId, i: String(itemId), v: JSON.stringify(valores) },
  )
  return { gravado: valores[col]! }
}
