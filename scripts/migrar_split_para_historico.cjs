#!/usr/bin/env node
/**
 * Migra a coluna Split JSON do board Entrada → Histórico.
 *
 * Steps:
 * 1. Cria coluna `Split JSON` (long_text) no board Histórico se ainda não existir.
 * 2. Lista itens da Entrada com long_text_mm3hgsph não-vazio.
 * 3. Pra cada item, acha o Histórico via UUID (texto compartilhado).
 * 4. Copia o JSON pra coluna nova no Histórico.
 * 5. Reporta count + erros.
 *
 * Idempotente: se rodar 2x, identifica coluna existente pelo título "Split JSON"
 * e re-aplica os valores (sobrescreve com o mesmo dado).
 *
 * Env vars:
 *   MONDAY_TOKEN — token monday.com com escopo me:write
 *
 * Output: imprime o ID da coluna criada na primeira linha (LOG marker)
 * — outros scripts podem capturar pra hardcode posterior:
 *   SPLIT_COL=$(node scripts/migrar_split_para_historico.cjs | head -1)
 */
const TOKEN = process.env.MONDAY_TOKEN
if (!TOKEN) {
  console.error("Defina MONDAY_TOKEN antes de rodar.")
  process.exit(1)
}

const BOARD_ENTRADA = 18408773953
const BOARD_HISTORICO = 18411141462
const COL_ENTRADA_SPLIT = "long_text_mm3hgsph"
const COL_HISTORICO_UUID = "text_mm2xjend"

async function mondayQuery(query) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      Authorization: TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  })
  const data = await res.json()
  if (data.errors) {
    throw new Error(`Monday API errors: ${JSON.stringify(data.errors)}`)
  }
  return data.data
}

async function acharOuCriarColuna() {
  // Lista colunas do Histórico procurando "Split JSON".
  const d = await mondayQuery(
    `query { boards(ids: [${BOARD_HISTORICO}]) { columns { id title type } } }`,
  )
  const cols = d.boards?.[0]?.columns || []
  const existente = cols.find(
    (c) => c.type === "long_text" && c.title.trim() === "Split JSON",
  )
  if (existente) {
    console.error(`[INFO] Coluna 'Split JSON' já existe no Histórico: ${existente.id}`)
    return existente.id
  }
  const created = await mondayQuery(
    `mutation { create_column(board_id: ${BOARD_HISTORICO}, title: "Split JSON", column_type: long_text) { id title type } }`,
  )
  const id = created.create_column?.id
  if (!id) throw new Error("Falha ao criar coluna no Histórico.")
  console.error(`[INFO] Coluna criada no Histórico: ${id}`)
  return id
}

async function listarSplitsExistentes() {
  // Paginação simples com items_page (até 500 por chamada). Para boards
  // grandes considerar cursor — aqui assume volume baixo de splits ativos.
  const d = await mondayQuery(
    `query { boards(ids: [${BOARD_ENTRADA}]) { items_page(limit: 500) { items { id name column_values(ids: ["${COL_ENTRADA_SPLIT}", "link_mm2pn9kg"]) { id text value } } } } }`,
  )
  const items = d.boards?.[0]?.items_page?.items || []
  const comSplit = []
  for (const it of items) {
    const c = (it.column_values || []).find((cv) => cv.id === COL_ENTRADA_SPLIT)
    const raw = c?.text || c?.value
    if (!raw || String(raw).trim() === "" || String(raw).trim() === "null")
      continue
    const linkCol = (it.column_values || []).find((cv) => cv.id === "link_mm2pn9kg")
    let uuid = null
    const url =
      (linkCol?.value
        ? (() => {
            try {
              return JSON.parse(linkCol.value)?.url
            } catch {
              return null
            }
          })()
        : null) || linkCol?.text
    if (url) {
      const m = String(url).match(/preencher\/([\w-]+)/)
      uuid = m?.[1] || null
    }
    comSplit.push({ itemEntradaId: it.id, name: it.name, split: raw, uuid })
  }
  return comSplit
}

async function acharHistoricoPorUuid(uuid) {
  if (!uuid) return null
  const d = await mondayQuery(
    `query { items_page_by_column_values(board_id: ${BOARD_HISTORICO}, columns: [{column_id: "${COL_HISTORICO_UUID}", column_values: ["${uuid}"]}], limit: 1) { items { id } } }`,
  )
  return d.items_page_by_column_values?.items?.[0]?.id || null
}

async function escreverSplitNoHistorico(itemId, colunaSplitHist, split) {
  // change_simple_column_value aceita string como value.
  const val = typeof split === "string" ? split : JSON.stringify(split)
  await mondayQuery(
    `mutation { change_simple_column_value(board_id: ${BOARD_HISTORICO}, item_id: ${itemId}, column_id: "${colunaSplitHist}", value: ${JSON.stringify(val)}) { id } }`,
  )
}

;(async () => {
  const colunaSplitHist = await acharOuCriarColuna()
  // Imprime ID da coluna na stdout (primeira linha) pra captura programática
  // por outros scripts. Logs vão pra stderr.
  console.log(colunaSplitHist)

  const splits = await listarSplitsExistentes()
  console.error(`[INFO] ${splits.length} item(s) Entrada com Split JSON não-vazio.`)
  let ok = 0
  let erros = 0
  for (const s of splits) {
    try {
      const histId = await acharHistoricoPorUuid(s.uuid)
      if (!histId) {
        console.error(
          `[WARN] Histórico não encontrado para Entrada ${s.itemEntradaId} (uuid=${s.uuid}). Pulando.`,
        )
        erros++
        continue
      }
      await escreverSplitNoHistorico(histId, colunaSplitHist, s.split)
      console.error(
        `[OK] ${s.name} (Entrada ${s.itemEntradaId} → Histórico ${histId})`,
      )
      ok++
    } catch (e) {
      console.error(`[ERR] ${s.name} (${s.itemEntradaId}): ${e.message}`)
      erros++
    }
  }
  console.error(
    `[FIM] Total migrados: ${ok}/${splits.length}. Erros: ${erros}. Coluna nova: ${colunaSplitHist}`,
  )
})().catch((e) => {
  console.error("[FATAL]", e)
  process.exit(1)
})
