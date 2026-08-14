// Back-fill do board "Notas e Relatórios Caju" para os pagamentos que já saíram.
//
// Reconstrói os dados de cada pagamento (snapshot + artefatos da execução) e cria a linha do
// pedido de CRÉDITO. Idempotente pela MESMA chave que o workflow usa
// (`pontual:{item}:monday_notas`), então rodar duas vezes não duplica linha — e o workflow, num
// retry futuro, também não recria o que este script criou.
//
// ⚠️ NÃO sobe o PDF do relatório: a credencial do Drive só existe na Vercel. A coluna `Relatório`
// fica vazia nestas linhas históricas; o PDF continua disponível sob demanda em
// GET /api/pontual/relatorio/:itemId. Pagamento novo nasce completo, pelo workflow.
//
// Dry-run por padrão:
//   node --env-file=.env --import tsx src/scripts/backfill-notas-caju.ts
//   node --env-file=.env --import tsx src/scripts/backfill-notas-caju.ts --aplicar
import { query } from "../db.js"
import { confirmarEfeito, detalheEfeito, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import { lerDadosRelatorioPontual } from "../pontual/relatorioPontual.js"
import { linhasNotaDeRelatorio, registrarNotasCaju, resolverBoardNotas, urlItemNota } from "../services/notasCaju.js"

const aplicar = process.argv.includes("--aplicar")

const board = await resolverBoardNotas()
if (!board) {
  console.error("board de notas não registrado — rode criar-board-notas-caju.ts primeiro")
  process.exit(1)
}
console.log(`board ${board.boardId} · ${board.colunas.length} colunas · modo ${aplicar ? "APLICAR" : "dry-run"}\n`)

// Pagamentos com snapshot consumido = felipeta que rodou. Ordem cronológica.
const { rows: itens } = await query<{ item_origem_id: string; nome: string | null; data_inicio: string }>(
  `SELECT item_origem_id::text, nome, data_inicio
     FROM pontual_prepagamento
    WHERE estado = 'consumido'
    ORDER BY criado_em`,
)
console.log(`${itens.length} pagamento(s) com snapshot consumido\n`)

let criados = 0
let pulados = 0
for (const it of itens) {
  const rotulo = `${(it.nome ?? "?").slice(0, 28).padEnd(30)} ${it.data_inicio} item ${it.item_origem_id}`
  const chave = `pontual:${it.item_origem_id}:monday_notas`
  const ja = await detalheEfeito(chave)
  if (ja?.status === "confirmado") {
    console.log(`= ${rotulo} — já registrado (${ja.refExterna})`)
    pulados++
    continue
  }

  const r = await lerDadosRelatorioPontual(it.item_origem_id, "back-fill", new Date())
  if (!r) {
    console.log(`? ${rotulo} — sem snapshot legível`)
    continue
  }
  const linhas = linhasNotaDeRelatorio(r.dados)
  if (!linhas.length) {
    console.log(`- ${rotulo} — sem pedido de crédito (semSaldo?)`)
    continue
  }
  const desc = linhas.map((l) => `${l.natureza} ${l.beneficio} R$ ${l.valor} ${l.orderId.slice(0, 8)}`).join(" | ")
  if (!aplicar) {
    console.log(`+ ${rotulo} — ${desc}`)
    continue
  }

  await reservarEfeito(chave, "pontual_monday_notas", { itemId: it.item_origem_id, backfill: true })
  try {
    const res = await registrarNotasCaju(linhas)
    if (res.pulado) {
      await liberarEfeito(chave).catch(() => {})
      console.log(`! ${rotulo} — ${res.pulado}`)
      continue
    }
    await confirmarEfeito(chave, `monday:notas:${res.criados.map((c) => c.itemId).join(",")}`)
    criados += res.criados.length
    console.log(`✓ ${rotulo} — ${desc}`)
    for (const c of res.criados) console.log(`    ${urlItemNota(board.boardId, c.itemId)}`)
    if (res.faltando.length) console.log(`    ⚠ colunas ausentes: ${res.faltando.join(", ")}`)
  } catch (e) {
    // Solta a chave: sem isto uma falha de rede deixa a chave `pendente` e o workflow futuro
    // lança FatalError de conciliação num pagamento que está inteiro.
    await liberarEfeito(chave).catch(() => {})
    console.error(`✖ ${rotulo} — ${(e as Error).message}`)
  }
}

console.log(
  aplicar
    ? `\nlinhas criadas: ${criados} · já registrados antes: ${pulados}`
    : "\ndry-run: nada gravado. Rode com --aplicar.",
)
process.exit(0)
