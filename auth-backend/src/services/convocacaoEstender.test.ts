// Extensão do fim da convocação no RM (fim de semana só pra folha), sem RM: rastro, pré-voo e a
// edição entram por injeção. O que se prova são as travas — só estende o pedaço que termina no
// fim da convocação e só se o RM não tiver nada nos dias novos.
import { test } from "node:test"
import assert from "node:assert/strict"
import { estenderFimConvocacaoDoItem, type DepsExtensaoRm } from "./convocacaoEstender.js"
import type { LancamentoRm } from "../repo/convocacoesRm.js"

const lanc = (id: string, inicio: string, fim: string): LancamentoRm =>
  ({
    id, item_origem_id: "123", chapa: "007468", coligada: 3, codigo: `C03S00${id}`, pk_rm: null,
    data_inicio: inicio, data_fim: fim, estado: "no_rm",
  }) as unknown as LancamentoRm

function mundo(vivos: LancamentoRm[], conflito?: { codConvocacao: string; dataInicio: string; dataFim: string }) {
  const chamadas: string[] = []
  const edicoes: Array<{ id: string; dataFim: string }> = []
  const janelas: Array<{ dataInicio: string; dataFim: string }> = []
  const deps: Partial<DepsExtensaoRm> = {
    lancamentos: async () => {
      chamadas.push("lancamentos")
      return vivos
    },
    preVoo: (async (alvos: Array<{ chapa: string; dataInicio: string; dataFim: string }>) => {
      chamadas.push("preVoo")
      janelas.push({ dataInicio: alvos[0]!.dataInicio, dataFim: alvos[0]!.dataFim })
      return {
        aGravar: conflito ? [] : alvos,
        jaExistem: conflito ? [{ alvo: alvos[0]!, existente: conflito }] : [],
        existentesNoRm: conflito ? [conflito] : [],
      }
    }) as unknown as DepsExtensaoRm["preVoo"],
    editarFim: (async (l: LancamentoRm, p: { dataFim: string }) => {
      chamadas.push("editarFim")
      edicoes.push({ id: l.id, dataFim: p.dataFim })
      return { estado: "editado", lancamentoId: l.id, codConvocacao: l.codigo, dataFimAnterior: l.data_fim, dataFimNova: p.dataFim }
    }) as unknown as DepsExtensaoRm["editarFim"],
  }
  return { deps, chamadas, edicoes, janelas }
}

test("caminho feliz: estende o fim da convocacao ate o domingo, pre-voo so dos dias novos", async () => {
  const m = mundo([lanc("4076", "2026-09-21", "2026-09-25")])
  const r = await estenderFimConvocacaoDoItem("123", { dataFimConvocacao: "2026-09-25", novoFim: "2026-09-27" }, m.deps)
  assert.equal(r.estado, "editado")
  assert.equal(r.dataFimAnterior, "2026-09-25")
  assert.equal(r.dataFimNova, "2026-09-27")
  assert.deepEqual(m.janelas, [{ dataInicio: "2026-09-26", dataFim: "2026-09-27" }])
  assert.deepEqual(m.edicoes, [{ id: "4076", dataFim: "2026-09-27" }])
})

test("varios pedacos (divisao de contrato): estende so o ultimo", async () => {
  const m = mundo([lanc("1", "2026-09-01", "2026-09-14"), lanc("2", "2026-09-15", "2026-09-25")])
  await estenderFimConvocacaoDoItem("123", { dataFimConvocacao: "2026-09-25", novoFim: "2026-09-27" }, m.deps)
  assert.deepEqual(m.edicoes, [{ id: "2", dataFim: "2026-09-27" }])
})

test("ultimo pedaco termina antes do fim (atestado quebrou): nao estende por cima", async () => {
  const m = mundo([lanc("1", "2026-09-21", "2026-09-24")])
  const r = await estenderFimConvocacaoDoItem("123", { dataFimConvocacao: "2026-09-25", novoFim: "2026-09-27" }, m.deps)
  assert.equal(r.estado, "fim_divergente")
  assert.deepEqual(m.chamadas, ["lancamentos"])
})

test("o RM ja tem convocacao no fim de semana: nao estende e devolve o conflito", async () => {
  const m = mundo([lanc("1", "2026-09-21", "2026-09-25")], {
    codConvocacao: "C03S009999", dataInicio: "2026-09-27", dataFim: "2026-09-30",
  })
  const r = await estenderFimConvocacaoDoItem("123", { dataFimConvocacao: "2026-09-25", novoFim: "2026-09-27" }, m.deps)
  assert.equal(r.estado, "conflito_no_rm")
  assert.match(r.detalhe ?? "", /C03S009999/)
  assert.equal(m.chamadas.includes("editarFim"), false)
})

test("ja estendido (refinalizar): nada a fazer, sem ir ao RM", async () => {
  const m = mundo([lanc("1", "2026-09-21", "2026-09-27")])
  const r = await estenderFimConvocacaoDoItem("123", { dataFimConvocacao: "2026-09-25", novoFim: "2026-09-27" }, m.deps)
  assert.equal(r.estado, "ja_no_periodo")
  assert.deepEqual(m.chamadas, ["lancamentos"])
})

test("sem convocacao nossa no RM: devolve isso, nao inventa", async () => {
  const m = mundo([])
  const r = await estenderFimConvocacaoDoItem("123", { dataFimConvocacao: "2026-09-25", novoFim: "2026-09-27" }, m.deps)
  assert.equal(r.estado, "sem_convocacao_rm")
})
