/**
 * Confere o pré-pagamento de uma convocação: snapshot no Postgres × colunas no board Monday.
 *
 *   npm run conferir:prepag -- <item_id_monday>
 *
 * Existe porque os dois lados são escritos por caminhos diferentes na MESMA requisição — o
 * snapshot por INSERT, as colunas dentro do `createItem` — e nada garante que combinem depois. Se
 * divergirem, o board (que o DP lê e a fase 2 espelha) está dizendo um número e o registro que
 * autoriza o pagamento está dizendo outro.
 *
 * Também mostra a reserva de desconto e o residual do board, que é a outra forma de o dinheiro
 * sair errado: reserva sem residual correspondente = dívida abatida duas vezes no fechamento.
 */
import { query } from "../db.js"
import { mondayGraphql } from "../monday.js"

const norm = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

const num = (v: unknown): number => {
  const s = String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

interface Coluna { id: string; text: string | null; column?: { title: string } | null }

/**
 * Título da coluna no Plan → chave do `plan_update`. As 7 que a fase 1 escreve.
 *
 * A referência é o `plan_update` guardado em `calculo`, não as colunas soltas do snapshot: é
 * literalmente o objeto que virou `column_values` no `createItem`, e `VR - MENSAL` só existe lá
 * (o snapshot não tem coluna própria pra ele). Conferir contra as colunas soltas deixaria essa
 * escrita sem verificação nenhuma.
 *
 * Espelha PLAN_COLS em mensal/mondayEfeitos.ts — se uma entrada for adicionada lá, some aqui.
 */
const PARES: Array<{ coluna: string; chave: string; label: string }> = [
  { coluna: "VR - Unitário", chave: "vrDia", label: "VR/dia" },
  { coluna: "VT - Diário", chave: "vtDia", label: "VT/dia" },
  { coluna: "VR - MENSAL", chave: "vrMensal", label: "VR mensal" },
  { coluna: "Dias Úteis/Mês - VR", chave: "diasVR", label: "dias VR" },
  { coluna: "Dias Úteis/Mês - VT", chave: "diasVT", label: "dias VT" },
  { coluna: "CREDITO CAJU", chave: "creditoVR", label: "crédito VR" },
  { coluna: "CREDITO VT", chave: "creditoVT", label: "crédito VT" },
]

async function main(): Promise<void> {
  const itemId = process.argv[2]
  if (!itemId || !/^\d+$/.test(itemId)) {
    console.error("uso: npm run conferir:prepag -- <item_id_monday>")
    process.exit(1)
  }

  const { rows: snaps } = await query<Record<string, unknown>>(
    `SELECT * FROM pontual_prepagamento WHERE item_origem_id = $1 ORDER BY criado_em DESC`,
    [itemId],
  )
  if (!snaps.length) {
    console.error(`\n❌ nenhum snapshot para o item ${itemId}.`)
    console.error("   Ou o pré-pagamento está desligado (PONTUAL_PREPAGAMENTO_HABILITADO), ou a")
    console.error("   convocação foi criada pelo n8n, ou a gravação falhou (veja /atividade).")
    process.exit(1)
  }
  const s = snaps[0]
  const vivos = snaps.filter((x) => x.estado === "reservado" || x.estado === "consumido")

  console.log(`\n=== snapshot (${snaps.length} linha${snaps.length > 1 ? "s" : ""}, ${vivos.length} viva${vivos.length === 1 ? "" : "s"}) ===`)
  console.log(`estado          ${s.estado}${s.motivo_invalido ? "  motivo: " + s.motivo_invalido : ""}`)
  console.log(`pessoa          ${s.nome}  chapa ${s.chapa}  ${s.contrato}`)
  console.log(`período         ${s.data_inicio} a ${s.data_fim}`)
  console.log(`dias            VR ${s.dias_vr}  VT ${s.dias_vt}`)
  console.log(`bruto           VR ${s.bruto_vr}  VT ${s.bruto_vt}`)
  console.log(`desconto        VR ${s.desconto_vr}  VT ${s.desconto_vt}`)
  console.log(`líquido         VR ${s.liquido_vr}  VT ${s.liquido_vt}`)
  console.log(`crédito         VR ${s.credito_vr}  VT ${s.credito_vt}`)
  console.log(`boleto PIX      VR ${s.pix_vr}  VT ${s.pix_vt}`)
  console.log(`pasta           ${s.pasta_estado}  ${s.pasta_convocacao_nome ?? "-"}  ${s.pasta_convocacao_drive_id ?? "(sem id)"}`)
  console.log(`caminho         ${s.pasta_caminho ?? "-"}`)

  // Reserva × residual do board: os dois têm que bater, senão a dívida sai abatida duas vezes.
  const { rows: reservas } = await query<{ desconto_monday_item_id: string; vr: string; vt: string }>(
    `SELECT r.desconto_monday_item_id, r.vr, r.vt FROM pontual_reserva_desconto r
       WHERE r.prepagamento_id = $1 ORDER BY 1`,
    [s.id],
  )
  console.log(`\n=== reservas (${reservas.length}) ===`)
  if (!reservas.length) console.log("(nenhuma — a pessoa não tinha desconto pendente, ou o cálculo não abateu nada)")

  const itensDesconto = reservas.length
    ? await mondayGraphql<{ items: Array<{ id: string; name: string; column_values: Coluna[] }> }>(
        `query Desc($ids:[ID!]) { items(ids:$ids) { id name column_values { id text column { title } } } }`,
        { ids: reservas.map((r) => r.desconto_monday_item_id) },
      )
    : { items: [] }

  for (const r of reservas) {
    const it = itensDesconto.items.find((x) => x.id === r.desconto_monday_item_id)
    const resid = (t: string) =>
      num(it?.column_values.find((c) => norm(c.column?.title ?? c.id) === norm(t))?.text)
    const rVR = resid("VR - Valor Residual")
    const rVT = resid("VT - Valor Residual")
    const okVR = Number(r.vr) <= rVR + 0.005
    const okVT = Number(r.vt) <= rVT + 0.005
    console.log(
      `  ${r.desconto_monday_item_id}  reservado VR ${Number(r.vr).toFixed(2)}/resid ${rVR.toFixed(2)} ${okVR ? "✅" : "❌"}` +
        `   VT ${Number(r.vt).toFixed(2)}/resid ${rVT.toFixed(2)} ${okVT ? "✅" : "❌"}` +
        `${it ? "" : "  ⚠️ item de desconto não encontrado no Monday"}`,
    )
  }

  // As colunas do próprio item: o que o DP vê e o que a fase 2 vai espelhar.
  const d = await mondayGraphql<{ items: Array<{ id: string; name: string; column_values: Coluna[] }> }>(
    `query Item($ids:[ID!]) { items(ids:$ids) { id name column_values { id text column { title } } } }`,
    { ids: [itemId] },
  )
  const item = d.items?.[0]
  if (!item) {
    console.error(`\n❌ item ${itemId} não existe mais no Monday (apagado?).`)
    process.exit(1)
  }

  const calculo = (s.calculo ?? {}) as Record<string, unknown>
  const planUpdate = (calculo.plan_update ?? {}) as Record<string, unknown>

  console.log(`\n=== colunas do item "${item.name}" ===`)
  let divergencias = 0
  for (const p of PARES) {
    const bruto = item.column_values.find((c) => norm(c.column?.title ?? c.id) === norm(p.coluna))
    if (!bruto) {
      console.log(`  ${p.label.padEnd(12)} ⚠️ coluna "${p.coluna}" não existe neste board`)
      continue
    }
    const noBoard = num(bruto.text)
    const esperado = planUpdate[p.chave]
    // `null` no plan_update LIMPA a célula de propósito (VR - Unitário fica vazio quando a
    // regra do contrato é mensal). Célula vazia ali é acerto, não divergência.
    const noCalc = esperado == null ? null : num(esperado)
    const bate = noCalc == null ? String(bruto.text ?? "").trim() === "" : Math.abs(noBoard - noCalc) < 0.005
    if (!bate) divergencias++
    console.log(
      `  ${p.label.padEnd(12)} board ${noBoard.toFixed(2).padStart(9)}   cálculo ${(noCalc == null ? "(limpar)" : noCalc.toFixed(2)).padStart(9)}   ${bate ? "✅" : "❌ DIVERGE"}`,
    )
  }

  if (divergencias) {
    console.error(`\n❌ ${divergencias} divergência(s) board × snapshot. NÃO libere a fase 2 assim.`)
    process.exitCode = 1
  } else {
    console.log("\n✅ board e snapshot batem.")
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
