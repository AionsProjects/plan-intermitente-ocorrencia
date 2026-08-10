// Lote do mensal: classificação por pessoa, período efetivo, atestado em lote, conciliação.
// Tudo DI — o que se prova é a ORQUESTRAÇÃO do contrato, não a gravação (testada no pontual).
// Roda: node --env-file=.env --import tsx --test src/services/convocacaoMensal.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  processarConvocacaoMensalContrato,
  type DepsConvocacaoMensal,
  type ItemConvocacaoMensal,
} from "./convocacaoMensal.js"
import type { ResultadoPontual } from "./convocacaoPontual.js"

const item = (p: Partial<ItemConvocacaoMensal> = {}): ItemConvocacaoMensal => ({
  itemId: "900001",
  nome: "FULANO TESTE",
  chapa: "007001",
  contrato: "TESTE",
  dataInicio: "2099-08-01",
  dataFim: "2099-08-31",
  dataAdmissao: null,
  statusConvocacao: "Válida",
  cancelamentoInicio: null,
  grupo: "MENSAL",
  ...p,
})

const RESULTADO_OK: ResultadoPontual = {
  codigos: ["C03S000100"],
  pedacos: [{ periodo: "2099-08-01..2099-08-31", estado: "gravado", codConvocacao: "C03S000100" }],
  cortes: [],
  cobertoPorAusencia: false,
  precisaConciliar: false,
}

function deps(
  itens: ItemConvocacaoMensal[],
  resultado: ResultadoPontual | ((d: { chapa: string; dataInicio: string; dataFim: string }) => ResultadoPontual),
  extra: Partial<DepsConvocacaoMensal> = {},
): { d: DepsConvocacaoMensal; processados: { chapa: string; inicio: string; fim: string; origem?: string }[]; jobs: unknown[] } {
  const processados: { chapa: string; inicio: string; fim: string; origem?: string }[] = []
  const jobs: unknown[] = []
  const d: DepsConvocacaoMensal = {
    lerItens: (async () => itens) as DepsConvocacaoMensal["lerItens"],
    ausenciasContrato: (async () => new Map()) as DepsConvocacaoMensal["ausenciasContrato"],
    processar: (async (dados, opts) => {
      processados.push({ chapa: dados.chapa, inicio: dados.dataInicio, fim: dados.dataFim, origem: opts?.origemAcao })
      return typeof resultado === "function" ? resultado(dados) : resultado
    }) as DepsConvocacaoMensal["processar"],
    enfileirarJob: (async (_t, payload, o) => { jobs.push({ payload, opts: o }); return "job-1" }) as DepsConvocacaoMensal["enfileirarJob"],
    quebraHabilitada: () => false,
    pontual: {
      gravar: (async () => { throw new Error("nao devia") }) as DepsConvocacaoMensal["pontual"]["gravar"],
      ausencias: (async () => ({ cortes: [], ausencias: [], descartadas: [], linhas: 0 })) as DepsConvocacaoMensal["pontual"]["ausencias"],
      mudarColunas: (async () => {}) as DepsConvocacaoMensal["pontual"]["mudarColunas"],
      quebraHabilitada: () => false,
    },
    ...extra,
  }
  return { d, processados, jobs }
}

const OPTS = { boardId: "1", colCodRm: "text_x" }

test("caminho feliz: grava todo mundo com origem 'mensal'", async () => {
  const { d, processados } = deps([item(), item({ itemId: "900002", chapa: "007002" })], RESULTADO_OK)
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.total, 2)
  assert.equal(r.gravados, 2)
  assert.equal(r.temPendencia, false)
  assert.deepEqual(processados.map((x) => x.origem), ["mensal", "mensal"])
})

test("cancelado PARCIAL entra com período truncado até Cancelamento Início - 1", async () => {
  // Decisão 1: a pessoa trabalhou até o dia anterior ao cancelamento — dias que precisam de S-2260.
  const { d, processados } = deps(
    [item({ statusConvocacao: "Cancelada parcialmente", cancelamentoInicio: "2099-08-20", grupo: "CANCELADOS PARCIAL" })],
    RESULTADO_OK,
  )
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(processados.length, 1)
  assert.equal(processados[0]!.inicio, "2099-08-01")
  assert.equal(processados[0]!.fim, "2099-08-19", "até o dia ANTERIOR ao cancelamento")
  assert.equal(r.gravados, 1)
})

test("cancelada TOTAL não grava nada — e não é falha", async () => {
  const { d, processados } = deps([item({ statusConvocacao: "Cancelada" })], RESULTADO_OK)
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(processados.length, 0)
  assert.equal(r.canceladasSemDias, 1)
  assert.equal(r.temPendencia, false)
})

test("cancelamento parcial ANTES do início zera o período — sem S-2260", async () => {
  const { d, processados } = deps(
    [item({ statusConvocacao: "Cancelada parcialmente", cancelamentoInicio: "2099-08-01" })],
    RESULTADO_OK,
  )
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(processados.length, 0)
  assert.equal(r.canceladasSemDias, 1)
})

test("chapa inválida e item sem datas viram 'invalido' com motivo — nunca somem calados", async () => {
  const { d } = deps(
    [item({ chapa: "" }), item({ itemId: "900003", dataInicio: "", dataFim: "" })],
    RESULTADO_OK,
  )
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.invalidos.length, 2)
  assert.deepEqual(r.invalidos.map((p) => p.detalhe), ["chapa_invalida", "sem_datas"])
})

test("CANCELADA NO RM vira requer_decisao_dp — nem regrava nem pula calado (decisão 3)", async () => {
  const { d } = deps([item()], {
    codigos: [],
    pedacos: [{
      periodo: "2099-08-01..2099-08-31",
      estado: "ja_no_rm",
      codConvocacao: "C03S000999",
      existenteEstado: "1",
      existenteEstadoDescricao: "Cancelada",
    }],
    cortes: [],
    cobertoPorAusencia: false,
    precisaConciliar: false,
  })
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.requerDecisao.length, 1)
  assert.match(r.requerDecisao[0]!.detalhe!, /C03S000999.*Cancelada/)
  assert.equal(r.temPendencia, true, "decisão pendente segura o contrato")
})

test("ja_no_rm VÁLIDA (DP lançou à mão, estado 4) conta como jaExistiam — sem pendência", async () => {
  const { d } = deps([item()], {
    codigos: ["C03S000123"],
    pedacos: [{
      periodo: "2099-08-01..2099-08-31",
      estado: "ja_no_rm",
      codConvocacao: "C03S000123",
      existenteEstado: "4",
      existenteEstadoDescricao: "Concluída",
    }],
    cortes: [],
    cobertoPorAusencia: false,
    precisaConciliar: false,
  })
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.jaExistiam, 1)
  assert.equal(r.requerDecisao.length, 0)
  assert.equal(r.temPendencia, false)
})

test("SOAP mudo enfileira job NO PASSO 1 — conciliação por leitura, nunca reenvio", async () => {
  const { d, jobs } = deps([item()], {
    codigos: [],
    pedacos: [{ periodo: "2099-08-01..2099-08-31", estado: "erro" }],
    cortes: [],
    cobertoPorAusencia: false,
    precisaConciliar: true,
  })
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.conciliando.length, 1)
  assert.equal(jobs.length, 1)
  assert.equal((jobs[0] as { opts: { passo: number } }).opts.passo, 1)
  assert.equal(r.temPendencia, true)
})

test("falha de uma pessoa NÃO derruba as outras — relatada e segue", async () => {
  let n = 0
  const { d } = deps(
    [item(), item({ itemId: "900002", chapa: "007002" })],
    () => {
      n++
      if (n === 1) throw new Error("rm caiu no meio")
      return RESULTADO_OK
    },
  )
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.falhas.length, 1)
  assert.equal(r.gravados, 1)
  assert.equal(r.temPendencia, true)
})

test("atestado do contrato: UMA leitura, cortes distribuídos por chapa", async () => {
  let janela = ""
  const cortes = new Map([["7001", [{ inicio: "2099-08-10", fim: "2099-08-11" }]]])
  const vistos: Record<string, { inicio: string; fim: string }[]> = {}
  const { d } = deps(
    [item(), item({ itemId: "900002", chapa: "007002", dataInicio: "2099-08-05", dataFim: "2099-08-20" })],
    RESULTADO_OK,
    {
      quebraHabilitada: () => true,
      ausenciasContrato: (async (chapas: string[], ini: string, fim: string) => {
        janela = `${ini}..${fim} (${chapas.length} chapas)`
        return cortes
      }) as DepsConvocacaoMensal["ausenciasContrato"],
      processar: (async (dados, opts) => {
        // O deps por pessoa resolve as ausências do Map — captura o que cada uma enxerga.
        const a = await opts!.deps!.ausencias("x", "y", "z")
        vistos[dados.chapa] = a.cortes
        return RESULTADO_OK
      }) as DepsConvocacaoMensal["processar"],
    },
  )
  await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(janela, "2099-08-01..2099-08-31 (2 chapas)", "janela = união dos períodos, 1 leitura só")
  assert.deepEqual(vistos["007001"], [{ inicio: "2099-08-10", fim: "2099-08-11" }])
  assert.deepEqual(vistos["007002"], [], "chapa sem atestado vê zero cortes")
})

test("quebra desligada: não lê atestado nenhum", async () => {
  let leu = false
  const { d } = deps([item()], RESULTADO_OK, {
    ausenciasContrato: (async () => { leu = true; return new Map() }) as DepsConvocacaoMensal["ausenciasContrato"],
  })
  await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(leu, false)
})

test("contrato vazio devolve relatório zerado sem I/O de atestado", async () => {
  const { d } = deps([], RESULTADO_OK)
  const r = await processarConvocacaoMensalContrato("TESTE", { ...OPTS, deps: d })
  assert.equal(r.total, 0)
  assert.equal(r.temPendencia, false)
})
