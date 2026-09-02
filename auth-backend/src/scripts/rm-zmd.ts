// READ-ONLY: histórico de benefício (ZMDHSTBENFUNC) de uma competência + duplicatas.
// Duplicata = mesma CHAPA + CODBENEFICIO + TPBEN mais de uma vez na MESMA ANOCOMP/MESCOMP.
// É a tabela que alimenta o benefício do empregado — registro repetido = benefício contado 2x.
import { contextoDataServer, desescaparXml, readViewDireto } from "../clients/rmSoap.js"

function blocos(xml: string, tabela: string): Record<string, string>[] {
  return xml.split("<" + tabela + ">").slice(1).map((parte) => {
    const corpo = parte.split("</" + tabela + ">")[0] ?? ""
    const campos: Record<string, string> = {}
    for (const m of corpo.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) campos[m[1]!] = m[2]!.trim()
    return campos
  })
}
// O ReadView do RM devolve decimal com PONTO ("441.0000"). Tratar ponto como milhar zera a conta.
const num = (v: unknown) => Number(String(v ?? "0").replace(",", ".")) || 0

async function main(): Promise<void> {
  const ano = Number(process.argv[2] ?? 2026)
  const mes = Number(process.argv[3] ?? 9)
  const chapasFoco = (process.argv[4] ?? "").split(",").filter(Boolean)

  const xml = desescaparXml(
    await readViewDireto(
      "RMSPRJ3230976Server",
      `ZMDHSTBENFUNC.CODCOLIGADA=3 AND ZMDHSTBENFUNC.ANOCOMP=${ano} AND ZMDHSTBENFUNC.MESCOMP=${mes}`,
      contextoDataServer(3), 120000,
    ),
  )
  const linhas = blocos(xml, "ZMDHSTBENFUNC")
  console.log(`### ZMDHSTBENFUNC ${String(mes).padStart(2, "0")}/${ano}: ${linhas.length} registros\n`)

  const porImport = new Map<string, { n: number; soma: number }>()
  for (const l of linhas) {
    const d = String(l.DATAIMPORT ?? "").slice(0, 10)
    const a = porImport.get(d) ?? { n: 0, soma: 0 }
    a.n++; a.soma += num(l.VLRTOTAL); porImport.set(d, a)
  }
  console.log("por DATAIMPORT (cada data = uma rodada que gravou):")
  for (const [d, a] of [...porImport].sort()) console.log(`  ${d}  ${String(a.n).padStart(4)} registros  ${a.soma.toFixed(2).padStart(12)}`)

  const porChave = new Map<string, Record<string, string>[]>()
  for (const l of linhas) {
    const k = `${l.CHAPA}|ben${l.CODBENEFICIO}|tpben${l.TPBEN}`
    if (!porChave.has(k)) porChave.set(k, [])
    porChave.get(k)!.push(l)
  }
  const dups = [...porChave.entries()].filter(([, v]) => v.length > 1)
  const excedente = dups.reduce((a, [, v]) => a + v.slice(1).reduce((s, l) => s + num(l.VLRTOTAL), 0), 0)
  console.log(`\ncombinações chapa+benefício+tpben: ${porChave.size}`)
  console.log(`DUPLICADAS: ${dups.length}  |  valor EXCEDENTE (tudo além do 1º registro): ${excedente.toFixed(2)}`)

  // Quem gravou: RECCREATEDBY separa automacao de gente, e RECMODIFIEDON != RECCREATEDON
  // denuncia edicao manual (a automacao so insere).
  const porAutor = new Map<string, number>()
  for (const l of linhas) {
    const k = `${l.RECCREATEDBY ?? "?"}${l.RECMODIFIEDON !== l.RECCREATEDON ? " (editado a mao)" : ""}`
    porAutor.set(k, (porAutor.get(k) ?? 0) + 1)
  }
  console.log(""); console.log("por RECCREATEDBY:")
  for (const [a2, n2] of [...porAutor].sort((x, y) => y[1] - x[1])) console.log(`  ${a2.padEnd(24)} ${n2}`)

  const semNome = linhas.filter((l) => !l.NOME).length
  console.log(`registros SEM NOME (nosso montador sempre preenche): ${semNome}`)
  const mesrefErrado = linhas.filter((l) => Number(l.MESREF) === Number(l.MESCOMP)).length
  console.log(`registros com MESREF = MESCOMP (o nosso usa MESCOMP-1): ${mesrefErrado}`)

  const parAutor = new Map<string, number>()
  for (const [, v] of [...porChave.entries()].filter(([, x]) => x.length > 1)) {
    const datas = v.map((l) => String(l.DATAIMPORT ?? "").slice(0, 10)).sort().join(" + ")
    const autores = [...new Set(v.map((l) => String(l.RECCREATEDBY ?? "?")))].sort().join("/")
    const k = `${datas}  por ${autores}`
    parAutor.set(k, (parAutor.get(k) ?? 0) + 1)
  }
  console.log(""); console.log("DUPLICATAS por (datas de import + autor):")
  for (const [k, n3] of [...parAutor].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n3).padStart(4)}x  ${k}`)

  const porSecao = new Map<string, number>()
  for (const [, v] of dups) {
    const s = String(v[0]!.CODSECAO ?? "?").slice(0, 10)
    porSecao.set(s, (porSecao.get(s) ?? 0) + 1)
  }
  console.log("\nduplicatas por seção (prefixo do contrato):")
  for (const [s, n] of [...porSecao].sort((a, b) => b[1] - a[1])) console.log(`  ${s}  ${n}`)

  if (chapasFoco.length) {
    console.log(`\n### foco nas chapas ${chapasFoco.join(", ")}`)
    for (const l of linhas.filter((x) => chapasFoco.includes(String(x.CHAPA))).sort((a, b) => Number(a.ID) - Number(b.ID))) {
      console.log(
        `  id=${String(l.ID).padEnd(7)} chapa=${l.CHAPA} ben=${l.CODBENEFICIO} tpben=${l.TPBEN}` +
        ` vlr=${String(l.VLRTOTAL).padStart(10)} import=${String(l.DATAIMPORT ?? "").slice(0, 10)} secao=${l.CODSECAO} ${(l.NOME ?? "").slice(0, 24)}`,
      )
    }
  }

  // Só roda quando chamado COMO SCRIPT (mesma guarda do rm-pendentes: importar os helpers daqui
  // não pode disparar consulta no RM).
}

if ((process.argv[1] ?? "").includes("rm-zmd")) {
  main().catch((e) => { console.error("FALHOU:", (e as Error).message); process.exit(1) })
}
