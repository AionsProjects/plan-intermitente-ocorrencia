// Job da substituição — máquina de estados, serviço stubado por DI.
// O ponto do arquivo: provar que ele NÃO regrava por cima de reserva muda.
// Roda: node --env-file=.env --import tsx --test src/jobs/convocacaoRmSubstituir.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.CONVOCACAO_RM_HABILITADA = "1"

const { query } = await import("../db.js")
const { handlerConvocacaoRmSubstituir, TIPO_JOB_CONVOCACAO_RM_SUBSTITUIR } =
  await import("./convocacaoRmSubstituir.js")
const { enfileirar } = await import("./repo.js")
type Deps = NonNullable<Parameters<typeof handlerConvocacaoRmSubstituir>[1]>

const ITEM = "999001101"

const vivo = (estado: string, id = "a") =>
  ({ id, chapa: "998877", coligada: 3, codigo: estado === "reservado" ? null : "C03S999901", estado,
     data_inicio: "2099-07-01", data_fim: "2099-07-20" }) as never

const ok = { remocoes: [], gravacoes: [], intactos: [], temPendencia: false } as never

function deps(extra: Partial<Deps> = {}): Deps {
  return {
    listar: (async () => []) as Deps["listar"],
    bifurcar: (async () => ok) as Deps["bifurcar"],
    reverter: (async () => ok) as Deps["reverter"],
    habilitado: () => true,
    ...extra,
  }
}

async function jobNovo(tipo: "aplicar" | "reverter" = "aplicar") {
  const id = await enfileirar(TIPO_JOB_CONVOCACAO_RM_SUBSTITUIR, {
    item_id: ITEM, tipo, corte: "2099-07-12", contrato_parte1: "SEMSA", contrato_parte2: "DETRAN",
  })
  const { rows } = await query<{ id: string; payload: Record<string, unknown>; passo: number; cursor: unknown; tentativas: number; tipo: string; estado: string }>(
    `SELECT id, tipo, estado, passo, payload, cursor, tentativas FROM jobs WHERE id=$1`, [id],
  )
  return rows[0]!
}
async function estadoDoJob(id: string) {
  const { rows } = await query<{ estado: string; cursor: Record<string, unknown> | null }>(
    `SELECT estado, cursor FROM jobs WHERE id=$1`, [id],
  )
  return rows[0]!
}
const limpar = async () => { await query(`DELETE FROM jobs WHERE tipo=$1`, [TIPO_JOB_CONVOCACAO_RM_SUBSTITUIR]) }

test("setup", limpar)

test("reserva MUDA para o job e pede conciliação — nunca regrava por cima", async () => {
  // `reservado` = SaveRecord sem resposta: PODE ter gravado. Reenviar emitiria um segundo
  // S-2260 pelo mesmo período. É a diferença que separa este job do de remoção.
  let chamou = false
  const d = deps({
    listar: (async () => [vivo("reservado")]) as Deps["listar"],
    bifurcar: (async () => { chamou = true; return ok }) as Deps["bifurcar"],
  })
  const j = await jobNovo()
  await handlerConvocacaoRmSubstituir(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "aguardando_externo")
  assert.equal(e.cursor?.nota, "conciliar_leitura")
  assert.equal(chamou, false, "não pode ter chamado o RM")
})

test("rastro limpo: re-executa e conclui", async () => {
  const d = deps({ listar: (async () => [vivo("no_rm")]) as Deps["listar"] })
  const j = await jobNovo()
  await handlerConvocacaoRmSubstituir(j as never, d)
  assert.equal((await estadoDoJob(j.id)).estado, "concluido")
})

test("pendência do serviço JOGA — o tick reagenda", async () => {
  const d = deps({
    listar: (async () => [vivo("no_rm")]) as Deps["listar"],
    bifurcar: (async () => ({ remocoes: [{ estado: "erro", lancamentoId: "a", erro: "fault" }], gravacoes: [], intactos: [], temPendencia: true }) as never) as Deps["bifurcar"],
  })
  const j = await jobNovo()
  await assert.rejects(() => handlerConvocacaoRmSubstituir(j as never, d), /pendente/)
})

test("reverter usa o caminho de reverter, não o de bifurcar", async () => {
  let qual = ""
  const d = deps({
    listar: (async () => [vivo("no_rm")]) as Deps["listar"],
    bifurcar: (async () => { qual = "bifurcar"; return ok }) as Deps["bifurcar"],
    reverter: (async () => { qual = "reverter"; return ok }) as Deps["reverter"],
  })
  const j = await jobNovo("reverter")
  await handlerConvocacaoRmSubstituir(j as never, d)
  assert.equal(qual, "reverter")
})

test("flag desligada: conclui sem tocar no RM", async () => {
  let chamou = false
  const d = deps({
    listar: (async () => [vivo("no_rm")]) as Deps["listar"],
    bifurcar: (async () => { chamou = true; return ok }) as Deps["bifurcar"],
    habilitado: () => false,
  })
  const j = await jobNovo()
  await handlerConvocacaoRmSubstituir(j as never, d)
  assert.equal((await estadoDoJob(j.id)).cursor?.nota, "desligado")
  assert.equal(chamou, false)
})

test("teardown", limpar)
