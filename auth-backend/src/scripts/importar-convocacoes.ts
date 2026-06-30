// FASE 1 — Importa o board Monday de Histórico (18411141462) -> pi.convocacoes.
// Lê o board (token Monday via MONDAY_TOKEN env; o MTOKEN do Mike NÃO vê esse board)
// e faz upsert por uuid. Idempotente (re-rodável). Insere direto no Postgres (pg).
// Uso: MONDAY_TOKEN=<token que vê o board> npm run importar:convocacoes
import { pool } from "../db.js"

const BOARD = 18411141462
const TOKEN = process.env.MONDAY_TOKEN
if (!TOKEN) { console.error("Defina MONDAY_TOKEN (token Monday que vê o board)"); process.exit(1) }

// id da coluna -> nome lógico
const COL = {
  uuid: "text_mm2xjend", protocolo: "text_mm2xsvg6", contrato: "text_mm2x1ktb",
  chapa: "text_mm33v9kp", data_inicio: "date_mm2xtp93", data_fim: "date_mm2xrr5q",
  status: "color_mm2xkqpc", status_cancelamento: "color_mm3b9v4n", data_cancel: "date_mm3b88ta",
  optante_vt: "color_mm34ry47", trabalha_sabado: "color_mm34yyet", item_origem: "link_mm2x1rk0",
  ledger: "long_text_mm3ct3hg", respostas: "long_text_mm2xtcpw", dias_desativados: "long_text_mm2xm820",
  atestados: "long_text_mm3cp43g", split: "long_text_mm3m8k0m", sabados_extras: "text_mm3bfn6h",
  qtd_faltas: "numeric_mm2xe2zk", qtd_atrasos: "numeric_mm2x18hh", total_minutos: "numeric_mm2x4fjj",
  dias_perde_vr: "numeric_mm34a3ph", dias_perde_vt: "numeric_mm345xb6",
  concluido_em: "date_mm2xh1vm", editado: "boolean_mm2x1aa4", editado_em: "date_mm2x62fq",
}

type CV = { id: string; text: string | null; value: string | null }
const txt = (cv: Record<string, CV>, id: string) => cv[id]?.text ?? null
const dateOnly = (s: string | null) => (s ? s.slice(0, 10) : null)
const tsOf = (s: string | null) => (s ? s.replace(" ", "T") : null)
const boolSim = (s: string | null) => (s == null ? null : /^SIM/i.test(s.trim()))
const numOf = (s: string | null) => (s == null || s === "" ? null : Number(String(s).replace(",", ".")))
function jparse(s: string | null): unknown {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}
function itemOrigemId(cv: Record<string, CV>): number | null {
  const raw = cv[COL.item_origem]?.value || cv[COL.item_origem]?.text || ""
  const m = String(raw).match(/pulses\/(\d+)|boards\/\d+\/pulses\/(\d+)|\/(\d{8,})/)
  const id = m && (m[1] || m[2] || m[3])
  return id ? Number(id) : null
}
const j = (v: unknown) => (v == null ? null : JSON.stringify(v))

async function mondayItems(): Promise<{ id: string; name: string; cv: Record<string, CV> }[]> {
  const out: { id: string; name: string; cv: Record<string, CV> }[] = []
  let cursor: string | null = null
  do {
    const q = cursor
      ? `query{ next_items_page(limit:100, cursor:"${cursor}"){ cursor items{ id name column_values{ id text value } } } }`
      : `query{ boards(ids:[${BOARD}]){ items_page(limit:100){ cursor items{ id name column_values{ id text value } } } } }`
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: TOKEN! },
      body: JSON.stringify({ query: q }),
    })
    const d = (await r.json()) as any
    if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 300))
    const page: any = cursor ? d.data.next_items_page : d.data.boards[0].items_page
    for (const it of page.items) {
      const cv: Record<string, CV> = {}
      for (const c of it.column_values) cv[c.id] = c
      out.push({ id: it.id, name: it.name, cv })
    }
    cursor = page.cursor
  } while (cursor)
  return out
}

async function main() {
  const itens = await mondayItems()
  console.log(`[import] board: ${itens.length} itens lidos`)
  let ok = 0, semUuid = 0
  for (const it of itens) {
    const cv = it.cv
    const uuid = txt(cv, COL.uuid)
    const chapa = txt(cv, COL.chapa)
    if (!uuid || !chapa) { semUuid++; continue }
    const sabExtraTxt = txt(cv, COL.sabados_extras) || ""
    const sabExtra = sabExtraTxt.split(/[,;\n]/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    await pool.query(
      `INSERT INTO convocacoes (
         uuid, monday_item_id, item_origem_id, chapa, contrato, data_inicio, data_fim,
         protocolo, status, status_cancelamento, data_inicio_cancelamento,
         optante_vt, trabalha_sabado, ledger_beneficios, respostas, dias_desativados,
         atestados, split, sabados_extras, qtd_faltas, qtd_atrasos, total_minutos,
         dias_perde_vr, dias_perde_vt, concluido_em, editado, editado_em, nome, atualizado_em
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28, now())
       ON CONFLICT (uuid) DO UPDATE SET
         monday_item_id=EXCLUDED.monday_item_id, item_origem_id=EXCLUDED.item_origem_id,
         chapa=EXCLUDED.chapa, contrato=EXCLUDED.contrato, data_inicio=EXCLUDED.data_inicio,
         data_fim=EXCLUDED.data_fim, protocolo=EXCLUDED.protocolo, status=EXCLUDED.status,
         status_cancelamento=EXCLUDED.status_cancelamento, data_inicio_cancelamento=EXCLUDED.data_inicio_cancelamento,
         optante_vt=EXCLUDED.optante_vt, trabalha_sabado=EXCLUDED.trabalha_sabado,
         ledger_beneficios=EXCLUDED.ledger_beneficios, respostas=EXCLUDED.respostas,
         dias_desativados=EXCLUDED.dias_desativados, atestados=EXCLUDED.atestados, split=EXCLUDED.split,
         sabados_extras=EXCLUDED.sabados_extras, qtd_faltas=EXCLUDED.qtd_faltas, qtd_atrasos=EXCLUDED.qtd_atrasos,
         total_minutos=EXCLUDED.total_minutos, dias_perde_vr=EXCLUDED.dias_perde_vr, dias_perde_vt=EXCLUDED.dias_perde_vt,
         concluido_em=EXCLUDED.concluido_em, editado=EXCLUDED.editado, editado_em=EXCLUDED.editado_em,
         nome=EXCLUDED.nome, atualizado_em=now()`,
      [
        uuid, Number(it.id) || null, itemOrigemId(cv), chapa, txt(cv, COL.contrato),
        dateOnly(txt(cv, COL.data_inicio)), dateOnly(txt(cv, COL.data_fim)), txt(cv, COL.protocolo),
        txt(cv, COL.status), txt(cv, COL.status_cancelamento), dateOnly(txt(cv, COL.data_cancel)),
        boolSim(txt(cv, COL.optante_vt)), boolSim(txt(cv, COL.trabalha_sabado)),
        j(jparse(txt(cv, COL.ledger))), j(jparse(txt(cv, COL.respostas))), j(jparse(txt(cv, COL.dias_desativados))),
        j(jparse(txt(cv, COL.atestados))), j(jparse(txt(cv, COL.split))), sabExtra,
        numOf(txt(cv, COL.qtd_faltas)), numOf(txt(cv, COL.qtd_atrasos)), numOf(txt(cv, COL.total_minutos)),
        numOf(txt(cv, COL.dias_perde_vr)), numOf(txt(cv, COL.dias_perde_vt)),
        tsOf(txt(cv, COL.concluido_em)), boolSim(txt(cv, COL.editado)), tsOf(txt(cv, COL.editado_em)),
        it.name || null,
      ],
    )
    ok++
  }
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int n FROM convocacoes")
  console.log(`[import] upsert ok: ${ok} | sem uuid/chapa (pulados): ${semUuid} | total no Postgres: ${rows[0]!.n}`)
  await pool.end()
}

main().catch((e) => { console.error("[import] falhou:", e); process.exit(1) })
