// Relatório + linhas do board no MENSAL. Puros — sem banco, Monday ou Caju.
import { test } from "node:test"
import assert from "node:assert/strict"
import { montarDadosRelatorioMensal } from "./relatorioMensal.js"
import { linhasNotaDeRelatorio } from "../services/notasCaju.js"
import { gerarRelatorioPagamentoPdf } from "../services/relatorioPagamento.js"
import type { ContratoPreviaMensal, PessoaPreviaMensal } from "./types.js"

const GERADO = new Date("2026-08-13T18:00:00Z")

const pessoa = (over: Partial<PessoaPreviaMensal> = {}): PessoaPreviaMensal => ({
  itemId: "1",
  nome: "MARIA DA SILVA",
  chapa: "007104",
  cpf: "12345678901",
  contrato: "SEMSA",
  funcao: "AGENTE",
  unidade: "SEMSA - SEDE",
  interior: "NAO",
  dataInicio: "2026-08-01",
  dataFim: "2026-08-31",
  brutoVR: 550,
  brutoVT: 220,
  descontoVR: 0,
  descontoVT: 0,
  liquidoVR: 550,
  liquidoVT: 220,
  creditoVR: 73.5,
  creditoVT: 0,
  pixVR: 476.5,
  pixVT: 220,
  ...over,
})

const contrato = (over: Partial<ContratoPreviaMensal> = {}): ContratoPreviaMensal => ({
  contrato: "SEMSA",
  ordem: 1,
  pessoas: [pessoa(), pessoa({ itemId: "2", nome: "JOAO SOUZA", cpf: "98765432100" })],
  bloqueado: false,
  motivoBloqueio: null,
  ...over,
} as ContratoPreviaMensal)

const refs = {
  pedidoCreditoVR: "cred-vr-mensal",
  pedidoCreditoVT: null,
  pedidoPixVR: "pix-vr-mensal",
  pedidoPixVT: "pix-vt-mensal",
  idVR: "24100",
  idVT: "24101",
  solicitacaoId: "999",
}

const montar = (c = contrato()) =>
  montarDadosRelatorioMensal({
    contrato: c,
    competencia: "2026-08",
    competenciaLabel: "AGOSTO",
    refs,
    pastaDriveUrl: "https://drive/pasta-mensal",
    geradoPor: "automação (mensal)",
    geradoEm: GERADO,
  })

test("período do mensal é a competência inteira (último dia do mês incluso)", () => {
  const d = montar()
  assert.equal(d.dataInicio, "2026-08-01")
  assert.equal(d.dataFim, "2026-08-31")
  assert.equal(d.periodoLabel, "AGOSTO/2026")
  assert.equal(d.origem, "MENSAL")
})

test("valores do pedido somam as pessoas do contrato", () => {
  const d = montar()
  const credito = d.pedidos.find((p) => p.natureza === "CRÉDITO")
  const boleto = d.pedidos.find((p) => p.natureza === "BOLETO")
  assert.equal(credito?.valor, 147) // 73,50 × 2 pessoas
  assert.equal(credito?.beneficio, "VR") // creditoVT é 0 no mensal (tetoVT=0)
  // Boleto do mensal é POR benefício: dois pedidos, cada um com o seu valor.
  assert.equal(boleto?.beneficio, "VR")
  assert.equal(boleto?.valor, 953) // 476,50 × 2
  assert.equal(d.pedidos.filter((p) => p.natureza === "BOLETO").length, 2)
})

test("board recebe o CRÉDITO do mensal — uma linha, origem MENSAL, sem colaborador", () => {
  // É o que fecha o pedido do Isaac: crédito do pontual E do mensal caem no mesmo board.
  const linhas = linhasNotaDeRelatorio(montar(), { relatorioUrl: "https://drive/rel.pdf" })
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0]!.natureza, "CRÉDITO")
  assert.equal(linhas[0]!.origem, "MENSAL")
  assert.equal(linhas[0]!.orderId, "cred-vr-mensal")
  assert.equal(linhas[0]!.valor, 147)
  assert.equal(linhas[0]!.contrato, "SEMSA")
  // Pedido do mensal é do CONTRATO — pôr uma das 40 pessoas na linha seria mentira.
  assert.equal(linhas[0]!.colaborador, null)
  assert.equal(linhas[0]!.relatorioUrl, "https://drive/rel.pdf")
  assert.equal(linhas[0]!.pastaDriveUrl, "https://drive/pasta-mensal")
})

test("dívidas usam o DELTA da rodada, não o descontado acumulado", () => {
  // Dívida que já vinha abatida de meses anteriores apareceria inflada se o relatório
  // lesse `descontadoVR` (acumulado do board) em vez de `abatidoVR` (delta desta execução).
  const c = contrato({
    descontoUpdates: [
      { id: "d1", residualVR: 10, residualVT: 0, descontadoVR: 90, descontadoVT: 0, status: "PARCIAL", abatidoVR: 40, abatidoVT: 0, pessoaKey: "12345678901" },
      { id: "d2", residualVR: 0, residualVT: 0, descontadoVR: 50, descontadoVT: 20, status: "FINALIZADO", abatidoVR: 0, abatidoVT: 0 },
    ],
  })
  const d = montar(c)
  assert.equal(d.dividas.length, 1) // d2 não teve abatimento nesta rodada
  assert.equal(d.dividas[0]!.vr, 40)
  assert.equal(d.dividas[0]!.status, "PARCIAL")
  assert.equal(d.dividas[0]!.residualVR, 10)
  assert.match(d.dividas[0]!.url!, /18400981023\/pulses\/d1/)
})

test("contrato sem descontoUpdates não quebra", () => {
  assert.deepEqual(montar().dividas, [])
})

test("PDF do mensal sai em paisagem com a tabela das pessoas", () => {
  const t = gerarRelatorioPagamentoPdf(montar()).toString("latin1")
  assert.match(t, /MediaBox \[0 0 841\.89 595\.28\]/)
  assert.match(t, /2 intermitentes/)
  assert.match(t, /MARIA DA SILVA/)
  assert.match(t, /JOAO SOUZA/)
  assert.match(t, /24100/)
})
