// Item do Plano pra escrever depois da virada — tudo injetado, sem banco nem Monday.
// O caso real: ELIANA (007412), cancelamento de 28/09/2026 escrito no item ARQUIVADO 12820165166;
// a cópia viva é 13044676426 e seguiu mostrando o corte velho.
// Roda: node --env-file=.env.example --env-file=.env.test --import tsx --test src/services/itemPlanoVigente.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { equivalentesVirada, itemPlanoVigente, type DepsItemPlano } from "./itemPlanoVigente.js"

const ORIGINAL = { itemId: "12820165166", boardId: "18418191275" }
const COPIA = "13044676426"
const BOARD_COPIA = "18431035464"

function deps(over: Partial<DepsItemPlano> & { estadosFixos?: Record<string, { state: string; boardId: string | null }> } = {}) {
  const chamadas = { estados: 0 }
  const d: Partial<DepsItemPlano> = {
    espelhos: async () => [COPIA],
    estados: async (ids) => {
      chamadas.estados++
      const fixos = over.estadosFixos ?? {
        [ORIGINAL.itemId]: { state: "archived", boardId: ORIGINAL.boardId },
        [COPIA]: { state: "active", boardId: BOARD_COPIA },
      }
      return new Map(ids.filter((i) => fixos[i]).map((i) => [i, fixos[i]!]))
    },
    ...over,
  }
  return { d, chamadas }
}

test("original arquivado + cópia ativa: escreve na cópia, no board dela", async () => {
  const { d } = deps()
  const r = await itemPlanoVigente(ORIGINAL, d)
  assert.deepEqual(r, { itemId: COPIA, boardId: BOARD_COPIA, arquivado: ORIGINAL.itemId })
})

test("sem espelho no rastro: fica no item de sempre, sem perguntar ao Monday", async () => {
  const { d, chamadas } = deps({ espelhos: async () => [] })
  const r = await itemPlanoVigente(ORIGINAL, d)
  assert.deepEqual(r, ORIGINAL)
  assert.equal(chamadas.estados, 0, "sem espelho não há o que confirmar")
})

test("original ainda ativo: não troca (nunca escreve em dois lugares)", async () => {
  const { d } = deps({
    estadosFixos: {
      [ORIGINAL.itemId]: { state: "active", boardId: ORIGINAL.boardId },
      [COPIA]: { state: "active", boardId: BOARD_COPIA },
    },
  })
  assert.deepEqual(await itemPlanoVigente(ORIGINAL, d), ORIGINAL)
})

test("cópia também arquivada ou sumida: fica no original — falha visível, não item errado", async () => {
  const arquivada = deps({
    estadosFixos: {
      [ORIGINAL.itemId]: { state: "archived", boardId: ORIGINAL.boardId },
      [COPIA]: { state: "archived", boardId: BOARD_COPIA },
    },
  })
  assert.deepEqual(await itemPlanoVigente(ORIGINAL, arquivada.d), ORIGINAL)
  const sumida = deps({ estadosFixos: { [ORIGINAL.itemId]: { state: "archived", boardId: ORIGINAL.boardId } } })
  assert.deepEqual(await itemPlanoVigente(ORIGINAL, sumida.d), ORIGINAL)
})

test("dois espelhos: ambíguo, fica no original", async () => {
  const { d } = deps({ espelhos: async () => [COPIA, "13099999999"] })
  assert.deepEqual(await itemPlanoVigente(ORIGINAL, d), ORIGINAL)
})

test("banco ou Monday fora: fica no original, não derruba a rota", async () => {
  const semBanco = deps({ espelhos: async () => { throw new Error("pg caiu") } })
  assert.deepEqual(await itemPlanoVigente(ORIGINAL, semBanco.d), ORIGINAL)
  const semMonday = deps({ estados: async () => { throw new Error("Monday GraphQL falhou (HTTP 500)") } })
  assert.deepEqual(await itemPlanoVigente(ORIGINAL, semMonday.d), ORIGINAL)
})

test("já está na cópia (espelho PG reapontado): nada a trocar", async () => {
  const { d } = deps({ espelhos: async () => [] })
  const r = await itemPlanoVigente({ itemId: COPIA, boardId: BOARD_COPIA }, d)
  assert.deepEqual(r, { itemId: COPIA, boardId: BOARD_COPIA })
})

test("sem item: devolve como veio", async () => {
  const { d, chamadas } = deps()
  assert.deepEqual(await itemPlanoVigente({ itemId: null, boardId: null }, d), { itemId: null, boardId: null })
  assert.equal(chamadas.estados, 0)
})

// ── equivalência (leitura por item dos dois lados da virada) ─────────────────

test("equivalência vale nos dois sentidos e inclui o próprio id", async () => {
  const pares = async () => [{ o: ORIGINAL.itemId, e: COPIA }]
  const m = await equivalentesVirada([ORIGINAL.itemId, COPIA], pares)
  assert.deepEqual(m.get(ORIGINAL.itemId)?.sort(), [ORIGINAL.itemId, COPIA].sort())
  assert.deepEqual(m.get(COPIA)?.sort(), [ORIGINAL.itemId, COPIA].sort())
})

test("item sem virada volta só ele; id inválido e vazio são ignorados", async () => {
  const m = await equivalentesVirada(["13148604608", null, "", "abc"], async () => [])
  assert.deepEqual([...m.keys()], ["13148604608"])
  assert.deepEqual(m.get("13148604608"), ["13148604608"])
})

test("sem id válido nem consulta o banco", async () => {
  let consultou = false
  const m = await equivalentesVirada([null, undefined, ""], async () => { consultou = true; return [] })
  assert.equal(m.size, 0)
  assert.equal(consultou, false)
})
