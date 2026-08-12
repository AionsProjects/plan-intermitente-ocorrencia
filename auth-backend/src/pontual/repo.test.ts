// A metade que faz a reserva EXISTIR: o residual entregue ao cálculo tem que vir líquido.
//
// Sem isto a reserva é decorativa — o mensal e a próxima convocação leem o residual cru do
// board `18400981023` e abatem a MESMA dívida de novo, e um dos dois pagamentos sai menor
// do que devia. É o cenário inteiro que a bifurcação criou e que a reserva fecha.
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import { lerReservasVivas } from "./repo.js"

const CHAPA = "reserva.test"

async function limpar(): Promise<void> {
  // CASCADE leva as reservas junto.
  await query("DELETE FROM pontual_prepagamento WHERE chapa = $1", [CHAPA])
}

async function prepagamento(estado: string, item: number): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO pontual_prepagamento
       (item_origem_id, chapa, contrato, data_inicio, data_fim, estado)
     VALUES ($1,$2,'CETAM','2026-08-01','2026-08-05',$3) RETURNING id`,
    [item, CHAPA, estado],
  )
  return rows[0]!.id
}

const reservar = (prepagId: string, descontoItemId: string, vr: number, vt: number) =>
  query(
    `INSERT INTO pontual_reserva_desconto (prepagamento_id, desconto_monday_item_id, vr, vt)
     VALUES ($1,$2,$3,$4)`,
    [prepagId, descontoItemId, vr, vt],
  )

test("reserva de pré-pagamento 'reservado' entra na soma", async () => {
  try {
    const p = await prepagamento("reservado", 970001)
    await reservar(p, "d-970001", 60, 30)
    const m = await lerReservasVivas()
    assert.deepEqual(m.get("d-970001"), { vr: 60, vt: 30 })
  } finally { await limpar() }
})

// 'consumido' = a felipeta já pagou e o desconto foi abatido de verdade no board. O
// residual do board já reflete isso, então continuar somando aqui subtrairia DUAS vezes.
// Ainda assim conta como vivo: enquanto o snapshot não for liberado, a dívida é dele.
test("'consumido' também conta como vivo", async () => {
  try {
    const p = await prepagamento("consumido", 970002)
    await reservar(p, "d-970002", 10, 5)
    const m = await lerReservasVivas()
    assert.deepEqual(m.get("d-970002"), { vr: 10, vt: 5 })
  } finally { await limpar() }
})

// O outro lado: liberado/invalido JÁ devolveram a dívida ao FIFO. Continuar contando aqui
// prenderia dívida pra sempre e o mensal abateria menos do que deveria — o problema que a
// expiração existe pra evitar.
test("'liberado' NÃO conta — a dívida já voltou pro FIFO", async () => {
  try {
    const p = await prepagamento("liberado", 970003)
    await reservar(p, "d-970003", 99, 99)
    const m = await lerReservasVivas()
    assert.equal(m.get("d-970003"), undefined)
  } finally { await limpar() }
})

test("'invalido' NÃO conta", async () => {
  try {
    const p = await prepagamento("invalido", 970004)
    await reservar(p, "d-970004", 99, 99)
    const m = await lerReservasVivas()
    assert.equal(m.get("d-970004"), undefined)
  } finally { await limpar() }
})

// O caso que a bifurcação criou: duas convocações da mesma pessoa esperando felipeta.
test("duas convocações sobre a MESMA dívida somam", async () => {
  try {
    const a = await prepagamento("reservado", 970005)
    const b = await prepagamento("reservado", 970006)
    await reservar(a, "d-comum", 40, 20)
    await reservar(b, "d-comum", 35, 15)
    const m = await lerReservasVivas()
    assert.deepEqual(m.get("d-comum"), { vr: 75, vt: 35 })
  } finally { await limpar() }
})

test("liberar uma das duas deixa só a outra na soma", async () => {
  try {
    const a = await prepagamento("reservado", 970007)
    const b = await prepagamento("reservado", 970008)
    await reservar(a, "d-parcial", 40, 20)
    await reservar(b, "d-parcial", 35, 15)
    await query("UPDATE pontual_prepagamento SET estado='liberado' WHERE id=$1", [a])
    const m = await lerReservasVivas()
    assert.deepEqual(m.get("d-parcial"), { vr: 35, vt: 15 })
  } finally { await limpar() }
})

// Liberar o pré-pagamento tem que devolver a dívida INTEIRA — se a reserva sobrevivesse ao
// delete, a dívida ficaria presa sem nenhum snapshot dono dela.
test("apagar o pré-pagamento devolve a dívida (CASCADE)", async () => {
  try {
    const p = await prepagamento("reservado", 970009)
    await reservar(p, "d-970009", 50, 25)
    await query("DELETE FROM pontual_prepagamento WHERE id=$1", [p])
    const m = await lerReservasVivas()
    assert.equal(m.get("d-970009"), undefined)
  } finally { await limpar() }
})

test("sem reserva nenhuma devolve mapa vazio, não erro", async () => {
  await limpar()
  const m = await lerReservasVivas()
  assert.ok(m instanceof Map)
  assert.equal(m.get("nao-existe"), undefined)
})
