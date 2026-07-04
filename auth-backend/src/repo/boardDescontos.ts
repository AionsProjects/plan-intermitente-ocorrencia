// Board DESCONTOS (18400981023) — item "INTERMITENTE" por período de desconto.
// Porta fiel do node "Decidir Desconto" (parte board) do WF Cancelar + usado
// pelo fluxo de atestado/PF. create_labels_if_missing pro dropdown de nome.
import { gql, lerPorColuna, type MondayItem } from "../clients/monday.js"

export const BOARD_DESCONTOS = 18400981023
export const GRUPO_DESCONTOS = "group_mm0rmjs3"

export const COL_DESC = {
  nome: "dropdown_mm0rgfrx",
  matricula: "text_mm0rpqxs",
  cpf: "text_mm0r5ted",
  dataInicio: "date_mm0r6tyr",
  dataFim: "date_mm0rzpyv",
  diasPerdeVT: "numeric_mm3428yj",
  diasPerdeVR: "numeric_mm34p6p7",
  qtdAtrasos: "numeric_mm2pj1av",
  descontoVR: "numeric_mm0rgsaw",
  descontoVT: "numeric_mm0r5tca",
  status: "color_mm0r8mjr",
  residualVR: "numeric_mm0r1691",
  residualVT: "numeric_mm0rtwwg",
  descontadoVR: "numeric_mm0rqy6z",
  descontadoVT: "numeric_mm0r6cn0",
} as const

export interface DescontoBoardExistente {
  id: string
  status: string
}

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()

/** Busca desconto existente da chapa cujo período bate exatamente (di, df). */
export async function buscarDescontoPorPeriodo(
  chapa: string,
  dataInicio: string,
  dataFim: string,
): Promise<DescontoBoardExistente | null> {
  if (!chapa) return null
  const items = await lerPorColuna(BOARD_DESCONTOS, COL_DESC.matricula, [chapa])
  for (const it of items) {
    const di = it.cv[COL_DESC.dataInicio]?.text || null
    const df = it.cv[COL_DESC.dataFim]?.text || null
    if (di === dataInicio && df === dataFim) {
      return { id: it.id, status: norm(it.cv[COL_DESC.status]?.text) }
    }
  }
  return null
}

export interface DescontoBoardPayload {
  nome: string | null
  chapa: string
  cpf: string
  dataInicio: string
  dataFim: string
  diasPerdeVT: number
  diasPerdeVR: number
  qtdAtrasos: number
  descontoVR: number
  descontoVT: number
}

function columnValues(p: DescontoBoardPayload): Record<string, unknown> {
  const toDate = (d: string) => (d ? { date: d } : null)
  const vals: Record<string, unknown> = {
    [COL_DESC.nome]: p.nome ? { labels: [p.nome] } : null,
    [COL_DESC.matricula]: p.chapa,
    [COL_DESC.cpf]: p.cpf,
    [COL_DESC.dataInicio]: toDate(p.dataInicio),
    [COL_DESC.dataFim]: toDate(p.dataFim),
    [COL_DESC.diasPerdeVT]: String(p.diasPerdeVT),
    [COL_DESC.diasPerdeVR]: String(p.diasPerdeVR),
    [COL_DESC.qtdAtrasos]: String(p.qtdAtrasos),
    [COL_DESC.descontoVR]: String(p.descontoVR),
    [COL_DESC.descontoVT]: String(p.descontoVT),
    [COL_DESC.status]: { label: "PENDENTE" },
    [COL_DESC.residualVR]: String(p.descontoVR),
    [COL_DESC.residualVT]: String(p.descontoVT),
    [COL_DESC.descontadoVR]: "0",
    [COL_DESC.descontadoVT]: "0",
  }
  for (const k of Object.keys(vals)) if (vals[k] === null || vals[k] === undefined) delete vals[k]
  return vals
}

/** Cria/atualiza o item de desconto no board (labels criadas se faltarem). */
export async function gravarDescontoBoard(
  p: DescontoBoardPayload,
  existente: DescontoBoardExistente | null,
): Promise<{ acao: "create" | "update"; itemId: string }> {
  const vals = JSON.stringify(columnValues(p))
  if (existente) {
    const d = await gql<{ change_multiple_column_values: { id: string } }>(
      `mutation($b:ID!,$i:ID!,$v:JSON!){
         change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true){ id }
       }`,
      { b: String(BOARD_DESCONTOS), i: existente.id, v: vals },
    )
    return { acao: "update", itemId: d.change_multiple_column_values.id }
  }
  const d = await gql<{ create_item: { id: string } }>(
    `mutation($b:ID!,$g:String!,$n:String!,$v:JSON!){
       create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true){ id }
     }`,
    { b: String(BOARD_DESCONTOS), g: GRUPO_DESCONTOS, n: "INTERMITENTE", v: vals },
  )
  return { acao: "create", itemId: d.create_item.id }
}

export type { MondayItem }
