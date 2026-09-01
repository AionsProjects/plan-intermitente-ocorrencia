import test from "node:test"
import assert from "node:assert/strict"
import {
  FIM_FORMATO_ANTIGO_POR_BENEFICIO,
  SPLIT_BENEFICIO_A_PARTIR_DE,
  caixaEfetiva,
  ehEfeitoFormatoAntigo,
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

test("ehEfeitoFormatoAntigo: só efeito de antes de 14/08/2026 é da era antiga", () => {
  assert.equal(ehEfeitoFormatoAntigo(new Date("2026-08-12T10:00:00Z")), true)
  assert.equal(ehEfeitoFormatoAntigo("2026-08-13T23:59:59Z"), true)
  assert.equal(ehEfeitoFormatoAntigo(FIM_FORMATO_ANTIGO_POR_BENEFICIO), false)
  assert.equal(ehEfeitoFormatoAntigo(new Date("2026-09-01T14:09:07Z")), false)
})

test("efeito de agora NÃO é formato antigo — foi o que derrubou o pagamento de 01/09", () => {
  // O step do VT lia a chave `caju_credito_vr` que o step do VR tinha acabado de confirmar
  // (14:09:07Z) e a tratava como pagamento da era antiga, estourando no meio do dinheiro.
  assert.equal(ehEfeitoFormatoAntigo(new Date("2026-09-01T14:09:07.914Z")), false)
})

test("ehEfeitoFormatoAntigo: sem data e data ilegível não inventam colisão", () => {
  assert.equal(ehEfeitoFormatoAntigo(null), false)
  assert.equal(ehEfeitoFormatoAntigo(undefined), false)
  assert.equal(ehEfeitoFormatoAntigo("nao-e-data"), false)
})
