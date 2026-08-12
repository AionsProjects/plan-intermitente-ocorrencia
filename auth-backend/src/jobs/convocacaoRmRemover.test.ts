// Job da remoção no RM — máquina de estados. O serviço é stubado por DI.
// Roda: node --env-file=.env --import tsx --test src/jobs/convocacaoRmRemover.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.CONVOCACAO_RM_HABILITADA = "1"

const { query } = await import("../db.js")
const { handlerConvocacaoRmRemover, TIPO_JOB_CONVOCACAO_RM_REMOVER } = await import("./convocacaoRmRemover.js")
const { enfileirar } = await import("./repo.js")
type Deps = NonNullable<Parameters<typeof handlerConvocacaoRmRemover>[1]>

const ITEM = "999000801"

const lancamentoFake = (id: string) =>
  ({ id, chapa: "998877", coligada: 3, codigo: "C03S999801", pk_rm: "3;998877;C03S999801", estado: "no_rm" }) as never

function deps(
  vivos: unknown[],
  resultado: { estado: string; erro?: string } | ((n: number) => { estado: string; erro?: string }),
  extra: Partial<Deps> = {},
): { d: Deps; chamadas: number } {
  let chamadas = 0
  const d: Deps = {
    listar: (async () => vivos) as Deps["listar"],
    remover: (async () => {
      chamadas++
      return (typeof resultado === "function" ? resultado(chamadas) : resultado) as never
    }) as Deps["remover"],
    habilitado: () => true,
    ...extra,
  }
  return { d, get chamadas() { return chamadas } } as never
}

async function jobNovo() {
  const id = await enfileirar(TIPO_JOB_CONVOCACAO_RM_REMOVER, { item_id: ITEM, motivo: "cancelamento_total" })
  const { rows } = await query<{ id: string; payload: Record<string, unknown>; passo: number; cursor: unknown; tentativas: number; tipo: string; estado: string }>(
    `SELECT id, tipo, estado, passo, payload, cursor, tentativas FROM jobs WHERE id=$1`, [id],
  )
  return rows[0]!
}
async function estadoDoJob(id: string) {
  const { rows } = await query<{ estado: string; erro: string | null; cursor: Record<string, unknown> | null }>(
    `SELECT estado, erro, cursor FROM jobs WHERE id=$1`, [id],
  )
  return rows[0]!
}
const limpar = async () => { await query(`DELETE FROM jobs WHERE tipo=$1`, [TIPO_JOB_CONVOCACAO_RM_REMOVER]) }

test("setup", limpar)

test("removeu tudo: conclui", async () => {
  const { d } = deps([lancamentoFake("a")], { estado: "removido" })
  const j = await jobNovo()
  await handlerConvocacaoRmRemover(j as never, d)
  assert.equal((await estadoDoJob(j.id)).estado, "concluido")
})

test("já ausente também conclui — apagar o que não está lá é inofensivo", async () => {
  // É o que dispensa um passo de conciliação separado: a releitura do serviço já concilia.
  const { d } = deps([lancamentoFake("a")], { estado: "ja_ausente" })
  const j = await jobNovo()
  await handlerConvocacaoRmRemover(j as never, d)
  assert.equal((await estadoDoJob(j.id)).estado, "concluido")
})

test("indeterminado JOGA — registro vivo no RM com board cancelado é o pior desfecho", async () => {
  const { d } = deps([lancamentoFake("a")], { estado: "indeterminado", erro: "timeout" })
  const j = await jobNovo()
  await assert.rejects(() => handlerConvocacaoRmRemover(j as never, d), /pendente/)
})

test("erro no meio de vários: joga, mas tentou TODOS antes", async () => {
  const vistos: string[] = []
  const j = await jobNovo()
  const d: Deps = {
    listar: (async () => [lancamentoFake("a"), lancamentoFake("b")]) as Deps["listar"],
    remover: (async (l: { id: string }) => {
      vistos.push(l.id)
      return (l.id === "a" ? { estado: "erro", erro: "fault" } : { estado: "removido" }) as never
    }) as Deps["remover"],
    habilitado: () => true,
  }
  await assert.rejects(() => handlerConvocacaoRmRemover(j as never, d))
  assert.deepEqual(vistos, ["a", "b"], "falhar no primeiro não pode impedir o segundo")
})

test("nada vivo no rastro: conclui sem chamar o RM", async () => {
  let chamou = false
  const d: Deps = {
    listar: (async () => []) as Deps["listar"],
    remover: (async () => { chamou = true; return { estado: "removido" } as never }) as Deps["remover"],
    habilitado: () => true,
  }
  const j = await jobNovo()
  await handlerConvocacaoRmRemover(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.nota, "nada_vivo")
  assert.equal(chamou, false)
})

test("flag desligada: conclui sem tocar no RM", async () => {
  let chamou = false
  const d: Deps = {
    listar: (async () => [lancamentoFake("a")]) as Deps["listar"],
    remover: (async () => { chamou = true; return { estado: "removido" } as never }) as Deps["remover"],
    habilitado: () => false,
  }
  const j = await jobNovo()
  await handlerConvocacaoRmRemover(j as never, d)
  assert.equal((await estadoDoJob(j.id)).cursor?.nota, "desligado")
  assert.equal(chamou, false)
})

test("teardown", limpar)
