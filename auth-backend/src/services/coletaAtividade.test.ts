// Duas regras que o relatório de atraso não pode errar, e que já erraram uma vez cada:
//
//  1. autor humano no log = edição À MÃO. Cruzar essas com execuções do app trocava
//     "fulano editou na interface" por "fulano usou o app" — o oposto do que aconteceu.
//  2. índice de status fora do mapa de labels = célula LIMPA, não "índice 5".
import { test } from "node:test"
import assert from "node:assert/strict"
import { UID_TOKEN, casarExecucao, valorLegivel, rotulosDeStatus, type AlteracaoBoard, type ExecucaoApp } from "./coletaAtividade.js"

const alteracao = (over: Partial<AlteracaoBoard> = {}): AlteracaoBoard => ({
  quando: new Date("2026-08-31T22:00:00Z"),
  board: "Plano",
  pulseId: "123456",
  pessoa: "MARIA DA SILVA",
  coluna: "Faltas",
  colunaId: "numeric",
  de: "0",
  para: "1",
  gravadoPor: "Isaac Raylen",
  gravadoPorId: UID_TOKEN,
  autorReal: null,
  via: "",
  ocorrencia: true,
  ...over,
})

const execucao = (over: Partial<ExecucaoApp> = {}): ExecucaoApp => ({
  quem: "KARINE ROMASKEVIS",
  acao: "registro",
  pessoa: "MARIA DA SILVA",
  inicio: new Date("2026-08-31T21:59:30Z"),
  fim: new Date("2026-08-31T22:00:30Z"),
  itens: new Set(["123456"]),
  ...over,
})

test("casa pelo id do item quando a execução registrou o artefato", () => {
  const e = casarExecucao(alteracao(), [execucao()])
  assert.equal(e?.quem, "KARINE ROMASKEVIS")
})

test("casa pela pessoa quando não há artefato de item", () => {
  const e = casarExecucao(alteracao(), [execucao({ itens: new Set() })])
  assert.equal(e?.quem, "KARINE ROMASKEVIS")
})

test("NÃO casa quando a alteração está fora da janela da execução", () => {
  const tarde = alteracao({ quando: new Date("2026-08-31T23:30:00Z") })
  assert.equal(casarExecucao(tarde, [execucao()]), null)
})

test("duas execuções cobrindo o instante e nenhuma identificável: não casa nada", () => {
  const anonima = alteracao({ pessoa: "OUTRA PESSOA", pulseId: "999" })
  const a = execucao({ pessoa: null, itens: new Set() })
  const b = execucao({ pessoa: null, itens: new Set(), quem: "OUTRO OPERADOR" })
  assert.equal(casarExecucao(anonima, [a, b]), null, "com ambiguidade tem de recusar")
})

test("índice de status sem label vira 'vazio', não 'índice N'", () => {
  const rotulos = rotulosDeStatus(
    [{ id: "color_x", settings_str: JSON.stringify({ labels: { "0": "Bloqueada", "1": "Válida", "2": "Cancelada" } }) }],
    "board1",
  ).get("board1:color_x")
  assert.equal(valorLegivel({ index: 1 }, rotulos), "Válida")
  assert.equal(valorLegivel({ label: { index: 2 } }, rotulos), "Cancelada")
  // 5 não existe no mapa: é célula limpa.
  assert.match(valorLegivel({ index: 5 }, rotulos), /^vazio/)
  // label com texto ganha do índice.
  assert.equal(valorLegivel({ label: { index: 9, text: "Direto do texto" } }, rotulos), "Direto do texto")
})

test("valorLegivel: número, data e nulo", () => {
  assert.equal(valorLegivel({ unit: null, value: 2 }, undefined), "2")
  assert.equal(valorLegivel({ date: "2026-08-31" }, undefined), "2026-08-31")
  assert.equal(valorLegivel(null, undefined), "vazio")
})
