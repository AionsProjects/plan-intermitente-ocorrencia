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
    ausencias: (async () => ({ cortes: [], ausencias: [], descartadas: [], linhas: 0 })) as NonNullable<Deps>["ausencias"],
    mudarColunas: (async () => { ecos++ }) as NonNullable<Deps>["mudarColunas"],
    habilitado: () => true,
    quebraHabilitada: () => false,
    ...extra,
  }
}

/** Deps com a quebra LIGADA e uma ausência fixa. */
function depsComAusencia(
  cortes: { inicio: string; fim: string }[],
  gravar: NonNullable<Deps>["gravar"],
): NonNullable<Deps> {
  return deps(undefined, {
    gravar,
    quebraHabilitada: () => true,
    ausencias: (async () => ({ cortes, ausencias: [], descartadas: [], linhas: cortes.length })) as NonNullable<Deps>["ausencias"],
  })
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
const limpar = async () => { await query(`DELETE FROM jobs WHERE tipo=$1`, [TIPO_JOB_CONVOCACAO_RM]) }

test("setup", limpar)

test("gravado: conclui e guarda o código no cursor", async () => {
  const d = deps({ estado: "gravado", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, codConvocacao: "C03S000900", pk: "3;998877;C03S000900" })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.deepEqual(e.cursor?.codigos, ["C03S000900"])
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
  // O cursor agora conta por PEDAÇO: com a quebra por atestado, um item pode ter 2 desfechos.
  assert.equal((e.cursor?.pedacos as { estado: string }[])[0]!.estado, "ja_lancado")
  assert.equal(ecos, antes + 1, "o eco tem que ser refeito")
})

test("ja_no_rm: terminal e informativo — o DP lançou à mão, não é falha", async () => {
  const d = deps({ estado: "ja_no_rm", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, detalhe: "C03S000123 2099-05-01..2099-05-10" })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal((e.cursor?.pedacos as { estado: string }[])[0]!.estado, "ja_no_rm")
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
    gravar: (async () => { chamou = true; return { estado: "gravado" } }) as unknown as NonNullable<Deps>["gravar"],
  })
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.nota, "desligado")
  assert.equal(chamou, false, "não pode nem chamar a gravação")
})

test("atestado no meio: grava DOIS pedaços e ecoa os dois códigos juntos", async () => {
  const pedidos: { ini: string; fim: string; ato?: string }[] = []
  let escrito = ""
  const d = depsComAusencia(
    [{ inicio: "2099-05-04", fim: "2099-05-05" }],
    (async (alvo) => {
      pedidos.push({ ini: alvo.dataInicio, fim: alvo.dataFim, ato: alvo.dataConvocacao })
      return {
        estado: "gravado",
        chapa: alvo.chapa,
        dataInicio: alvo.dataInicio,
        dataFim: alvo.dataFim,
        codConvocacao: `C03S00090${pedidos.length}`,
      }
    }) as NonNullable<Deps>["gravar"],
  )
  d.mudarColunas = (async (_b: string, _i: string, cols: Record<string, string>) => {
    escrito = cols.text_x!
  }) as NonNullable<Deps>["mudarColunas"]

  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)

  assert.deepEqual(
    pedidos.map((x) => `${x.ini}..${x.fim}`),
    ["2099-05-01..2099-05-03", "2099-05-06..2099-05-10"],
  )
  // Um eco só, com os dois códigos: escrever um por vez faria o segundo apagar o primeiro.
  assert.equal(escrito, "C03S000901, C03S000902")
  assert.equal((await estadoDoJob(j.id)).estado, "concluido")
})

test("os pedaços HERDAM a data do ato do período original", async () => {
  // Houve UM ato de convocação. Recalculando por pedaço, o ato do 2o cairia dentro do atestado —
  // afirmando um convite que não aconteceu.
  const atos: (string | undefined)[] = []
  const d = depsComAusencia(
    [{ inicio: "2099-05-04", fim: "2099-05-05" }],
    (async (alvo) => {
      atos.push(alvo.dataConvocacao)
      return { estado: "gravado", chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, codConvocacao: "C" }
    }) as NonNullable<Deps>["gravar"],
  )
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  assert.deepEqual(atos, ["2099-04-28", "2099-04-28"], "3 dias antes do início ORIGINAL, nos dois")
})

test("atestado cobrindo tudo: não grava nada, e não é falha", async () => {
  let chamou = false
  const d = depsComAusencia(
    [{ inicio: "2099-04-01", fim: "2099-06-01" }],
    (async () => { chamou = true; return { estado: "gravado" } }) as unknown as NonNullable<Deps>["gravar"],
  )
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  const e = await estadoDoJob(j.id)
  assert.equal(e.estado, "concluido")
  assert.equal(e.cursor?.pulado, "coberto_por_ausencia")
  assert.equal(chamou, false)
})

test("RM fora do ar na leitura de atestado é RETRYÁVEL — nunca 'sem atestado'", async () => {
  // Falha fechado: tratar indisponibilidade como ausência zero grava por cima de dia coberto.
  const d = deps(undefined, {
    quebraHabilitada: () => true,
    ausencias: (async () => { throw new Error("rm indisponivel") }) as NonNullable<Deps>["ausencias"],
    gravar: (async () => { throw new Error("nao devia gravar") }) as NonNullable<Deps>["gravar"],
  })
  const j = await jobNovo()
  await assert.rejects(() => handlerConvocacaoRmPontual(j as never, d), /rm indisponivel/)
})

test("um pedaço indeterminado manda o job pra conciliação, mesmo com o outro OK", async () => {
  // Precedência: resolver o mudo por leitura vem antes de qualquer retry.
  let n = 0
  const d = depsComAusencia(
    [{ inicio: "2099-05-04", fim: "2099-05-05" }],
    (async (alvo) => {
      n++
      return n === 1
        ? { estado: "gravado", chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, codConvocacao: "C03S000910" }
        : { estado: "erro", chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, erro: "timeout", indeterminado: true }
    }) as NonNullable<Deps>["gravar"],
  )
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  assert.equal((await estadoDoJob(j.id)).passo, 1)
})

test("quebra DESLIGADA não lê atestado nenhum", async () => {
  let leu = false
  const d = deps(
    { estado: "gravado", chapa: "998877", dataInicio: payload.data_inicio, dataFim: payload.data_fim, codConvocacao: "C03S000920" },
    { ausencias: (async () => { leu = true; return { cortes: [], ausencias: [], descartadas: [], linhas: 0 } }) as NonNullable<Deps>["ausencias"] },
  )
  const j = await jobNovo()
  await handlerConvocacaoRmPontual(j as never, d)
  assert.equal(leu, false)
  assert.equal((await estadoDoJob(j.id)).estado, "concluido")
})

test("teardown", limpar)
