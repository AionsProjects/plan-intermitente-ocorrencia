/**
 * Pré-voo da convocação no RM — READ-ONLY, não grava nada.
 *
 * Responde "quem deste lote JÁ tem convocação no RM cobrindo o período?" antes de qualquer
 * SaveRecord. Também serve pro DP medir quanto do board já está lançado à mão.
 *
 *   npm run rm:prevoo -- 2026-08-01 2026-08-31 003330,007404,003857
 *
 * Imprime, pra cada chapa, o XML que SERIA gravado (sem gravar) e o conflito encontrado.
 */
import { montarConvocacaoRm } from "../domain/convocacaoRm.js"
import { preVooConvocacaoRm, type AlvoConvocacaoRm } from "../services/convocacaoRm.js"

async function main(): Promise<void> {
  const [, , dataInicio, dataFim, listaChapas, coligadaArg] = process.argv
  if (!dataInicio || !dataFim || !listaChapas) {
    console.error("uso: npm run rm:prevoo -- <YYYY-MM-DD ini> <YYYY-MM-DD fim> <chapa,chapa,...> [coligada]")
    process.exit(1)
  }
  const alvos: AlvoConvocacaoRm[] = listaChapas
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((chapa) => ({ chapa, dataInicio, dataFim }))

  const r = await preVooConvocacaoRm(alvos, { coligada: coligadaArg ? Number(coligadaArg) : undefined })
  console.log(`janela ${dataInicio} .. ${dataFim} | ${alvos.length} alvo(s)`)
  console.log(`RM devolveu ${r.existentesNoRm.length} convocação(ões) cruzando a janela\n`)

  if (r.jaExistem.length) {
    console.log(`=== JÁ EXISTEM no RM (${r.jaExistem.length}) — não gravar ===`)
    for (const { alvo, existente } of r.jaExistem) {
      console.log(
        `  chapa ${alvo.chapa} -> ${existente.codConvocacao} ` +
          `${existente.dataInicio}..${existente.dataFim} (${existente.estadoDescricao || existente.estado})`,
      )
    }
    console.log()
  }

  console.log(`=== A GRAVAR (${r.aGravar.length}) ===`)
  for (const alvo of r.aGravar) {
    const m = montarConvocacaoRm(alvo)
    const aviso = m.antecedenciaSuficiente ? "" : `  ⚠ antecedência ${m.antecedenciaDias}d (< 3)`
    console.log(`  chapa ${m.chapa}${aviso}`)
    console.log(m.dadosXml.replace(/^/gm, "    "))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
