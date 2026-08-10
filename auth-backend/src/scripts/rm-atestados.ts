/**
 * Atestados do RM — READ-ONLY, não grava nada.
 *
 * Mostra a cadeia inteira: linhas cruas → mapeadas → filtradas → pedaços da convocação.
 * É por aqui que se confere se a consulta registrada está devolvendo o que o código espera
 * (nomes de coluna, formato de data, HORAINICIO/HORAFINAL) ANTES de ligar a flag.
 *
 *   npm run rm:atestados -- 2026-08-01 2026-08-31 006824
 *   npm run rm:atestados -- 2026-08-05 2026-08-20 006824 --cruas
 */
import { config } from "../config.js"
import { ausenciaQuebraConvocacao } from "../domain/ausencias.js"
import { quebrarPeriodoPorAusencias } from "../domain/convocacaoRm.js"
import { ausenciasDaConvocacao } from "../services/ausenciasRm.js"

async function main(): Promise<void> {
  const [, , inicio, fim, chapa, ...flags] = process.argv
  if (!inicio || !fim || !chapa) {
    console.error("uso: npm run rm:atestados -- <YYYY-MM-DD ini> <YYYY-MM-DD fim> <chapa> [--cruas]")
    process.exit(1)
  }
  const cruas = flags.includes("--cruas")

  console.log(`consulta "${config.rmSqlAtestados}" | chapa ${chapa} | janela ${inicio} .. ${fim}\n`)
  const r = await ausenciasDaConvocacao(chapa, inicio, fim)

  console.log(`RM devolveu ${r.linhas} linha(s); ${r.ausencias.length} mapeada(s), ${r.descartadas.length} descartada(s)\n`)

  if (cruas && r.ausencias.length) {
    console.log("=== MAPEADAS ===")
    for (const a of r.ausencias) {
      console.log(
        `  ${a.inicio}..${a.fim}  tipo ${a.codTipo || "?"} ${a.tipo || ""} ` +
          `| hora ${a.horaInicio ?? "-"}..${a.horaFinal ?? "-"} | diaCheio=${a.diaCheio} ` +
          `| quebra=${ausenciaQuebraConvocacao(a)} | sit=${a.situacao} cat=${a.categoriaESocial}`,
      )
    }
    console.log()
  }

  if (r.descartadas.length) {
    console.log("=== DESCARTADAS (linha que não virou ausência) ===")
    for (const d of r.descartadas) console.log(`  ${d.motivo}:`, JSON.stringify(d.linha))
    console.log()
  }

  console.log(`=== CORTES (${r.cortes.length}) ===`)
  for (const c of r.cortes) console.log(`  ${c.inicio}..${c.fim}`)

  const pedacos = quebrarPeriodoPorAusencias(inicio, fim, r.cortes)
  console.log(`\n=== PEDAÇOS DA CONVOCAÇÃO (${pedacos.length}) ===`)
  if (!pedacos.length) console.log("  (nenhum — o período inteiro está coberto por ausência)")
  for (const p of pedacos) console.log(`  ${p.inicio}..${p.fim}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
