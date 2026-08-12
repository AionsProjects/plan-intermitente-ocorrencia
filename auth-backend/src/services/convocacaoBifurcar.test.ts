// Bifurcação — regra pura + efeito no banco. O RM não é chamado de verdade: as PKs são
// inventadas, então o delete cai em `ja_ausente` (determinístico e offline) e a gravação para no
// `rm_soap_nao_configurado`/erro. O que se prova aqui é QUEM é partido, QUEM fica intacto e o que
// sobra no rastro — que é onde este módulo erra em silêncio.
// Roda: node --env-file=.env --import tsx --test src/services/convocacaoBifurcar.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.CONVOCACAO_RM_HABILITADA = "1"

const { query } = await import("../db.js")
const { confirmarLancamentoRm, lancamentosDoItem, reservarLancamentoRm } = await import("../repo/convocacoesRm.js")
const { bifurcarConvocacoesDoItem, pedacosDaBifurcacao, reverterBifurcacaoDoItem } =
  await import("./convocacaoBifurcar.js")

const ITEM = 999001001
const CHAPA = "998877"

async function limpar() {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM convocacoes_rm WHERE item_origem_id = $1`, [ITEM],
  )
  for (const r of rows) {
    await query(`DELETE FROM efeitos_externos WHERE chave LIKE $1`, [`%${r.id}%`])
  }
  await query(`UPDATE convocacoes_rm SET origem_lancamento_id = NULL WHERE item_origem_id = $1`, [ITEM])
  await query(`DELETE FROM convocacoes_rm WHERE item_origem_id = $1`, [ITEM])
}

async function noRm(codigo: string, inicio: string, fim: string, contrato = "SEMSA") {
  const r = await reservarLancamentoRm({
    itemOrigemId: ITEM, chapa: CHAPA, contrato,
    dataInicio: inicio, dataFim: fim, dataConvocacao: "2099-06-28", origemAcao: "teste",
  })
  await confirmarLancamentoRm(r.lancamento.id, { codigo, pkRm: `3;${CHAPA};${codigo}` })
  return r.lancamento.id
}

test("setup", limpar)

// ── regra pura ─────────────────────────────────────────────────────────────

test("corte DENTRO do período: parte 1 termina na véspera, parte 2 começa no corte", () => {
  const r = pedacosDaBifurcacao(
    { data_inicio: "2099-07-01", data_fim: "2099-07-20" },
    { corte: "2099-07-12", contratoParte1: "SEMSA", contratoParte2: "DETRAN" },
  )
  assert.deepEqual(r, [
    { dataInicio: "2099-07-01", dataFim: "2099-07-11", contrato: "SEMSA" },
    { dataInicio: "2099-07-12", dataFim: "2099-07-20", contrato: "DETRAN" },
  ])
})

test("período inteiro ANTES do corte não é partido", () => {
  // Apagar e recriar com o mesmo período seria destruir um S-2260 correto por nada.
  assert.equal(
    pedacosDaBifurcacao(
      { data_inicio: "2099-07-01", data_fim: "2099-07-05" },
      { corte: "2099-07-12", contratoParte1: "A", contratoParte2: "B" },
    ),
    null,
  )
})

test("período que COMEÇA no corte não é partido — parte 1 seria vazia", () => {
  assert.equal(
    pedacosDaBifurcacao(
      { data_inicio: "2099-07-12", data_fim: "2099-07-20" },
      { corte: "2099-07-12", contratoParte1: "A", contratoParte2: "B" },
    ),
    null,
  )
})

test("aceita data com hora do RM (2099-07-01T00:00:00-03:00)", () => {
  const r = pedacosDaBifurcacao(
    { data_inicio: "2099-07-01T00:00:00-03:00", data_fim: "2099-07-20T00:00:00-03:00" },
    { corte: "2099-07-12", contratoParte1: "A", contratoParte2: "B" },
  )
  assert.equal(r?.[0]!.dataFim, "2099-07-11")
})

// ── efeito no rastro ───────────────────────────────────────────────────────

test("bifurcar: o original sai do ar e nascem duas reservas com o ato herdado", async () => {
  await limpar()
  const paiId = await noRm("C03S999801", "2099-07-01", "2099-07-20")
  const r = await bifurcarConvocacoesDoItem(ITEM, {
    corte: "2099-07-12", contratoParte1: "SEMSA", contratoParte2: "DETRAN",
  })

  assert.equal(r.remocoes.length, 1)
  assert.equal(r.remocoes[0]!.estado, "ja_ausente", "PK inventada: o RM não tem, e o rastro fecha")

  const todos = await lancamentosDoItem(ITEM)
  const pai = todos.find((x) => x.id === paiId)!
  assert.equal(pai.estado, "removido")
  assert.equal(pai.motivo_saida, "bifurcacao")

  const filhas = todos.filter((x) => x.origem_lancamento_id === paiId)
  assert.equal(filhas.length, 2)
  const [p1, p2] = filhas.sort((a, b) => String(a.data_inicio).localeCompare(String(b.data_inicio)))
  assert.equal(String(p1!.data_fim).slice(0, 10), "2099-07-11")
  assert.equal(String(p2!.data_inicio).slice(0, 10), "2099-07-12")
  assert.equal(p1!.contrato, "SEMSA")
  assert.equal(p2!.contrato, "DETRAN")
  // Houve UM ato de convocação; recalcular pela regra dos 3 dias colocaria o ato da parte 2
  // DENTRO do período já convocado, afirmando um convite que não houve.
  assert.equal(String(p1!.data_convocacao).slice(0, 10), "2099-06-28")
  assert.equal(String(p2!.data_convocacao).slice(0, 10), "2099-06-28")
})

test("peça que não cruza o corte fica INTACTA", async () => {
  await limpar()
  const fora = await noRm("C03S999802", "2099-07-01", "2099-07-05")
  await noRm("C03S999803", "2099-07-10", "2099-07-20")
  const r = await bifurcarConvocacoesDoItem(ITEM, {
    corte: "2099-07-12", contratoParte1: "SEMSA", contratoParte2: "DETRAN",
  })
  assert.equal(r.intactos.length, 1)
  assert.equal(r.intactos[0]!.lancamentoId, fora)
  const viva = (await lancamentosDoItem(ITEM)).find((x) => x.id === fora)!
  assert.equal(viva.estado, "no_rm", "não pode ter sido apagada")
  assert.equal(viva.codigo, "C03S999802")
})

test("nenhum vivo cruza o corte: não mexe em nada", async () => {
  await limpar()
  await noRm("C03S999804", "2099-07-01", "2099-07-05")
  const r = await bifurcarConvocacoesDoItem(ITEM, {
    corte: "2099-07-12", contratoParte1: "A", contratoParte2: "B",
  })
  assert.equal(r.nota, "nenhum_cruza_o_corte")
  assert.equal(r.remocoes.length, 0)
  assert.equal(r.gravacoes.length, 0)
})

test("reverter volta pra UM, com a união das peças (não o período do pai)", async () => {
  await limpar()
  await noRm("C03S999805", "2099-07-01", "2099-07-20")
  await bifurcarConvocacoesDoItem(ITEM, {
    corte: "2099-07-12", contratoParte1: "SEMSA", contratoParte2: "DETRAN",
  })
  // As peças ficam `reservado` (o SaveRecord não roda no teste). Confirma pra simular o estado
  // real pós-gravação, senão o revert não teria o que remover no RM.
  const filhas = (await lancamentosDoItem(ITEM, { apenasVivos: true }))
  let i = 0
  for (const f of filhas) await confirmarLancamentoRm(f.id, { codigo: `C03S99981${i++}`, pkRm: `3;${CHAPA};C03S99981${i}` })

  const r = await reverterBifurcacaoDoItem(ITEM)
  assert.equal(r.remocoes.length, 2, "as duas peças saem")
  const vivos = await lancamentosDoItem(ITEM, { apenasVivos: true })
  assert.equal(vivos.length, 1)
  assert.equal(String(vivos[0]!.data_inicio).slice(0, 10), "2099-07-01")
  assert.equal(String(vivos[0]!.data_fim).slice(0, 10), "2099-07-20")
  assert.equal(vivos[0]!.contrato, "SEMSA", "volta pro contrato do pai")
})

test("reverter sem bifurcação no rastro não inventa nada", async () => {
  await limpar()
  await noRm("C03S999820", "2099-07-01", "2099-07-20")
  const r = await reverterBifurcacaoDoItem(ITEM)
  assert.equal(r.nota, "nada_vivo")
  assert.equal((await lancamentosDoItem(ITEM, { apenasVivos: true })).length, 1)
})

test("flag desligada: não toca no RM nem no rastro", async () => {
  await limpar()
  await noRm("C03S999830", "2099-07-01", "2099-07-20")
  process.env.SPLIT_RM_HABILITADO = "0"
  try {
    const r = await bifurcarConvocacoesDoItem(ITEM, {
      corte: "2099-07-12", contratoParte1: "A", contratoParte2: "B",
    })
    assert.equal(r.nota, "desligado")
    assert.equal((await lancamentosDoItem(ITEM, { apenasVivos: true })).length, 1)
  } finally {
    delete process.env.SPLIT_RM_HABILITADO
  }
})

test("teardown", limpar)
