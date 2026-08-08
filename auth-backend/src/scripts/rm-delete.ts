/**
 * Apaga UM registro do RM pela PK. **DESTRUTIVO.**
 *
 * Existe pra conciliação: registro gravado em duplicidade, sobra de teste controlado, linha de
 * histórico repetida. Não faz parte de nenhum fluxo automático.
 *
 *   npm run rm:delete -- FopConvocacaoData "3;007404;C03S003755" --confirmar
 *
 * Confere a existência ANTES (ReadView/ReadRecord) e prova a remoção DEPOIS relendo — "deletou" que
 * responde 200 sem apagar existe, e PK que nunca existiu também responde de forma parecida.
 */
import {
  contextoDataServer,
  deleteRecordByKeyDireto,
  desescaparXml,
  readRecordDireto,
  temRmSoap,
} from "../clients/rmSoap.js"

async function existe(dataServer: string, chave: string, contexto: string): Promise<string | null> {
  try {
    const xml = desescaparXml(await readRecordDireto(dataServer, chave, contexto))
    return /<\w+>[\s\S]*<\/\w+>/.test(xml) && xml.trim().length > 40 ? xml : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const dataServer = process.argv[2]
  const chave = process.argv[3]
  if (!dataServer || !chave || !process.argv.includes("--confirmar")) {
    console.error('uso: npm run rm:delete -- <DataServerName> "<PK>" --confirmar')
    process.exit(1)
  }
  if (!temRmSoap()) {
    console.error("RM_DIRETO_URL/USER/PASS não configurados.")
    process.exit(1)
  }
  const coligada = Number(chave.split(";")[0]) || 3
  const contexto = contextoDataServer(coligada)

  const antes = await existe(dataServer, chave, contexto)
  if (!antes) {
    console.log(`⚠️ PK "${chave}" não foi encontrada — nada a apagar. (Confira a PK antes de insistir.)`)
    return
  }
  console.log(`--- registro ANTES ---\n${antes}`)

  const r = await deleteRecordByKeyDireto(dataServer, chave, contexto)
  console.log(`\n🗑️ DeleteRecordByKey -> ${r.trim() || "(sem retorno)"}`)

  const depois = await existe(dataServer, chave, contexto)
  if (depois) {
    console.log(`\n❌ AINDA EXISTE. Apagar na tela do RM: ${chave}`)
    process.exitCode = 1
  } else {
    console.log(`\n✅ removido e confirmado: ${chave}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
