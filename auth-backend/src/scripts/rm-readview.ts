/**
 * Lista registros de um DataServer por filtro — READ-ONLY, não grava nada no RM.
 *
 * Serve pra duas coisas: (1) descobrir o domínio real de campo `short` que o XSD não explica
 * (ESTADOCONVOCACAO, INDLOCALPRESTACTRAB...) olhando o que o DP já lançou na mão; (2) redescobrir
 * PKs pra desfazer um lote, já que o ledger nem sempre guardou.
 *
 *   npm run rm:readview -- FopConvocacaoData "CODCOLIGADA=3" [saida.xml] [coligada]
 *
 * O filtro vai cru no XML do DataServer — só literal montado por você, nunca entrada de usuário.
 */
import { writeFileSync } from "node:fs"
import { contextoDataServer, desescaparXml, readViewDireto, temRmSoap } from "../clients/rmSoap.js"

/** Registros achatados: cada `<TABELA>` com seus campos folha viram um objeto. */
export function linhasDoXml(xml: string, tabela: string): Record<string, string>[] {
  const re = new RegExp(`<${tabela}>([\\s\\S]*?)</${tabela}>`, "g")
  return [...xml.matchAll(re)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/<([\w]+)>([\s\S]*?)<\/\1>/g)].map((c) => [c[1], c[2].trim()])),
  )
}

async function main(): Promise<void> {
  const dataServer = process.argv[2]
  const filtro = process.argv[3]
  if (!dataServer || !filtro) {
    console.error('uso: npm run rm:readview -- <DataServerName> "<filtro SQL>" [saida.xml] [coligada]')
    process.exit(1)
  }
  const saida = process.argv[4] ?? `rm-readview-${dataServer}.xml`
  const coligada = Number(process.argv[5] ?? 3)

  if (!temRmSoap()) {
    console.error("RM_DIRETO_URL/USER/PASS não configurados no .env.")
    process.exit(1)
  }

  const contexto = contextoDataServer(coligada)
  console.log(`ReadView ${dataServer} | filtro: ${filtro} | contexto: ${contexto}`)
  const t0 = Date.now()
  // ReadView devolve o XML HTML-escapado (`&lt;PFCONVOCACAO&gt;`). Sem desescapar, qualquer regex
  // acha zero registro e parece "não tem nada no RM" — falso negativo que já custou tempo aqui.
  const xml = desescaparXml(await readViewDireto(dataServer, filtro, contexto))
  console.log(`ok em ${Date.now() - t0}ms · ${xml.length} chars`)
  writeFileSync(saida, xml, "utf8")
  console.log(`XML cru: ${saida}`)

  // O resultado vem embrulhado em <NewDataSet>; a tabela é o FILHO dele, não a raiz.
  const tabela = /<\w+>\s*<(\w+)>/.exec(xml)?.[1]
  if (!tabela) return console.log("(nenhum registro)")
  const linhas = linhasDoXml(xml, tabela)
  console.log(`\n${linhas.length} registro(s) em ${tabela}`)
  for (const l of linhas.slice(0, 10)) console.log("  " + JSON.stringify(l))

  // Domínio observado dos campos curtos: é o que o XSD não conta.
  const contagens = new Map<string, Map<string, number>>()
  for (const l of linhas) {
    for (const [k, v] of Object.entries(l)) {
      if (!contagens.has(k)) contagens.set(k, new Map())
      const m = contagens.get(k)!
      m.set(v, (m.get(v) ?? 0) + 1)
    }
  }
  console.log("\n=== valores distintos por campo (<=12) ===")
  for (const [campo, vals] of contagens) {
    if (vals.size > 12) continue
    const lista = [...vals.entries()].map(([v, n]) => `${v || "∅"}(${n})`).join("  ")
    console.log(`  ${campo.padEnd(24)} ${lista}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
