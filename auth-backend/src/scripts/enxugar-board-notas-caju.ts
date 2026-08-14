// Apaga do board de notas as colunas que não servem ao trabalho dele.
//
// O board tem UM trabalho (decisão do Isaac, 14/08): abrir a linha, baixar o PDF da nota e anexar
// na pasta do Drive. Ele nasceu com 17 colunas; ficam 6. O que sai está justificado em
// `camposDaLinha` (services/notasCaju.ts) — e sai do CÓDIGO junto, senão o step passaria a avisar
// "colunas ausentes no board" em todo pagamento, que é a fadiga de alerta que já consertamos.
//
// A lista de quem FICA é a fonte da verdade; tudo o que não está nela vai embora. Assim o script
// não desatualiza quando o contrato mudar: ele deriva o que apagar do que o código escreve.
//
// Dry-run por padrão:
//   node --env-file=.env --import tsx src/scripts/enxugar-board-notas-caju.ts
//   node --env-file=.env --import tsx src/scripts/enxugar-board-notas-caju.ts --aplicar
import { query } from "../db.js"
import { lerColunas, mondayGraphql } from "../monday.js"
import { montarValuesItemNota, resolverBoardNotas } from "../services/notasCaju.js"

const aplicar = process.argv.includes("--aplicar")

const board = await resolverBoardNotas()
if (!board) {
  console.error("board de notas não registrado")
  process.exit(1)
}

/**
 * Quem FICA = as colunas que `camposDaLinha` preenche, descobertas passando uma linha completa
 * pelo builder. Nada de segunda lista pra manter em sincronia.
 */
const linhaCheia = {
  natureza: "CRÉDITO" as const, beneficio: "VR + VT", orderId: "x", valor: 1,
  origem: "PONTUAL" as const, contrato: "SEMSA", colaborador: "X", chapa: "1",
  dataInicio: "2026-08-14", dataFim: "2026-08-14",
  resumoUrl: "https://x", notaUrl: "https://x", relatorioUrl: "https://x",
  pastaDriveUrl: "https://x", idfinanc: "1", solicitacaoUrl: "https://x",
}
const { values } = montarValuesItemNota(linhaCheia, board.colunas)
const idsQueFicam = new Set(Object.keys(values))

const atuais = await lerColunas(board.boardId)
// `name` (o título do item) NUNCA pode ser apagada — não é coluna de dado.
const paraApagar = atuais.filter((c) => c.type !== "name" && !idsQueFicam.has(c.id))
const ficam = atuais.filter((c) => c.type === "name" || idsQueFicam.has(c.id))

console.log(`board ${board.boardId} · ${atuais.length} colunas · modo ${aplicar ? "APLICAR" : "dry-run"}\n`)
console.log(`FICAM (${ficam.length}):`)
for (const c of ficam) console.log(`  ${c.title} [${c.type}] ${c.id}`)
console.log(`\nAPAGAR (${paraApagar.length}):`)
for (const c of paraApagar) console.log(`  ${c.title} [${c.type}] ${c.id}`)

if (!aplicar) {
  console.log("\ndry-run: nada apagado. Rode com --aplicar.")
  process.exit(0)
}

let ok = 0
for (const c of paraApagar) {
  try {
    await mondayGraphql(
      `mutation($b:ID!,$c:String!){ delete_column(board_id:$b, column_id:$c){ id } }`,
      { b: board.boardId, c: c.id },
    )
    ok++
    console.log(`  - ${c.title}`)
  } catch (e) {
    console.error(`  ✖ ${c.title}: ${(e as Error).message}`)
  }
}

// Registry re-sincronizado: `board_colunas` guarda título->id, e coluna apagada tem de sair de lá
// também — senão `montarValuesItemNota` tentaria escrever num column_id que não existe mais.
const finais = await lerColunas(board.boardId)
await query(`DELETE FROM board_colunas WHERE monday_board_id = $1`, [board.boardId])
for (const c of finais) {
  await query(
    `INSERT INTO board_colunas (monday_board_id, nome, column_id, tipo) VALUES ($1,$2,$3,$4)
     ON CONFLICT (monday_board_id, nome) DO UPDATE SET column_id = EXCLUDED.column_id, tipo = EXCLUDED.tipo`,
    [board.boardId, c.title, c.id, c.type],
  )
}
console.log(`\napagadas: ${ok}/${paraApagar.length} · registry agora com ${finais.length} colunas`)

// Confere que o código continua achando tudo o que escreve.
const b2 = await resolverBoardNotas()
const { faltando } = montarValuesItemNota(linhaCheia, b2?.colunas ?? [])
console.log(faltando.length ? `⚠ o código NÃO acha: ${faltando.join(", ")}` : "✓ o código acha todas as colunas que escreve")
process.exit(0)
