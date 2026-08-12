/**
 * Validação end-to-end da bifurcação (G3) contra o RM de verdade. **GRAVA E APAGA.**
 *
 * Prova, na ordem:
 *   1. grava uma convocação 2099-07-01..2099-07-20 (rastro + ledger + RM);
 *   2. bifurca no corte 2099-07-12 -> o registro original some do RM e nascem DOIS;
 *   3. reverte -> os dois somem e volta UM, com o período da união.
 *
 * Blindagens (mesmo protocolo do `rm:teste-convocacao`):
 *   - período em **2099**, fora de qualquer competência real de folha;
 *   - `item_origem_id` sentinela (999002099), que não existe em board nenhum — nada de Monday;
 *   - exige `--confirmar` no argv;
 *   - `finally` apaga tudo que criou (RM, rastro, ledger) e grita o que sobrou.
 *
 * ⚠️ Convocação é S-2260. O contador do RM não retrocede: os números consumidos viram gap.
 *
 *   npm run rm:teste-bifurcacao -- 007404 --confirmar
 */
import { pkConvocacaoRm, RM_DATA_SERVER_CONVOCACAO } from "../domain/convocacaoRm.js"
import { contextoDataServer, deleteRecordByKeyDireto, existeRegistroRm, temRmSoap } from "../clients/rmSoap.js"
import { gravarConvocacaoRm } from "../services/convocacaoRm.js"
import { bifurcarConvocacoesDoItem, reverterBifurcacaoDoItem } from "../services/convocacaoBifurcar.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import { pool, query } from "../db.js"

const COLIGADA = 3
const ITEM = 999002099
const INICIO = "2099-07-01"
const FIM = "2099-07-20"
const CORTE = "2099-07-12"

const ctx = contextoDataServer(COLIGADA)
const iso = (v: unknown) => String(v).slice(0, 10)

async function estadoNoRm(): Promise<string[]> {
  const linhas = await lancamentosDoItem(ITEM)
  const out: string[] = []
  for (const l of linhas) {
    if (!l.codigo) { out.push(`  ${l.estado.padEnd(9)} (sem codigo) ${iso(l.data_inicio)}..${iso(l.data_fim)}`); continue }
    const pk = l.pk_rm ?? pkConvocacaoRm({ coligada: l.coligada, chapa: l.chapa, codConvocacao: l.codigo })
    const vivo = await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pk, ctx)
    out.push(
      `  ${l.estado.padEnd(9)} ${l.codigo} ${iso(l.data_inicio)}..${iso(l.data_fim)} ` +
        `[${l.contrato ?? "-"}] RM:${vivo ? "PRESENTE" : "ausente"}`,
    )
  }
  return out
}

async function limpar() {
  const linhas = await lancamentosDoItem(ITEM)
  for (const l of linhas) {
    if (l.codigo) {
      const pk = l.pk_rm ?? pkConvocacaoRm({ coligada: l.coligada, chapa: l.chapa, codConvocacao: l.codigo })
      // Ordem obrigatória: apaga no RM ANTES de sumir com a linha. Invertido, o C03S###### fica
      // órfão no RM sem ninguém que saiba que ele existe.
      if (await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pk, ctx)) {
        try {
          await deleteRecordByKeyDireto(RM_DATA_SERVER_CONVOCACAO, pk, ctx, 20000)
          console.log(`[limpeza] apagado no RM: ${pk}`)
        } catch (e) {
          console.log(`[limpeza] ⚠️ FALHOU apagar ${pk} — APAGAR NA MÃO: ${(e as Error).message}`)
        }
      }
    }
    await query(`DELETE FROM efeitos_externos WHERE chave LIKE $1`, [`%${l.id}%`])
  }
  await query(`UPDATE convocacoes_rm SET origem_lancamento_id=NULL WHERE item_origem_id=$1`, [ITEM])
  await query(`DELETE FROM convocacoes_rm WHERE item_origem_id=$1`, [ITEM])
  console.log("[limpeza] rastro e ledger limpos")
}

async function main() {
  const chapa = (process.argv[2] ?? "").trim()
  if (!chapa || !process.argv.includes("--confirmar")) {
    console.log("uso: npm run rm:teste-bifurcacao -- <chapa> --confirmar")
    process.exit(1)
  }
  if (!temRmSoap()) throw new Error("RM_DIRETO_* nao configurado")

  let falhou = false
  try {
    await limpar() // resíduo de execução anterior

    console.log(`\n=== 1) grava ${INICIO}..${FIM} (chapa ${chapa}) ===`)
    const g = await gravarConvocacaoRm({
      itemOrigemId: ITEM, chapa, contrato: "TESTE BIFURCACAO",
      dataInicio: INICIO, dataFim: FIM, origemAcao: "teste_bifurcacao",
    })
    console.log(`  estado=${g.estado} codigo=${g.codConvocacao ?? "-"} ${g.erro ?? ""}`)
    if (g.estado !== "gravado") throw new Error(`nao gravou: ${g.estado} ${g.erro ?? ""}`)
    console.log((await estadoNoRm()).join("\n"))

    console.log(`\n=== 2) bifurca no corte ${CORTE} ===`)
    const b = await bifurcarConvocacoesDoItem(ITEM, {
      corte: CORTE, contratoParte1: "PARTE 1", contratoParte2: "PARTE 2", operador: "teste",
    })
    console.log(`  remocoes=${b.remocoes.map((r) => r.estado).join(",") || "-"}`)
    console.log(`  gravacoes=${b.gravacoes.map((x) => `${x.estado}:${x.codConvocacao ?? "-"}`).join(",") || "-"}`)
    console.log(`  intactos=${b.intactos.length} pendencia=${b.temPendencia} nota=${b.nota ?? "-"}`)
    // `nota` sem print custou uma execução inteira: com a flag desligada o serviço volta
    // "desligado" e não faz nada, o que num relatório sem esse campo é idêntico a "não achou o
    // que partir". Aqui é falha, não observação — o teste existe pra exercitar o caminho real.
    if (b.nota === "desligado") throw new Error("flag desligada: rode com CONVOCACAO_RM_HABILITADA=1")
    console.log((await estadoNoRm()).join("\n"))

    const vivosPos = await lancamentosDoItem(ITEM, { apenasVivos: true })
    if (vivosPos.length !== 2) { falhou = true; console.log(`  ✖ esperava 2 vivos, tem ${vivosPos.length}`) }
    else console.log("  ✔ dois registros vivos")

    console.log(`\n=== 3) reverte ===`)
    const r = await reverterBifurcacaoDoItem(ITEM, { operador: "teste" })
    console.log(`  remocoes=${r.remocoes.map((x) => x.estado).join(",") || "-"}`)
    console.log(`  gravacoes=${r.gravacoes.map((x) => `${x.estado}:${x.codConvocacao ?? "-"}`).join(",") || "-"}`)
    console.log(`  nota=${r.nota ?? "-"} pendencia=${r.temPendencia}`)
    console.log((await estadoNoRm()).join("\n"))

    const vivosFim = await lancamentosDoItem(ITEM, { apenasVivos: true })
    if (vivosFim.length !== 1) { falhou = true; console.log(`  ✖ esperava 1 vivo, tem ${vivosFim.length}`) }
    else if (iso(vivosFim[0]!.data_inicio) !== INICIO || iso(vivosFim[0]!.data_fim) !== FIM) {
      falhou = true
      console.log(`  ✖ periodo restaurado errado: ${iso(vivosFim[0]!.data_inicio)}..${iso(vivosFim[0]!.data_fim)}`)
    } else console.log(`  ✔ voltou pra um: ${INICIO}..${FIM}`)
  } finally {
    console.log("\n=== limpeza ===")
    await limpar().catch((e) => console.log("[limpeza] ⚠️ falhou:", (e as Error).message))
    await pool.end()
  }
  console.log(falhou ? "\nRESULTADO: ✖ com falhas" : "\nRESULTADO: ✔ tudo certo")
  process.exit(falhou ? 1 : 0)
}

main().catch((e) => {
  console.error("[teste-bifurcacao] falhou:", e)
  process.exit(1)
})
