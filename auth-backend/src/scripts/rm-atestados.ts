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
import { consultarSql } from "../clients/rm.js"
import { ausenciaQuebraConvocacao, type LinhaAtestadoRm } from "../domain/ausencias.js"
import { quebrarPeriodoPorAusencias } from "../domain/convocacaoRm.js"
import { ausenciasDaConvocacao } from "../services/ausenciasRm.js"

/**
 * Canário da ORDEM dos parâmetros.
 *
 * O RM casa parâmetro por POSIÇÃO na querystring, não por nome (medido 10/08/2026). Se a sentença
 * registrada for editada e a ordem de `:DATA_INICIAL`/`:DATA_FINAL` inverter, a consulta passa a
 * devolver o COMPLEMENTO da janela — menos linhas, sem erro nenhum. A guarda do serviço não pega
 * esse caso (o que volta está dentro da janela; o problema é o que NÃO volta), então aqui a gente
 * pergunta as duas ordens e compara.
 */
async function canarioOrdem(chapa: string, inicio: string, fim: string): Promise<void> {
  const pedir = (parametros: Record<string, string>) =>
    consultarSql<LinhaAtestadoRm>({ codigoSql: config.rmSqlAtestados, parametros }).catch(() => null)

  const [normal, invertida] = await Promise.all([
    pedir({ CHAPA: chapa, DATA_INICIAL: inicio, DATA_FINAL: fim }),
    pedir({ CHAPA: chapa, DATA_FINAL: fim, DATA_INICIAL: inicio }),
  ])
  if (!normal || !invertida) return
  if (invertida.length > normal.length) {
    console.log(
      `\n⚠ ORDEM DOS PARAMETROS INVERTIDA na consulta "${config.rmSqlAtestados}".\n` +
        `  ordem normal devolveu ${normal.length}; ordem invertida devolveu ${invertida.length}.\n` +
        `  Na sentenca registrada, :DATA_INICIAL tem que aparecer ANTES de :DATA_FINAL.\n` +
        `  Ver docs/rm/pi-atestados.md. TUDO abaixo esta subcontando.\n`,
    )
  }
}

async function main(): Promise<void> {
  const [, , inicio, fim, chapa, ...flags] = process.argv
  if (!inicio || !fim || !chapa) {
    console.error("uso: npm run rm:atestados -- <YYYY-MM-DD ini> <YYYY-MM-DD fim> <chapa> [--cruas]")
    process.exit(1)
  }
  const cruas = flags.includes("--cruas")

  console.log(`consulta "${config.rmSqlAtestados}" | chapa ${chapa} | janela ${inicio} .. ${fim}\n`)
  await canarioOrdem(chapa, inicio, fim)
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
