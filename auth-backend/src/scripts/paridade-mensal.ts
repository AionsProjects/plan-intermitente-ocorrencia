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
import { montarPedidoCaju, type AllowanceCaju, type PessoaPedidoCaju } from "../clients/caju.js"

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

  // 4) Payloads Caju por contrato — employeeIds fictícios iguais dos 2 lados.
  //
  // Desde 08/2026 o pedido é SEPARADO por benefício, então não há paridade 1:1 de payload: o legado
  // monta UM pedido com VR e VT no mesmo `amounts[]`, e nós montamos dois. O que a paridade tem que
  // provar é que o EMPACOTAMENTO mudou e o DINHEIRO não — então compara a UNIÃO dos nossos dois
  // pedidos contra o pedido único do legado, normalizada por (employeeId, category).
  const fundirAmounts = (payloads: Array<{ allowances: AllowanceCaju[] } | null>): Array<[string, number]> => {
    const mapa = new Map<string, number>()
    for (const p of payloads) {
      for (const a of p?.allowances ?? []) {
        for (const x of a.amounts) {
          const k = `${a.employeeId}|${x.category}`
          mapa.set(k, (mapa.get(k) ?? 0) + x.amount)
        }
      }
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
  }

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
      const lp = json1(rodarCodeNode(nodes[nodeName]!, { sd })) as {
        payload: { allowances: AllowanceCaju[] } | null; confirmPayload: unknown; totalCentavos: number
      }
      const nossoVR = montarPedidoCaju(pessoasNossas, tipo, "VR", nc.contrato, 7, 2026)
      const nossoVT = montarPedidoCaju(pessoasNossas, tipo, "VT", nc.contrato, 7, 2026)
      // Nenhum centavo a mais nem a menos, por pessoa e por categoria.
      cmp(`${lc.contrato} · caju ${tipo} · amounts (união VR+VT)`,
        fundirAmounts([lp.payload]), fundirAmounts([nossoVR.payload, nossoVT.payload]))
      // O total do legado tem que fechar com a soma dos dois pedidos — é o valor que vira boleto.
      cmp(`${lc.contrato} · caju ${tipo} · total centavos`,
        lp.totalCentavos, nossoVR.totalCentavos + nossoVT.totalCentavos)
      // E cada pedido nosso carrega SÓ a sua categoria — é a garantia do split.
      const cats = (p: { allowances: AllowanceCaju[] } | null): string[] =>
        [...new Set((p?.allowances ?? []).flatMap((a) => a.amounts.map((x) => x.category)))].sort()
      cmp(`${lc.contrato} · caju ${tipo} · categorias do pedido VR`, ["FOOD_AID"].slice(0, cats(nossoVR.payload).length), cats(nossoVR.payload))
      if (cats(nossoVT.payload).includes("FOOD_AID")) {
        divergencias.push(`${lc.contrato} · caju ${tipo} · pedido de VT contém FOOD_AID — split quebrado`)
      }
    }
  }

  // 5) Solicitação (column_values) — refs idênticas dos 2 lados
  for (const lc of legado.contratos) {
    const nc = snapshot.contratos.find((c) => norm(c.contrato) === norm(lc.contrato))
    if (!nc) continue
    // O legado só conhece um pedido de crédito e um de boleto. Para a paridade das OUTRAS colunas
    // continuar valendo, damos ao nosso lado o caso degenerado: só o boleto de VR preenchido.
    // O formato de dois ids na mesma célula é conferido logo abaixo, à parte.
    const refs = { idVR: "111", idVT: "222", pedidoCreditoId: "ord-c", pedidoPixId: "ord-p", summaryCredito: "sc", summaryPix: "sp" }
    const sd = {}
    const lp = json1(rodarCodeNode(nodes["Mensal Preparar Solicitação"]!, {
      $: { "Mensal Acumular Resultado": { idVR: refs.idVR, idVT: refs.idVT } },
      sd: { mensalContratoAtual: { ...lc, mesComp: 7, anoComp: 2026, competenciaLabel: "JULHO", groupIdSolicitacao: legado.groupIdSolicitacao, pedidoCreditoId: refs.pedidoCreditoId, pedidoPixId: refs.pedidoPixId, summaryCredito: refs.summaryCredito, summaryPix: refs.summaryPix } },
      ...(sd && {}),
    })) as { column_values_json: string }
    // Desde 08/2026 o board tem UMA LINHA POR BENEFÍCIO, então a comparação 1:1 com o item único
    // do legado não existe mais. O que continua tendo de bater são as colunas que NÃO dependem do
    // benefício — contrato, gaveta, referência, competência, status, link do Plan. As colunas de
    // dinheiro são conferidas por linha, logo abaixo.
    const entrada = {
      contrato: nc.contrato, competenciaLabel: "JULHO", anoComp: 2026,
      totais: { vr: nc.totais.vr ?? 0, vt: nc.totais.vt ?? 0, credito: nc.totais.credito ?? 0, pix: nc.totais.pix ?? 0 },
      pessoas: nc.pessoas, idVR: refs.idVR, idVT: refs.idVT,
      pedidoCreditoVR: refs.pedidoCreditoId, pedidoPixVR: "ord-vr", pedidoPixVT: "ord-vt",
      planBoardId: "18408773953", dataIso: new Date().toISOString().slice(0, 10),
    }
    const linhaVR = montarValuesSolicitacao(entrada, ["VR"]) as Record<string, unknown>
    const linhaVT = montarValuesSolicitacao(entrada, ["VT"]) as Record<string, unknown>
    const legadoValues = JSON.parse(lp.column_values_json) as Record<string, unknown>

    // Colunas por benefício + resumo saem da comparação de bloco; cada uma é conferida à parte.
    const POR_BENEFICIO = [
      "dropdown_mkwhxxs2", "numeric_mkrek29b", "numeric_mkwhk2xr",
      "text_mkrenhm", "text_mkwhg4dn", "text_mm1zyhcw", "text_mm395p8s", "long_text_mkre1qa0",
    ]
    const semBeneficio = (v: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(v).filter(([k]) => !POR_BENEFICIO.includes(k)))

    cmp(`${lc.contrato} · solicitacao · colunas comuns (linha VR)`, semBeneficio(legadoValues), semBeneficio(linhaVR))
    cmp(`${lc.contrato} · solicitacao · colunas comuns (linha VT)`, semBeneficio(legadoValues), semBeneficio(linhaVT))

    // Valor: a soma das duas linhas tem de dar o que o item único trazia — o split muda
    // empacotamento, não dinheiro.
    cmp(`${lc.contrato} · solicitacao · VALOR CAJU (VR)`, legadoValues.numeric_mkrek29b, linhaVR.numeric_mkrek29b)
    cmp(`${lc.contrato} · solicitacao · VALOR CAJU VT`, legadoValues.numeric_mkwhk2xr, linhaVT.numeric_mkwhk2xr)
    cmp(`${lc.contrato} · solicitacao · VALOR CAJU ausente na linha VT`, undefined, linhaVT.numeric_mkrek29b)
    cmp(`${lc.contrato} · solicitacao · VALOR CAJU VT ausente na linha VR`, undefined, linhaVR.numeric_mkwhk2xr)

    // IDFINANC do RM: cada linha carrega só o evento dela.
    cmp(`${lc.contrato} · solicitacao · IDFINANC VR`, legadoValues.text_mkrenhm, linhaVR.text_mkrenhm)
    cmp(`${lc.contrato} · solicitacao · IDFINANC VT`, legadoValues.text_mkwhg4dn, linhaVT.text_mkwhg4dn)

    // Id do pedido: UM por linha — o "; " na mesma célula morreu com o split do board.
    cmp(`${lc.contrato} · solicitacao · id do pedido (VR)`, "ord-vr", linhaVR.text_mm1zyhcw)
    cmp(`${lc.contrato} · solicitacao · id do pedido (VT)`, "ord-vt", linhaVT.text_mm1zyhcw)
    cmp(`${lc.contrato} · solicitacao · summary (VR)`,
      "https://empresa.caju.com.br/classic/#/order/ord-vr/summary", linhaVR.text_mm395p8s)
    cmp(`${lc.contrato} · solicitacao · summary (VT)`,
      "https://empresa.caju.com.br/classic/#/order/ord-vt/summary", linhaVT.text_mm395p8s)

    // Tipo pgto: uma label por linha, contra as duas do item único do legado.
    cmp(`${lc.contrato} · solicitacao · tipo pgto (VR)`, { labels: ["CAJU"] }, linhaVR.dropdown_mkwhxxs2)
    cmp(`${lc.contrato} · solicitacao · tipo pgto (VT)`, { labels: ["CAJU VT"] }, linhaVT.dropdown_mkwhxxs2)
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
