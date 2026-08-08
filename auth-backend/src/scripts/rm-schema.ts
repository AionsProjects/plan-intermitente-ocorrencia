/**
 * Dump do schema de um DataServer do RM — READ-ONLY, não grava nada no RM.
 *
 * Existe porque montar SaveRecord num DataServer novo sem ver o XSD é chute: nome de campo errado
 * volta como SOAP Fault opaco (ou pior, grava incompleto). Rode isto ANTES de escrever o XML.
 *
 *   npm run rm:schema -- FopConvocacaoData [arquivo-de-saida.xsd] [coligada]
 *
 * Imprime tabelas/campos destilados e salva o XSD cru pra conferência.
 */
import { writeFileSync } from "node:fs"
import { contextoDataServer, getSchemaDireto, temRmSoap } from "../clients/rmSoap.js"

interface Campo {
  nome: string
  tipo: string
  /** Sem `minOccurs="0"` o XSD exige o campo — é o que o SaveRecord vai cobrar. */
  obrigatorio: boolean
  /** Rótulo em pt-BR que o RM mostra na tela (`msdata:Caption`) — casa campo com a UI do ERP. */
  caption?: string
  maxLength?: string
  padrao?: string
}

interface Tabela {
  nome: string
  campos: Campo[]
}

interface Chave {
  tabela: string
  campos: string[]
  primaria: boolean
}

/**
 * Destila o XSD do RM em tabelas -> campos.
 *
 * Cuidado com a pegadinha do formato: campo `string` NÃO traz `type=`, ele abre um
 * `<xs:simpleType>` aninhado só pra declarar `maxLength`. Distinguir tabela de campo por
 * "tem type?" joga metade dos campos fora (CHAPA, CODCONVOCACAO, ESTADO...). O que separa de
 * verdade é a tag seguinte: `xs:complexType` = tabela, `xs:simpleType` = campo string.
 * Vale pro formato do RM; não é um parser de XSD genérico.
 */
export function destilarSchema(xsd: string): Tabela[] {
  const tabelas: Tabela[] = []
  const re = /<xs:element\s+([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xsd)) !== null) {
    const [, attrs, autoFechado] = m
    const nome = /\bname="([^"]+)"/.exec(attrs)?.[1]
    if (!nome) continue

    const resto = xsd.slice(re.lastIndex).trimStart()
    if (!autoFechado && resto.startsWith("<xs:complexType")) {
      tabelas.push({ nome, campos: [] })
      continue
    }

    const tabela = tabelas[tabelas.length - 1]
    if (!tabela) continue
    // Só elemento COM corpo tem `</xs:element>`. Num auto-fechado, procurar o fechamento acha o do
    // campo seguinte e o maxLength vaza de um campo pro outro (short(140) etc).
    const bloco = autoFechado ? "" : resto.slice(0, resto.indexOf("</xs:element>") + 1)
    const tipo =
      /\btype="([^"]+)"/.exec(attrs)?.[1] ??
      /<xs:restriction\s+base="([^"]+)"/.exec(bloco)?.[1] ??
      "?"
    tabela.campos.push({
      nome,
      tipo: tipo.replace(/^xs:/, ""),
      obrigatorio: !/\bminOccurs="0"/.test(attrs),
      caption: /\bmsdata:Caption="([^"]+)"/.exec(attrs)?.[1],
      maxLength: /<xs:maxLength\s+value="([^"]+)"/.exec(bloco)?.[1],
      padrao: /\bdefault="([^"]+)"/.exec(attrs)?.[1],
    })
  }
  return tabelas
}

/**
 * Chaves do XSD. O RM declara PK como `xs:unique msdata:PrimaryKey="true"` (não `xs:key`), e FK
 * como `xs:keyref`. O `xs:selector` diz de qual tabela é a chave.
 */
export function extrairChaves(xsd: string): Chave[] {
  const chaves: Chave[] = []
  const re = /<xs:(unique|key|keyref)\s+([^>]*)>([\s\S]*?)<\/xs:\1>/g
  const limpar = (x: string) => x.replace(/^\.\/\/|^mstns:/g, "").replace(/^mstns:/, "")
  let m: RegExpExecArray | null
  while ((m = re.exec(xsd)) !== null) {
    const [, , attrs, corpo] = m
    chaves.push({
      tabela: limpar(/<xs:selector\s+xpath="([^"]+)"/.exec(corpo)?.[1] ?? "?"),
      campos: [...corpo.matchAll(/<xs:field\s+xpath="([^"]+)"/g)].map((f) => limpar(f[1])),
      primaria: /\bmsdata:PrimaryKey="true"/.test(attrs),
    })
  }
  return chaves
}

async function main(): Promise<void> {
  const dataServer = process.argv[2]
  if (!dataServer) {
    console.error("uso: npm run rm:schema -- <DataServerName> [saida.xsd] [coligada]")
    process.exit(1)
  }
  const saida = process.argv[3] ?? `rm-schema-${dataServer}.xsd`
  const coligada = Number(process.argv[4] ?? 3)

  if (!temRmSoap()) {
    console.error("RM_DIRETO_URL/USER/PASS não configurados no .env — GetSchema precisa do SOAP direto.")
    process.exit(1)
  }

  const contexto = contextoDataServer(coligada)
  console.log(`GetSchema ${dataServer} | contexto: ${contexto}`)
  const t0 = Date.now()
  const xsd = await getSchemaDireto(dataServer, contexto)
  console.log(`ok em ${Date.now() - t0}ms · ${xsd.length} chars`)

  writeFileSync(saida, xsd, "utf8")
  console.log(`XSD cru: ${saida}\n`)

  const tabelas = destilarSchema(xsd).filter((t) => t.campos.length > 0)
  for (const t of tabelas) {
    console.log(`\n=== ${t.nome} (${t.campos.length} campos) ===`)
    for (const c of t.campos) {
      const tipo = c.maxLength ? `${c.tipo}(${c.maxLength})` : c.tipo
      const extra = c.padrao ? ` default=${c.padrao}` : ""
      console.log(`  ${c.obrigatorio ? "*" : " "} ${c.nome.padEnd(24)} ${tipo.padEnd(14)} ${c.caption ?? ""}${extra}`)
    }
  }

  const chaves = extrairChaves(xsd)
  if (chaves.length) {
    console.log("\n=== chaves ===")
    for (const k of chaves) {
      console.log(`  ${k.primaria ? "PK" : "FK"} ${k.tabela}: ${k.campos.join(", ")}`)
    }
  }
  console.log("\n(* = obrigatório no XSD)")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
