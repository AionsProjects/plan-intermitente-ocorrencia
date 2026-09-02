/**
 * Duplicidade de histórico de benefício na população CELETISTA — READ-ONLY.
 *
 * Por que só celetista: o celetista tem UM pagamento por competência, então registro repetido em
 * `chapa + benefício + TPBEN` é duplicata. No intermitente é o oposto — um registro POR CONVOCAÇÃO
 * PAGA é o normal (medido: MICHELE GALVAO, chapa 007425, 7 pagamentos e 7 registros em 08/2026).
 *
 * Quem é intermitente vem do RM, não de inferência: `PFUNC.CODCATEGORIAESOCIAL = '111'` é o filtro
 * que a própria SQL "BEN 2" do app usa. Aqui SEM o corte de demitidos — para excluir da análise
 * qualquer um que já foi intermitente algum dia.
 *
 *   npm run rm:dup-celetista [ano] [mes...]      ex.: npm run rm:dup-celetista 2026 8 9
 */
import { contextoDataServer, desescaparXml, readViewDireto } from "../clients/rmSoap.js"
import { chapa6, codSecaoBase } from "../mensal/rmEfeitos.js"

const COLIGADA = 3

function blocos(xml: string, tabela: string): Record<string, string>[] {
  return xml.split("<" + tabela + ">").slice(1).map((parte) => {
    const corpo = parte.split("</" + tabela + ">")[0] ?? ""
    const campos: Record<string, string> = {}
    for (const m of corpo.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) campos[m[1]!] = m[2]!.trim()
    return campos
  })
}
/** O ReadView do RM devolve decimal com PONTO ("441.0000"). */
const num = (v: unknown): number => Number(String(v ?? "0").replace(",", ".")) || 0

/** Chapas que são (ou já foram) intermitentes — a população a EXCLUIR. */
export async function chapasIntermitentes(): Promise<Set<string>> {
  const xml = desescaparXml(await readViewDireto("FopFuncData",
    `PFUNC.CODCOLIGADA=${COLIGADA} AND PFUNC.CODCATEGORIAESOCIAL='111'`, contextoDataServer(COLIGADA), 120000))
  const s = new Set<string>()
  for (const bloco of xml.split("<CHAPA>").slice(1)) {
    const chapa = bloco.split("</CHAPA>")[0]?.trim()
    if (chapa) s.add(chapa6(chapa))
  }
  return s
}

async function main(): Promise<void> {
  const ano = Number(process.argv[2] ?? 2026)
  const meses = process.argv.slice(3).map(Number).filter(Boolean)
  const inter = await chapasIntermitentes()
  console.log(`intermitentes no RM (CODCATEGORIAESOCIAL=111, todas as situações): ${inter.size}`)

  // Lançamentos financeiros do período — para dizer QUAL rodada virou dinheiro.
  const fin = blocos(desescaparXml(await readViewDireto("FopLancFinanceiroData",
    `PFINANCEIRO.CODCOLIGADA=${COLIGADA} AND PFINANCEIRO.DATAEMISSAO >= '${ano}-01-01'`,
    contextoDataServer(COLIGADA), 120000)), "PFINANCEIRO").filter((x) => /CAJU V/i.test(String(x.HISTORICO)))
  const statusPorRodada = new Map<string, string>()
  for (const f of fin) {
    const k = `${codSecaoBase(f.CODSECAO ?? "")}|${String(f.DATAEMISSAO).slice(0, 10)}`
    const atual = statusPorRodada.get(k)
    const st = String(f.STATUSINTBACKOFFICE ?? "?")
    statusPorRodada.set(k, atual && atual !== st ? `${atual}+${st}` : st)
  }

  const csv = ["competencia;chapa;nome;beneficio;tpben;secao;id_registro;valor;data_import;gravado_por;financeiro_da_rodada"]
  for (const mes of meses) {
    const zmd = blocos(desescaparXml(await readViewDireto("RMSPRJ3230976Server",
      `ZMDHSTBENFUNC.CODCOLIGADA=${COLIGADA} AND ZMDHSTBENFUNC.ANOCOMP=${ano} AND ZMDHSTBENFUNC.MESCOMP=${mes}`,
      contextoDataServer(COLIGADA), 120000)), "ZMDHSTBENFUNC")
    const g = new Map<string, Record<string, string>[]>()
    for (const l of zmd) {
      const k = `${chapa6(l.CHAPA ?? "")}|${l.CODBENEFICIO}|${l.TPBEN}`
      if (!g.has(k)) g.set(k, [])
      g.get(k)!.push(l)
    }
    let grupos = 0, registrosExcedentes = 0, excedente = 0, comIntegrado = 0
    for (const [k, v] of g) {
      const chapa = k.split("|")[0]!
      if (v.length < 2 || inter.has(chapa)) continue
      grupos++
      registrosExcedentes += v.length - 1
      excedente += v.slice(1).reduce((s, l) => s + num(l.VLRTOTAL), 0)
      let algumIntegrado = false
      for (const l of v.sort((a, b) => String(a.DATAIMPORT).localeCompare(String(b.DATAIMPORT)))) {
        const data = String(l.DATAIMPORT).slice(0, 10)
        const st = statusPorRodada.get(`${codSecaoBase(l.CODSECAO ?? "")}|${data}`) ?? "sem lancamento"
        if (/Sucesso/.test(st)) algumIntegrado = true
        csv.push([`${String(mes).padStart(2, "0")}/${ano}`, chapa, String(l.NOME ?? "").replace(/;/g, ","),
          l.CODBENEFICIO === "1" ? "VR" : "VT", l.TPBEN ?? "", l.CODSECAO ?? "", l.ID ?? "",
          num(l.VLRTOTAL).toFixed(2), data, l.RECCREATEDBY ?? "", st].join(";"))
      }
      if (algumIntegrado) comIntegrado++
    }
    console.log(`\n${String(mes).padStart(2, "0")}/${ano}: ${zmd.length} registros | grupos duplicados (celetista): ${grupos}`)
    console.log(`  registros excedentes: ${registrosExcedentes} | valor excedente: ${excedente.toFixed(2)}`)
    console.log(`  grupos em que ALGUMA rodada integrou no financeiro: ${comIntegrado}`)
  }
  const saida = process.env.SAIDA_CSV
  if (saida) { const { writeFileSync } = await import("node:fs"); writeFileSync(saida, csv.join("\n"), "utf8"); console.log(`\nCSV: ${csv.length - 1} linhas em ${saida}`) }
}

if ((process.argv[1] ?? "").includes("rm-dup-celetista")) {
  main().then(() => process.exit(0)).catch((e) => { console.error("FALHOU:", (e as Error).message); process.exit(1) })
}
