// Modo desenvolvedor do mensal — banco REAL com run sentinela e limpeza.
// Roda: node --env-file=.env --import tsx --test src/mensal/devEfeitos.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import {
  FAMILIAS_EFEITO,
  etapaRealNoRunDev,
  familiaDaEtapa,
  familiasReaisDoRun,
  familiasValidas,
  limparCacheDev,
  marcarRunDev,
} from "./devEfeitos.js"

// run_id é uuid — sentinelas fixos no range reservado de teste.
const RUN = "00000000-0000-4000-8000-00000000d001"
const RUN2 = "00000000-0000-4000-8000-00000000d002"
const RUN_NADA = "00000000-0000-4000-8000-00000000d0ff"

async function limpar() {
  await query(`DELETE FROM mensal_run WHERE run_id = ANY($1::uuid[])`, [[RUN, RUN2]])
  limparCacheDev()
}

async function runNovo(id = RUN) {
  await query(
    `INSERT INTO mensal_run (run_id, papel, competencia, modo, status, snapshot)
     VALUES ($1, 'teste', '2099-01', 'producao', 'aguardando_aprovacao', '{}'::jsonb)`,
    [id],
  )
}

test("setup", limpar)

test("familiaDaEtapa cobre TODAS as etapas do ledger que passam por reservarOuPular", () => {
  // Se uma etapa nova nascer sem família, ela simula em run dev mesmo marcada — silencioso.
  // Este teste é o lembrete: nome de etapa novo => decidir a família aqui.
  const casos: Record<string, string> = {
    rm_gerar: "rm_historico",
    rm_foprotinas: "rm_financeiro",
    rm_aguardar: "rm_financeiro",
    rm_integrar: "rm_financeiro",
    convocacao_rm: "rm_convocacao",
    convocacao_rm_lote2: "rm_convocacao",
    monday_plano: "monday_escritas",
    monday_controle_caju: "monday_escritas",
    monday_solicitacao: "monday_escritas",
    monday_status_ok: "monday_escritas",
    drive: "drive",
  }
  for (const [etapa, familia] of Object.entries(casos)) assert.equal(familiaDaEtapa(etapa), familia, etapa)
  // Caju fica FORA de propósito na v1 (gate inline no step, região sob edição de outra sessão).
  assert.equal(familiaDaEtapa("caju_pix_vr"), null)
  assert.equal(familiaDaEtapa("caju_credito_vt"), null)
  assert.equal(familiaDaEtapa("validacao"), null)
})

test("familiasValidas é fechada: typo é recusado, não ignorado", () => {
  assert.equal(familiasValidas(["rm_convocacao"]), true)
  assert.equal(familiasValidas(["rm_convocacao", "drive"]), true)
  assert.equal(familiasValidas([]), false, "lista vazia não é run dev")
  assert.equal(familiasValidas(["rm_convocacao", "caju_credito"]), false, "caju fora da v1")
  assert.equal(familiasValidas(["rm_convocacoes"]), false, "typo")
  assert.equal(familiasValidas("rm_convocacao"), false)
  assert.equal(FAMILIAS_EFEITO.length, 5)
})

test("marcarRunDev força homologação e grava a whitelist", async () => {
  await runNovo()
  await marcarRunDev(RUN, ["rm_convocacao", "drive"])
  const { rows } = await query<{ modo: string; dev_familias_reais: string[] }>(
    `SELECT modo, dev_familias_reais FROM mensal_run WHERE run_id=$1`, [RUN],
  )
  // Homologação = chave de idempotência POR RUN. É a regra que impede o teste real de marcar a
  // etapa como feita pra competência (o run oficial pularia em silêncio — incidente e173b1ef).
  assert.equal(rows[0]!.modo, "homologacao")
  assert.deepEqual(rows[0]!.dev_familias_reais, ["rm_convocacao", "drive"])
})

test("etapaRealNoRunDev: só a família marcada vai real", async () => {
  limparCacheDev()
  assert.equal(await etapaRealNoRunDev(RUN, "convocacao_rm"), true)
  assert.equal(await etapaRealNoRunDev(RUN, "drive"), true)
  assert.equal(await etapaRealNoRunDev(RUN, "rm_gerar"), false, "rm_historico não foi marcada")
  assert.equal(await etapaRealNoRunDev(RUN, "monday_plano"), false)
  assert.equal(await etapaRealNoRunDev(RUN, "caju_pix_vr"), false, "caju nunca em v1")
})

test("run normal (sem whitelist) devolve null e nada vai real", async () => {
  limparCacheDev()
  await runNovo(RUN2)
  assert.equal(await familiasReaisDoRun(RUN2), null)
  assert.equal(await etapaRealNoRunDev(RUN2, "drive"), false)
  // Run inexistente idem — o workflow nunca pode quebrar por causa do lookup dev.
  assert.equal(await familiasReaisDoRun(RUN_NADA), null)
})

test("teardown", limpar)
