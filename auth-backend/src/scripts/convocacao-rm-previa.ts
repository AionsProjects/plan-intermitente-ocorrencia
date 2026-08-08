/**
 * Prévia do lote de convocação no RM, por contrato — READ-ONLY.
 *
 * Não grava no RM e não reserva chave no ledger (reservar numa prévia deixaria a chave `pendente` e
 * travaria a execução real). É a mesma coisa que `POST /api/convocacao-rm/previa` faz, sem precisar
 * de sessão — serve pra conferir antes de ligar `CONVOCACAO_RM_HABILITADA`.
 *
 *   npm run convocacao-rm:previa -- DETRAN
 *   npm run convocacao-rm:previa -- "SEDUC ESCOLA" --board 18418191275
 */
import { pool } from "../db.js"
import { boardPorPapel } from "../repo/boards.js"
import { montarLote } from "../routes/convocacaoRm.js"
import { executarLoteConvocacaoRm } from "../services/convocacaoRm.js"

async function main(): Promise<void> {
  const contrato = process.argv[2]
  if (!contrato) {
    console.error('uso: npm run convocacao-rm:previa -- "<CONTRATO>" [--board <id>]')
    process.exit(1)
  }
  const i = process.argv.indexOf("--board")
  const board = i > 0 ? process.argv[i + 1]! : String((await boardPorPapel("atual")) ?? "")
  if (!board) throw new Error("board não resolvido")

  const lote = await montarLote(board, contrato)
  if ("erro" in lote) {
    console.error(`${lote.erro}: ${lote.faltando.join(" · ")}`)
    process.exitCode = 1
    return
  }
  console.log(`board ${board} | contrato "${contrato}" | ${lote.itens.length} item(ns) no board`)

  const r = await executarLoteConvocacaoRm({ contrato, itens: lote.itens, previa: true })
  console.log(`\ntotais: ${JSON.stringify(r.totais)}`)

  if (r.resultados.length) {
    console.log("\n=== SERIA GRAVADO ===")
    for (const x of r.resultados) {
      const aviso = x.exigeConfirmacaoRm ? `  ⚠ antecedência ${x.antecedenciaDias}d` : ""
      console.log(
        `  [${x.estado}] ${x.chapa} ${x.nome.slice(0, 28).padEnd(28)} ` +
          `${x.dataInicio}..${x.dataFim}  ato=${x.dataConvocacao}${aviso}`,
      )
    }
  }
  if (r.pulados.length) {
    console.log("\n=== PULADOS ===")
    for (const p of r.pulados) {
      console.log(`  [${p.motivo}] ${p.chapa || "(sem chapa)"} ${p.nome.slice(0, 28)}${p.detalhe ? `  ${p.detalhe}` : ""}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
