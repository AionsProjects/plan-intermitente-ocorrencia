// Sábado extra: o que o WF `3TAyDuKFkWGvXTHT` promete, provado em código.
//
// Foco no que muda dinheiro (vtDia, "SIM*", total) e nas recusas que impedem pedido vazio
// na Caju — não no encanamento.
import { test } from "node:test"
import assert from "node:assert/strict"
import { montarPedidoSabados, normalizarSabados, ehErroSabados, sabadosDentroDaConvocacao } from "./calculo.js"
import { montarHistoricoSabados, chaveEfeitoSabados, sabadosDasChaves } from "./rmSabados.js"
import { montarNomeDebitoSabados, montarTextoBalaoSabados } from "./mondaySabados.js"
import type { LinhaValores } from "../domain/desconto.js"

const VALORES: LinhaValores[] = [
  { contrato: "SEMSA", regra: "", vrDia: 24.5, vtDia: 11.6, ativo: true },
  { contrato: "PADRAO", regra: "", vrDia: 20, vtDia: 8, ativo: true },
]

const BASE = {
  uuid: "u-1",
  nome: "MARIA AUGUSTA",
  chapa: "7406",
  contrato: "SEMSA",
  sabados: ["2026-08-08", "2026-08-15"],
  optanteVT: true,
  anoComp: 2026,
  mesComp: 8,
}

test("normalizarSabados: descarta invalido, deduplica e ordena", () => {
  const r = normalizarSabados(["2026-08-15", "xx", "2026-08-08", "2026-08-15", 5])
  assert.deepEqual(r, ["2026-08-08", "2026-08-15"])
})

test("2 sabados no SEMSA: total = vtDia x qtd, chapa com 6 digitos", () => {
  const p = montarPedidoSabados(BASE, VALORES)
  assert.ok(!ehErroSabados(p))
  if (ehErroSabados(p)) return
  assert.equal(p.vtDia, 11.6)
  assert.equal(p.qtdSabados, 2)
  assert.equal(p.valorTotal, 23.2)
  assert.equal(p.chapa, "007406") // o RM casa por chapa com zero à esquerda
})

test("'SIM*' (VT so volta) paga METADE do VT do dia", () => {
  const p = montarPedidoSabados({ ...BASE, vtSoVolta: true }, VALORES)
  assert.ok(!ehErroSabados(p))
  if (ehErroSabados(p)) return
  assert.equal(p.vtDia, 5.8)
  assert.equal(p.valorTotal, 11.6)
})

test("nao optante de VT e RECUSA, nao zero", () => {
  // Zero geraria pedido vazio na Caju e lançamento de nada no RM.
  const p = montarPedidoSabados({ ...BASE, optanteVT: false }, VALORES)
  assert.ok(ehErroSabados(p))
  if (!ehErroSabados(p)) return
  assert.equal(p.erro, "nao_optante_vt")
  assert.equal(p.status, 400)
})

test("sem sabado valido -> recusa", () => {
  const p = montarPedidoSabados({ ...BASE, sabados: ["ontem"] }, VALORES)
  assert.ok(ehErroSabados(p) && p.erro === "sem_sabados")
})

test("contrato sem VT no board -> recusa em vez de pagar zero", () => {
  const semVt: LinhaValores[] = [{ contrato: "SEMSA", regra: "", vrDia: 24.5, vtDia: 0, ativo: true }]
  const p = montarPedidoSabados(BASE, semVt)
  assert.ok(ehErroSabados(p) && p.erro === "vt_dia_zero")
})

test("DETRAN RECEBE sabado extra — nao-desconto nao se aplica a credito", () => {
  const valores: LinhaValores[] = [{ contrato: "DETRAN", regra: "", vrDia: 17.15, vtDia: 9.5, ativo: true }]
  const p = montarPedidoSabados({ ...BASE, contrato: "DETRAN" }, valores)
  assert.ok(!ehErroSabados(p))
  if (ehErroSabados(p)) return
  assert.equal(p.valorTotal, 19) // 9.5 x 2 — nada zerado
})

test("historico RM: VT de CREDITO (TPBEN=1) e valor em virgula", () => {
  const p = montarPedidoSabados(BASE, VALORES)
  if (ehErroSabados(p)) throw new Error("pedido invalido")
  const h = montarHistoricoSabados(p, { codSecao: "01.01.0085.01.0002", dataImport: "2026-08-17" })
  assert.equal(h.chapa, "007406")
  assert.match(h.dadosXml, /<CODBENEFICIO>2<\/CODBENEFICIO>/)
  // Crédito não vira lançamento financeiro — é o 1 do pontual, não o 0 do boleto.
  assert.match(h.dadosXml, /<TPBEN>1<\/TPBEN>/)
  assert.match(h.dadosXml, /<VLRTOTAL>23,20<\/VLRTOTAL>/)
  assert.match(h.dadosXml, /<CODSECAO>01\.01\.0085<\/CODSECAO>/) // base de 3 octetos
})

test("Controle Caju: debito do sabado tem nome proprio, separado do pontual", () => {
  assert.equal(
    montarNomeDebitoSabados(" maria augusta ", "2026-09-24T10:00:00Z"),
    "INTERMITENTE - MARIA AUGUSTA - SÁBADO EXTRA (2026-09-24)",
  )
})

test("balao no item do Plano: datas, valor e o pedido que pagou", () => {
  const p = montarPedidoSabados(BASE, VALORES)
  if (ehErroSabados(p)) throw new Error("pedido invalido")
  const texto = montarTextoBalaoSabados(p, { orderId: "ord-9", summaryUrl: "https://caju/ord-9" })
  assert.equal(
    texto,
    [
      "Sábado extra nesta convocação: 08/08/2026 e 15/08/2026 (2 sábados).",
      "VT do sábado: R$ 11,60 por dia, total R$ 23,20, pago em crédito Caju.",
      "Pedido Caju ord-9 (confirmado): https://caju/ord-9",
    ].join("\n"),
  )
  // Um sábado só, e sem id de pedido (retomada que perdeu o id): não inventa linha de pedido.
  const um = montarTextoBalaoSabados({ ...p, sabados: ["2026-08-08"], qtdSabados: 1, valorTotal: 11.6 }, { orderId: null })
  assert.equal(um.split("\n").length, 2)
  assert.match(um, /08\/08\/2026 \(1 sábado\)/)
})

test("nome do pedido Caju segue o formato do WF (o DP concilia por ele)", async () => {
  const { montarNomePedidoSabados } = await import("../jobs/sabadoExtra.js")
  const n = montarNomePedidoSabados("maria augusta", "2026-08-17")
  // Corta em 27 como o WF — com nome deste tamanho o ANO fica de fora. É o comportamento
  // do WF (`.substring(0,27)`), preservado de propósito: mudar o formato faria o sábado
  // extra sumir da busca que o DP já usa no painel da Caju.
  assert.equal(n, "INT-MARIA AUGUSTA-SAB-17/08")
  assert.equal(n.length, 27)
  // Nome longo nao estoura o limite da Caju.
  assert.ok(montarNomePedidoSabados("ANA BEATRIZ DA SILVA SANTOS FERREIRA", "2026-08-17").length <= 27)
})

test("chave de efeito: muda se o conjunto de sabados muda, estavel se nao", () => {
  const a = montarPedidoSabados(BASE, VALORES)
  const b = montarPedidoSabados({ ...BASE, sabados: ["2026-08-15", "2026-08-08"] }, VALORES)
  const c = montarPedidoSabados({ ...BASE, sabados: ["2026-08-08", "2026-08-15", "2026-08-22"] }, VALORES)
  if (ehErroSabados(a) || ehErroSabados(b) || ehErroSabados(c)) throw new Error("pedido invalido")
  // Mesma lista em outra ordem = mesmo pagamento: refinalizar nao pode pagar de novo.
  assert.equal(chaveEfeitoSabados(a, "caju"), chaveEfeitoSabados(b, "caju"))
  // Sabado novo = pagamento novo.
  assert.notEqual(chaveEfeitoSabados(a, "caju"), chaveEfeitoSabados(c, "caju"))
  // Alvos diferentes nao colidem entre si.
  assert.notEqual(chaveEfeitoSabados(a, "caju"), chaveEfeitoSabados(a, "rm_historico"))
})

// Convocacao da ELIANA (SEMSA): 01/09 a 30/09, cancelada parcialmente a partir de 23/09 — o RM
// ficou com fim em 22/09. Sabados do mes: 05, 12, 19 e 26.
const SETEMBRO = { inicio: "2026-09-01", fim: "2026-09-30" }

test("sabado depois do corte do parcial fica de fora: o RM nao tem convocacao nele", () => {
  const r = sabadosDentroDaConvocacao(["2026-09-19", "2026-09-26"], { ...SETEMBRO, corte: "2026-09-23" })
  assert.deepEqual(r.validos, ["2026-09-19"])
  assert.deepEqual(r.descartados, ["2026-09-26"])
})

test("o proprio dia do corte ja e cancelado; a vespera ainda vale", () => {
  const r = sabadosDentroDaConvocacao(["2026-09-19", "2026-09-26"], { ...SETEMBRO, corte: "2026-09-19" })
  assert.deepEqual(r.validos, [])
  assert.deepEqual(r.descartados, ["2026-09-19", "2026-09-26"])
  const vespera = sabadosDentroDaConvocacao(["2026-09-19"], { ...SETEMBRO, corte: "2026-09-20" })
  assert.deepEqual(vespera.validos, ["2026-09-19"])
})

test("sem corte vale o periodo inteiro, bordas inclusive; fora dele e descartado", () => {
  const r = sabadosDentroDaConvocacao(
    ["2026-09-05", "2026-08-29", "2026-10-03", "2026-09-26"],
    { inicio: "2026-09-05", fim: "2026-09-26", corte: null },
  )
  assert.deepEqual(r.validos, ["2026-09-05", "2026-09-26"])
  assert.deepEqual(r.descartados, ["2026-08-29", "2026-10-03"])
})

test("lista do corpo: duplicata some, data com hora e cortada, lixo vai pro log", () => {
  const r = sabadosDentroDaConvocacao(
    ["2026-09-12", "2026-09-12T00:00:00", "2026-09-05", "sabado", 7],
    { ...SETEMBRO, corte: null },
  )
  assert.deepEqual(r.validos, ["2026-09-05", "2026-09-12"])
  assert.deepEqual(r.descartados, ["7", "sabado"])
})

test("sabados ja cobrados: lidos da chave do pedido Caju, so desta convocacao", () => {
  const chaves = [
    "sabado_extra:caju:u-1:2026-09-05_2026-09-12",
    "sabado_extra:caju:u-1:2026-09-19",
    "sabado_extra:controle_caju:u-1:2026-09-26", // outro alvo nao e cobranca
    "sabado_extra:caju:u-2:2026-09-26", // outra convocacao
    "sabado_extra-sim:job-9:caju", // simulacao nao e cobranca
  ]
  assert.deepEqual([...sabadosDasChaves(chaves, "u-1")].sort(), ["2026-09-05", "2026-09-12", "2026-09-19"])
  assert.equal(sabadosDasChaves(chaves, "u-3").size, 0)
})
