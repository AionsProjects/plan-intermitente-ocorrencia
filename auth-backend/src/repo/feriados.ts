// Lê o board Feriados (18415442661) -> Feriado[] (domain/feriado). Híbrido: board fica no Monday.
import { lerItens, texto } from "../clients/monday.js"
import type { Feriado } from "../domain/feriado.js"

const BOARD_FERIADOS = 18415442661
const COL_DATA = "date_mm3t5bgd"
const COL_TIPO = "color_mm3t72h3"
const COL_CONTRATOS = "dropdown_mm3t4wjp"

export async function lerFeriados(): Promise<Feriado[]> {
  const itens = await lerItens(BOARD_FERIADOS)
  return itens
    .map((it) => {
      const data = (texto(it.cv, COL_DATA) || "").slice(0, 10)
      const tipo = (texto(it.cv, COL_TIPO) || "").toUpperCase().trim()
      const cs = texto(it.cv, COL_CONTRATOS) || ""
      const contratos = cs ? cs.split(",").map((s) => s.trim()).filter(Boolean) : []
      return { data, nome: it.name, tipo, contratos }
    })
    .filter((f) => f.data)
}
