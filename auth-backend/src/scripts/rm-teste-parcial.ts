/**
 * Validação end-to-end do CANCELAMENTO PARCIAL (G2) contra o RM de verdade. **GRAVA E APAGA.**
 *
 * O que o teste offline não alcança: se o `SaveRecord` com `CODCONVOCACAO` preenchido realmente
 * EDITA no lugar em vez de criar outro, e se os campos que não foram enviados sobrevivem (o RM faz
 * MERGE, não substituição). Por isso aqui a conferência lê o `DTFIMPRESTSERV` de volta — existir
 * não basta, tem que ter o período certo, e o código tem que ser o MESMO.
 *
 * Cobre os TRÊS desfechos do encurtamento, em dois cenários:
 *   1) pedaço que CRUZA o corte      -> editado, mesmo C03S######, fim novo;
 *   2) pedaço que termina ANTES      -> intacto;
 *      pedaço que COMEÇA depois      -> removido (editar deixaria fim < início).
 *
 * Os cenários são separados porque o RM RECUSA convocações com interseção para a mesma chapa
 * ("O período para prestação de serviço da convocação possui interseção com a convocação de
 * código C03S…") — medido em 12/08/2026. Dois lançamentos vivos do mesmo item são sempre
 * disjuntos na vida real (quebra por atestado e bifurcação produzem intervalos disjuntos), então
 * montar o cenário com sobreposição testaria algo que não existe.
 *
 * Blindagens iguais às do `rm:teste-bifurcacao`: período 2099, item sentinela, `--confirmar`,
 * limpeza no `finally`.
 *
 *   npm run rm:teste-parcial -- 007404 --confirmar
 */
import { pkConvocacaoRm, RM_DATA_SERVER_CONVOCACAO } from "../domain/convocacaoRm.js"
import {
  contextoDataServer,
  deleteRecordByKeyDireto,
  desescaparXml,
  existeRegistroRm,
  readRecordDireto,
  temRmSoap,
} from "../clients/rmSoap.js"
import { gravarConvocacaoRm } from "../services/convocacaoRm.js"
import { encurtarConvocacoesDoItem } from "../services/convocacaoRemover.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import { pool, query } from "../db.js"

const COLIGADA = 3
const ITEM = 999002098
const CORTE_CANCELAMENTO = "2099-07-12" // primeiro dia cancelado
const NOVO_FIM = "2099-07-11" // = corte - 1, é o que a rota calcula

const ctx = contextoDataServer(COLIGADA)
const iso = (v: unknown) => String(v).slice(0, 10)
const pkDe = (l: { coligada: number; chapa: string; codigo: string | null; pk_rm: string | null }) =>
  l.pk_rm ?? (l.codigo ? pkConvocacaoRm({ coligada: l.coligada, chapa: l.chapa, codConvocacao: l.codigo }) : null)

/** Campos que o RM guarda hoje, lidos de volta. É a única prova de que a edição pegou. */
async function campoNoRm(pk: string, tag: string): Promise<string | null> {
  const xml = desescaparXml(await readRecordDireto(RM_DATA_SERVER_CONVOCACAO, pk, ctx))
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.slice(0, 10) ?? null
}

async function limpar() {
  for (const l of await lancamentosDoItem(ITEM)) {
    const pk = pkDe(l)
    if (pk && (await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pk, ctx))) {
      try {
        await deleteRecordByKeyDireto(RM_DATA_SERVER_CONVOCACAO, pk, ctx, 20000)
        console.log(`[limpeza] apagado no RM: ${pk}`)
      } catch (e) {
        console.log(`[limpeza] ⚠️ FALHOU apagar ${pk} — APAGAR NA MÃO: ${(e as Error).message}`)
      }
    }
    await query(`DELETE FROM efeitos_externos WHERE chave LIKE $1`, [`%${l.id}%`])
  }
  await query(`UPDATE convocacoes_rm SET origem_lancamento_id=NULL WHERE item_origem_id=$1`, [ITEM])
  await query(`DELETE FROM convocacoes_rm WHERE item_origem_id=$1`, [ITEM])
  console.log("[limpeza] rastro e ledger limpos")
}

async function grava(inicio: string, fim: string, chapa: string) {
  const g = await gravarConvocacaoRm(
    {
      itemOrigemId: ITEM, chapa, contrato: "TESTE PARCIAL",
      dataInicio: inicio, dataFim: fim, origemAcao: "teste_parcial",
    },
    // Os dois pedaços coexistem no mesmo item; sem pular, o pré-voo do 2º veria o 1º e devolveria
    // `ja_no_rm`. Quem garante não-duplicidade aqui é o índice parcial (inícios distintos).
    { pularPreVoo: true },
  )
  console.log(`  grava ${inicio}..${fim}: estado=${g.estado} codigo=${g.codConvocacao ?? "-"} ${g.erro ?? ""}`)
  if (g.estado !== "gravado") throw new Error(`nao gravou ${inicio}: ${g.estado} ${g.erro ?? ""}`)
  return g.codConvocacao!
}

async function main() {
  const chapa = (process.argv[2] ?? "").trim()
  if (!chapa || !process.argv.includes("--confirmar")) {
    console.log("uso: npm run rm:teste-parcial -- <chapa> --confirmar")
    process.exit(1)
  }
  if (!temRmSoap()) throw new Error("RM_DIRETO_* nao configurado")

  let falhou = false
  try {
    // ── CENÁRIO 1: o pedaço cruza o corte -> EDITA no lugar ──
    await limpar()
    console.log("\n=== CENÁRIO 1: pedaço 07-01..07-20 cruza o corte ===")
    const codA = await grava("2099-07-01", "2099-07-20", chapa)
    console.log(`  cancelamento parcial a partir de ${CORTE_CANCELAMENTO} (novo fim ${NOVO_FIM})`)
    const r1 = await encurtarConvocacoesDoItem(ITEM, { novoFim: NOVO_FIM, removidoPor: "teste" })
    console.log(`  edicoes=${r1.edicoes.map((x) => x.estado).join(",") || "-"} remocoes=${r1.remocoes.map((x) => x.estado).join(",") || "-"} pendencia=${r1.temPendencia}`)

    const pkA = `${COLIGADA};${chapa};${codA}`
    const vivoA = await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pkA, ctx)
    const fimA = vivoA ? await campoNoRm(pkA, "DTFIMPRESTSERV") : null
    const iniA = vivoA ? await campoNoRm(pkA, "DTINIPRESTSERV") : null
    console.log(`  ${codA} no RM: ${vivoA ? `PRESENTE ${iniA}..${fimA}` : "ausente"}`)
    if (!vivoA) { falhou = true; console.log("  ✖ tinha que sobreviver EDITADO, não ser apagado") }
    else if (fimA !== NOVO_FIM) { falhou = true; console.log(`  ✖ DTFIMPRESTSERV=${fimA}, esperava ${NOVO_FIM}`) }
    else if (iniA !== "2099-07-01") { falhou = true; console.log(`  ✖ o início mudou: ${iniA}`) }
    else console.log(`  ✔ editado NO LUGAR: mesmo código, fim ${NOVO_FIM}, início intacto`)

    const vivos1 = await lancamentosDoItem(ITEM, { apenasVivos: true })
    if (vivos1.length !== 1 || iso(vivos1[0]!.data_fim) !== NOVO_FIM) {
      falhou = true
      console.log(`  ✖ rastro não acompanhou: ${vivos1.length} vivo(s), fim ${vivos1[0] ? iso(vivos1[0].data_fim) : "-"}`)
    } else console.log("  ✔ rastro acompanhou (pré-voo não passa a mentir sobre o período)")

    // ── CENÁRIO 2: um pedaço antes do corte (intacto) e um depois (removido) ──
    await limpar()
    console.log("\n=== CENÁRIO 2: 07-01..07-10 (antes) + 07-15..07-20 (depois) ===")
    const codC = await grava("2099-07-01", "2099-07-10", chapa)
    const codD = await grava("2099-07-15", "2099-07-20", chapa)
    const r2 = await encurtarConvocacoesDoItem(ITEM, { novoFim: NOVO_FIM, removidoPor: "teste" })
    console.log(`  edicoes=${r2.edicoes.map((x) => x.estado).join(",") || "-"} remocoes=${r2.remocoes.map((x) => x.estado).join(",") || "-"} pendencia=${r2.temPendencia}`)

    const pkC = `${COLIGADA};${chapa};${codC}`
    const fimC = (await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pkC, ctx)) ? await campoNoRm(pkC, "DTFIMPRESTSERV") : null
    console.log(`  ${codC} (termina antes do corte): ${fimC ? `PRESENTE fim ${fimC}` : "ausente"}`)
    if (fimC !== "2099-07-10") { falhou = true; console.log("  ✖ tinha que ficar INTACTO") }
    else console.log("  ✔ intacto")

    const vivoD = await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, `${COLIGADA};${chapa};${codD}`, ctx)
    console.log(`  ${codD} (começa depois do corte): ${vivoD ? "PRESENTE" : "ausente"}`)
    if (vivoD) { falhou = true; console.log("  ✖ tinha que ser REMOVIDO (editar deixaria fim < inicio)") }
    else console.log("  ✔ removido")

    console.log("\n=== rastro final ===")
    for (const l of await lancamentosDoItem(ITEM)) {
      console.log(`  ${l.estado.padEnd(9)} ${l.codigo} ${iso(l.data_inicio)}..${iso(l.data_fim)} saida=${l.motivo_saida ?? "-"}`)
    }
  } finally {
    console.log("\n=== limpeza ===")
    await limpar().catch((e) => console.log("[limpeza] ⚠️ falhou:", (e as Error).message))
    await pool.end()
  }
  console.log(falhou ? "\nRESULTADO: ✖ com falhas" : "\nRESULTADO: ✔ tudo certo")
  process.exit(falhou ? 1 : 0)
}

main().catch((e) => {
  console.error("[teste-parcial] falhou:", e)
  process.exit(1)
})
