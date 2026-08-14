// Renomeia os itens do board de notas para o nome NOVO, que carrega o benefício.
//
// Os 14 itens do back-fill nasceram como `CRÉDITO - NOME - data`. Depois que as colunas
// `Benefício` e `Valor` saíram do board, os dois itens de um mesmo pagamento antigo (um pedido por
// benefício) ficaram com nome IDÊNTICO e nada os distinguindo na lista. O nome novo é
// `CRÉDITO VR - NOME - data`.
//
// O benefício de cada item é recuperado pelo `orderId` que está na URL da coluna `Resumo Caju`:
// esse id identifica o pedido, e o pedido diz qual benefício é. Não há palpite por posição.
//
// Dry-run por padrão:
//   node --env-file=.env --import tsx src/scripts/renomear-itens-notas-caju.ts
//   node --env-file=.env --import tsx src/scripts/renomear-itens-notas-caju.ts --aplicar
import { query } from "../db.js"
import { mondayGraphql } from "../monday.js"
import { lerDadosRelatorioPontual } from "../pontual/relatorioPontual.js"
import { linhasNotaDeRelatorio, montarNomeItemNota, resolverBoardNotas } from "../services/notasCaju.js"

const aplicar = process.argv.includes("--aplicar")

const board = await resolverBoardNotas()
if (!board) {
  console.error("board de notas não registrado")
  process.exit(1)
}
const colResumo = board.colunas.find((c) => c.nome === "Resumo Caju")?.columnId
if (!colResumo) {
  console.error("coluna 'Resumo Caju' não encontrada — sem ela não há como saber o pedido de cada item")
  process.exit(1)
}

// Nome esperado por orderId: reconstrói cada pagamento e indexa pelas linhas que ele geraria.
const { rows: itensPag } = await query<{ item_origem_id: string }>(
  `SELECT item_origem_id::text FROM pontual_prepagamento WHERE estado = 'consumido' ORDER BY criado_em`,
)
const nomePorOrder = new Map<string, string>()
for (const p of itensPag) {
  const r = await lerDadosRelatorioPontual(p.item_origem_id, "renomeio", new Date())
  if (!r) continue
  for (const l of linhasNotaDeRelatorio(r.dados)) nomePorOrder.set(l.orderId, montarNomeItemNota(l))
}
console.log(`${nomePorOrder.size} pedido(s) de crédito mapeados a partir dos snapshots\n`)

interface ItemBoard {
  id: string
  name: string
  column_values: Array<{ id: string; text: string | null }>
}
const d = await mondayGraphql<{ boards: Array<{ items_page: { items: ItemBoard[] } }> }>(
  `query($b:ID!,$col:[String!]){
     boards(ids:[$b]){ items_page(limit:200){ items{ id name column_values(ids:$col){ id text } } } }
   }`,
  { b: board.boardId, col: [colResumo] },
)
const itens = d.boards[0]?.items_page.items ?? []
console.log(`${itens.length} item(ns) no board\n`)

let renomeados = 0
let iguais = 0
for (const it of itens) {
  const link = it.column_values[0]?.text ?? ""
  const orderId = /order\/([0-9a-f-]{8,})\//.exec(link)?.[1]
  if (!orderId) {
    console.log(`? ${it.id} — sem orderId no link ("${link.slice(0, 40)}")`)
    continue
  }
  const novo = nomePorOrder.get(orderId)
  if (!novo) {
    console.log(`? ${it.id} — pedido ${orderId.slice(0, 8)} não está em nenhum snapshot`)
    continue
  }
  if (novo === it.name) {
    iguais++
    continue
  }
  if (!aplicar) {
    console.log(`+ ${it.name}\n   -> ${novo}`)
    continue
  }
  await mondayGraphql(
    `mutation($b:ID!,$i:ID!,$v:String!){
       change_simple_column_value(board_id:$b, item_id:$i, column_id:"name", value:$v){ id }
     }`,
    { b: board.boardId, i: it.id, v: novo },
  )
  renomeados++
  console.log(`✓ ${novo}`)
}

console.log(
  aplicar
    ? `\nrenomeados: ${renomeados} · já corretos: ${iguais}`
    : `\ndry-run: nada gravado (${iguais} já corretos). Rode com --aplicar.`,
)
process.exit(0)
