// Sábado extra: o que o WF `3TAyDuKFkWGvXTHT` promete, provado em código.
//
// Foco no que muda dinheiro (vtDia, "SIM*", total) e nas recusas que impedem pedido vazio
// na Caju — não no encanamento.
import { test } from "node:test"
import assert from "node:assert/strict"
import { montarPedidoSabados, normalizarSabados, ehErroSabados } from "./calculo.js"
import { montarHistoricoSabados, montarLancamentoSabados, chaveEfeitoSabados } from "./rmSabados.js"
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

test("historico RM: VT com TPBEN=0 e valor em virgula", () => {
  const p = montarPedidoSabados(BASE, VALORES)
  if (ehErroSabados(p)) throw new Error("pedido invalido")
  const h = montarHistoricoSabados(p, { codSecao: "01.01.0085.01.0002", dataImport: "2026-08-17" })
  assert.equal(h.chapa, "007406")
  assert.match(h.dadosXml, /<CODBENEFICIO>2<\/CODBENEFICIO>/)
  assert.match(h.dadosXml, /<TPBEN>0<\/TPBEN>/)
  assert.match(h.dadosXml, /<VLRTOTAL>23,20<\/VLRTOTAL>/)
  assert.match(h.dadosXml, /<CODSECAO>01\.01\.0085<\/CODSECAO>/) // base de 3 octetos
})

test("lancamento financeiro: so evento 110", () => {
  const p = montarPedidoSabados(BASE, VALORES)
  if (ehErroSabados(p)) throw new Error("pedido invalido")
  const l = montarLancamentoSabados(p, { codSecao: "01.01.0085.01.0002" })
  assert.deepEqual(l.eventos, ["110"])
  assert.deepEqual(l.chapas, ["007406"])
  assert.equal(l.tipo, "Diario")
  assert.equal(l.coligada, 3)
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
