// Leitura do board Valores de Benefícios (18413870370) -> LinhaValores[].
// Híbrido: parâmetros continuam no Monday; lemos via client (read-only). Mapeia
// colunas por TÍTULO (mesma heurística do node "Decidir Desconto1" do WF3).
import { gql } from "../clients/monday.js"
import type { LinhaValores } from "../domain/desconto.js"

const BOARD_VALORES = 18413870370

function norm(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
}
function num(v: unknown): number {
  return Number(String(v ?? "0").replace(",", ".")) || 0
}

interface RawCol {
  id: string
  text: string | null
  column?: { title?: string } | null
}
interface RawItem {
  id: string
  name: string
  column_values: RawCol[]
}

function valorPorTitulo(cols: RawCol[], candidatos: string[]): string {
  const alvo = candidatos.map(norm)
  for (const cv of cols) {
    const t = norm(cv.column?.title || cv.id)
    if (alvo.some((a) => t === a || t.includes(a))) return cv.text || ""
  }
  return ""
}

function linhaAtiva(cols: RawCol[]): boolean {
  const t = norm(valorPorTitulo(cols, ["Ativo", "Status", "Habilitado"]))
  return !t || ["SIM", "ATIVO", "TRUE", "1", "HABILITADO", "REALIZADO", "DONE"].includes(t)
}

/** Lê todas as linhas ativas do board Valores e mapeia pro domínio. */
export async function lerValores(): Promise<LinhaValores[]> {
  const out: LinhaValores[] = []
  let cursor: string | null = null
  do {
    const q: string = cursor
      ? `query($c:String!){ next_items_page(limit:100, cursor:$c){ cursor items{ id name column_values{ id text column{ title } } } } }`
      : `query($b:ID!){ boards(ids:[$b]){ items_page(limit:100){ cursor items{ id name column_values{ id text column{ title } } } } } }`
    const vars = cursor ? { c: cursor } : { b: String(BOARD_VALORES) }
    const d = await gql<{
      next_items_page?: { cursor: string | null; items: RawItem[] }
      boards?: Array<{ items_page: { cursor: string | null; items: RawItem[] } }>
    }>(q, vars)
    const page: { cursor: string | null; items: RawItem[] } = cursor
      ? d.next_items_page!
      : d.boards![0]!.items_page
    for (const it of page.items) {
      const cols = it.column_values
      if (!linhaAtiva(cols)) continue
      out.push({
        contrato: valorPorTitulo(cols, ["Contrato"]),
        regra: valorPorTitulo(cols, ["Regra/Função", "Regra", "Funcao", "Função", "Cargo"]),
        vrDia: num(valorPorTitulo(cols, ["VR", "Valor VR", "Vale Refeição", "Vale Refeicao"])),
        vtDia: num(valorPorTitulo(cols, ["VT", "Valor VT", "Vale Transporte"])),
        prioridade: num(valorPorTitulo(cols, ["Prioridade", "Ordem"])) || 0,
        ativo: true,
      })
    }
    cursor = page.cursor
  } while (cursor)
  return out
}
