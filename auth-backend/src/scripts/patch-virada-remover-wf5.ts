/**
 * CUTOVER DO PONTUAL — remove da Virada de Board o nó que ressuscita o WF5.
 *
 *   npm run patch:virada            # dry-run: mostra o que faria
 *   npm run patch:virada -- --confirmar
 *
 * ## Por que
 *
 * A virada (`gm2Ie8pbR2rOK5id`, cron dia 14 às 17h) duplica o board central. Webhook de API
 * do Monday NÃO é copiado na duplicação, então o WF recria os três na cópia. Um deles é:
 *
 *     create_webhook(board_id: <cópia>, url: ".../webhook/intermitentes/pontual", event: create_item)
 *
 * ...que é o gatilho do WF5 Pontual FIFO — o pagador que a felipeta substituiu. Enquanto esse
 * nó existir, a próxima virada faz o board novo pagar no NASCIMENTO do item outra vez, em
 * paralelo com a felipeta. Os dois consomem a mesma dívida: a fase 1 reserva no Postgres e o
 * WF5 decrementa o board, e o fechamento mensal passa a abater menos do que devia, calado.
 *
 * O webhook da FELIPETA não precisa de nó aqui: o `Salvar registry (virada)` já chama
 * `POST /api/boards/virada`, e essa rota registra as colunas da cópia e garante o webhook de
 * `OP - Compareceu?` (boards.ts → garantirWebhookComparecimento). Ciclo de vida no backend.
 *
 * ## O que o patch faz
 *
 * 1. backup do workflow inteiro em `docs/n8n/backups/`;
 * 2. remove o nó `Criar webhook create_item na copia`;
 * 3. religa a cadeia: `Criar webhook ativar na copia` → `Eventos do monitor`
 *    (era `ativar → create_item → monitor`);
 * 4. relê do banco e confirma: nó ausente, cadeia religada, 24 nós.
 *
 * NÃO desativa o WF5 nem apaga o webhook `597057041` do board atual — são passos separados
 * do cutover, com decisão própria.
 */
import fs from "node:fs"
import path from "node:path"
import { pool } from "../db.js"

const WF_VIRADA = "gm2Ie8pbR2rOK5id"
const NO_ALVO = "Criar webhook create_item na copia"
const NO_ANTES = "Criar webhook ativar na copia"
const NO_DEPOIS = "Eventos do monitor"
const CONFIRMAR = process.argv.includes("--confirmar")

interface NoN8n { name: string; [k: string]: unknown }
type Conexoes = Record<string, { main?: Array<Array<{ node: string; type: string; index: number }> | null> }>

async function main(): Promise<void> {
  const c = await pool.connect()
  try {
    const { rows } = await c.query<{ name: string; active: boolean; nodes: unknown; connections: unknown }>(
      `SELECT name, active, nodes, connections FROM nocturnalgoose.workflow_entity WHERE id = $1`,
      [WF_VIRADA],
    )
    if (!rows.length) throw new Error("workflow_da_virada_nao_encontrado")
    const wf = rows[0]!
    const nodes: NoN8n[] = typeof wf.nodes === "string" ? JSON.parse(wf.nodes) : (wf.nodes as NoN8n[])
    const conns: Conexoes = typeof wf.connections === "string" ? JSON.parse(wf.connections) : (wf.connections as Conexoes)

    console.log(`workflow: ${wf.name}  (active=${wf.active})`)
    console.log(`nós antes: ${nodes.length}`)

    const alvo = nodes.find((n) => n.name === NO_ALVO)
    if (!alvo) {
      console.log(`\n✅ o nó "${NO_ALVO}" já não existe — patch já aplicado, nada a fazer.`)
      return
    }
    // Sanidade da cadeia: só religa se ela for exatamente a esperada. Topologia diferente =
    // alguém editou o WF; abortar é melhor que adivinhar (o passo seguinte é o pagamento).
    const saidaAntes = (conns[NO_ANTES]?.main?.[0] ?? []).filter(Boolean).map((x) => x!.node)
    const saidaAlvo = (conns[NO_ALVO]?.main?.[0] ?? []).filter(Boolean).map((x) => x!.node)
    if (saidaAntes.length !== 1 || saidaAntes[0] !== NO_ALVO) {
      throw new Error(`cadeia inesperada: "${NO_ANTES}" -> ${JSON.stringify(saidaAntes)} (esperado ["${NO_ALVO}"])`)
    }
    if (saidaAlvo.length !== 1 || saidaAlvo[0] !== NO_DEPOIS) {
      throw new Error(`cadeia inesperada: "${NO_ALVO}" -> ${JSON.stringify(saidaAlvo)} (esperado ["${NO_DEPOIS}"])`)
    }

    console.log(`\n--- o que sai ---`)
    console.log(`  nó   : ${NO_ALVO}`)
    console.log(`  faz  : create_webhook(event: create_item) -> .../webhook/intermitentes/pontual  [WF5]`)
    console.log(`--- religação ---`)
    console.log(`  antes: ${NO_ANTES} -> ${NO_ALVO} -> ${NO_DEPOIS}`)
    console.log(`  depois: ${NO_ANTES} -> ${NO_DEPOIS}`)

    if (!CONFIRMAR) {
      console.log(`\n(dry-run — nada gravado. Repita com --confirmar.)`)
      return
    }

    // 1) backup
    const dir = path.resolve("../docs/n8n/backups")
    fs.mkdirSync(dir, { recursive: true })
    const arq = path.join(dir, `virada-${WF_VIRADA}-antes-remover-wf5.json`)
    fs.writeFileSync(arq, JSON.stringify({ name: wf.name, active: wf.active, nodes, connections: conns }, null, 1))
    console.log(`\nbackup: ${arq}`)

    // 2/3) remove o nó e religa
    const nodesNovos = nodes.filter((n) => n.name !== NO_ALVO)
    const connsNovas: Conexoes = JSON.parse(JSON.stringify(conns))
    delete connsNovas[NO_ALVO]
    connsNovas[NO_ANTES] = { main: [[{ node: NO_DEPOIS, type: "main", index: 0 }]] }

    await c.query(
      `UPDATE nocturnalgoose.workflow_entity SET nodes = $2, connections = $3, "updatedAt" = now() WHERE id = $1`,
      [WF_VIRADA, JSON.stringify(nodesNovos), JSON.stringify(connsNovas)],
    )
    console.log(`gravado: ${nodesNovos.length} nós (era ${nodes.length})`)

    // 4) prova por releitura
    const dep = await c.query<{ nodes: unknown; connections: unknown }>(
      `SELECT nodes, connections FROM nocturnalgoose.workflow_entity WHERE id = $1`,
      [WF_VIRADA],
    )
    const nd: NoN8n[] = typeof dep.rows[0]!.nodes === "string" ? JSON.parse(dep.rows[0]!.nodes as string) : (dep.rows[0]!.nodes as NoN8n[])
    const cn: Conexoes = typeof dep.rows[0]!.connections === "string" ? JSON.parse(dep.rows[0]!.connections as string) : (dep.rows[0]!.connections as Conexoes)
    const sumiu = !nd.some((n) => n.name === NO_ALVO)
    const religado = (cn[NO_ANTES]?.main?.[0] ?? []).some((x) => x?.node === NO_DEPOIS)
    const semRestos = !JSON.stringify(cn).includes(NO_ALVO)
    const semWf5 = !JSON.stringify(nd).includes("intermitentes/pontual")
    console.log(`\n${sumiu ? "✅" : "❌"} nó removido`)
    console.log(`${religado ? "✅" : "❌"} ${NO_ANTES} -> ${NO_DEPOIS}`)
    console.log(`${semRestos ? "✅" : "❌"} nenhuma conexão órfã citando o nó`)
    console.log(`${semWf5 ? "✅" : "❌"} nenhuma referência restante a /webhook/intermitentes/pontual`)
    if (!(sumiu && religado && semRestos && semWf5)) process.exitCode = 1
    console.log(
      `\n⚠️ O n8n só relê o workflow no boot/ativação. Desative e reative a Virada no painel ` +
        `para o patch valer na execução de hoje 17h.`,
    )
  } finally {
    c.release()
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
