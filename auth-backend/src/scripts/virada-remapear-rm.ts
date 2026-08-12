// Reancora `pi.convocacoes_rm` nos itens do board ATUAL (a cópia da virada), casando pelo
// `Código Convocação RM`. A virada já faz isso sozinha; este script é a rede — o node
// "Salvar registry (virada)" do WF n8n roda com `onError: continueRegularOutput`, então uma
// falha ali passa em silêncio.
//
// Uso:
//   node --env-file=.env --import tsx src/scripts/virada-remapear-rm.ts            # board atual
//   node --env-file=.env --import tsx src/scripts/virada-remapear-rm.ts <boardId>  # board explícito
import { pool, query } from "../db.js"
import { remapearConvocacoesRmParaBoard } from "../services/viradaConvocacoesRm.js"

async function main() {
  const arg = process.argv[2]?.trim()
  let boardId = arg
  if (!boardId) {
    const { rows } = await query<{ monday_board_id: string }>(
      `SELECT monday_board_id FROM boards WHERE papel='atual' AND ativo=true
        ORDER BY atualizado_em DESC LIMIT 1`,
    )
    boardId = rows[0]?.monday_board_id
    if (!boardId) throw new Error("nenhum board com papel=atual no registry")
  }
  const { rows: cc } = await query<{ column_id: string }>(
    `SELECT column_id FROM board_colunas
      WHERE monday_board_id=$1 AND nome='Código Convocação RM' LIMIT 1`,
    [boardId],
  )
  const col = cc[0]?.column_id
  if (!col) throw new Error(`board ${boardId} não tem a coluna 'Código Convocação RM' no registry`)

  console.log(`[virada] board ${boardId}, coluna ${col}`)
  const r = await remapearConvocacoesRmParaBoard(boardId, col)
  console.log(`[virada] candidatos=${r.candidatos} remapeados=${r.remapeados.length} ja_no_board=${r.jaNoBoard}`)
  for (const m of r.remapeados) console.log(`  ${m.codigo}: ${m.de} -> ${m.para}`)
  if (r.semItemNaCopia.length) {
    console.log(`[virada] ATENÇÃO — ${r.semItemNaCopia.length} código(s) vivo(s) sem item na cópia:`)
    for (const s of r.semItemNaCopia) console.log(`  ${s.codigo} (chapa ${s.chapa}, item antigo ${s.item_origem_id})`)
  }
  if (r.semCodigo.length) {
    console.log(`[virada] ${r.semCodigo.length} linha(s) sem código (reservado) — reancorar à mão se sobreviverem`)
    for (const s of r.semCodigo) console.log(`  ${s.id} (chapa ${s.chapa}, item ${s.item_origem_id})`)
  }
  await pool.end()
}

main().catch((e) => {
  console.error("[virada] falhou:", e)
  process.exit(1)
})
