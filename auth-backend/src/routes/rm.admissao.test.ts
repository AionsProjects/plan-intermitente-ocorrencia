// Mapeamento da BEN 2 -> payload do front. Puro, sem RM.
//
// Nasceu de um bug em produção (13/08): a `Data de Admissão` do RM vem como dateTime com fuso e
// ia CRUA até a coluna `Admissão` do board, que é text. O board ficou com metade das linhas em
// `06/08/2026` (legado, à mão) e metade em `2026-08-06T00:00:00-03:00`.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mapearEmpregadoBen2 } from "./rm.js"

const linha = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  "Nome do Intermitente": "KETLEM RAMOS MATOS",
  "Seção": "01.01.0085.01.0112",
  "Descrição Seção": "SEMSA - INTERMITENTE",
  "Matrícula/Chapa": "007419",
  CPF: "03523895243",
  "Data de Admissão": "2026-08-12T00:00:00-03:00",
  "Função": "AUXILIAR DE SERVIÇOS GERAIS",
  "Vale Transporte": "SIM",
  ...over,
})

test("admissão sai YYYY-MM-DD, sem hora e sem fuso", () => {
  assert.equal(mapearEmpregadoBen2(linha()).admissao, "2026-08-12")
})

test("meia-noite -03:00 NÃO muda de dia", () => {
  // O caso que `new Date(...).toISOString()` erraria dependendo do fuso da máquina. A admissão
  // é o piso da data do ato no S-2260: um dia a menos muda o documento enviado ao eSocial.
  for (const iso of [
    "2026-01-01T00:00:00-03:00",
    "2026-12-31T00:00:00-03:00",
    "2026-03-01T00:00:00-04:00",
  ]) {
    assert.equal(mapearEmpregadoBen2(linha({ "Data de Admissão": iso })).admissao, iso.slice(0, 10))
  }
})

test("aceita o que o RM já mandava seco e o pt-BR do board", () => {
  assert.equal(mapearEmpregadoBen2(linha({ "Data de Admissão": "2026-08-12" })).admissao, "2026-08-12")
  assert.equal(mapearEmpregadoBen2(linha({ "Data de Admissão": "12/08/2026" })).admissao, "2026-08-12")
})

test("admissão ausente ou lixo vira string vazia, não 'Invalid Date'", () => {
  for (const v of [null, undefined, "", "  ", "nao informado"]) {
    assert.equal(mapearEmpregadoBen2(linha({ "Data de Admissão": v })).admissao, "")
  }
})

test("resto do payload segue intacto (contrato inferido da seção, VT nas duas chaves)", () => {
  const r = mapearEmpregadoBen2(linha())
  assert.equal(r.nome, "KETLEM RAMOS MATOS")
  assert.equal(r.chapa, "007419")
  // Formato do RM (`85-SEMSA`), não o label do board (`SEMSA`) — quem escolhe o contrato no
  // /convocar é o operador, pelo select; este campo é informativo.
  assert.equal(r.contrato, "85-SEMSA")
  assert.equal(r.localUnidade, "SEMSA - INTERMITENTE")
  // As duas chaves de VT: o front lê `optante_vt` (snake). Só camelCase zerava o VT de todo mundo.
  assert.equal(r.optante_vt, "SIM")
  assert.equal(r.optanteVT, "SIM")
  assert.equal(r.codcoligada, 3)
})
