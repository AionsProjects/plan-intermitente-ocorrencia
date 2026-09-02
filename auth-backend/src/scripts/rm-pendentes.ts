/**
 * Lançamentos financeiros que NÃO foram integrados no backoffice — READ-ONLY, nada é gravado.
 *
 * Existe porque a SQL `IDFNAN` (a que o workflow usa pra achar o IDFINANC) **não devolve
 * indicador de integração**: um lançamento integrado continua aparecendo nela, então presença na
 * IDFNAN não prova nada. Isso deixou "o 24316 chegou a ser integrado?" sem resposta desde 18/08.
 *
 * Quem responde é o DataServer `FopLancFinanceiroData` (tabela `PFINANCEIRO`):
 *   - `STATUSINTEGRACAO`     0 = não integrado, 1 = integrado  → é COLUNA, dá pra filtrar
 *   - `STATUSINTBACKOFFICE`  "Pendente" / "Sucesso"            → campo DERIVADO do DataServer;
 *     usar no filtro devolve `Invalid column name`. Só serve pra ler.
 *
 * Uso — conciliação de chave `rm_idfinanc` pendente no ledger:
 *   npm run rm:pendentes                 (desde 25/08/2026)
 *   npm run rm:pendentes -- 2026-09-01   (desde a data dada)
 *
 * Pendente aqui NÃO é sempre defeito: LIQ. FOPAG e FGTS RESCISÓRIO são outros processos do DP e
 * têm ritmo próprio. O que interessa à conciliação são as linhas `CAJU VR`/`CAJU VT`.
 */
import { contextoDataServer, desescaparXml, readViewDireto } from "../clients/rmSoap.js"

const COLIGADA = 3

/** Cada `<PFINANCEIRO>` da visão vira um objeto com seus campos folha. */
export function linhasPfinanceiro(xml: string): Record<string, string>[] {
  return xml.split("<PFINANCEIRO>").slice(1).map((parte) => {
    const corpo = parte.split("</PFINANCEIRO>")[0] ?? ""
    const campos: Record<string, string> = {}
    for (const m of corpo.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) campos[m[1]!] = m[2]!.trim()
    return campos
  })
}

/** VR / VT / o que não é Caju — o histórico é a única pista do tipo. */
export function tipoDoHistorico(historico: string): "VR" | "VT" | "OUTRO" {
  const h = String(historico ?? "").toUpperCase()
  if (h.includes("CAJU VR")) return "VR"
  if (h.includes("CAJU VT")) return "VT"
  return "OUTRO"
}

async function main(): Promise<void> {
  const desde = process.argv[2] ?? "2026-08-25"
  const xml = desescaparXml(
    await readViewDireto(
      "FopLancFinanceiroData",
      `PFINANCEIRO.CODCOLIGADA=${COLIGADA} AND PFINANCEIRO.DATAEMISSAO >= '${desde}' AND PFINANCEIRO.STATUSINTEGRACAO = 0`,
      contextoDataServer(COLIGADA),
    ),
  )
  const linhas = linhasPfinanceiro(xml).sort((a, b) => Number(a.IDFINANC) - Number(b.IDFINANC))
  console.log(`### ${linhas.length} lançamentos NÃO integrados, emissão >= ${desde}\n`)
  const soma = { VR: 0, VT: 0, OUTRO: 0 }
  for (const l of linhas) {
    const tipo = tipoDoHistorico(l.HISTORICO ?? "")
    const valor = Number(l.VALORORIGINAL) || 0
    soma[tipo] += valor
    console.log(
      `${String(l.IDFINANC).padEnd(7)} ${tipo.padEnd(5)} ${String(l.STATUSINTBACKOFFICE ?? "?").padEnd(9)}` +
      ` ${valor.toFixed(2).padStart(12)} ${String(l.DATAEMISSAO ?? "").slice(0, 10)}` +
      ` ${String(l.CODSECAO ?? "-").padEnd(20)} ${String(l.HISTORICO ?? "").slice(0, 48)}`,
    )
  }
  console.log(
    `\nCaju não integrado: VR ${soma.VR.toFixed(2)} | VT ${soma.VT.toFixed(2)} | ` +
    `outros processos do DP: ${soma.OUTRO.toFixed(2)}`,
  )
}

main().catch((e) => { console.error("FALHOU:", (e as Error).message); process.exit(1) })
