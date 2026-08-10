// Testes do job do pontual: o que o handler faz com cada desfecho da gravação.
// O `gravarConvocacaoRm` é stubado — o que se prova aqui é a MÁQUINA DE ESTADOS do job
// (retryável vs terminal, quando vai pra conciliação), não a gravação em si.
// Roda: node --env-file=.env --import tsx --test src/jobs/convocacaoRmPontual.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.CONVOCACAO_RM_HABILITADA = "1"

const { query } = await import("../db.js")
const { handlerConvocacaoRmPontual, TIPO_JOB_CONVOCACAO_RM } = await import("./convocacaoRmPontual.js")
const { enfileirar } = await import("./repo.js")
type Deps = Parameters<typeof handlerConvocacaoRmPontual>[1]

const ITEM = "999000777"
let ecos = 0

const payload = {
  item_id: ITEM,
  board_id: "1",
  col_cod_rm: "text_x",
  contrato: "TESTE",
  chapa: "998877",
  data_inicio: "2099-05-01",
  data_fim: "2099-05-10",
}

/** Deps com a gravação trocada por um resultado fixo. */
function deps(resultado: unknown, extra: Partial<NonNullable<Deps>> = {}): NonNullable<Deps> {
  return {
    gravar: (async () => resultado) as NonNullable<Deps>["gravar"],
    existentes: (async () => []) as NonNullable<Deps>["existentes"],
    mudarColunas: (async () => { ecos++ }) as NonNullable<Deps>["mudarColunas"],
    habilitado: () => true,
    ...extra,
  }
}

async function jobNovo() {
  const id = await enfileirar(TIPO_JOB_CONVOCACAO_RM, payload)
  const { rows } = await query<{ id: string; tipo: string; estado: string; passo: number; payload: Record<string, unknown>; cursor: unknown; tentativas: number }>(
    `SELECT id, tipo, estado, passo, payload, cursor, tentativas FROM jobs WHERE id=$1`, [id],
  )
  return rows[0]!
}
async function estadoDoJob(id: string) {
  const { rows } = await query<{ estado: string; passo: number; erro: string | null; cursor: Record<string, unknown> | null }>(
    `SELECT estado, passo, erro, cursor FROM jobs WHERE id=$1`, [id],
  )
  return rows[0]!
}
const limpar = () => query(`DELETE FROM jobs WHERE tipo=$1`, [TIPO_JOB_CONVOCACAO_RM])

test("setup", limpar)

test("gravado: conclui e guarda o código no cursor", async () => {
  const d = deps({ estado: "gravado", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, codConvocacao: "C03S000900", pk: "3;998877;C03S000900" })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.codConvocacao, "C03S000900")
})

test("erro determinístico é RETRYÁVEL: joga, pra tentativa ser contada", async () => {
  // `avancar({estado:'falhou'})` direto NÃO conta tentativa nem reagenda — só `throw` faz isso,
  // porque quem chama `falhar()` é o tick.
  const d = deps({ estado: "erro", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, erro: "Fault: chapa inexistente", indeterminado: false })
  const j = await jobNovo()
  await assert.rejects(() => handlerConvocacaoRmPontual(j as never, d))
})

test("entrada inválida é TERMINAL: retry nunca conserta payload ruim", async () => {
  const d = deps({ estado: "erro", chapa: "", dataInicio: "", dataFim: "", erro: "convocacao_rm_invalida: chapa_invalida" })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "falhou")
  assert.match(e.erro!, /chapa_invalida/)
})

test("indeterminado vai pra CONCILIAÇÃO, nunca pra reenvio", async () => {
  // Timeout/5xx: pode ter gravado. Reenviar é o único jeito de duplicar um S-2260.
  const d = deps({ estado: "erro", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, erro: "timeout", indeterminado: true })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "pendente")
  assert.equal(e.passo, 1, "tem que ir pro passo de conciliação")
})

test("reserva_pendente também concilia (não reenvia)", async () => {
  const d = deps({ estado: "reserva_pendente", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  assert.equal((await estadoDoJob(j.id)).passo, 1)
})

test("ja_lancado: conclui e REFAZ o eco (conserta código perdido no board)", async () => {
  const d = deps({ estado: "ja_lancado", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, codConvocacao: "C03S000901" })
  const antes = ecos
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.pulado, "ja_lancado")
  assert.equal(ecos, antes + 1, "o eco tem que ser refeito")
})

test("ja_no_rm: terminal e informativo — o DP lançou à mão, não é falha", async () => {
  const d = deps({ estado: "ja_no_rm", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, detalhe: "C03S000123 2099-05-01..2099-05-10" })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.pulado, "ja_no_rm")
})

test("gravado_monday_pendente é retryável: o RM tem, o board não", async () => {
  const d = deps({ estado: "gravado_monday_pendente", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, codConvocacao: "C03S000902", erro: "monday caiu" })
  const j = await jobNovo()
  await assert.rejects(() => handlerConvocacaoRmPontual(j as never, d))
})

test("flag desligada em runtime: conclui sem tocar no RM", async () => {
  let chamou = false
  const d = deps(undefined, {
    habilitado: () => false,
    gravar: (async () => { chamou = true; return { estado: "gravado" } }) as NonNullable<Deps>["gravar"],
  })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.nota, "desligado")
  assert.equal(chamou, false, "não pode nem chamar a gravação")
})

test("teardown", limpar)
