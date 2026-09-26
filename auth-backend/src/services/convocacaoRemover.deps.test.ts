// Edição/remoção no RM com TUDO injetado — sem banco, sem RM. O que se prova aqui é a decisão em
// cada resposta do RM, principalmente a de 25/09/2026: rastro dizendo `no_rm` para um registro que
// o RM não tem mais (KAREN 007355, C03S003983, apagada na limpeza do run b4a1f614 em 31/08).
// O arquivo irmão `convocacaoRemover.test.ts` cobre o mesmo módulo contra banco e RM reais.
// Roda: node --env-file=.env.example --env-file=.env.test --import tsx --test src/services/convocacaoRemover.deps.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  editarFimLancamentoRm,
  encurtarConvocacoesDoItem,
  removerLancamentoRm,
  type DepsRm,
} from "./convocacaoRemover.js"
import type { LancamentoRm } from "../repo/convocacoesRm.js"

function lancamento(over: Partial<LancamentoRm> = {}): LancamentoRm {
  return {
    id: "lanc-karen",
    item_origem_id: "12820039363",
    chapa: "007355",
    coligada: 3,
    codigo: "C03S003983",
    pk_rm: "3;007355;C03S003983",
    estado: "no_rm",
    data_inicio: "2026-09-08",
    data_fim: "2026-09-30",
    ...over,
  } as LancamentoRm
}

/** Deps que registram cada chamada; `existe` decide o que o RM "tem". */
function fakes(over: Partial<DepsRm> = {}) {
  const chamadas: string[] = []
  const reg = (nome: string) => (...args: unknown[]) => {
    chamadas.push(`${nome}:${JSON.stringify(args[0])}`)
  }
  const d: Partial<DepsRm> = {
    temSoap: () => true,
    existe: (async () => true) as DepsRm["existe"],
    salvar: (async (...a: unknown[]) => { reg("salvar")(...a); return { chave: "3;007355;C03S003983", xml: "" } }) as DepsRm["salvar"],
    apagar: (async (...a: unknown[]) => { reg("apagar")(...a); return "" }) as DepsRm["apagar"],
    reservar: (async (...a: unknown[]) => { reg("reservar")(...a); return "novo" }) as DepsRm["reservar"],
    confirmar: (async (...a: unknown[]) => { reg("confirmar")(...a) }) as DepsRm["confirmar"],
    liberar: (async (...a: unknown[]) => { reg("liberar")(...a); return true }) as DepsRm["liberar"],
    lancamentos: (async () => []) as DepsRm["lancamentos"],
    marcarRemocao: (async (...a: unknown[]) => { reg("marcarRemocao")(...a); return lancamento({ estado: "a_remover" }) }) as DepsRm["marcarRemocao"],
    confirmarRemocao: (async (...a: unknown[]) => { reg("confirmarRemocao")(...a) }) as DepsRm["confirmarRemocao"],
    fecharAusente: (async (id: string, p: unknown) => {
      chamadas.push(`fecharAusente:${JSON.stringify(id)}:${JSON.stringify(p)}`)
      return lancamento({ estado: "removido" })
    }) as DepsRm["fecharAusente"],
    atualizarPeriodo: (async (...a: unknown[]) => { reg("atualizarPeriodo")(...a); return lancamento() }) as DepsRm["atualizarPeriodo"],
    ...over,
  }
  return { d, chamadas, nomes: () => chamadas.map((c) => c.split(":")[0]) }
}

// ── EDIÇÃO (cancelamento parcial) ─────────────────────────────────────────────

test("registro que o RM não tem mais: fecha o rastro, NÃO chama SaveRecord e não é pendência", async () => {
  const f = fakes({ existe: (async () => false) as DepsRm["existe"] })
  const r = await editarFimLancamentoRm(
    lancamento(),
    { dataFim: "2026-09-27", motivo: "cancelamento_parcial", removidoPor: "karine@x" },
    f.d,
  )
  assert.equal(r.estado, "ja_ausente")
  assert.equal(r.codConvocacao, "C03S003983")
  assert.ok(!f.nomes().includes("salvar"), "SaveRecord numa chave inexistente é o que prendia a pendência")
  assert.ok(!f.nomes().includes("reservar"), "não pode reservar efeito pra edição impossível")
  // A reserva presa da tentativa de hoje (15:04) sai do ledger.
  assert.ok(f.chamadas.includes(`liberar:"convocacao_rm_editar:lanc-karen:2026-09-27"`))
  const fechou = f.chamadas.find((c) => c.startsWith("fecharAusente"))!
  assert.match(fechou, /"motivo":"cancelamento_parcial"/)
  assert.match(fechou, /"removidoPor":"karine@x"/)
})

test("RM sem resposta na checagem: erro retryável, e nada é escrito nem fechado", async () => {
  // Com a leitura antiga (que engole erro), RM fora virava "não existe" — e fechar o rastro de
  // um registro vivo faria o rastro mentir.
  const f = fakes({ existe: (async () => { throw new Error("RM SOAP transporte: timeout") }) as DepsRm["existe"] })
  const r = await editarFimLancamentoRm(lancamento(), { dataFim: "2026-09-27" }, f.d)
  assert.equal(r.estado, "erro")
  assert.match(r.erro!, /existencia_nao_confirmada/)
  assert.deepEqual(f.nomes(), [], `não devia ter tocado em nada: ${f.chamadas.join(", ")}`)
})

test("registro existe: segue o caminho normal (reserva, salva, confirma, atualiza o rastro)", async () => {
  const f = fakes()
  const r = await editarFimLancamentoRm(lancamento(), { dataFim: "2026-09-27" }, f.d)
  assert.equal(r.estado, "editado")
  assert.deepEqual(f.nomes(), ["reservar", "salvar", "confirmar", "atualizarPeriodo"])
})

test("registro existe e o SaveRecord fica mudo: indeterminado, chave continua presa", async () => {
  const f = fakes({
    salvar: (async () => {
      throw Object.assign(new Error("RM SOAP transporte: timeout"), { indeterminado: true })
    }) as DepsRm["salvar"],
  })
  const r = await editarFimLancamentoRm(lancamento(), { dataFim: "2026-09-27" }, f.d)
  assert.equal(r.estado, "indeterminado")
  assert.ok(!f.nomes().includes("liberar"), "timeout pode ter editado: liberar a chave permitiria duplicar")
})

// ── ENCURTAR (o que o cancelamento parcial chama) ─────────────────────────────

test("encurtar com o pedaço ausente no RM: sem pendência, e o pedaço sai do rastro", async () => {
  const f = fakes({
    existe: (async () => false) as DepsRm["existe"],
    lancamentos: (async () => [lancamento()]) as DepsRm["lancamentos"],
  })
  const r = await encurtarConvocacoesDoItem("13044722514", { novoFim: "2026-09-27", removidoPor: "karine@x" }, f.d)
  assert.equal(r.temPendencia, false, "sem pendência não nasce job, e o cancelamento não fecha 'parcial'")
  assert.equal(r.edicoes.length, 1)
  assert.equal(r.edicoes[0]!.estado, "ja_ausente")
})

test("encurtar: exceção inesperada num pedaço vira erro dele, e o seguinte ainda roda", async () => {
  const a = lancamento({ id: "a", codigo: "C03S000001", pk_rm: "3;007355;C03S000001" })
  const b = lancamento({ id: "b", codigo: "C03S000002", pk_rm: "3;007355;C03S000002" })
  const f = fakes({
    existe: (async () => false) as DepsRm["existe"],
    lancamentos: (async () => [a, b]) as DepsRm["lancamentos"],
    fecharAusente: (async (id: string) => {
      if (id === "a") throw new Error("banco caiu")
      return lancamento({ id, estado: "removido" })
    }) as DepsRm["fecharAusente"],
  })
  const r = await encurtarConvocacoesDoItem("13044722514", { novoFim: "2026-09-27" }, f.d)
  assert.deepEqual(r.edicoes.map((e) => [e.lancamentoId, e.estado]), [["a", "erro"], ["b", "ja_ausente"]])
  assert.equal(r.temPendencia, true)
})

test("encurtar: pedaço que termina antes do corte não é tocado nem lido no RM", async () => {
  let leu = false
  const f = fakes({
    existe: (async () => { leu = true; return true }) as DepsRm["existe"],
    lancamentos: (async () => [lancamento({ data_fim: "2026-09-20" })]) as DepsRm["lancamentos"],
  })
  const r = await encurtarConvocacoesDoItem("13044722514", { novoFim: "2026-09-27" }, f.d)
  assert.deepEqual(r.edicoes, [])
  assert.equal(leu, false)
})

// ── REMOÇÃO (cancelamento total, pedaço depois do corte, bifurcação) ──────────

test("remover com o RM sem resposta: erro retryável, rastro intacto", async () => {
  // Antes: `existeRegistroRm` engolia o erro, o "não existe" fechava o rastro como `ja_ausente` e
  // o S-2260 ficava de pé no RM com o board cancelado — sem pendência nenhuma pra avisar.
  const f = fakes({ existe: (async () => { throw new Error("RM SOAP HTTP 503") }) as DepsRm["existe"] })
  const r = await removerLancamentoRm(lancamento(), { motivo: "cancelamento_total" }, f.d)
  assert.equal(r.estado, "erro")
  assert.match(r.erro!, /existencia_nao_confirmada/)
  assert.deepEqual(f.nomes(), [])
})

test("remover o que já não está no RM: fecha o rastro preservando o histórico, sem DeleteRecordByKey", async () => {
  const f = fakes({ existe: (async () => false) as DepsRm["existe"] })
  const r = await removerLancamentoRm(lancamento(), { motivo: "cancelamento_total", removidoPor: "x@y" }, f.d)
  assert.equal(r.estado, "ja_ausente")
  assert.deepEqual(f.nomes(), ["fecharAusente"])
})

test("delete aceito mas a releitura falha: indeterminado, nada confirmado", async () => {
  let leituras = 0
  const f = fakes({
    existe: (async () => {
      leituras++
      if (leituras === 1) return true
      throw new Error("RM SOAP transporte: timeout")
    }) as DepsRm["existe"],
  })
  const r = await removerLancamentoRm(lancamento(), { motivo: "cancelamento_total" }, f.d)
  assert.equal(r.estado, "indeterminado")
  assert.match(r.erro!, /remocao_nao_conferida/)
  assert.ok(!f.nomes().includes("confirmar"))
  assert.ok(!f.nomes().includes("confirmarRemocao"))
})

test("remover o que existe: marca, reserva, apaga, confere e confirma", async () => {
  let leituras = 0
  const f = fakes({ existe: (async () => ++leituras === 1) as DepsRm["existe"] })
  const r = await removerLancamentoRm(lancamento(), { motivo: "cancelamento_total" }, f.d)
  assert.equal(r.estado, "removido")
  assert.deepEqual(f.nomes(), ["marcarRemocao", "reservar", "apagar", "confirmar", "confirmarRemocao"])
})
