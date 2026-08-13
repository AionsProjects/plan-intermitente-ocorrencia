// Snapshot + reserva. O que precisa de prova: a atomicidade (snapshot sem reserva prometeria
// abater dívida que segue livre), o recálculo (libera antes de reservar, senão o CHECK
// recusa), e a distinção reservado × invalido.
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import type { PessoaCalculadaMensal } from "../mensal/calculo.js"
import { anotarPastaDrive, lerPrePagamentoVivo, liberarPrePagamento, reservarPrePagamento } from "./prepagamento.js"
import { lerReservasVivas } from "./repo.js"

const CHAPA = "prepag.test"
let seq = 960000

async function limpar(): Promise<void> {
  await query("DELETE FROM pontual_prepagamento WHERE chapa = $1", [CHAPA])
}

const pessoa = (over: Partial<PessoaCalculadaMensal> = {}): PessoaCalculadaMensal => ({
  itemId: "1", nome: "MISSILENE", chapa: CHAPA, cpf: "12345678901",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO",
  inicio: "2026-08-18", fim: "2026-08-22",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false,
  key: "12345678901", itemIds: ["1"],
  diasVR: 5, diasVT: 5, vrDia: 20, vtDia: 10, vrMensal: 0,
  brutoVR: 100, brutoVT: 50, descontoVR: 0, descontoVT: 0,
  liquidoVR: 100, liquidoVT: 50, creditoVR: 40, creditoVT: 20,
  pixVR: 60, pixVT: 30, regraAplicada: "r1", ...over,
})

const entrada = (item: number, over: Record<string, unknown> = {}) => ({
  itemOrigemId: String(item), chapa: CHAPA, nome: "MISSILENE", contrato: "CETAM",
  dataInicio: "2026-08-18", dataFim: "2026-08-22",
  pessoa: pessoa(), reservas: [], calculo: { teste: true }, ...over,
})

test("grava snapshot 'reservado' com os valores do calculo", async () => {
  try {
    const item = ++seq
    const r = await reservarPrePagamento(entrada(item))
    assert.ok(r)
    assert.equal(r!.estado, "reservado")
    const vivo = await lerPrePagamentoVivo(String(item))
    assert.ok(vivo)
    assert.equal(Number(vivo!.liquido_vr), 100)
    assert.equal(Number(vivo!.credito_vr), 40)
    assert.equal(Number(vivo!.pix_vt), 30)
    assert.equal(Number(vivo!.dias_vr), 5)
    assert.equal(vivo!.pasta_estado, "pendente")
  } finally { await limpar() }
})

test("sem pessoa (calculo falhou) nasce 'invalido' com o motivo", async () => {
  try {
    const item = ++seq
    const r = await reservarPrePagamento(entrada(item, {
      pessoa: undefined, motivoInvalido: "regra_beneficio_ausente: CETAM/AUXILIAR",
    }))
    assert.equal(r!.estado, "invalido")
    // 'invalido' NÃO é vivo — a felipeta recalcula em vez de pagar um snapshot sem número.
    assert.equal(await lerPrePagamentoVivo(String(item)), null)
    const { rows } = await query<{ estado: string; motivo_invalido: string }>(
      "SELECT estado, motivo_invalido FROM pontual_prepagamento WHERE id=$1", [r!.id],
    )
    assert.equal(rows[0]!.estado, "invalido")
    assert.match(rows[0]!.motivo_invalido, /regra_beneficio_ausente/)
  } finally { await limpar() }
})

test("reserva e gravada e aparece na soma viva", async () => {
  try {
    const item = ++seq
    await reservarPrePagamento(entrada(item, {
      reservas: [{ descontoMondayItemId: "d-960a", vr: 30, vt: 15 }],
    }))
    const m = await lerReservasVivas()
    assert.deepEqual(m.get("d-960a"), { vr: 30, vt: 15 })
  } finally { await limpar() }
})

test("reserva zerada nao gera linha", async () => {
  try {
    const item = ++seq
    const r = await reservarPrePagamento(entrada(item, {
      reservas: [{ descontoMondayItemId: "d-zero", vr: 0, vt: 0 }],
    }))
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM pontual_reserva_desconto WHERE prepagamento_id=$1", [r!.id],
    )
    assert.equal(rows[0]!.n, 0)
  } finally { await limpar() }
})

// O recálculo: liberar ANTES de reservar. Se reservasse primeiro, o CHECK
// `reservado <= residual` recusaria por conta da própria reserva antiga.
test("recalculo libera o vivo antigo e cria linha nova", async () => {
  try {
    const item = ++seq
    const a = await reservarPrePagamento(entrada(item, {
      reservas: [{ descontoMondayItemId: "d-960b", vr: 50, vt: 0 }],
    }))
    const b = await reservarPrePagamento(entrada(item, {
      dataFim: "2026-08-20",
      pessoa: pessoa({ liquidoVR: 60, diasVR: 3 }),
      reservas: [{ descontoMondayItemId: "d-960b", vr: 20, vt: 0 }],
    }))
    assert.notEqual(a!.id, b!.id, "reusou a linha em vez de criar histórico")

    // Só o novo é vivo, e a soma da reserva reflete só ele.
    const vivo = await lerPrePagamentoVivo(String(item))
    assert.equal(vivo!.id, b!.id)
    assert.equal(Number(vivo!.liquido_vr), 60)
    const m = await lerReservasVivas()
    assert.deepEqual(m.get("d-960b"), { vr: 20, vt: 0 }, "a reserva antiga nao foi solta")

    // O antigo virou histórico, não desapareceu.
    const { rows } = await query<{ estado: string }>(
      "SELECT estado FROM pontual_prepagamento WHERE id=$1", [a!.id],
    )
    assert.equal(rows[0]!.estado, "liberado")
  } finally { await limpar() }
})

test("liberar solta a reserva e sai do vivo", async () => {
  try {
    const item = ++seq
    await reservarPrePagamento(entrada(item, {
      reservas: [{ descontoMondayItemId: "d-960c", vr: 40, vt: 20 }],
    }))
    const n = await liberarPrePagamento(String(item), "cancelamento")
    assert.equal(n, 1)
    assert.equal(await lerPrePagamentoVivo(String(item)), null)
    const m = await lerReservasVivas()
    assert.equal(m.get("d-960c"), undefined, "a divida ficou presa")
  } finally { await limpar() }
})

test("liberar item sem pre-pagamento vivo e no-op", async () => {
  const n = await liberarPrePagamento("960999", "cancelamento")
  assert.equal(n, 0)
})

test("anotarPastaDrive preenche as refs e marca 'pronta'", async () => {
  try {
    const item = ++seq
    const r = await reservarPrePagamento(entrada(item))
    await anotarPastaDrive(r!.id, {
      pastaPessoaId: "pasta-pessoa-1", pastaConvocacaoId: "pasta-conv-1",
      nome: "18 A 22/08/2026", caminho: "2026/08 - AGOSTO/CONTATO/74 - CETAM/INTERMITENTE - PONTUAL/MISSILENE/18 A 22/08/2026",
    })
    const vivo = await lerPrePagamentoVivo(String(item))
    assert.equal(vivo!.pasta_estado, "pronta")
    assert.equal(vivo!.pasta_convocacao_drive_id, "pasta-conv-1")
    assert.equal(vivo!.pasta_pessoa_drive_id, "pasta-pessoa-1")
    assert.equal(vivo!.pasta_convocacao_nome, "18 A 22/08/2026")
  } finally { await limpar() }
})

// A propriedade central: um item nunca tem dois pré-pagamentos vivos, mesmo sob chamada
// concorrente (duplo-clique que passou pela chave de efeito).
test("duas gravacoes concorrentes no mesmo item deixam UM vivo", async () => {
  try {
    const item = ++seq
    const [a, b] = await Promise.all([
      reservarPrePagamento(entrada(item)),
      reservarPrePagamento(entrada(item)),
    ])
    // Uma pode falhar (unique) — o que não pode é sobrarem dois vivos.
    assert.ok(a || b, "as duas falharam")
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int n FROM pontual_prepagamento
        WHERE item_origem_id = $1 AND estado IN ('reservado','consumido')`,
      [String(item)],
    )
    assert.equal(rows[0]!.n, 1, "sobrou mais de um pre-pagamento vivo")
  } finally { await limpar() }
})

test("cleanup", limpar)
