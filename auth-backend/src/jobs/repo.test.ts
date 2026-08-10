// Testes da fila + ledger de efeitos externos. Banco REAL com chaves sentinela e limpeza —
// mesmo padrão de routes/mensalRun.test.ts.
// Roda: node --env-file=.env --import tsx --test src/jobs/repo.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import {
  confirmarEfeito,
  detalheEfeito,
  enfileirar,
  estadoEfeito,
  liberarEfeito,
  pegarDevidos,
  reservarEfeito,
  retomarPresos,
} from "./repo.js"

const CHAVE = "teste_repo:sentinela:1"
const TIPO_A = "teste_repo_a"
const TIPO_B = "teste_repo_b"

async function limpar() {
  await query(`DELETE FROM efeitos_externos WHERE chave LIKE 'teste_repo:%'`)
  await query(`DELETE FROM jobs WHERE tipo LIKE 'teste_repo_%'`)
}

test("setup", limpar)

test("liberarEfeito: devolve a chave reservada, mas NUNCA a confirmada", async () => {
  // Reservada e não confirmada = o efeito não aconteceu (Fault do RM, com rollback).
  // Sem liberar, a chave fica `pendente` para sempre e a pessoa nunca mais entra.
  assert.equal(await reservarEfeito(CHAVE, "teste"), "novo")
  assert.equal(await estadoEfeito(CHAVE), "pendente")
  assert.equal(await liberarEfeito(CHAVE), true)
  assert.equal(await estadoEfeito(CHAVE), "ausente")
  assert.equal(await reservarEfeito(CHAVE, "teste"), "novo", "slot deveria estar livre")

  // Confirmada é intocável — é a trava que impede liberar um efeito que aconteceu de verdade.
  await confirmarEfeito(CHAVE, "ref-123")
  assert.equal(await liberarEfeito(CHAVE), false)
  assert.equal(await estadoEfeito(CHAVE), "confirmado")
})

test("detalheEfeito: devolve ref_externa e payload (é onde o código sobrevive)", async () => {
  await limpar()
  await reservarEfeito(CHAVE, "teste")
  await confirmarEfeito(CHAVE, "3;003330;C03S000123", { codConvocacao: "C03S000123" })
  const d = await detalheEfeito(CHAVE)
  assert.equal(d?.status, "confirmado")
  assert.equal(d?.refExterna, "3;003330;C03S000123")
  assert.equal(d?.payload?.codConvocacao, "C03S000123")
  assert.equal(await detalheEfeito("teste_repo:nao-existe"), null)
})

test("pegarDevidos: filtra por tipo, pra job lento não segurar job rápido", async () => {
  await limpar()
  await enfileirar(TIPO_A, { n: 1 })
  await enfileirar(TIPO_B, { n: 2 })
  const soA = await pegarDevidos(10, TIPO_A)
  assert.equal(soA.length, 1)
  assert.equal(soA[0]!.tipo, TIPO_A)
  // Sem filtro pega o que sobrou (o de tipo A já foi reivindicado e está 'rodando').
  const resto = await pegarDevidos(10)
  assert.deepEqual(resto.map((j) => j.tipo), [TIPO_B])
})

test("retomarPresos: job morto em 'rodando' volta pra fila contando a tentativa", async () => {
  await limpar()
  const id = await enfileirar(TIPO_A, { n: 3 })
  await query(
    `UPDATE jobs SET estado='rodando', atualizado_em=now() - interval '20 minutes' WHERE id=$1`,
    [id],
  )
  // Enquanto está 'rodando', o claim não enxerga — é assim que um job some pra sempre.
  assert.equal((await pegarDevidos(10, TIPO_A)).length, 0)

  assert.equal(await retomarPresos(10), 1)
  const [j] = await pegarDevidos(10, TIPO_A)
  assert.equal(j?.id, id)
  // A tentativa TEM que subir, senão um job que sempre estoura o tempo gira eternamente.
  assert.equal(j!.tentativas, 1)
})

test("retomarPresos: na 5ª tentativa desiste em vez de girar", async () => {
  await limpar()
  const id = await enfileirar(TIPO_A, { n: 4 })
  await query(
    `UPDATE jobs SET estado='rodando', tentativas=4, atualizado_em=now() - interval '1 hour' WHERE id=$1`,
    [id],
  )
  await retomarPresos(10)
  const { rows } = await query<{ estado: string; tentativas: number }>(
    `SELECT estado, tentativas FROM jobs WHERE id=$1`,
    [id],
  )
  assert.equal(rows[0]!.estado, "falhou")
  assert.equal(rows[0]!.tentativas, 5)
})

test("retomarPresos: não mexe em job recém-reivindicado", async () => {
  await limpar()
  const id = await enfileirar(TIPO_A, { n: 5 })
  await pegarDevidos(10, TIPO_A) // vira 'rodando' agora
  assert.equal(await retomarPresos(10), 0)
  const { rows } = await query<{ estado: string }>(`SELECT estado FROM jobs WHERE id=$1`, [id])
  assert.equal(rows[0]!.estado, "rodando")
})

test("teardown", limpar)
