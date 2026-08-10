// Testes do job: o que ele faz com cada desfecho do serviço.
// O `processarConvocacaoPontual` é stubado — o que se prova aqui é a MÁQUINA DE ESTADOS do job
// (retryável vs terminal, quando vai pra conciliação). A orquestração em si tem teste próprio em
// services/convocacaoPontual.test.ts.
// Roda: node --env-file=.env --import tsx --test src/jobs/convocacaoRmPontual.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.CONVOCACAO_RM_HABILITADA = "1"

const { query } = await import("../db.js")
const { handlerConvocacaoRmPontual, TIPO_JOB_CONVOCACAO_RM } = await import("./convocacaoRmPontual.js")
const { enfileirar } = await import("./repo.js")
type Deps = NonNullable<Parameters<typeof handlerConvocacaoRmPontual>[1]>
type Resultado = Awaited<ReturnType<Deps["processar"]>>

const ITEM = "999000777"

const payload = {
  item_id: ITEM,
  board_id: "1",
  col_cod_rm: "text_x",
  contrato: "TESTE",
  chapa: "998877",
  data_inicio: "2099-05-01",
  data_fim: "2099-05-10",
}

const BASE: Resultado = {
  codigos: [],
  pedacos: [],
  cortes: [],
  cobertoPorAusencia: false,
  precisaConciliar: false,
}

/** Deps com o serviço trocado por um resultado fixo. */
function deps(r: Partial<Resultado>, extra: Partial<Deps> = {}): Deps {
  return {
    processar: (async () => ({ ...BASE, ...r })) as Deps["processar"],
    existentes: (async () => []) as Deps["existentes"],
    mudarColunas: (async () => {}) as Deps["mudarColunas"],
    habilitado: () => true,
    pontual: {
      gravar: (async () => { throw new Error("nao devia gravar") }) as Deps["pontual"]["gravar"],
      ausencias: (async () => ({ cortes: [], ausencias: [], descartadas: [], linhas: 0 })) as Deps["pontual"]["ausencias"],
      mudarColunas: (async () => {}) as Deps["pontual"]["mudarColunas"],
      quebraHabilitada: () => false,
    },
    ...extra,
  }
}

async function jobNovo(passo = 0) {
  const id = await enfileirar(TIPO_JOB_CONVOCACAO_RM, payload, { passo })
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
const limpar = async () => { await query(`DELETE FROM jobs WHERE tipo=$1`, [TIPO_JOB_CONVOCACAO_RM]) }

test("setup", limpar)

test("enfileirar com passo=1 entra direto na conciliação", async () => {
  // É como a rota registra "tentei e o RM ficou mudo": recomeçar do passo 0 seria REENVIAR.
  const j = await jobNovo(1)
  assert.equal(j.passo, 1)
})

test("gravado: conclui e guarda os códigos", async () => {
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, deps({ codigos: ["C03S000900"] }))
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.deepEqual(e.cursor?.codigos, ["C03S000900"])
})

test("retryável JOGA, pra tentativa ser contada", async () => {
  // `avancar({estado:'falhou'})` direto NÃO conta tentativa nem reagenda — só `throw` faz isso,
  // porque quem chama `falhar()` é o tick.
  const j = await jobNovo()
  await assert.rejects(() => handlerConvocacaoRmPontual(j as never, deps({ retryavel: "Fault: chapa inexistente" })))
})

test("entrada inválida é TERMINAL: retry nunca conserta payload ruim", async () => {
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, deps({ invalido: "convocacao_rm_invalida: chapa_invalida" }))
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "falhou")
  assert.match(e.erro!, /chapa_invalida/)
})

test("precisaConciliar vai pro passo 1, nunca pra reenvio", async () => {
  // Timeout/5xx: pode ter gravado. Reenviar é o único jeito de duplicar um S-2260.
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, deps({ precisaConciliar: true, retryavel: "timeout" }))
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "pendente")
  assert.equal(e.passo, 1, "conciliar tem precedência sobre retry")
})

test("coberto por ausência: terminal e informativo, não é falha", async () => {
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(
    j as never,
    deps({ cobertoPorAusencia: true, cortes: [{ inicio: "2099-05-01", fim: "2099-05-10" }] }),
  )
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.pulado, "coberto_por_ausencia")
})

test("flag desligada em runtime: conclui sem tocar no RM", async () => {
  let chamou = false
  const d = deps({}, {
    habilitado: () => false,
    processar: (async () => { chamou = true; return BASE }) as Deps["processar"],
  })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.nota, "desligado")
  assert.equal(chamou, false, "não pode nem chamar o serviço")
})

test("conciliação sem nada pendente conclui em vez de girar", async () => {
  const j = await jobNovo(1)
  await handlerConvocacaoRmPontual(j as never, deps({}))
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.conciliacao, "nada_pendente")
})

test("teardown", limpar)
