// Reancoragem do rastro do RM na virada — banco REAL com sentinelas, lookup do Monday stubado.
// O que se prova aqui: quem é movido, quem NÃO é, e que o não-encontrado vira pendência visível
// em vez de sumir. Roda: node --env-file=.env --import tsx --test src/services/viradaConvocacoesRm.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import {
  confirmarLancamentoRm,
  lancamentosDoItem,
  lancamentosVivosPorItens,
  reservarLancamentoRm,
} from "../repo/convocacoesRm.js"
import { remapearConvocacoesRmParaBoard, type itensPorCodigoRm } from "./viradaConvocacoesRm.js"

const ITEM_VELHO = 999000901
const ITEM_VELHO_2 = 999000902
const ITEM_NOVO = "999000951"
const CHAPA = "998877"
const BOARD_COPIA = "18999999999"

async function limpar() {
  for (const i of [ITEM_VELHO, ITEM_VELHO_2, Number(ITEM_NOVO)]) {
    await query(`DELETE FROM convocacoes_rm WHERE item_origem_id = $1`, [i])
  }
}

async function noRm(item: number, codigo: string, inicio = "2099-09-01", fim = "2099-09-20") {
  const r = await reservarLancamentoRm({
    itemOrigemId: item, chapa: CHAPA, contrato: "TESTE",
    dataInicio: inicio, dataFim: fim, origemAcao: "teste",
  })
  await confirmarLancamentoRm(r.lancamento.id, { codigo, pkRm: `3;${CHAPA};${codigo}` })
  return r.lancamento.id
}

/** Stub do lookup no Monday: só o que o mapa disser existe na cópia. */
const busca = (mapa: Record<string, string>): typeof itensPorCodigoRm =>
  (async (_b: string, _c: string, codigos: string[]) => {
    const m = new Map<string, string>()
    for (const cod of codigos) if (mapa[cod]) m.set(cod, mapa[cod])
    return m
  }) as typeof itensPorCodigoRm

test("setup", limpar)

test("os DOIS ids acham a mesma linha depois da virada", async () => {
  await limpar()
  await noRm(ITEM_VELHO, "C03S999901")
  const r = await remapearConvocacoesRmParaBoard(BOARD_COPIA, "text_x", busca({ C03S999901: ITEM_NOVO }))
  const meu = r.remapeados.find((x) => x.codigo === "C03S999901")
  assert.ok(meu, "tinha que gravar o espelho")
  assert.equal(meu!.de, String(ITEM_VELHO))
  assert.equal(meu!.para, ITEM_NOVO)

  // Cancelamento vindo da CÓPIA (o DP reativou lá).
  const [pelaCopia] = await lancamentosDoItem(Number(ITEM_NOVO), { apenasVivos: true })
  assert.equal(pelaCopia?.codigo, "C03S999901")
  // Cancelamento vindo do HISTÓRICO (link aponta pro item arquivado). Este é o caminho que
  // trocar a âncora teria quebrado.
  const [peloOriginal] = await lancamentosDoItem(ITEM_VELHO, { apenasVivos: true })
  assert.equal(peloOriginal?.codigo, "C03S999901")
  assert.equal(pelaCopia!.id, peloOriginal!.id, "é a MESMA linha, não duas")

  assert.equal(String(peloOriginal!.item_origem_id), String(ITEM_VELHO), "âncora não se move")
  assert.match(String(peloOriginal!.observacao), /virada: espelho 999000901 -> 999000951/)
})

test("lote por itens indexa pelo id que o caller pediu", async () => {
  const mapa = await lancamentosVivosPorItens([ITEM_NOVO])
  assert.equal(mapa.get(ITEM_NOVO)?.length, 1, "varredura do board da cópia tem que enxergar")
})

test("rodar de novo não grava nada — a virada pode ser reexecutada", async () => {
  const r = await remapearConvocacoesRmParaBoard(BOARD_COPIA, "text_x", busca({ C03S999901: ITEM_NOVO }))
  assert.equal(r.remapeados.filter((x) => x.codigo === "C03S999901").length, 0)
  assert.ok(r.jaNoBoard >= 1)
})

test("código vivo SEM item na cópia vira pendência, não sumiço", async () => {
  await limpar()
  await noRm(ITEM_VELHO_2, "C03S999902")
  // Item apagado à mão pelo DP: o registro no RM ficou órfão. Engolir isso seria perder o
  // único aviso de que existe um S-2260 sem dono.
  const r = await remapearConvocacoesRmParaBoard(BOARD_COPIA, "text_x", busca({}))
  const p = r.semItemNaCopia.find((x) => x.codigo === "C03S999902")
  assert.ok(p, "tinha que reportar")
  assert.equal(p!.item_origem_id, String(ITEM_VELHO_2))
  const [l] = await lancamentosDoItem(ITEM_VELHO_2, { apenasVivos: true })
  assert.ok(l, "a linha continua onde estava — nada é apagado por não achar item")
})

test("linha `reservado` (sem código) é reportada, não adivinhada", async () => {
  await limpar()
  await reservarLancamentoRm({
    itemOrigemId: ITEM_VELHO, chapa: CHAPA, contrato: "TESTE",
    dataInicio: "2099-09-01", dataFim: "2099-09-20", origemAcao: "teste",
  })
  const r = await remapearConvocacoesRmParaBoard(BOARD_COPIA, "text_x", busca({}))
  assert.ok(
    r.semCodigo.some((x) => x.item_origem_id === String(ITEM_VELHO)),
    "sem código não há chave determinística — casar por nome/período seria chute",
  )
})

test("teardown", limpar)
