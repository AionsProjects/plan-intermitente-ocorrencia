/**
 * Provisiona no board Entrada o que o gatilho de convocação no RM precisa. **ESCREVE NO MONDAY.**
 *
 *   npm run monday:provisionar-convocacao-rm                    # só mostra o plano (nada muda)
 *   npm run monday:provisionar-convocacao-rm -- --confirmar      # aplica
 *   npm run monday:provisionar-convocacao-rm -- --board 18418191275 --confirmar
 *
 * Cria (pulando o que já existe):
 *   - coluna `Código Convocação RM` (text) — onde o `C03S######` do RM é gravado de volta;
 *   - coluna `Lançar no RM` (status, labels AGUARDANDO/LANÇAR) — o gatilho;
 *   - grupo `LANÇAR NO RM (por contrato)` com **um item por contrato**, com `Op - Contrato`
 *     preenchido e SEM chapa (é a chapa vazia que mantém o item de gatilho fora do lote).
 *
 * No fim re-registra colunas e grupos em `board_colunas`/`board_grupos`: a rota resolve tudo por
 * TÍTULO no registry, então coluna criada e não registrada é coluna que a rota não vê.
 */
import { pool } from "../db.js"
import { boardPorPapel } from "../repo/boards.js"
import { createItem, lerColunas, lerColunasSettings, lerGrupos, mondayGraphql } from "../monday.js"

const COL_COD_RM = "Código Convocação RM"
const COL_GATILHO = "Lançar no RM"
const GRUPO = "LANÇAR NO RM (por contrato)"
const TITULO_CONTRATO = "Op - Contrato"
/** Labels do gatilho. `LANÇAR` é o que o webhook procura (normalizado, sem acento). */
const LABELS_GATILHO = { "0": "AGUARDANDO", "1": "LANÇAR" }

const aplicar = process.argv.includes("--confirmar")
const boardArg = (() => {
  const i = process.argv.indexOf("--board")
  return i > 0 ? process.argv[i + 1] : undefined
})()

function log(acao: "criar" | "ok" | "erro", o: string, extra = ""): void {
  const marca = acao === "ok" ? "✔ já existe" : acao === "criar" ? (aplicar ? "＋ criado" : "→ criaria") : "✖ erro"
  console.log(`  ${marca}  ${o}${extra ? `  ${extra}` : ""}`)
}

async function criarColuna(board: string, titulo: string, tipo: string, defaults?: unknown): Promise<string> {
  const d = await mondayGraphql<{ create_column: { id: string } }>(
    `mutation($board:ID!,$title:String!,$type:ColumnType!,$defaults:JSON){
       create_column(board_id:$board, title:$title, column_type:$type, defaults:$defaults){ id }
     }`,
    { board, title: titulo, type: tipo, defaults: defaults ? JSON.stringify(defaults) : null },
  )
  return d.create_column.id
}

async function criarGrupo(board: string, nome: string): Promise<string> {
  const d = await mondayGraphql<{ create_group: { id: string } }>(
    `mutation($board:ID!,$name:String!){ create_group(board_id:$board, group_name:$name){ id } }`,
    { board, name: nome },
  )
  return d.create_group.id
}

/** Nomes dos itens de UM grupo — base do dedup (o board todo tem homônimos em outros grupos). */
async function itensDoGrupo(board: string, grupoId: string): Promise<string[]> {
  const d = await mondayGraphql<{
    boards: { groups: { items_page: { items: { name: string }[] } }[] }[]
  }>(
    `query($board:ID!,$group:String!){
       boards(ids:[$board]){ groups(ids:[$group]){ items_page(limit:500){ items{ id name } } } }
     }`,
    { board, group: grupoId },
  )
  return d.boards?.[0]?.groups?.[0]?.items_page?.items?.map((i) => i.name) ?? []
}

/** Espelha colunas/grupos no registry pi — a rota resolve por título a partir de lá. */
async function reregistrar(board: string): Promise<void> {
  const colunas = await lerColunas(board)
  for (const c of colunas) {
    await pool.query(
      `INSERT INTO board_colunas (monday_board_id, nome, column_id, tipo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (monday_board_id, nome) DO UPDATE SET column_id=EXCLUDED.column_id, tipo=EXCLUDED.tipo`,
      [board, c.title, c.id, c.type],
    )
  }
  const grupos = await lerGrupos(board)
  for (const g of grupos) {
    await pool.query(
      `INSERT INTO board_grupos (monday_board_id, titulo, group_id) VALUES ($1,$2,$3)
       ON CONFLICT (monday_board_id, titulo) DO UPDATE SET group_id=EXCLUDED.group_id`,
      [board, g.title, g.id],
    )
  }
  console.log(`  registry atualizado: ${colunas.length} colunas, ${grupos.length} grupos`)
}

async function main(): Promise<void> {
  const board = boardArg ?? String((await boardPorPapel("atual")) ?? "")
  if (!board) throw new Error("board não resolvido (registry sem papel=atual e sem --board)")
  console.log(`board: ${board}${boardArg ? " (--board)" : " (registry papel=atual)"}`)
  console.log(aplicar ? "MODO: APLICAR\n" : "MODO: plano (nada muda) — use --confirmar pra aplicar\n")

  const colunas = await lerColunas(board)
  const porTitulo = new Map(colunas.map((c) => [c.title, c]))

  // --- colunas ---
  console.log("colunas:")
  if (porTitulo.has(COL_COD_RM)) log("ok", COL_COD_RM, porTitulo.get(COL_COD_RM)!.id)
  else if (aplicar) log("criar", COL_COD_RM, await criarColuna(board, COL_COD_RM, "text"))
  else log("criar", COL_COD_RM, "(text)")

  if (porTitulo.has(COL_GATILHO)) log("ok", COL_GATILHO, porTitulo.get(COL_GATILHO)!.id)
  else if (aplicar) {
    log("criar", COL_GATILHO, await criarColuna(board, COL_GATILHO, "status", { labels: LABELS_GATILHO }))
  } else log("criar", COL_GATILHO, `(status ${Object.values(LABELS_GATILHO).join("/")})`)

  // --- contratos (labels reais da coluna do board, não lista chumbada) ---
  const colContrato = porTitulo.get(TITULO_CONTRATO)
  if (!colContrato) throw new Error(`coluna "${TITULO_CONTRATO}" não existe no board ${board}`)
  const settings = await lerColunasSettings(board, [colContrato.id])
  const labels: Record<string, string> = JSON.parse(settings[0]?.settings_str || "{}").labels ?? {}
  const contratos = Object.values(labels).filter(Boolean)
  console.log(`\ncontratos na coluna ${TITULO_CONTRATO} (${contratos.length}): ${contratos.join(", ")}`)

  // --- grupo ---
  console.log("\ngrupo:")
  const grupos = await lerGrupos(board)
  let grupoId = grupos.find((g) => g.title === GRUPO)?.id
  if (grupoId) log("ok", GRUPO, grupoId)
  else if (aplicar) {
    grupoId = await criarGrupo(board, GRUPO)
    log("criar", GRUPO, grupoId)
  } else log("criar", GRUPO)

  // --- 1 item por contrato ---
  // Dedup SÓ dentro do grupo de gatilho. O board tem itens com nome de contrato em outros grupos
  // (ex. "DETRAN" em "Acompanhamento de Fechamento", que é rastreio do mensal, com contrato vazio);
  // deduplicar pelo board inteiro deixaria esses contratos sem gatilho nenhum.
  console.log("\nitens de gatilho (1 por contrato, SEM chapa):")
  const existentes = new Set(grupoId ? (await itensDoGrupo(board, grupoId)).map((n) => n.trim().toUpperCase()) : [])
  for (const contrato of contratos) {
    if (existentes.has(contrato.trim().toUpperCase())) {
      log("ok", contrato, "(já há item com esse nome no grupo de gatilho)")
      continue
    }
    if (!aplicar || !grupoId) {
      log("criar", contrato)
      continue
    }
    const novo = await createItem(board, contrato, { [colContrato.id]: { label: contrato } }, grupoId)
    log("criar", contrato, novo.id)
  }

  if (aplicar) {
    console.log("\nregistry:")
    await reregistrar(board)
  }
  console.log(
    aplicar
      ? "\n✅ aplicado. Próximo: POST /api/convocacao-rm/previa (read-only) antes de ligar CONVOCACAO_RM_HABILITADA."
      : "\nNada foi alterado. Rode com --confirmar pra aplicar.",
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
