/**
 * Lê UM registro de um DataServer pela PK — READ-ONLY, não grava nada no RM.
 *
 * Diferente do ReadView (que traz só a tabela principal), o ReadRecord devolve o dataset COMPLETO,
 * com as tabelas filhas. É como se descobre se o RM/DP preenche a filha (ex.
 * PFCONVOCACAOPFPERFF na convocação) sem gravar nada.
 *
 *   npm run rm:readrecord -- FopConvocacaoData "3;003330;C03S003328" [saida.xml] [coligada]
 *
 * PK composta vai separada por `;` na ordem do XSD. PK de uma coluna vai só o valor.
 */
import { writeFileSync } from "node:fs"
import { contextoDataServer, desescaparXml, readRecordDireto, temRmSoap } from "../clients/rmSoap.js"

async function main(): Promise<void> {
  const dataServer = process.argv[2]
  const chave = process.argv[3]
  if (!dataServer || !chave) {
    console.error('uso: npm run rm:readrecord -- <DataServerName> "<PK>" [saida.xml] [coligada]')
    process.exit(1)
  }
  const saida = process.argv[4] ?? `rm-readrecord-${dataServer}.xml`
  const coligada = Number(process.argv[5] ?? 3)

  if (!temRmSoap()) {
    console.error("RM_DIRETO_URL/USER/PASS não configurados no .env.")
    process.exit(1)
  }

  const contexto = contextoDataServer(coligada)
  console.log(`ReadRecord ${dataServer} | PK: ${chave} | contexto: ${contexto}`)
  const t0 = Date.now()
  // Vem HTML-escapado, igual ao ReadView — desescapar antes de olhar/parsear.
  const xml = desescaparXml(await readRecordDireto(dataServer, chave, contexto))
  console.log(`ok em ${Date.now() - t0}ms · ${xml.length} chars`)
  writeFileSync(saida, xml, "utf8")
  console.log(`XML cru: ${saida}\n`)
  console.log(xml.slice(0, 4000))

  // Quais tabelas vieram e com quantas linhas — responde "a filha existe?".
  const tabelas = new Map<string, number>()
  for (const m of xml.matchAll(/<(\w+)>\s*\r?\n/g)) tabelas.set(m[1], (tabelas.get(m[1]) ?? 0) + 1)
  console.log("\n=== elementos repetidos (tabela: linhas) ===")
  for (const [t, n] of tabelas) console.log(`  ${t}: ${n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
