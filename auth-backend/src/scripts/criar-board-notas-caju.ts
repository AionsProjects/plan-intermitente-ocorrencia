// Cria o board "Notas e Relatórios Caju" no Monday e o registra no registry.
//
// Spec em docs/pontual/board-notas-caju.md. UM item por pedido de CRÉDITO na Caju, com os links
// do resumo Caju, da nota de débito, do relatório em PDF e da pasta no Drive.
//
// Idempotente por NOME: se o board já existir no workspace, reusa em vez de criar um segundo — e
// cria só as colunas que faltam. Rodar duas vezes não duplica nada.
//
// Dry-run por padrão:
//   node --env-file=.env --import tsx src/scripts/criar-board-notas-caju.ts
//   node --env-file=.env --import tsx src/scripts/criar-board-notas-caju.ts --aplicar
import { query } from "../db.js"
import { lerColunas, lerGrupos, mondayGraphql } from "../monday.js"
import { PAPEL_BOARD_NOTAS } from "../services/notasCaju.js"

const aplicar = process.argv.includes("--aplicar")
const NOME_BOARD = "Notas e Relatórios Caju"
const WORKSPACE = "2739319" // DEPARTAMENTO PESSOAL — mesmo dos boards de Plano e Solicitação
const PASTA = "17865263" // mesma pasta da Solicitação de Pagamento

/**
 * Colunas na ORDEM de leitura do item. Os títulos são contrato com o código: `notasCaju.ts`
 * resolve tudo por título via registry (`board_colunas`), então mudar um nome aqui exige mudar lá.
 */
const COLUNAS: Array<{ titulo: string; tipo: string; descricao?: string }> = [
  { titulo: "Pedido Caju", tipo: "text", descricao: "id do pedido na Caju — chave de conferência com o extrato" },
  { titulo: "Natureza", tipo: "status", descricao: "CRÉDITO (o BOLETO fica na Solicitação de Pagamento)" },
  { titulo: "Benefício", tipo: "dropdown", descricao: "VR e/ou VT dentro deste pedido" },
  { titulo: "Origem", tipo: "status", descricao: "PONTUAL ou MENSAL" },
  { titulo: "Contrato", tipo: "dropdown" },
  { titulo: "Colaborador", tipo: "text", descricao: "vazio no mensal: lá o pedido é do contrato inteiro" },
  { titulo: "Chapa", tipo: "text" },
  { titulo: "Data Início", tipo: "date" },
  { titulo: "Data Fim", tipo: "date" },
  { titulo: "Valor", tipo: "numbers", descricao: "valor deste pedido" },
  { titulo: "Resumo Caju", tipo: "link", descricao: "painel da Caju do pedido" },
  { titulo: "Nota de Débito", tipo: "link", descricao: "PDF da nota — só existe depois de o crédito ser confirmado no painel" },
  { titulo: "Relatório", tipo: "link", descricao: "PDF do pagamento, em OUTROS/ na pasta do Drive" },
  { titulo: "Pasta Drive", tipo: "link" },
  { titulo: "IDFINANC", tipo: "text", descricao: "lançamento financeiro no RM — só na linha de BOLETO" },
  { titulo: "Solicitação", tipo: "link", descricao: "item da Solicitação de Pagamento — só na linha de BOLETO" },
  { titulo: "Status", tipo: "status", descricao: "nasce GERADO; daí em diante é do DP" },
]

const norm = (v: string): string =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

// --- 1. board: acha por nome no workspace, ou cria -------------------------------------------
const achados = await mondayGraphql<{ boards: Array<{ id: string; name: string; state: string }> }>(
  `query{ boards(limit:200, workspace_ids:[${WORKSPACE}]){ id name state } }`,
)
const existente = (achados.boards ?? []).find((b) => norm(b.name) === norm(NOME_BOARD) && b.state === "active")

let boardId: string
if (existente) {
  boardId = existente.id
  console.log(`board já existe: ${boardId} (${existente.name})`)
} else if (!aplicar) {
  console.log(`[dry-run] criaria o board "${NOME_BOARD}" no workspace ${WORKSPACE}, pasta ${PASTA}`)
  console.log(`[dry-run] + ${COLUNAS.length} colunas: ${COLUNAS.map((c) => c.titulo).join(", ")}`)
  console.log("\nnada gravado. Rode com --aplicar.")
  process.exit(0)
} else {
  const criado = await mondayGraphql<{ create_board: { id: string } }>(
    `mutation($nome:String!,$ws:ID!,$pasta:ID){
       create_board(board_name:$nome, board_kind:public, workspace_id:$ws, folder_id:$pasta,
                    description:"Um item por pedido de CRÉDITO na Caju. Preenchido pela automação (pontual e mensal)."){ id }
     }`,
    { nome: NOME_BOARD, ws: WORKSPACE, pasta: PASTA },
  )
  boardId = criado.create_board.id
  console.log(`board CRIADO: ${boardId}`)
}

// --- 2. colunas: só as que faltam (board novo já vem com defaults) ---------------------------
const atuais = await lerColunas(boardId)
const porTitulo = new Map(atuais.map((c) => [norm(c.title), c]))
console.log(`\ncolunas atuais (${atuais.length}): ${atuais.map((c) => `${c.title}[${c.type}]`).join(", ")}`)

const faltando = COLUNAS.filter((c) => !porTitulo.has(norm(c.titulo)))
const reusadas = COLUNAS.filter((c) => porTitulo.has(norm(c.titulo)))
if (reusadas.length) {
  console.log(`\nreusando ${reusadas.length} coluna(s) que já existem com o nome certo:`)
  for (const c of reusadas) {
    const a = porTitulo.get(norm(c.titulo))!
    const alerta = a.type !== c.tipo ? `  ⚠ tipo ${a.type} ≠ ${c.tipo} esperado` : ""
    console.log(`  ${c.titulo} → ${a.id} [${a.type}]${alerta}`)
  }
}
if (!aplicar) {
  console.log(`\n[dry-run] criaria ${faltando.length} coluna(s): ${faltando.map((c) => c.titulo).join(", ")}`)
  console.log("nada gravado. Rode com --aplicar.")
  process.exit(0)
}

for (const c of faltando) {
  const r = await mondayGraphql<{ create_column: { id: string; title: string } }>(
    `mutation($b:ID!,$t:String!,$tipo:ColumnType!,$d:String){
       create_column(board_id:$b, title:$t, column_type:$tipo, description:$d){ id title }
     }`,
    { b: boardId, t: c.titulo, tipo: c.tipo, ...(c.descricao ? { d: c.descricao } : { d: null }) },
  )
  console.log(`  + ${r.create_column.title} → ${r.create_column.id} [${c.tipo}]`)
}

// --- 2b. item default ("Task 1") que o Monday cria com o board -------------------------------
// Só apaga se estiver REALMENTE vazio: um item com dado nunca é lixo de criação.
try {
  const d = await mondayGraphql<{ boards: Array<{ items_page: { items: Array<{ id: string; name: string; column_values: Array<{ text: string | null }> }> } }> }>(
    `query($b:ID!){ boards(ids:[$b]){ items_page(limit:5){ items{ id name column_values{ text } } } } }`,
    { b: boardId },
  )
  for (const it of d.boards[0]?.items_page.items ?? []) {
    if (it.column_values.some((c) => c.text)) continue
    if (!/^(task|item)\s*\d+$/i.test(it.name.trim())) continue
    await mondayGraphql(`mutation($i:ID!){ delete_item(item_id:$i){ id } }`, { i: it.id })
    console.log(`\nitem default apagado: ${JSON.stringify(it.name)}`)
  }
} catch (e) {
  console.warn("apagar item default falhou (segue):", (e as Error).message)
}

// --- 3. registry: papel notas_caju (título -> column_id) -------------------------------------
const finais = await lerColunas(boardId)
await query(
  `INSERT INTO boards (monday_board_id, competencia, papel)
     VALUES ($1, NULL, $2)
   ON CONFLICT (monday_board_id) DO UPDATE
     SET papel = EXCLUDED.papel, ativo = true, atualizado_em = now()`,
  [boardId, PAPEL_BOARD_NOTAS],
)
await query(`DELETE FROM board_colunas WHERE monday_board_id = $1`, [boardId])
for (const c of finais) {
  await query(
    `INSERT INTO board_colunas (monday_board_id, nome, column_id, tipo) VALUES ($1,$2,$3,$4)
     ON CONFLICT (monday_board_id, nome) DO UPDATE SET column_id = EXCLUDED.column_id, tipo = EXCLUDED.tipo`,
    [boardId, c.title, c.id, c.type],
  )
}
let grupos: Array<{ id: string; title: string }> = []
try { grupos = await lerGrupos(boardId) } catch { /* best-effort */ }
await query(`DELETE FROM board_grupos WHERE monday_board_id = $1`, [boardId])
for (const g of grupos) {
  await query(
    `INSERT INTO board_grupos (monday_board_id, titulo, group_id) VALUES ($1,$2,$3)
     ON CONFLICT (monday_board_id, titulo) DO UPDATE SET group_id = EXCLUDED.group_id`,
    [boardId, g.title, g.id],
  )
}

console.log(`\nregistrado no registry: papel=${PAPEL_BOARD_NOTAS}, ${finais.length} colunas, ${grupos.length} grupo(s)`)
console.log(`board: https://contato-serv.monday.com/boards/${boardId}`)

// --- 4. confere que o código acha tudo o que precisa ----------------------------------------
const { resolverBoardNotas, montarValuesItemNota } = await import("../services/notasCaju.js")
const b = await resolverBoardNotas()
if (!b) {
  console.error("\n⚠ resolverBoardNotas() devolveu null — o registry não pegou.")
  process.exit(1)
}
const { faltando: semColuna } = montarValuesItemNota(
  {
    natureza: "CRÉDITO", beneficio: "VR + VT", orderId: "teste", valor: 1, origem: "PONTUAL",
    contrato: "SEMSA", colaborador: "TESTE", chapa: "000000",
    dataInicio: "2026-08-14", dataFim: "2026-08-14",
    resumoUrl: "https://x", notaUrl: "https://x", relatorioUrl: "https://x",
    pastaDriveUrl: "https://x", idfinanc: "1", solicitacaoUrl: "https://x",
  },
  b.colunas,
)
console.log(
  semColuna.length
    ? `\n⚠ o código NÃO acha: ${semColuna.join(", ")} — confira o título no board`
    : "\n✓ o código acha todas as colunas do contrato",
)
process.exit(0)
