// Uniformiza a coluna `Admissão` do board atual em `DD/MM/YYYY` — o formato que o DP usa à mão.
//
// Origem do estrago: a rota `/api/convocar-buscar-empregado` devolvia a `Data de Admissão` do RM
// CRUA (dateTime com fuso, `2026-08-12T00:00:00-03:00`) e o valor ia inteiro pra coluna, que é
// text. Corrigido na fonte e na escrita (routes/rm.ts + routes/convocar.ts); este script arruma o
// que já entrou.
//
// NÃO muda a data, só o formato. Conversão por STRING (`paraDataBr`), nunca `new Date()`:
// converter meia-noite -03:00 pro fuso da máquina troca o dia — e a admissão é o piso do cálculo
// da data do ato no S-2260.
//
// Dry-run por padrão. Para gravar:  node --env-file=.env --import tsx src/scripts/corrigir-admissao-board.ts --aplicar
import { query } from "../db.js"
import { paraDataBr } from "../domain/convocacaoRm.js"
import { mondayGraphql } from "../monday.js"

const aplicar = process.argv.includes("--aplicar")

interface ItemPagina {
  cursor: string | null
  items: Array<{ id: string; name: string; column_values: Array<{ text: string | null }> }>
}

const { rows: boards } = await query<{ monday_board_id: string }>(
  `SELECT monday_board_id FROM boards WHERE papel = 'atual' AND ativo = true LIMIT 1`,
)
const boardId = boards[0]?.monday_board_id
if (!boardId) throw new Error("board atual nao registrado")

const { rows: cols } = await query<{ column_id: string }>(
  `SELECT column_id FROM board_colunas WHERE monday_board_id = $1 AND nome = 'Admissão'`,
  [boardId],
)
const colId = cols[0]?.column_id
if (!colId) throw new Error("coluna Admissão nao registrada")

console.log(`board ${boardId} · coluna ${colId} · modo ${aplicar ? "APLICAR" : "dry-run"}`)

// Função separada pra o tipo da página não depender do cursor que ela mesma devolve
// (inferência circular: TS acusa `implicitly has type any` se isto for inline no do/while).
async function lerPagina(c: string | null): Promise<ItemPagina | undefined> {
  const d = await mondayGraphql<{ boards: Array<{ items_page: ItemPagina }> }>(
    `query($b:ID!,$c:String,$col:[String!]){
       boards(ids:[$b]){ items_page(limit:200, cursor:$c){ cursor items{ id name column_values(ids:$col){ text } } } }
     }`,
    { b: boardId, c, col: [colId] },
  )
  return d.boards[0]?.items_page
}

const alvos: Array<{ id: string; nome: string; de: string; para: string }> = []
let cursor: string | null = null
let total = 0
do {
  const page = await lerPagina(cursor)
  if (!page) break
  for (const it of page.items) {
    total++
    const v = (it.column_values[0]?.text ?? "").trim()
    if (!v) continue
    // Já em `DD/MM/YYYY` = nada a fazer. O resto (ISO seco ou com carimbo) vira pt-BR.
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) continue
    const br = paraDataBr(v)
    // Sem `paraDataBr` = não é data (texto livre do DP). Não inventa: deixa como está e reporta.
    if (!br) {
      console.warn(` ? ${it.id} valor não reconhecido como data: ${JSON.stringify(v)}  ${it.name}`)
      continue
    }
    alvos.push({ id: it.id, nome: it.name, de: v, para: br })
  }
  cursor = page.cursor
} while (cursor)

console.log(`itens lidos: ${total} · a corrigir: ${alvos.length}`)
for (const a of alvos) console.log(` ${a.id}  ${a.de}  ->  ${a.para}   ${a.nome}`)

if (!aplicar) {
  console.log("\ndry-run: nada gravado. Rode com --aplicar para corrigir.")
  process.exit(0)
}

let ok = 0
for (const a of alvos) {
  try {
    await mondayGraphql(
      `mutation($b:ID!,$i:ID!,$c:String!,$v:String!){
         change_simple_column_value(board_id:$b, item_id:$i, column_id:$c, value:$v){ id }
       }`,
      { b: boardId, i: a.id, c: colId, v: a.para },
    )
    ok++
  } catch (e) {
    console.error(` FALHOU ${a.id}: ${(e as Error).message}`)
  }
}
console.log(`\ncorrigidos: ${ok}/${alvos.length}`)
process.exit(0)
