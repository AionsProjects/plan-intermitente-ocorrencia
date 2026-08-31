import assert from "node:assert/strict"
import test from "node:test"
import { calcularMensal, type ConvocacaoMensal, type RegraBeneficioMensal, diasBase30, vrMensalCeletista } from "./calculo.js"

const pessoa = (extra: Partial<ConvocacaoMensal> = {}): ConvocacaoMensal => ({ itemId: "1", nome: "Teste", chapa: "1", cpf: "1",
  contrato: "CETAM", funcao: "AUXILIAR", interior: "NAO", inicio: "2026-07-01", fim: "2026-07-10",
  trabalhaSabado: false, optanteVT: true, vtSoVolta: false, ...extra })
const regra: RegraBeneficioMensal = { id: "r1", contrato: "CETAM", regra: "GERAL", vrDia: 20, vtDia: 10,
  vrMensal: 0, vtMensal: 0, prioridade: 0, escala12x36: false }

test("dias seg-sex, crédito de 3 dias de VR (VT zero), resto PIX", () => {
  const r = calcularMensal([pessoa()], [regra], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 8); assert.equal(p.diasVT, 8)
  // brutoVR 160 / brutoVT 80; crédito = 3 dias de VR (60) + VT 0; PIX 100 + 80 = 180
  assert.equal(p.creditoVR, 60); assert.equal(p.creditoVT, 0)
  assert.deepEqual(r.contratos[0]!.totais, { vr: 160, vt: 80, credito: 60, pix: 180 })
})

test("regra VR Mensal: valor-dia mensal/30 x dias CORRIDOS — paridade com o WF5 Pontual", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  // Período 01-10/07/2026: 10 dias corridos, 8 úteis (04 e 05 são sáb/dom).
  const r = calcularMensal([pessoa()], [rMensal], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.vrDia, 19.6) // 588/30
  // O /30 é mês CORRIDO: sábado e domingo contam no VR. Contar só os 8 úteis pagaria 156,80
  // num benefício mensal — foi o bug do DETRAN. O pontual faz `if (__vrTodosDias && !__ehUtil) diasVR++`.
  assert.equal(p.diasVR, 10)
  assert.equal(p.brutoVR, 196) // 19.6 x 10 corridos
  // VT NÃO muda: segue seg-sex (+sábado se trabalha), então fica nos 8 úteis.
  assert.equal(p.diasVT, 8)
  assert.equal(p.creditoVR, 58.8) // teto de 3 dias x 19.6 — não muda com a contagem corrida
  assert.equal(p.pixVR, 137.2) // 196 bruto - 58,80 de crédito
  // Board: regra mensal preenche SÓ o VR - MENSAL; o unitário fica vazio (null limpa a célula),
  // porque o benefício é pago por mês. O valor-dia segue existindo no cálculo (p.vrDia).
  const up = r.contratos[0]!.planUpdates[0]!
  assert.equal(up.vrDia, null)
  // E o que vai na célula é o valor GANHO no período (10 dias x 19,60), não o parâmetro 588,00.
  assert.equal(up.vrMensal, 196)
  assert.equal(up.vrMensal, p.brutoVR) // linha única -> coincide com o bruto da pessoa
})

test("VR - MENSAL leva o ganho por LINHA, não o parâmetro — caso real DETRAN 08/2026", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, contrato: "DETRAN", vrDia: 0, vrMensal: 588 }
  // Mesma pessoa com 2 convocações, como o MICHEL: 01-03/08 (3 dias) e 04-31/08. O rateio pesa
  // pelos dias DENTRO da base de 30, então o dia 31 não puxa valor pra linha B.
  const r = calcularMensal([
    pessoa({ itemId: "A", contrato: "DETRAN", inicio: "2026-08-01", fim: "2026-08-03" }),
    pessoa({ itemId: "B", contrato: "DETRAN", inicio: "2026-08-04", fim: "2026-08-31" }),
  ], [rMensal], [], [])
  const ups = r.contratos[0]!.planUpdates
  const porItem = Object.fromEntries(ups.map((u) => [u.itemId, u.vrMensal]))
  assert.equal(porItem["A"], 58.8)   // 3 x 19,60 — e NÃO 588,00 como antes
  assert.equal(porItem["B"], 529.2)  // 27 x 19,60
  // As linhas somam o mês cheio do contrato.
  assert.equal(Math.round((porItem["A"]! + porItem["B"]!) * 100) / 100, 588)
})

// --- VR mensal na forma do celetista (31/08/2026) -------------------------------------------
// `mensal − mensal/30 × dias não cobertos`, com a base do divisor em 1..min(30, dias do mês).
// O teto do dia 31 SAIU: a forma subtrativa não paga 31/30 de nada, então a contagem de dias
// voltou a ser a real (é ela que vai pras colunas do board).

test("VR Mensal: mês cheio de 31 dias fecha o mensal cravado, e os dias são os reais", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  const r = calcularMensal([pessoa({ inicio: "2026-08-01", fim: "2026-08-31" })], [rMensal], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 31, "dias reais — o dia 31 deixou de ser descartado")
  assert.equal(p.brutoVR, 588, "nenhum dia não coberto -> mensal cheio, sem os 31/30 de antes")
  // O VT segue dias úteis e o dia 31 (segunda) continua contando: 21 em agosto.
  assert.equal(p.diasVT, 21)
})

test("VR Mensal: período parcial desconta só os dias não cobertos — caso JAMILE 03-31/08", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  // 01 e 02/08 fora do período = 2 dias não cobertos: 588 - 2 x 19,60 = 548,80. É o número que a
  // Thifany digitou no board, e o mesmo que a forma antiga dava com o teto.
  const r = calcularMensal([pessoa({ inicio: "2026-08-03", fim: "2026-08-31" })], [rMensal], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 29)
  assert.equal(p.brutoVR, 548.8)
})

test("VR Mensal: mês de 30 dias inteiro paga o mensal cheio", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  const r = calcularMensal([pessoa({ inicio: "2026-09-01", fim: "2026-09-30" })], [rMensal], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 30)
  assert.equal(p.brutoVR, 588)
})

test("VR Mensal: FEVEREIRO inteiro paga o mensal CHEIO — é o que a forma subtrativa muda", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  // Base de fevereiro/2027 = 28 dias; cobertos 28 -> nada a subtrair. A forma antiga somava
  // 28 x 19,60 = 548,80 e divergia do celetista em 39,20 por pessoa.
  const r = calcularMensal([pessoa({ inicio: "2027-02-01", fim: "2027-02-28" })], [rMensal], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.brutoVR, 588)
})

test("VR Mensal: em fevereiro o período parcial ganha os dias que faltam pra 30 (aritmética da forma)", () => {
  const rMensal: RegraBeneficioMensal = { ...regra, vrDia: 0, vrMensal: 588 }
  // 10 dias cobertos, 18 não cobertos: 588 - 18 x 19,60 = 235,20 = 12 x 19,60. Consequência
  // conhecida de subtrair do mensal num mês com menos de 31 dias — decisão do Isaac (31/08),
  // registrada no Brain pro DP confirmar.
  const r = calcularMensal([pessoa({ inicio: "2027-02-01", fim: "2027-02-10" })], [rMensal], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 10)
  assert.equal(p.brutoVR, 235.2)
})

test("vrMensalCeletista: nenhum dia coberto é ZERO, não o resíduo de fevereiro", () => {
  // Sem a guarda, mês inteiro sem cobertura deixaria 588 - 28 x 19,60 = 39,20 — o mesmo bug que
  // o FIX 13 (v44) consertou no celetista.
  assert.equal(vrMensalCeletista(588, 19.6, 28, 0), 0)
  assert.equal(vrMensalCeletista(588, 19.6, 30, 0), 0)
  // E nunca devolve negativo, mesmo com base maior que o mensal comporta.
  assert.equal(vrMensalCeletista(588, 19.6, 60, 1), 0)
})

test("diasBase30: dia 31 fora da base; fevereiro entra com os dias que tem", () => {
  assert.equal(diasBase30("2026-08"), 30) // 31 dias -> base 30
  assert.equal(diasBase30("2026-09"), 30)
  assert.equal(diasBase30("2027-02"), 28)
  assert.equal(diasBase30("2028-02"), 29) // bissexto
})

test("regra DIÁRIA não muda: dia 31 útil continua contando no VR", () => {
  // 31/08/2026 é segunda. A forma subtrativa vale só pra regra mensal (vrMensal > 0).
  const r = calcularMensal([pessoa({ inicio: "2026-08-31", fim: "2026-08-31" })], [regra], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.diasVR, 1)
  assert.equal(p.brutoVR, 20)
})

test("matching de função ignora preposições (EM vs DE)", () => {
  const especifica: RegraBeneficioMensal = { ...regra, id: "esp", regra: "TECNICO DE NIVEL MEDIO", vrDia: 99 }
  const padrao: RegraBeneficioMensal = { ...regra, id: "pad", regra: "PADRAO", vrDia: 20 }
  const r = calcularMensal([pessoa({ funcao: "TECNICO EM NIVEL MEDIO" })], [padrao, especifica], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.regraAplicada, "esp")
})

test("VT nunca entra no crédito — vai 100% no boleto, em qualquer contrato", () => {
  const r = calcularMensal([pessoa({ contrato: "SEMSA" })], [{ ...regra, contrato: "SEMSA" }], [], [])
  const p = r.contratos[0]!.pessoas[0]!
  assert.equal(p.creditoVT, 0)
  assert.equal(p.pixVT, p.liquidoVT) // todo o VT líquido sai pelo boleto
})

test("desconto FIFO reduz líquido e atualiza residual", () => {
  const r = calcularMensal([pessoa()], [regra], [], [{ id: "d1", pessoaKey: "1", inicio: "2026-01-01", residualVR: 50,
    residualVT: 20, descontadoVR: 0, descontadoVT: 0 }])
  assert.equal(r.contratos[0]!.pessoas[0]!.liquidoVR, 110)
  assert.equal(r.descontos[0]!.status, "FINALIZADO")
})

test("escala 12x36 usa paridade", () => {
  const r = calcularMensal([pessoa({ escala12x36: "IMPAR" })], [{ ...regra, escala12x36: true }], [], [])
  assert.equal(r.contratos[0]!.pessoas[0]!.diasVR, 5)
})

test("emite planUpdates por linha com crédito alocado na ordem", () => {
  // 2 convocações da mesma pessoa: crédito (3 primeiros dias = 60) vai todo pra 1ª linha.
  const r = calcularMensal([
    pessoa({ itemId: "A", inicio: "2026-07-01", fim: "2026-07-03" }), // qua-sex: 3 dias
    pessoa({ itemId: "B", inicio: "2026-07-06", fim: "2026-07-10" }), // seg-sex: 5 dias
  ], [regra], [], [])
  const ups = r.contratos[0]!.planUpdates
  assert.equal(ups.length, 2)
  const a = ups.find((u) => u.itemId === "A")!, b = ups.find((u) => u.itemId === "B")!
  assert.equal(a.diasVR, 3); assert.equal(b.diasVR, 5)
  assert.equal(a.creditoVR, 60); assert.equal(b.creditoVR, 0) // teto 3 dias × 20 na 1ª linha
  assert.equal(a.creditoVT, 0); assert.equal(b.creditoVT, 0) // VT nunca vai pro crédito
  // Regra DIÁRIA: o inverso do mensal — unitário preenchido, VR - MENSAL zerado.
  assert.equal(a.vrDia, 20); assert.equal(a.vrMensal, 0)
})

test("emite descontoUpdates com residual/status finais", () => {
  const r = calcularMensal([pessoa()], [regra], [], [{ id: "d1", pessoaKey: "1", inicio: "2026-01-01",
    residualVR: 50, residualVT: 20, descontadoVR: 10, descontadoVT: 0 }])
  const ups = r.contratos[0]!.descontoUpdates
  assert.equal(ups.length, 1)
  assert.deepEqual(ups[0], {
    id: "d1", residualVR: 0, residualVT: 0, descontadoVR: 60, descontadoVT: 20, status: "FINALIZADO",
    // pessoaKey + delta: só o balãozinho usa (o board de Desconto não tem coluna pra isso).
    pessoaKey: "1", abatidoVR: 50, abatidoVT: 20,
  })
})

// O balãozinho do mensal precisa dizer, no item de CADA pessoa, qual dívida foi dela —
// e `descontoUpdates` é por CONTRATO. Sem pessoaKey no update, não há como ligar.
test("descontoUpdates liga cada dívida à pessoa certa e traz o DELTA desta execução", () => {
  const r = calcularMensal(
    [pessoa({ itemId: "A", cpf: "111", nome: "UM" }), pessoa({ itemId: "B", cpf: "222", nome: "DOIS" })],
    [regra], [],
    [
      { id: "dUM", pessoaKey: "111", inicio: "2026-01-01", residualVR: 30, residualVT: 0, descontadoVR: 70, descontadoVT: 0 },
      { id: "dDOIS", pessoaKey: "222", inicio: "2026-01-01", residualVR: 10, residualVT: 5, descontadoVR: 0, descontadoVT: 0 },
    ],
  )
  const ups = r.contratos[0]!.descontoUpdates
  const um = ups.find((u) => u.id === "dUM")!, dois = ups.find((u) => u.id === "dDOIS")!
  assert.equal(um.pessoaKey, "111")
  assert.equal(dois.pessoaKey, "222")
  // Delta ≠ acumulado: dUM já tinha 70 abatidos antes, e AGORA saíram 30. Dizer "abatido
  // R$ 100,00" no balão seria mentira.
  assert.equal(um.abatidoVR, 30)
  assert.equal(um.descontadoVR, 100)
  assert.equal(dois.abatidoVR, 10)
  assert.equal(dois.abatidoVT, 5)
})
