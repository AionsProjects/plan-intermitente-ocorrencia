// Teste de PARIDADE do mensal: executa o código REAL dos Code nodes do n8n
// (extraído do WF krRj3mXCM3F1CCYN) offline, alimentado pelos mesmos boards Monday,
// e diffa contra o nosso pipeline (calcularPreviaMensal + builders).
// READ-ONLY: nenhuma escrita em Monday/Caju/RM/Drive. Nada é gravado no Postgres.
//
// Uso:
//   npx tsx --env-file=.env src/scripts/paridade-mensal.ts <caminho n8n_nodes_paridade.json>
// O JSON dos nós NÃO é versionado (contém trechos do WF; extraia via API n8n).
import { readFileSync } from "node:fs"
import { config } from "../config.js"
import { calcularPreviaMensal } from "../mensal/previa.js"
import { montarValuesPlanUpdate, montarValuesDesconto, montarValuesSolicitacao } from "../mensal/mondayEfeitos.js"
import { montarPedidoCaju, type PessoaPedidoCaju } from "../clients/caju.js"

const BACKEND = "http://127.0.0.1:3000"
const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100
const norm = (v: unknown): string => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

interface NodeShim { first(): { json: Record<string, unknown> } }
type DollarFn = (nome: string) => NodeShim
const shim = (json: unknown): NodeShim => ({ first: () => ({ json: json as Record<string, unknown> }) })

function rodarCodeNode(codigo: string, ctx: {
  $?: Record<string, unknown>
  $input?: unknown
  $vars?: Record<string, unknown>
  sd?: Record<string, unknown>
}): unknown {
  const dollar: DollarFn = (nome) => {
    if (!ctx.$ || !(nome in ctx.$)) throw new Error(`shim ausente: $('${nome}')`)
    return shim(ctx.$[nome])
  }
  const fn = new Function("$", "$input", "$vars", "$getWorkflowStaticData", "Buffer", codigo) as (
    d: DollarFn, i: NodeShim, v: Record<string, unknown>, g: () => Record<string, unknown>, b: typeof Buffer,
  ) => unknown
  return fn(dollar, shim(ctx.$input ?? {}), ctx.$vars ?? {}, () => ctx.sd ?? {}, Buffer)
}

const json1 = (r: unknown): Record<string, unknown> => (r as Array<{ json: Record<string, unknown> }>)[0]!.json

function parseAliases(query: string | null): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  if (!query) return out
  const re = /change_multiple_column_values\(board_id: \d+, item_id: (\d+), column_values: ("(?:\\.|[^"\\])*")/g
  for (const m of query.matchAll(re)) out.set(m[1]!, JSON.parse(JSON.parse(m[2]!)) as Record<string, unknown>)
  return out
}

const divergencias: string[] = []
let comparacoes = 0
function cmp(rotulo: string, legado: unknown, nosso: unknown): void {
  comparacoes++
  const a = JSON.stringify(legado), b = JSON.stringify(nosso)
  if (a !== b) divergencias.push(`${rotulo}\n  legado: ${a}\n  nosso : ${b}`)
}

async function main(): Promise<void> {
  const nodesPath = process.argv[2]
  if (!nodesPath) throw new Error("uso: paridade-mensal.ts <n8n_nodes_paridade.json>")
  const nodes = JSON.parse(readFileSync(nodesPath, "utf8")) as Record<string, string>

  // --- Lado LEGADO: mesmos resolvers + mesma query GraphQL do WF -------------
  const resolverNovo = await (await fetch(`${BACKEND}/api/boards/resolver?papel=atual`)).json()
  const resolverLegado = await (await fetch(`${BACKEND}/api/boards/resolver?board_id=18408773953`)).json()
  const gate = { devePassar: true, papel: "atual", anoCompAlvo: 2026, mesCompAlvo: 7, competenciaIso: "2026-07", competenciaAlvo: "2026-07", competenciaLabel: "JULHO" }
  const buildOut = json1(rodarCodeNode(nodes["Mensal Build Query Agrupado"]!, {
    $: { "Code Gate": gate, "Resolver Board": resolverNovo },
  }))
  const gql = await (await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: config.mondayToken },
    body: JSON.stringify({ query: buildOut.query }),
  })).json() as { data?: { solicit?: Array<{ items_page?: { items: unknown[] } }> } }
  // Neutraliza a antifraude do LEGADO (contrato_ja_solicitado) — o objetivo aqui é
  // comparar o CÁLCULO; o bloqueio por competência já processada é testado à parte.
  const solicitLegado = gql.data?.solicit?.[0]
  if (solicitLegado?.items_page) solicitLegado.items_page.items = []
  const legado = json1(rodarCodeNode(nodes["Mensal Preparar Contexto Agrupado"]!, {
    $: {
      "Resolver Board": resolverNovo,
      "Resolver Board Legado": resolverLegado,
      "Mensal Build Query Agrupado": buildOut,
    },
    $input: gql,
  })) as {
    contratos: Array<Record<string, unknown> & {
      contrato: string
      pessoas: Array<Record<string, number | string>>
      totais: { vr: number; vt: number; credito: number; pix: number }
    }>
    queryUpdatePlan: string | null
    queryUpdateDescontos: string | null
    groupIdSolicitacao: string
  }

  // --- Lado NOSSO: pipeline real de produção --------------------------------
  const snapshot = await calcularPreviaMensal("atual")

  console.log(`\n=== PARIDADE MENSAL ${snapshot.competencia} ===`)
  console.log(`legado: ${legado.contratos.length} contratos | nosso: ${snapshot.contratos.length} contratos`)

  // 1) Totais + pessoas por contrato
  for (const lc of legado.contratos) {
    const nc = snapshot.contratos.find((c) => norm(c.contrato) === norm(lc.contrato))
    if (!nc) { divergencias.push(`contrato ${lc.contrato}: existe no legado, ausente no nosso`); continue }
    cmp(`${lc.contrato} · totais`, lc.totais, nc.totais)
    cmp(`${lc.contrato} · n pessoas`, lc.pessoas.length, nc.pessoas.length)
    for (const lp of lc.pessoas) {
      const np = nc.pessoas.find((p) => (p.cpf || p.chapa) === lp.key || p.chapa === lp.chapa)
      if (!np) { divergencias.push(`${lc.contrato} · pessoa chapa ${lp.chapa}: ausente no nosso`); continue }
      cmp(`${lc.contrato} · ${lp.chapa} · valores`, {
        bVR: r2(Number(lp.brutoVR)), bVT: r2(Number(lp.brutoVT)),
        dVR: r2(Number(lp.descontoAplicadoVR)), dVT: r2(Number(lp.descontoAplicadoVT)),
        lVR: r2(Number(lp.liquidoVR)), lVT: r2(Number(lp.liquidoVT)),
        cVR: r2(Number(lp.creditoVR)), cVT: r2(Number(lp.creditoVT)),
        pVR: r2(Number(lp.pixVR)), pVT: r2(Number(lp.pixVT)),
      }, {
        bVR: np.brutoVR, bVT: np.brutoVT, dVR: np.descontoVR, dVT: np.descontoVT,
        lVR: np.liquidoVR, lVT: np.liquidoVT, cVR: np.creditoVR, cVT: np.creditoVT,
        pVR: np.pixVR, pVT: np.pixVT,
      })
    }
  }
  for (const nc of snapshot.contratos) {
    if (!legado.contratos.find((c) => norm(c.contrato) === norm(nc.contrato))) {
      divergencias.push(`contrato ${nc.contrato}: existe no nosso, ausente no legado`)
    }
  }

  // 2) planUpdates (item -> colunas/valores)
  const planLegado = parseAliases(legado.queryUpdatePlan)
  const planNosso = new Map<string, Record<string, unknown>>()
  for (const c of snapshot.contratos) {
    for (const u of c.planUpdates ?? []) planNosso.set(u.itemId, montarValuesPlanUpdate(u, snapshot.apoio.colunasPlano))
  }
  cmp("planUpdates · qtd itens", planLegado.size, planNosso.size)
  for (const [itemId, valsLegado] of planLegado) {
    const valsNosso = planNosso.get(itemId)
    if (!valsNosso) { divergencias.push(`planUpdate item ${itemId}: ausente no nosso`); continue }
    cmp(`planUpdate ${itemId}`, valsLegado, valsNosso)
  }

  // 3) descontoUpdates
  const descLegado = parseAliases(legado.queryUpdateDescontos)
  const descNosso = new Map<string, Record<string, unknown>>()
  for (const c of snapshot.contratos) {
    for (const u of c.descontoUpdates ?? []) descNosso.set(u.id, montarValuesDesconto(u))
  }
  cmp("descontoUpdates · qtd itens", descLegado.size, descNosso.size)
  for (const [id, valsLegado] of descLegado) {
    const valsNosso = descNosso.get(id)
    if (!valsNosso) { divergencias.push(`descontoUpdate ${id}: ausente no nosso`); continue }
    cmp(`descontoUpdate ${id}`, valsLegado, valsNosso)
  }

  // 4) Payloads Caju (crédito + boleto) por contrato — employeeIds fictícios iguais dos 2 lados
  for (const lc of legado.contratos) {
    const nc = snapshot.contratos.find((c) => norm(c.contrato) === norm(lc.contrato))
    if (!nc) continue
    const cajuIds: Record<string, string> = {}
    for (const p of lc.pessoas) cajuIds[`${lc.contratoN}|${p.key}`] = `EID-${p.key}`
    const sd = { mensalContratoAtual: { ...lc, mesComp: 7, anoComp: 2026 }, cajuIds }
    const pessoasNossas: PessoaPedidoCaju[] = nc.pessoas.map((p) => ({
      employeeId: `EID-${p.cpf || p.chapa}`, contrato: p.contrato, interior: p.interior,
      creditoVR: p.creditoVR, creditoVT: p.creditoVT, pixVR: p.pixVR, pixVT: p.pixVT,
    }))
    for (const [nodeName, tipo] of [["Mensal Montar Pedido CREDITO", "credito"], ["Mensal Montar Pedido BOLETO", "boleto"]] as const) {
      const lp = json1(rodarCodeNode(nodes[nodeName]!, { sd })) as { payload: unknown; confirmPayload: unknown; totalCentavos: number }
      const np = montarPedidoCaju(pessoasNossas, tipo, nc.contrato, 7, 2026)
      cmp(`${lc.contrato} · caju ${tipo} · payload`, lp.payload, np.payload)
      cmp(`${lc.contrato} · caju ${tipo} · confirm`, lp.confirmPayload, np.confirmPayload)
    }
  }

  // 5) Solicitação (column_values) — refs idênticas dos 2 lados
  for (const lc of legado.contratos) {
    const nc = snapshot.contratos.find((c) => norm(c.contrato) === norm(lc.contrato))
    if (!nc) continue
    const refs = { idVR: "111", idVT: "222", pedidoCreditoId: "ord-c", pedidoPixId: "ord-p", summaryCredito: "sc", summaryPix: "sp" }
    const sd = {}
    const lp = json1(rodarCodeNode(nodes["Mensal Preparar Solicitação"]!, {
      $: { "Mensal Acumular Resultado": { idVR: refs.idVR, idVT: refs.idVT } },
      sd: { mensalContratoAtual: { ...lc, mesComp: 7, anoComp: 2026, competenciaLabel: "JULHO", groupIdSolicitacao: legado.groupIdSolicitacao, pedidoCreditoId: refs.pedidoCreditoId, pedidoPixId: refs.pedidoPixId, summaryCredito: refs.summaryCredito, summaryPix: refs.summaryPix } },
      ...(sd && {}),
    })) as { column_values_json: string }
    const nossoValues = montarValuesSolicitacao({
      contrato: nc.contrato, competenciaLabel: "JULHO", anoComp: 2026,
      totais: { vr: nc.totais.vr ?? 0, vt: nc.totais.vt ?? 0, credito: nc.totais.credito ?? 0, pix: nc.totais.pix ?? 0 },
      pessoas: nc.pessoas, idVR: refs.idVR, idVT: refs.idVT,
      pedidoCreditoId: refs.pedidoCreditoId, pedidoPixId: refs.pedidoPixId,
      summaryCredito: refs.summaryCredito, summaryPix: refs.summaryPix,
      planBoardId: "18408773953", dataIso: new Date().toISOString().slice(0, 10),
    })
    const legadoValues = JSON.parse(lp.column_values_json) as Record<string, unknown>
    // resumo (long_text) comparado à parte — formatação de itens_plan difere só se itemIds divergirem
    const { long_text_mkre1qa0: lvResumo, ...lvResto } = legadoValues
    const { long_text_mkre1qa0: nvResumo, ...nvResto } = nossoValues as Record<string, unknown>
    cmp(`${lc.contrato} · solicitacao · values`, lvResto, nvResto)
    cmp(`${lc.contrato} · solicitacao · resumo`, lvResumo, nvResumo)
  }

  // --- Relatório -------------------------------------------------------------
  console.log(`\ncomparações: ${comparacoes} | divergências: ${divergencias.length}`)
  if (divergencias.length) {
    console.log("\n### DIVERGÊNCIAS ###")
    for (const d of divergencias) console.log("\n" + d)
    process.exitCode = 1
  } else {
    console.log("PARIDADE OK — nenhum campo divergente.")
  }
}

main().catch((e) => {
  console.error("ERRO:", (e as Error).message, (e as Error & { cause?: unknown }).cause ?? "")
  console.error((e as Error).stack)
  process.exit(2)
})
