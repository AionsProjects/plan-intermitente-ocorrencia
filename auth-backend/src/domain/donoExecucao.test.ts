// Dono da linha de execução — puro, sem banco.
// Roda: node --import tsx --test src/domain/donoExecucao.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { ehDonoDaExecucao } from "./donoExecucao.js"

const KARINE = { id: "u-karine", email: "karine.romaskevis@contatoserv.com.br" }

test("linha da rota PÚBLICA (sem user_id) com o operador da sessão é dela — sem fantasma", () => {
  // KAREN 25/09/2026: a rota do cancelamento abriu a linha com o operador do corpo e user_id
  // NULL; a abertura do front chegou 1,3 s depois, foi tratada como "de outra pessoa" e virou
  // uma segunda linha, 'aberta' pra sempre.
  assert.equal(
    ehDonoDaExecucao({ user_id: null, operador_email: "Karine.Romaskevis@contatoserv.com.br " }, KARINE),
    true,
  )
})

test("linha pública sem operador nenhum também — o id foi cunhado por este front", () => {
  assert.equal(ehDonoDaExecucao({ user_id: null, operador_email: null }, KARINE), true)
})

test("linha pública carimbada com OUTRO operador não é dela", () => {
  assert.equal(
    ehDonoDaExecucao({ user_id: null, operador_email: "outra.pessoa@contatoserv.com.br" }, KARINE),
    false,
  )
})

test("com user_id, vale só o próprio — o e-mail não substitui o dono", () => {
  assert.equal(ehDonoDaExecucao({ user_id: "u-karine", operador_email: null }, KARINE), true)
  assert.equal(
    ehDonoDaExecucao({ user_id: "u-outro", operador_email: KARINE.email }, KARINE),
    false,
    "linha com dono de sessão não pode ser tomada por quem só coincide no e-mail",
  )
})
