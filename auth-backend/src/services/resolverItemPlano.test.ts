// Cascata de resolução uuid_alvo -> item do Plano. As fontes são injetadas, então
// nada aqui toca banco ou rede — mas o módulo importa db.js/config.js em cadeia, que
// exigem ambiente. Rodar com --env-file (é o que `npm test` faz):
//   node --env-file=.env --import tsx --test src/services/resolverItemPlano.test.ts
// (Definir process.env no topo do arquivo NÃO resolve: ESM iça os imports acima.)
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatoAlvo,
  resolverVarios,
  resolverItemDoPlano,
  type Fontes,
  type NivelResolucao,
} from "./resolverItemPlano.js"

const UUID_A = "d288f9c2-3015-46fb-8591-c9c0fb185ba9"
const UUID_B = "de1b6fc7-eeff-4652-834d-3774be51c293"

interface Espiao extends Fontes {
  chamadas: { cache: string[][]; convocacoes: string[][]; monday: string[]; gravou: unknown[] }
}

function fakeFontes(opts: {
  cache?: Record<string, { itemId: number; nivel: NivelResolucao }>
  convocacoes?: Record<string, number>
  monday?: Record<string, number | "erro">
  gravarFalha?: boolean
} = {}): Espiao {
  const chamadas: Espiao["chamadas"] = { cache: [], convocacoes: [], monday: [], gravou: [] }
  return {
    chamadas,
    async cache(uuids) {
      chamadas.cache.push(uuids)
      const m = new Map<string, { itemId: number; boardId: number | null; nivel: NivelResolucao }>()
      for (const u of uuids) {
        const hit = opts.cache?.[u]
        if (hit) m.set(u, { itemId: hit.itemId, boardId: null, nivel: hit.nivel })
      }
      return m
    },
    async convocacoes(uuids) {
      chamadas.convocacoes.push(uuids)
      const m = new Map<string, { itemId: number; boardId: number | null }>()
      for (const u of uuids) {
        const hit = opts.convocacoes?.[u]
        if (hit) m.set(u, { itemId: hit, boardId: null })
      }
      return m
    },
    async monday(uuid) {
      chamadas.monday.push(uuid)
      const hit = opts.monday?.[uuid]
      if (hit === "erro") throw new Error("Monday GraphQL falhou (HTTP 500)")
      return hit ? { itemId: hit, boardId: 18418191275 } : null
    },
    async gravarCache(entradas) {
      if (opts.gravarFalha) throw new Error("cache indisponivel")
      chamadas.gravou.push(...entradas)
    },
  }
}

// ---------------------------------------------------------------------------
test("formatoAlvo: separa item_id, uuid e chave composta", () => {
  assert.equal(formatoAlvo("12749358219"), "item") // acao=convocacao
  assert.equal(formatoAlvo(UUID_A), "uuid") // acao=registro/cancelamento
  assert.equal(formatoAlvo("SEMSA:CENTRO:2026-05-20"), "outro") // ponto_facultativo
  assert.equal(formatoAlvo(""), "outro")
  assert.equal(formatoAlvo(null), "outro")
  assert.equal(formatoAlvo("  12749358219  "), "item") // tolera espaço
})

test("nivel 1: uuid_alvo numerico resolve sem tocar em nenhuma fonte", async () => {
  const f = fakeFontes()
  const r = await resolverVarios(["12749358219"], f)
  assert.deepEqual(r.get("12749358219"), {
    itemId: 12749358219, boardId: null, nivel: 1, fonte: "direto",
  })
  assert.equal(f.chamadas.cache.length, 0)
  assert.equal(f.chamadas.convocacoes.length, 0)
  assert.equal(f.chamadas.monday.length, 0)
})

test("nivel 2: acha em pi.convocacoes e grava no cache", async () => {
  const f = fakeFontes({ convocacoes: { [UUID_A]: 12534248944 } })
  const r = await resolverVarios([UUID_A], f)
  assert.deepEqual(r.get(UUID_A), {
    itemId: 12534248944, boardId: null, nivel: 2, fonte: "convocacoes",
  })
  assert.equal(f.chamadas.monday.length, 0, "nao deve ir ao Monday se o Postgres resolveu")
  assert.deepEqual(f.chamadas.gravou, [{ uuid: UUID_A, itemId: 12534248944, boardId: null, nivel: 2 }])
})

test("nivel 3: orfao do Postgres cai no Monday e grava no cache", async () => {
  const f = fakeFontes({ monday: { [UUID_A]: 12533822002 } })
  const r = await resolverVarios([UUID_A], f)
  assert.deepEqual(r.get(UUID_A), {
    itemId: 12533822002, boardId: 18418191275, nivel: 3, fonte: "monday",
  })
  assert.deepEqual(f.chamadas.monday, [UUID_A])
  assert.equal((f.chamadas.gravou[0] as { nivel: number }).nivel, 3)
})

test("cache hit curto-circuita Postgres e Monday", async () => {
  const f = fakeFontes({
    cache: { [UUID_A]: { itemId: 999, nivel: 3 } },
    convocacoes: { [UUID_A]: 111 },
    monday: { [UUID_A]: 222 },
  })
  const r = await resolverVarios([UUID_A], f)
  assert.equal(r.get(UUID_A)?.itemId, 999)
  assert.equal(r.get(UUID_A)?.fonte, "cache")
  assert.equal(f.chamadas.convocacoes.length, 0)
  assert.equal(f.chamadas.monday.length, 0)
  assert.equal(f.chamadas.gravou.length, 0, "cache hit nao regrava")
})

test("dedupe: mesmo uuid repetido consulta uma vez so", async () => {
  // uma convocacao escreve ~12 colunas -> 12 activity_logs com o mesmo uuid_alvo
  const f = fakeFontes({ convocacoes: { [UUID_A]: 12534248944 } })
  const r = await resolverVarios(Array(12).fill(UUID_A), f)
  assert.equal(r.size, 1)
  assert.deepEqual(f.chamadas.cache, [[UUID_A]])
  assert.deepEqual(f.chamadas.convocacoes, [[UUID_A]])
})

test("falha do Monday num alvo nao derruba os outros", async () => {
  const f = fakeFontes({ monday: { [UUID_A]: "erro", [UUID_B]: 12563120398 } })
  const r = await resolverVarios([UUID_A, UUID_B], f)
  assert.equal(r.has(UUID_A), false, "o que falhou fica de fora")
  assert.equal(r.get(UUID_B)?.itemId, 12563120398, "o outro resolve normalmente")
  assert.equal(f.chamadas.gravou.length, 1)
})

test("cache que nao grava nao invalida a resolucao da rodada", async () => {
  const f = fakeFontes({ monday: { [UUID_A]: 12533822002 }, gravarFalha: true })
  const r = await resolverVarios([UUID_A], f)
  assert.equal(r.get(UUID_A)?.itemId, 12533822002)
})

test("chave composta (ponto_facultativo/split) fica de fora sem consultar nada", async () => {
  const f = fakeFontes()
  const r = await resolverVarios(["SEMSA:CENTRO:2026-05-20", null, ""], f)
  assert.equal(r.size, 0)
  assert.equal(f.chamadas.cache.length, 0)
})

test("lote misto: cada alvo pela sua rota, uma ida ao Monday so", async () => {
  const f = fakeFontes({
    cache: { [UUID_A]: { itemId: 700, nivel: 2 } },
    convocacoes: { [UUID_B]: 800 },
    monday: { "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee": 900 },
  })
  const r = await resolverVarios(
    ["12749358219", UUID_A, UUID_B, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "chave:composta"],
    f,
  )
  assert.equal(r.size, 4, "a chave composta nao entra")
  assert.equal(r.get("12749358219")?.nivel, 1)
  assert.equal(r.get(UUID_A)?.nivel, 2)
  assert.equal(r.get(UUID_B)?.nivel, 2)
  assert.equal(r.get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")?.nivel, 3)
  assert.equal(f.chamadas.monday.length, 1, "so o que sobrou dos niveis 1 e 2 vai a rede")
})

test("resolverItemDoPlano: atalho de 1 alvo", async () => {
  const f = fakeFontes({ convocacoes: { [UUID_A]: 12534248944 } })
  assert.equal((await resolverItemDoPlano(UUID_A, f))?.itemId, 12534248944)
  assert.equal(await resolverItemDoPlano("nao-existe-uuid", f), null)
})
