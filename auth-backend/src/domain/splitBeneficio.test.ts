import test from "node:test"
import assert from "node:assert/strict"
import {
  SPLIT_BENEFICIO_A_PARTIR_DE,
  caixaEfetiva,
  gruposBeneficio,
  splitPorBeneficio,
  sufixoGrupo,
} from "./splitBeneficio.js"

test("o corte é a gaveta de 09/2026 — agosto junto, setembro separado", () => {
  assert.equal(SPLIT_BENEFICIO_A_PARTIR_DE, "2026-09")
  assert.equal(splitPorBeneficio("2026-07"), false)
  assert.equal(splitPorBeneficio("2026-08"), false)
  assert.equal(splitPorBeneficio("2026-09"), true)
  assert.equal(splitPorBeneficio("2026-10"), true)
  // Vira o ano sem regredir: comparação é de string YYYY-MM, não de número de mês.
  assert.equal(splitPorBeneficio("2027-01"), true)
  assert.equal(splitPorBeneficio("2025-12"), false)
})

test("gaveta com dia junto ainda é lida (YYYY-MM-DD -> YYYY-MM)", () => {
  assert.equal(splitPorBeneficio("2026-09-01"), true)
  assert.equal(splitPorBeneficio("2026-08-31"), false)
})

test("gaveta ilegível ESTOURA — escolher formato errado num #dinheiro-real é pior que parar", () => {
  for (const ruim of ["", "setembro", "2026", "26-09", "abc-de"]) {
    assert.throws(() => splitPorBeneficio(ruim), /caixa_invalida_para_split/)
  }
})

test("caixaEfetiva: a explícita manda; sem ela, o mês do dataIso (mesma queda do grupo)", () => {
  assert.equal(caixaEfetiva("2026-08", "2026-09-15"), "2026-08")
  assert.equal(caixaEfetiva(undefined, "2026-09-15"), "2026-09")
  assert.equal(caixaEfetiva(null, "2026-08-31"), "2026-08")
  assert.equal(caixaEfetiva("lixo", "2026-09-02"), "2026-09")
})

test("gruposBeneficio: um grupo com os dois antes do corte, dois grupos depois", () => {
  assert.deepEqual(gruposBeneficio("2026-08"), [["VR", "VT"]])
  assert.deepEqual(gruposBeneficio("2026-09"), [["VR"], ["VT"]])
})

test("sufixoGrupo: rótulo só quando o grupo é de um benefício só", () => {
  assert.equal(sufixoGrupo(["VR"]), "VR")
  assert.equal(sufixoGrupo(["VT"]), "VT")
  assert.equal(sufixoGrupo(["VR", "VT"]), "")
})
