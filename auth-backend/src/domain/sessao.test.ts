import { test } from "node:test"
import assert from "node:assert/strict"
import { proximaExpiracao } from "./sessao.js"

const DIA = 24 * 60 * 60 * 1000
const t0 = new Date("2026-10-01T12:00:00Z")
const depois = (dias: number, base = t0) => new Date(base.getTime() + dias * DIA)

test("não renova no mesmo dia do login (ganho < 1 dia)", () => {
  const r = proximaExpiracao({
    agora: depois(0.5),
    expiraEm: depois(10),
    criadaEm: t0,
    ttlDias: 10,
    tetoDias: 30,
  })
  assert.equal(r, null)
})

test("renova quando já passou mais de um dia desde a última renovação", () => {
  const agora = depois(2)
  const r = proximaExpiracao({
    agora,
    expiraEm: depois(10),
    criadaEm: t0,
    ttlDias: 10,
    tetoDias: 30,
  })
  assert.deepEqual(r, depois(10, agora))
})

test("sessão que quase venceu volta a ter o TTL cheio", () => {
  const agora = depois(9.5)
  const r = proximaExpiracao({
    agora,
    expiraEm: depois(10),
    criadaEm: t0,
    ttlDias: 10,
    tetoDias: 30,
  })
  assert.deepEqual(r, depois(10, agora))
})

test("não passa do teto absoluto desde a criação", () => {
  const agora = depois(25)
  const r = proximaExpiracao({
    agora,
    expiraEm: depois(35 - 10),
    criadaEm: t0,
    ttlDias: 10,
    tetoDias: 30,
  })
  // alvo = min(25+10, 30) = dia 30; ganho sobre o vencimento atual (dia 25) = 5 dias
  assert.deepEqual(r, depois(30))
})

test("no teto, a renovação para (ganho zero)", () => {
  const r = proximaExpiracao({
    agora: depois(28),
    expiraEm: depois(30),
    criadaEm: t0,
    ttlDias: 10,
    tetoDias: 30,
  })
  assert.equal(r, null)
})

test("vencimento já além do alvo (TTL reduzido por config) nunca encurta a sessão", () => {
  const r = proximaExpiracao({
    agora: depois(3),
    expiraEm: depois(20),
    criadaEm: t0,
    ttlDias: 10,
    tetoDias: 30,
  })
  assert.equal(r, null)
})
