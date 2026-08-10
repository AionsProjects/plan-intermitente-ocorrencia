// Roda: node --import tsx --test src/services/ausenciasRm.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { ausenciasDaConvocacao, ausenciasDoContrato, ORDEM_PARAMETROS_ATESTADOS } from "./ausenciasRm.js"
import type { LinhaAtestadoRm } from "../domain/ausencias.js"

const linha = (ini: string, fim: string): LinhaAtestadoRm => ({
  CHAPA: "006824",
  DT_INICIO: ini,
  DT_FINAL: fim,
  COD_TIPO_ATESTADO: "10",
  TIPO_ATESTADO: "Atestado Medico",
})

test("a ordem dos parâmetros é contrato com o RM, não estilo", () => {
  // O RM casa parâmetro por POSIÇÃO na querystring (medido 10/08/2026). Com `:DATA_FINAL` antes
  // de `:DATA_INICIAL` na sentença, a MESMA janela devolveu 6 linhas em vez de 24 — sem erro
  // nenhum, porque a janela virava o seu complemento. Reordenar aqui reintroduz isso calado.
  assert.deepEqual([...ORDEM_PARAMETROS_ATESTADOS], ["CHAPA", "DATA_INICIAL", "DATA_FINAL"])
})

test("passa a janela pedida pra consulta", async () => {
  let visto: unknown
  await ausenciasDaConvocacao("006824", "2026-08-05", "2026-08-20", async (p) => {
    visto = p
    return []
  })
  assert.deepEqual(visto, { chapa: "006824", dataInicial: "2026-08-05", dataFinal: "2026-08-20" })
})

test("resultado fora da janela é ERRO, não filtro silencioso", async () => {
  // Assinatura de parâmetro trocado / sentença alterada no RM. Aceitar caladamente é o caminho
  // pra gravar convocação por cima de dia coberto por atestado.
  await assert.rejects(
    () =>
      ausenciasDaConvocacao("006824", "2026-08-05", "2026-08-20", async () => [
        linha("2026-08-10", "2026-08-11"),
        linha("2026-01-02", "2026-01-03"),
      ]),
    /fora da janela/,
  )
})

test("atestado que só encosta na borda da janela é válido", async () => {
  const r = await ausenciasDaConvocacao("006824", "2026-08-05", "2026-08-20", async () => [
    linha("2026-07-28", "2026-08-05"), // termina no primeiro dia
    linha("2026-08-20", "2026-08-30"), // começa no último
  ])
  assert.equal(r.ausencias.length, 2)
  assert.equal(r.cortes.length, 2)
})

test("chapa não-numérica não chega a consultar", async () => {
  // Filtro que não casa nada devolveria "sem atestado" — o resultado perigoso.
  let chamou = false
  await assert.rejects(
    () =>
      ausenciasDaConvocacao("6824' OR 1=1 --", "2026-08-01", "2026-08-31", async () => {
        chamou = true
        return []
      }),
    /chapa invalida/,
  )
  assert.equal(chamou, false)
})

test("RM fora do ar propaga o erro — falha fechado", async () => {
  await assert.rejects(
    () =>
      ausenciasDaConvocacao("006824", "2026-08-01", "2026-08-31", async () => {
        throw new Error("rm indisponivel")
      }),
    /rm indisponivel/,
  )
})

test("contrato: UMA consulta com '%', cortes só das chapas do contrato", async () => {
  let pedido = ""
  const mapa = await ausenciasDoContrato(
    ["007001", "7002", "007003"],
    "2026-08-01",
    "2026-08-31",
    async (p) => {
      pedido = p.chapa
      return [
        linha("2026-08-10", "2026-08-11"), // 006824 — NAO e do contrato, tem que sumir
        { ...linha("2026-08-05", "2026-08-06"), CHAPA: "007001" },
        { ...linha("2026-08-20", "2026-08-20"), CHAPA: "007002" },
      ]
    },
  )
  assert.equal(pedido, "%", "lote consulta a coligada inteira e filtra client-side")
  assert.deepEqual(mapa.get("7001"), [{ inicio: "2026-08-05", fim: "2026-08-06" }])
  assert.deepEqual(mapa.get("7002"), [{ inicio: "2026-08-20", fim: "2026-08-20" }])
  assert.equal(mapa.has("7003"), false, "chapa sem atestado nem entra no Map")
  assert.equal(mapa.has("6824"), false, "atestado de fora do contrato nao vaza")
})

test("contrato: forasteira derruba o lote inteiro — melhor atrasado que subcontado", async () => {
  await assert.rejects(
    () =>
      ausenciasDoContrato(["007001"], "2026-08-01", "2026-08-31", async () => [
        { ...linha("2026-01-02", "2026-01-03"), CHAPA: "007001" },
      ]),
    /fora da janela/,
  )
})

test("contrato: RM fora do ar propaga — falha fechado no lote também", async () => {
  await assert.rejects(
    () =>
      ausenciasDoContrato(["007001"], "2026-08-01", "2026-08-31", async () => {
        throw new Error("rm indisponivel")
      }),
    /rm indisponivel/,
  )
})
