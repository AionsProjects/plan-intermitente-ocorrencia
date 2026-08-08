/**
 * Cria (ou só confere) o webhook do Monday que dispara a convocação no RM. **ESCREVE NO MONDAY.**
 *
 *   npm run monday:webhook-convocacao-rm                 # confere: lista o que existe, não cria
 *   npm run monday:webhook-convocacao-rm -- --confirmar   # cria se faltar
 *   npm run monday:webhook-convocacao-rm -- --board 18418191275 --confirmar
 *
 * Dispara em `change_specific_column_value` da coluna `Lançar no RM` do board Entrada.
 *
 * O Monday faz handshake `challenge` NA CRIAÇÃO: se a URL não responder `{challenge}`, o
 * `create_webhook` falha. Por isso o script checa o endpoint antes — erro de deploy aqui aparece
 * como "erro do Monday" e custa tempo pra entender.
 *
 * Idempotente: webhook cujo `config` já aponta pra mesma coluna não é recriado (webhook duplicado
 * = o lote do contrato dispararia duas vezes; a idempotência do ledger seguraria, mas o relatório
 * viria dobrado e ninguém entenderia).
 */
import { config } from "../config.js"
import { pool } from "../db.js"
import { boardPorPapel } from "../repo/boards.js"
import { criarWebhook, lerColunas, listarWebhooks } from "../monday.js"

const COL_GATILHO = "Lançar no RM"
const CAMINHO = "/api/monday/convocacao-rm"

const aplicar = process.argv.includes("--confirmar")
const boardArg = (() => {
  const i = process.argv.indexOf("--board")
  return i > 0 ? process.argv[i + 1] : undefined
})()

/** Prova que a URL responde o handshake ANTES de pedir o webhook ao Monday. */
async function endpointResponde(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge: "provisionamento" }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) {
      console.log(`  endpoint respondeu HTTP ${r.status}`)
      return false
    }
    const j = (await r.json()) as { challenge?: string }
    return j?.challenge === "provisionamento"
  } catch (e) {
    console.log(`  endpoint inacessível: ${(e as Error).message}`)
    return false
  }
}

async function main(): Promise<void> {
  const board = boardArg ?? String((await boardPorPapel("atual")) ?? "")
  if (!board) throw new Error("board não resolvido (registry sem papel=atual e sem --board)")
  const url = config.publicBaseUrl.replace(/\/$/, "") + CAMINHO

  const colunas = await lerColunas(board)
  const col = colunas.find((c) => c.title === COL_GATILHO)
  if (!col) throw new Error(`coluna "${COL_GATILHO}" não existe no board ${board} — rode monday:provisionar-convocacao-rm`)

  console.log(`board ${board} | coluna ${COL_GATILHO} (${col.id})`)
  console.log(`url   ${url}`)

  const existentes = await listarWebhooks(board)
  console.log(`\nwebhooks no board: ${existentes.length}`)
  for (const w of existentes) console.log(`  ${w.id}  config=${w.config ?? "(sem config)"}`)

  const jaTem = existentes.find((w) => (w.config ?? "").includes(col.id))
  if (jaTem) {
    console.log(`\n✔ já existe webhook nessa coluna (id ${jaTem.id}) — nada a fazer`)
    return
  }

  console.log("\nconferindo o handshake do endpoint:")
  const ok = await endpointResponde(url)
  if (!ok) {
    console.log(
      "\n✖ o endpoint NÃO devolveu o challenge. O create_webhook falharia.\n" +
        "  Deploy ainda não saiu, ou o path está errado. Nada foi criado.",
    )
    process.exitCode = 1
    return
  }
  console.log("  ✔ challenge devolvido")

  if (!aplicar) {
    console.log("\n→ criaria o webhook agora. Rode com --confirmar pra aplicar.")
    return
  }
  const novo = await criarWebhook(board, url, col.id)
  console.log(`\n＋ webhook criado: id ${novo.id} (board ${novo.board_id})`)
  console.log(
    "Lembrete: CONVOCACAO_RM_HABILITADA=0 => o gatilho responde 200 'ignorado'. " +
      "Com a flag off o webhook é inofensivo.",
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
