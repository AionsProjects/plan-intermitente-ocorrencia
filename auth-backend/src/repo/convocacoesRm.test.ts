// Testes do rastro de convocações no RM. Batem no banco REAL com item sentinela e limpam —
// mesmo padrão de routes/mensalRun.test.ts.
// Roda: node --env-file=.env --import tsx --test src/repo/convocacoesRm.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import {
  confirmarLancamentoRm,
  confirmarRemocaoRm,
  falharLancamentoRm,
  lancamentosDoItem,
  lancamentosPorChapaPeriodo,
  lancamentosVivosPorItens,
  marcarParaRemocaoRm,
  planejarSubstituicaoRm,
  reservarLancamentoRm,
  vincularUuidConvocacao,
} from "./convocacoesRm.js"

const ITEM = 999000001
const ITEM2 = 999000002
const CHAPA = "998877"

const base = (extra: Record<string, unknown> = {}) => ({
  itemOrigemId: ITEM,
  chapa: CHAPA,
  contrato: "TESTE",
  dataInicio: "2099-03-05",
  dataFim: "2099-03-20",
  origemAcao: "teste",
  ...extra,
})

async function limpar() {
  // origem_lancamento_id referencia a própria tabela — apagar os filhos primeiro.
  await query(
    `DELETE FROM convocacoes_rm WHERE item_origem_id = ANY($1::bigint[]) AND origem_lancamento_id IS NOT NULL`,
    [[String(ITEM), String(ITEM2)]],
  )
  await query(`DELETE FROM convocacoes_rm WHERE item_origem_id = ANY($1::bigint[])`, [
    [String(ITEM), String(ITEM2)],
  ])
}

test("setup", limpar)

test("reservar: primeiro é novo, segundo no mesmo (item, início) é ocupado", async () => {
  const a = await reservarLancamentoRm(base())
  assert.equal(a.status, "novo")
  assert.equal(a.lancamento.estado, "reservado")
  assert.equal(a.lancamento.chapa, CHAPA)
  assert.equal(a.lancamento.data_inicio, "2099-03-05") // date volta string, sem virar Date

  // Mesmo início, fim diferente: continua sendo duplicata (data_fim está fora do índice
  // de propósito — relançar o mesmo início com outro fim é duplicata de eSocial).
  const b = await reservarLancamentoRm(base({ dataFim: "2099-03-25" }))
  assert.equal(b.status, "ocupado")
  assert.equal(b.lancamento.id, a.lancamento.id)
})

test("reservar: chapa crua é normalizada pro formato RM", async () => {
  await limpar()
  const r = await reservarLancamentoRm(base({ chapa: " 98877 " }))
  assert.equal(r.lancamento.chapa, "098877")
})

test("confirmar: vira no_rm com código e PK", async () => {
  await limpar()
  const r = await reservarLancamentoRm(base())
  await confirmarLancamentoRm(r.lancamento.id, {
    codigo: "C03S999001",
    pkRm: `3;${CHAPA};C03S999001`,
    payload: { xml: "<x/>" },
  })
  const [l] = await lancamentosDoItem(ITEM)
  assert.equal(l!.estado, "no_rm")
  assert.equal(l!.codigo, "C03S999001")
  assert.ok(l!.confirmado_em)
})

test("confirmar atrasado NÃO ressuscita linha já removida", async () => {
  await limpar()
  const r = await reservarLancamentoRm(base())
  await confirmarLancamentoRm(r.lancamento.id, { codigo: "C03S999002", pkRm: "3;x;C03S999002" })
  await marcarParaRemocaoRm(r.lancamento.id, { motivo: "cancelamento_total" })
  await confirmarRemocaoRm(r.lancamento.id)
  // Um confirm que chega atrasado (retry lento) não pode desfazer o cancelamento.
  await confirmarLancamentoRm(r.lancamento.id, { codigo: "C03S999002", pkRm: "3;x;C03S999002" })
  const [l] = await lancamentosDoItem(ITEM)
  assert.equal(l!.estado, "removido")
})

test("marcar re-marca linha JÁ `a_remover` — senão a bifurcação pula o delete", async () => {
  await limpar()
  const r = await reservarLancamentoRm(base())
  await confirmarLancamentoRm(r.lancamento.id, { codigo: "C03S999003", pkRm: "3;x;C03S999003" })
  // `planejarSubstituicaoRm` marca dentro da transação (obrigatório: é o que libera o índice
  // parcial pra peça que herda o início). Depois `removerLancamentoRm` marca de novo — se isto
  // recusar, ele devolve `sem_rastro` e NÃO chama o DeleteRecordByKey: o registro original
  // sobrevive no RM enquanto as duas peças novas são criadas. Registro triplo, em silêncio.
  assert.ok(await marcarParaRemocaoRm(r.lancamento.id, { motivo: "bifurcacao" }))
  assert.ok(
    await marcarParaRemocaoRm(r.lancamento.id, { motivo: "bifurcacao" }),
    "re-marcação tem que casar",
  )
  // `reservado` continua fora: código NULL + CHECK = 23514 (o bug do G0).
  const s = await reservarLancamentoRm(base({ dataInicio: "2099-04-05", dataFim: "2099-04-20" }))
  assert.equal(await marcarParaRemocaoRm(s.lancamento.id, { motivo: "bifurcacao" }), null)
})

test("falhar com Fault LIBERA o slot; indeterminado MANTÉM travado", async () => {
  await limpar()
  // Fault = o RM respondeu e recusou, com rollback -> pode tentar de novo.
  const a = await reservarLancamentoRm(base())
  await falharLancamentoRm(a.lancamento.id, "Fault: chapa inexistente", { indeterminado: false })
  const b = await reservarLancamentoRm(base())
  assert.equal(b.status, "novo", "slot deveria estar livre após Fault")

  // Timeout/5xx = pode ter gravado -> reenviar é o único jeito de duplicar. Slot fica travado.
  await falharLancamentoRm(b.lancamento.id, "timeout", { indeterminado: true })
  const c = await reservarLancamentoRm(base())
  assert.equal(c.status, "ocupado", "slot deveria continuar travado no indeterminado")
  assert.equal(c.lancamento.estado, "reservado")
  assert.equal(c.lancamento.indeterminado, true)
})

test("planejarSubstituicaoRm: o pedaço que HERDA o início cabe, atomicamente", async () => {
  await limpar()
  // Caso do DP: 05→20 já no RM, chega atestado 10→11, vira 05→09 + 12→20.
  const orig = await reservarLancamentoRm(base())
  await confirmarLancamentoRm(orig.lancamento.id, { codigo: "C03S999003", pkRm: "3;x;C03S999003" })

  const r = await planejarSubstituicaoRm({
    remover: [{ id: orig.lancamento.id, motivo: "quebra_atestado" }],
    criar: [
      base({ dataInicio: "2099-03-05", dataFim: "2099-03-09", origemLancamentoId: orig.lancamento.id }),
      base({ dataInicio: "2099-03-12", dataFim: "2099-03-20", origemLancamentoId: orig.lancamento.id }),
    ],
  })
  assert.equal(r.aRemover.length, 1)
  assert.equal(r.aRemover[0]!.estado, "a_remover")
  assert.equal(r.reservados.length, 2)
  // O pedaço 1 tem o MESMO início do original — só cabe porque 'a_remover' saiu do índice.
  assert.equal(r.reservados[0]!.data_inicio, "2099-03-05")
  assert.equal(r.reservados[0]!.origem_lancamento_id, orig.lancamento.id)

  const vivos = await lancamentosDoItem(ITEM, { apenasVivos: true })
  assert.equal(vivos.length, 2)
})

test("remover só vale pra quem ESTÁ no RM — linha reservada não vira a_remover", async () => {
  await limpar()
  // Linha `reservado` tem codigo NULL, e o CHECK ck_convocacoes_rm_codigo exige código pra
  // 'a_remover'. Antes a função aceitava 'reservado' e estourava 23514 — justamente no caso
  // "gravou e morreu no meio". Agora devolve null: sem código não há registro no RM pra apagar,
  // e o caminho certo pra esse caso é falharLancamentoRm / conciliação.
  const r = await reservarLancamentoRm(base())
  assert.equal(r.lancamento.estado, "reservado")
  assert.equal(r.lancamento.codigo, null)
  const m = await marcarParaRemocaoRm(r.lancamento.id, { motivo: "cancelamento_total" })
  assert.equal(m, null, "não pode marcar; e não pode estourar")
  const [depois] = await lancamentosDoItem(ITEM)
  assert.equal(depois!.estado, "reservado", "a linha fica intacta")
})

test("planejarSubstituicaoRm: falha no meio não deixa metade aplicada", async () => {
  await limpar()
  // `orig` precisa estar NO RM pra entrar no plano de remoção — senão o rejects viria só da
  // colisão dos dois `criar`, e o teste passaria sem exercitar o que anuncia.
  const orig = await reservarLancamentoRm(base())
  await confirmarLancamentoRm(orig.lancamento.id, { codigo: "C03S999004", pkRm: "3;x;C03S999004" })
  await assert.rejects(() =>
    planejarSubstituicaoRm({
      remover: [{ id: orig.lancamento.id, motivo: "bifurcacao" }],
      criar: [
        base({ dataInicio: "2099-03-05", dataFim: "2099-03-09" }),
        base({ dataInicio: "2099-03-05", dataFim: "2099-03-20" }), // colide com o irmão acima
      ],
    }),
  )
  // Rollback: o original continua vivo e nada novo entrou.
  const todos = await lancamentosDoItem(ITEM)
  assert.equal(todos.length, 1)
  assert.equal(todos[0]!.estado, "no_rm", "rollback devolve o original ao estado anterior")
})

test("lancamentosVivosPorItens: em lote, agrupado por item, ignora id não numérico", async () => {
  await limpar()
  await reservarLancamentoRm(base())
  await reservarLancamentoRm(base({ itemOrigemId: ITEM2, dataInicio: "2099-04-01", dataFim: "2099-04-10" }))
  const m = await lancamentosVivosPorItens([ITEM, ITEM2, "nao-numerico", ITEM])
  assert.equal(m.size, 2)
  assert.equal(m.get(String(ITEM))!.length, 1)
  assert.equal(m.get(String(ITEM2))![0]!.data_inicio, "2099-04-01")
  assert.deepEqual(await lancamentosVivosPorItens([]), new Map())
})

test("lancamentosPorChapaPeriodo: overlap inclusive e chapa crua normalizada", async () => {
  await limpar()
  const r = await reservarLancamentoRm(base())
  await confirmarLancamentoRm(r.lancamento.id, { codigo: "C03S999004", pkRm: "3;x;C03S999004" })

  // Encosta na ponta final -> conta.
  assert.equal((await lancamentosPorChapaPeriodo(CHAPA, "2099-03-20", "2099-03-31")).length, 1)
  // Não cruza -> não conta.
  assert.equal((await lancamentosPorChapaPeriodo(CHAPA, "2099-03-21", "2099-03-31")).length, 0)
  // Chapa crua (sem zeros) tem que achar igual — é o erro que devolveria zero em silêncio.
  assert.equal((await lancamentosPorChapaPeriodo("998877", "2099-03-01", "2099-03-31")).length, 1)
})

test("vincularUuidConvocacao: preenche o uuid depois, e é idempotente", async () => {
  await limpar()
  await reservarLancamentoRm(base())
  assert.equal(await vincularUuidConvocacao(ITEM, "uuid-teste"), 1)
  assert.equal(await vincularUuidConvocacao(ITEM, "uuid-teste"), 0, "segunda chamada não mexe")
  const [l] = await lancamentosDoItem(ITEM)
  assert.equal(l!.uuid_convocacao, "uuid-teste")
})

test("teardown", limpar)
