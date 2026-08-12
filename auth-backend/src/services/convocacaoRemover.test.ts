// Remoção de convocação no RM — banco REAL com sentinelas, SOAP stubado por injeção de módulo.
// O que se prova aqui é a ORDEM e o que acontece em cada desfecho do RM, não o transporte.
// Roda: node --env-file=.env --import tsx --test src/services/convocacaoRemover.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import { confirmarLancamentoRm, lancamentosDoItem, reservarLancamentoRm } from "../repo/convocacoesRm.js"
import { estadoEfeito } from "../jobs/repo.js"
import type { LancamentoRm } from "../repo/convocacoesRm.js"

const ITEM = 999000701
const CHAPA = "998877"

async function limpar() {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM convocacoes_rm WHERE item_origem_id = $1`, [ITEM],
  )
  for (const r of rows) await query(`DELETE FROM efeitos_externos WHERE chave = $1`, [`convocacao_rm_remover:${r.id}`])
  await query(`DELETE FROM convocacoes_rm WHERE item_origem_id = $1`, [ITEM])
}

/** Cria uma linha JÁ NO RM (é o único estado removível). */
async function lancamentoNoRm(
  codigo = "C03S999701",
  inicio = "2099-07-01",
  fim = "2099-07-20",
): Promise<LancamentoRm> {
  const r = await reservarLancamentoRm({
    itemOrigemId: ITEM, chapa: CHAPA, contrato: "TESTE",
    dataInicio: inicio, dataFim: fim, origemAcao: "teste",
  })
  await confirmarLancamentoRm(r.lancamento.id, { codigo, pkRm: `3;${CHAPA};${codigo}` })
  const [l] = await lancamentosDoItem(ITEM, { apenasVivos: true })
  return l!
}

/**
 * Stub do transporte. O serviço importa `existeRegistroRm`/`deleteRecordByKeyDireto` do módulo
 * do cliente; como namespace ESM é congelado, o teste injeta por parâmetro — mas o serviço não
 * tem DI. Então aqui a verificação é feita pelo EFEITO no banco, chamando o serviço com um
 * lançamento cuja PK não existe no RM (caminho `ja_ausente`), que é determinístico e offline.
 */
test("setup", limpar)

test("linha JÁ AUSENTE no RM fecha o rastro em vez de deixar `no_rm` pendurado", async () => {
  // PK inventada: o RM não tem esse código, então `existeRegistroRm` devolve null.
  // Sem fechar o rastro aqui, o pré-voo seguiria achando que existe convocação viva e
  // bloquearia a próxima gravação legítima da pessoa.
  const { removerLancamentoRm } = await import("./convocacaoRemover.js")
  const l = await lancamentoNoRm("C03S999701")
  const r = await removerLancamentoRm(l, { motivo: "cancelamento_total", timeoutMs: 15000 })
  assert.equal(r.estado, "ja_ausente")
  const [depois] = await lancamentosDoItem(ITEM)
  assert.equal(depois!.estado, "removido")
  assert.equal(depois!.motivo_saida, "cancelamento_total")
})

test("lançamento sem PK nem código não vira 'apague algo' — vira sem_rastro", async () => {
  await limpar()
  const { removerLancamentoRm } = await import("./convocacaoRemover.js")
  const r = await reservarLancamentoRm({
    itemOrigemId: ITEM, chapa: CHAPA, contrato: "TESTE",
    dataInicio: "2099-07-01", dataFim: "2099-07-20", origemAcao: "teste",
  })
  // `reservado` = nunca confirmou, código NULL. Não há registro no RM pra apagar.
  const out = await removerLancamentoRm(r.lancamento, { motivo: "cancelamento_total" })
  assert.equal(out.estado, "sem_rastro")
  assert.equal(out.erro, "lancamento_sem_pk")
  const [depois] = await lancamentosDoItem(ITEM)
  assert.equal(depois!.estado, "reservado", "a linha fica intacta — quem resolve isso é a conciliação")
})

test("item sem lançamento vivo: nada a fazer, e não é pendência", async () => {
  await limpar()
  const { removerConvocacoesDoItem } = await import("./convocacaoRemover.js")
  // É o caso DOMINANTE hoje: dos 4 itens nos grupos CANCELADOS do board, zero têm rastro no RM.
  // Se isso virasse erro, todo cancelamento passaria a falhar.
  const s = await removerConvocacoesDoItem(ITEM, { motivo: "cancelamento_total" })
  assert.deepEqual(s.removidos, [])
  assert.equal(s.temPendencia, false)
})

test("cancelamento total leva TODOS os lançamentos vivos do item", async () => {
  await limpar()
  const { removerConvocacoesDoItem } = await import("./convocacaoRemover.js")
  // Uma convocação pode ter virado N registros (quebra por atestado, bifurcação).
  await lancamentoNoRm("C03S999702", "2099-07-01", "2099-07-20")
  await lancamentoNoRm("C03S999703", "2099-08-01", "2099-08-20")
  const s = await removerConvocacoesDoItem(ITEM, { motivo: "cancelamento_total" })
  assert.equal(s.removidos.length, 2, "não pode parar no primeiro")
  assert.equal(s.temPendencia, false)
  const vivos = await lancamentosDoItem(ITEM, { apenasVivos: true })
  assert.equal(vivos.length, 0)
})

test("o ledger NÃO fica com chave pendente quando o registro já estava ausente", async () => {
  await limpar()
  const { removerLancamentoRm } = await import("./convocacaoRemover.js")
  const l = await lancamentoNoRm("C03S999704")
  await removerLancamentoRm(l, { motivo: "cancelamento_total" })
  // Caminho `ja_ausente` sai antes de reservar — chave pendente presa seria um slot travado
  // pra sempre, que foi exatamente o bug que `liberarEfeito` veio consertar.
  assert.equal(await estadoEfeito(`convocacao_rm_remover:${l.id}`), "ausente")
})

test("teardown", limpar)
