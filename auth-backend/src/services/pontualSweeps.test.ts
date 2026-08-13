// Sweep de expiração — as duas propriedades de dinheiro: reserva esquecida VOLTA ao FIFO
// no prazo certo, e reserva com felipeta em curso NÃO é expirada por baixo dela.
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import { config } from "../config.js"
import type { PessoaCalculadaMensal } from "../mensal/calculo.js"
import { lerPrePagamentoCompleto, marcarConsumido, reservarPrePagamento } from "../pontual/prepagamento.js"
import { expirarReservasPontual } from "./pontualSweeps.js"

const CHAPA = "sweep.test"
let seq = 970000

async function limpar(): Promise<void> {
  await query("DELETE FROM pontual_prepagamento WHERE chapa = $1", [CHAPA])
  await query("DELETE FROM efeitos_externos WHERE chave LIKE 'pontual:gatilho:97%'")
}

const pessoa = (): PessoaCalculadaMensal => ({
  itemId: "1", nome: "SWEEP", chapa: CHAPA, cpf: "12345678901",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO",
  inicio: "2026-08-01", fim: "2026-08-05",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false,
  key: "12345678901", itemIds: ["1"],
  diasVR: 5, diasVT: 5, vrDia: 20, vtDia: 10, vrMensal: 0,
  brutoVR: 100, brutoVT: 50, descontoVR: 10, descontoVT: 0,
  liquidoVR: 90, liquidoVT: 50, creditoVR: 40, creditoVT: 20,
  pixVR: 50, pixVT: 30, regraAplicada: "r1",
})

const entrada = (item: number, fim: string) => ({
  itemOrigemId: String(item), chapa: CHAPA, nome: "SWEEP", contrato: "CETAM",
  dataInicio: "2026-08-01", dataFim: fim,
  pessoa: pessoa(), reservas: [{ descontoMondayItemId: "d1", vr: 10, vt: 0 }],
  calculo: {},
})

// hoje fixo: 2026-09-01. Com expiração default 15, corte = 2026-08-17.
const HOJE = new Date("2026-09-01T12:00:00Z")

test("reserva vencida é liberada e a dívida volta (reserva some)", async () => {
  try {
    const item = ++seq
    await reservarPrePagamento(entrada(item, "2026-08-05")) // fim + 15 < hoje
    const r = await expirarReservasPontual(HOJE)
    assert.ok(r.liberadas >= 1)
    const { rows } = await query<{ estado: string; n: number }>(
      `SELECT p.estado, (SELECT count(*)::int FROM pontual_reserva_desconto rr WHERE rr.prepagamento_id = p.id) n
         FROM pontual_prepagamento p WHERE p.item_origem_id = $1`,
      [String(item)],
    )
    assert.equal(rows[0]!.estado, "liberado")
    assert.equal(rows[0]!.n, 0)
  } finally { await limpar() }
})

test("reserva dentro do prazo NÃO expira", async () => {
  try {
    const item = ++seq
    const fimRecente = new Date(HOJE)
    fimRecente.setUTCDate(fimRecente.getUTCDate() - (config.pontualReservaExpiraDias - 2))
    await reservarPrePagamento(entrada(item, fimRecente.toISOString().slice(0, 10)))
    await expirarReservasPontual(HOJE)
    const { rows } = await query<{ estado: string }>(
      `SELECT estado FROM pontual_prepagamento WHERE item_origem_id = $1`, [String(item)],
    )
    assert.equal(rows[0]!.estado, "reservado")
  } finally { await limpar() }
})

test("gatilho de pagamento em curso protege a reserva da expiração", async () => {
  try {
    const item = ++seq
    await reservarPrePagamento(entrada(item, "2026-08-05"))
    await query(
      `INSERT INTO efeitos_externos (chave, tipo, status) VALUES ($1, 'pontual_gatilho', 'pendente')`,
      [`pontual:gatilho:${item}`],
    )
    const r = await expirarReservasPontual(HOJE)
    assert.ok(r.puladas >= 1)
    const { rows } = await query<{ estado: string }>(
      `SELECT estado FROM pontual_prepagamento WHERE item_origem_id = $1`, [String(item)],
    )
    assert.equal(rows[0]!.estado, "reservado", "expirou debaixo do pagamento em curso")
  } finally { await limpar() }
})

test("marcarConsumido: estado vira consumido e reservas somem na mesma transação", async () => {
  try {
    const item = ++seq
    const g = await reservarPrePagamento(entrada(item, "2026-08-05"))
    assert.ok(g)
    const ok = await marcarConsumido(g!.id)
    assert.equal(ok, true)
    const completo = await lerPrePagamentoCompleto(String(item))
    assert.equal(completo!.estado, "consumido")
    assert.equal(completo!.reservas.length, 0)
    // segunda chamada é no-op (não estava mais 'reservado')
    assert.equal(await marcarConsumido(g!.id), false)
  } finally { await limpar() }
})

test("lerPrePagamentoCompleto devolve calculo e reservas", async () => {
  try {
    const item = ++seq
    await reservarPrePagamento({ ...entrada(item, "2026-08-05"), calculo: { entrada: { interior: "NAO" } } })
    const c = await lerPrePagamentoCompleto(String(item))
    assert.ok(c)
    assert.equal(c!.reservas.length, 1)
    assert.equal(c!.reservas[0]!.descontoMondayItemId, "d1")
    assert.equal(c!.reservas[0]!.vr, 10)
    assert.deepEqual((c!.calculo as { entrada?: unknown }).entrada, { interior: "NAO" })
  } finally { await limpar() }
})

test("cleanup", limpar)
