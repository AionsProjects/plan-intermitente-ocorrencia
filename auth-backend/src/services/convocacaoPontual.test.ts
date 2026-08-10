// Orquestração de uma convocação pontual: quebra por atestado, gravação por pedaço, eco.
// O `gravarConvocacaoRm` é stubado — o que se prova aqui é a SEQUÊNCIA, não a gravação.
// Roda: node --env-file=.env --import tsx --test src/services/convocacaoPontual.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  processarConvocacaoPontual,
  type DadosConvocacaoPontual,
  type DepsPontual,
} from "./convocacaoPontual.js"

const DADOS: DadosConvocacaoPontual = {
  itemId: "999000555",
  boardId: "1",
  colCodRm: "text_x",
  contrato: "TESTE",
  chapa: "998877",
  dataInicio: "2099-05-01",
  dataFim: "2099-05-10",
}

type Gravar = DepsPontual["gravar"]

function deps(gravar: Gravar, extra: Partial<DepsPontual> = {}): DepsPontual {
  return {
    gravar,
    ausencias: (async () => ({ cortes: [], ausencias: [], descartadas: [], linhas: 0 })) as DepsPontual["ausencias"],
    mudarColunas: (async () => {}) as DepsPontual["mudarColunas"],
    quebraHabilitada: () => false,
    ...extra,
  }
}

const gravaOk = (cods: string[]): Gravar => {
  let i = 0
  return (async (alvo) => ({
    estado: "gravado" as const,
    chapa: alvo.chapa,
    dataInicio: alvo.dataInicio,
    dataFim: alvo.dataFim,
    codConvocacao: cods[i++] ?? "C",
  })) as Gravar
}

const comAusencia = (cortes: { inicio: string; fim: string }[], gravar: Gravar): DepsPontual =>
  deps(gravar, {
    quebraHabilitada: () => true,
    ausencias: (async () => ({ cortes, ausencias: [], descartadas: [], linhas: cortes.length })) as DepsPontual["ausencias"],
  })

test("caminho simples: um pedaço, um código", async () => {
  const r = await processarConvocacaoPontual(DADOS, { deps: deps(gravaOk(["C03S000100"])) })
  assert.deepEqual(r.codigos, ["C03S000100"])
  assert.equal(r.pedacos.length, 1)
  assert.equal(r.precisaConciliar, false)
  assert.equal(r.retryavel, undefined)
})

test("atestado no meio: grava DOIS pedaços", async () => {
  const pedidos: string[] = []
  const g: Gravar = (async (alvo) => {
    pedidos.push(`${alvo.dataInicio}..${alvo.dataFim}`)
    return { estado: "gravado" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, codConvocacao: `C0${pedidos.length}` }
  }) as Gravar
  const r = await processarConvocacaoPontual(DADOS, {
    deps: comAusencia([{ inicio: "2099-05-04", fim: "2099-05-05" }], g),
  })
  assert.deepEqual(pedidos, ["2099-05-01..2099-05-03", "2099-05-06..2099-05-10"])
  assert.deepEqual(r.codigos, ["C01", "C02"])
})

test("os pedaços HERDAM a data do ato do período original", async () => {
  // Houve UM ato de convocação. Recalculando por pedaço, o ato do 2o cairia dentro do atestado —
  // afirmando um convite que não aconteceu.
  const atos: (string | undefined)[] = []
  const g: Gravar = (async (alvo) => {
    atos.push(alvo.dataConvocacao)
    return { estado: "gravado" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, codConvocacao: "C" }
  }) as Gravar
  await processarConvocacaoPontual(DADOS, {
    deps: comAusencia([{ inicio: "2099-05-04", fim: "2099-05-05" }], g),
  })
  assert.deepEqual(atos, ["2099-04-28", "2099-04-28"], "3 dias antes do início ORIGINAL, nos dois")
})

test("pedaço único NÃO recebe data do ato herdada — deixa a regra normal valer", async () => {
  const atos: (string | undefined)[] = []
  const g: Gravar = (async (alvo) => {
    atos.push(alvo.dataConvocacao)
    return { estado: "gravado" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, codConvocacao: "C" }
  }) as Gravar
  await processarConvocacaoPontual(DADOS, { deps: deps(g) })
  assert.deepEqual(atos, [undefined])
})

test("eco escreve TODOS os códigos juntos, uma vez só", async () => {
  // Escrever um por vez faria o segundo apagar o primeiro.
  const escritas: string[] = []
  const d = comAusencia([{ inicio: "2099-05-04", fim: "2099-05-05" }], gravaOk(["C01", "C02"]))
  d.mudarColunas = (async (_b: string, _i: string, cols: Record<string, string>) => {
    escritas.push(cols.text_x!)
  }) as DepsPontual["mudarColunas"]
  await processarConvocacaoPontual(DADOS, { deps: d })
  assert.deepEqual(escritas, ["C01, C02"])
})

test("atestado cobrindo tudo: não grava nada, e não é falha", async () => {
  let chamou = false
  const g: Gravar = (async () => { chamou = true; return { estado: "gravado" as const } }) as unknown as Gravar
  const r = await processarConvocacaoPontual(DADOS, {
    deps: comAusencia([{ inicio: "2099-04-01", fim: "2099-06-01" }], g),
  })
  assert.equal(r.cobertoPorAusencia, true)
  assert.equal(chamou, false)
  assert.equal(r.retryavel, undefined)
})

test("indeterminado pede CONCILIAÇÃO, nunca reenvio", async () => {
  const g: Gravar = (async (alvo) => ({
    estado: "erro" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim,
    erro: "timeout", indeterminado: true,
  })) as Gravar
  const r = await processarConvocacaoPontual(DADOS, { deps: deps(g) })
  assert.equal(r.precisaConciliar, true)
  assert.equal(r.retryavel, undefined, "conciliar tem precedência sobre retry")
})

test("um pedaço mudo contamina o todo — conciliar vem antes de tudo", async () => {
  let n = 0
  const g: Gravar = (async (alvo) => {
    n++
    return n === 1
      ? { estado: "gravado" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, codConvocacao: "C01" }
      : { estado: "erro" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, erro: "timeout", indeterminado: true }
  }) as Gravar
  const r = await processarConvocacaoPontual(DADOS, {
    deps: comAusencia([{ inicio: "2099-05-04", fim: "2099-05-05" }], g),
  })
  assert.equal(r.precisaConciliar, true)
  assert.deepEqual(r.codigos, ["C01"], "o que gravou tem que aparecer mesmo assim")
})

test("erro determinístico é retryável; entrada inválida é terminal", async () => {
  const erro = (msg: string): Gravar =>
    (async (alvo) => ({ estado: "erro" as const, chapa: alvo.chapa, dataInicio: alvo.dataInicio, dataFim: alvo.dataFim, erro: msg, indeterminado: false })) as Gravar
  const a = await processarConvocacaoPontual(DADOS, { deps: deps(erro("Fault: chapa inexistente")) })
  assert.match(a.retryavel!, /chapa inexistente/)
  assert.equal(a.invalido, undefined)

  const b = await processarConvocacaoPontual(DADOS, { deps: deps(erro("convocacao_rm_invalida: chapa_invalida")) })
  assert.match(b.invalido!, /chapa_invalida/)
  assert.equal(b.retryavel, undefined)
})

test("eco que falha vira retryável, mas o código gravado não se perde", async () => {
  const d = deps(gravaOk(["C03S000200"]))
  d.mudarColunas = (async () => { throw new Error("monday caiu") }) as DepsPontual["mudarColunas"]
  const r = await processarConvocacaoPontual(DADOS, { deps: d })
  assert.deepEqual(r.codigos, ["C03S000200"])
  assert.match(r.retryavel!, /falhou no Monday/)
})

test("quebra DESLIGADA não lê atestado nenhum", async () => {
  let leu = false
  const d = deps(gravaOk(["C"]), {
    ausencias: (async () => { leu = true; return { cortes: [], ausencias: [], descartadas: [], linhas: 0 } }) as DepsPontual["ausencias"],
  })
  await processarConvocacaoPontual(DADOS, { deps: d })
  assert.equal(leu, false)
})

test("RM fora do ar na leitura de atestado PROPAGA — falha fechado", async () => {
  const d = deps(gravaOk(["C"]), {
    quebraHabilitada: () => true,
    ausencias: (async () => { throw new Error("rm indisponivel") }) as DepsPontual["ausencias"],
  })
  await assert.rejects(() => processarConvocacaoPontual(DADOS, { deps: d }), /rm indisponivel/)
})
