// Nota de débito do crédito no Plano — puro, sem Monday nem banco.
// Roda: node --env-file=.env.example --env-file=.env.test --import tsx --test src/services/notaDebitoPlano.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  COLUNA_NOTA_VR,
  COLUNA_NOTA_VT,
  colunasNotaDoBoard,
  idsNotaCredito,
  juntarNota,
  valoresNota,
} from "./notaDebitoPlano.js"
import { notaDebitoUrl } from "../clients/caju.js"

test("separado (09/2026 em diante): cada benefício com o seu pedido", () => {
  assert.deepEqual(
    idsNotaCredito({ pedidoVR: "ord-vr", pedidoVT: "ord-vt", creditoVR: 49, creditoVT: 20, junto: false }),
    { vr: "ord-vr", vt: "ord-vt" },
  )
})

test("junto (gaveta até 08/2026): o pedido único é a nota dos dois", () => {
  assert.deepEqual(
    idsNotaCredito({ pedidoVR: "ord-par", pedidoVT: null, creditoVR: 49, creditoVT: 20, junto: true }),
    { vr: "ord-par", vt: "ord-par" },
  )
})

test("benefício sem crédito não tem nota (não optante de VT, tudo em PIX)", () => {
  assert.deepEqual(
    idsNotaCredito({ pedidoVR: "ord-vr", pedidoVT: null, creditoVR: 49, creditoVT: 0, junto: false }),
    { vr: "ord-vr", vt: null },
  )
  assert.deepEqual(
    idsNotaCredito({ pedidoVR: null, pedidoVT: null, creditoVR: 0, creditoVT: 0, junto: false }),
    { vr: null, vt: null },
  )
})

test("no formato separado o VT nunca herda o pedido do VR", () => {
  // Pedido do VT ausente com crédito de VT é defeito a montante — gravar o do VR aqui mentiria.
  assert.deepEqual(
    idsNotaCredito({ pedidoVR: "ord-vr", pedidoVT: null, creditoVR: 49, creditoVT: 20, junto: false }),
    { vr: "ord-vr", vt: null },
  )
})

test("acrescenta sem repetir, no separador do app", () => {
  assert.equal(juntarNota(null, "a"), "a")
  assert.equal(juntarNota("a", "b"), "a; b")
  assert.equal(juntarNota("a; b", "a"), "a; b", "o mesmo pedido não entra duas vezes")
  assert.equal(juntarNota(" a , b ", "c"), "a; b; c", "vírgula e espaço de quem editou à mão")
  assert.equal(juntarNota("a", ""), "a")
})

test("valores só pras colunas que existem e têm id novo", () => {
  const cols = { vr: "text_vr", vt: "text_vt" }
  assert.deepEqual(valoresNota(cols, { vr: "x", vt: "y" }), { text_vr: "x", text_vt: "y" })
  assert.deepEqual(valoresNota(cols, { vr: "x", vt: null }, { vt: "antigo" }), { text_vr: "x" })
  assert.deepEqual(valoresNota(cols, { vr: null, vt: "y" }, { vt: "antigo" }), { text_vt: "antigo; y" })
  assert.deepEqual(valoresNota({ vr: null, vt: null }, { vr: "x", vt: "y" }), {}, "board sem as colunas: nada")
})

test("colunas: registry primeiro, Monday só pro que faltar, título sem acento/caixa", async () => {
  let leu = 0
  const ler = async () => {
    leu++
    return [{ id: "text_mm_vt", title: "crédito vt nota" }, { id: "text_x", title: "OUTRA" }]
  }
  const registry = new Map([["CREDITO VR NOTA", "text_mm_vr"]])
  const c = await colunasNotaDoBoard("18431035464", registry, ler)
  assert.deepEqual(c, { vr: "text_mm_vr", vt: "text_mm_vt" })
  assert.equal(leu, 1)
  const cheio = new Map([["CREDITO VR NOTA", "a"], ["CREDITO VT NOTA", "b"]])
  await colunasNotaDoBoard("18431035464", cheio, ler)
  assert.equal(leu, 1, "com as duas no registry não pergunta ao Monday")
  assert.equal(COLUNA_NOTA_VR, "CREDITO VR NOTA")
  assert.equal(COLUNA_NOTA_VT, "CREDITO VT NOTA")
})

test("link da nota: padrão medido no painel da Caju", () => {
  // `.env.example`/`.env.test` não definem CAJU_NOTA_URL, então vale o padrão do código.
  assert.equal(
    notaDebitoUrl("8630d80a-b2ab-4b1b-81e3-ece246f4a8eb"),
    "https://empresa.caju.com.br/classic/#/debit_note/8630d80a-b2ab-4b1b-81e3-ece246f4a8eb",
  )
  assert.equal(notaDebitoUrl(null), "")
})
