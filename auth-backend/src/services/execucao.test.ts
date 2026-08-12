// Integração contra o banco real. Cada teste limpa o que criou no `finally` —
// audit_lancamentos é auditoria de dinheiro, não pode ficar resíduo de teste lá.
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import { abrirExecucao, comEtapa, comExecucao, type Execucao } from "./execucao.js"

const MARCA = "execucao.test@local"

async function limpar(): Promise<void> {
  // ⚠️ alerta_falha PRIMEIRO e por fora: fechar 'erro' dispara o escape, e aquela tabela
  // é `ON DELETE SET NULL` de propósito (o alerta sobrevive à poda da execução) — logo o
  // CASCADE do cabeçalho NÃO a alcança, e o resíduo ficaria.
  await query(
    `DELETE FROM alerta_falha
      WHERE execucao_id IN (SELECT id FROM audit_lancamentos WHERE operador_email = $1)`,
    [MARCA],
  )
  // CASCADE leva evento e artefato.
  await query("DELETE FROM audit_lancamentos WHERE operador_email = $1", [MARCA])
}

const abrir = (extra: Record<string, unknown> = {}): Promise<Execucao> =>
  abrirExecucao({ acao: "convocacao", motor: "backend", operador: { email: MARCA }, ...extra })

test("abrirExecucao grava cabeçalho em 'aberta'", async () => {
  try {
    const ex = await abrir()
    assert.ok(ex.id, "não devolveu id")
    const { rows } = await query<{ estado: string; motor: string; acao: string }>(
      "SELECT estado, motor, acao FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.equal(rows[0]?.estado, "aberta")
    assert.equal(rows[0]?.motor, "backend")
    assert.equal(rows[0]?.acao, "convocacao")
  } finally { await limpar() }
})

test("passar o mesmo id reataca a execução em vez de criar outra", async () => {
  try {
    const a = await abrir()
    const b = await abrirExecucao({
      id: a.id, acao: "convocacao", motor: "n8n",
      operador: { email: MARCA }, correlacao: { job_id: "j1" },
    })
    assert.equal(b.id, a.id)
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM audit_lancamentos WHERE operador_email=$1", [MARCA],
    )
    assert.equal(rows[0]?.n, 1, "criou cabeçalho duplicado")
    const m = await query<{ motor: string; correlacao: Record<string, string> }>(
      "SELECT motor, correlacao FROM audit_lancamentos WHERE id=$1", [a.id],
    )
    assert.equal(m.rows[0]?.motor, "n8n", "não atualizou o motor no reatache")
    assert.equal(m.rows[0]?.correlacao.job_id, "j1")
  } finally { await limpar() }
})

test("correlacao acumula entre reataches em vez de substituir", async () => {
  try {
    const a = await abrirExecucao({ acao: "convocacao", motor: "backend", operador: { email: MARCA }, correlacao: { run_id: "r1" } })
    await abrirExecucao({ id: a.id, acao: "convocacao", motor: "job", operador: { email: MARCA }, correlacao: { job_id: "j2" } })
    const { rows } = await query<{ correlacao: Record<string, string> }>(
      "SELECT correlacao FROM audit_lancamentos WHERE id=$1", [a.id],
    )
    assert.deepEqual(rows[0]?.correlacao, { run_id: "r1", job_id: "j2" })
  } finally { await limpar() }
})

test("etapa grava e atualiza etapa_atual do cabeçalho", async () => {
  try {
    const ex = await abrir()
    const id1 = await ex.etapa("validacao", "ok", { duracaoMs: 12 })
    const id2 = await ex.etapa("caju_pedido", "erro", { mensagem: "saldo insuficiente", tentativa: 3 })
    assert.ok(id1 > 0 && id2 > 0)
    const ev = await query<{ etapa: string; estado: string; tentativa: number; mensagem: string | null }>(
      "SELECT etapa, estado, tentativa, mensagem FROM atividade_evento WHERE execucao_id=$1 ORDER BY id", [ex.id],
    )
    assert.equal(ev.rows.length, 2)
    assert.equal(ev.rows[1]?.tentativa, 3)
    assert.equal(ev.rows[1]?.mensagem, "saldo insuficiente")
    const cab = await query<{ etapa_atual: string }>("SELECT etapa_atual FROM audit_lancamentos WHERE id=$1", [ex.id])
    assert.equal(cab.rows[0]?.etapa_atual, "caju_pedido")
  } finally { await limpar() }
})

// A razão de existir do sanitizador recursivo: o corpo do alerta de WhatsApp é
// montado a partir destes metadados.
test("metadados aninhados são sanitizados antes de gravar", async () => {
  try {
    const ex = await abrir()
    await ex.etapa("caju", "erro", {
      metadados: { pessoas: [{ nome: "MARIA", chapa: "007406", cpf: "12345678901" }], auth: { token: "seg" } },
      mensagem: "Bearer abc.def falhou",
    })
    const { rows } = await query<{ metadados: unknown; mensagem: string }>(
      "SELECT metadados, mensagem FROM atividade_evento WHERE execucao_id=$1", [ex.id],
    )
    const bruto = JSON.stringify(rows[0]?.metadados)
    assert.ok(!bruto.includes("12345678901"), "vazou CPF no metadado")
    assert.ok(!bruto.includes("seg"), "vazou token no metadado")
    assert.ok(bruto.includes("007406"), "perdeu a chapa, que é o dado útil")
    assert.ok(rows[0]?.mensagem.includes("[redigido]"), "não redigiu o Bearer da mensagem")
  } finally { await limpar() }
})

test("artefato grava e retry não duplica (upsert preenche o que faltava)", async () => {
  try {
    const ex = await abrir()
    await ex.artefato({ tipo: "monday_item", chave: "12345", rotulo: "Item no Plano" })
    await ex.artefato({ tipo: "monday_item", chave: "12345", url: "https://x/pulses/12345" })
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM atividade_artefato WHERE execucao_id=$1", [ex.id],
    )
    assert.equal(rows[0]?.n, 1, "duplicou artefato no retry")
    const a = await query<{ rotulo: string; url: string }>(
      "SELECT rotulo, url FROM atividade_artefato WHERE execucao_id=$1", [ex.id],
    )
    assert.equal(a.rows[0]?.rotulo, "Item no Plano", "upsert apagou o rótulo anterior")
    assert.equal(a.rows[0]?.url, "https://x/pulses/12345", "upsert não preencheu a url nova")
  } finally { await limpar() }
})

test("fechar grava desfecho, duração e onde quebrou", async () => {
  try {
    const ex = await abrir()
    await ex.fechar("erro", { erro: new Error("rm_indisponivel"), etapaErro: "rm_convocacao" })
    const { rows } = await query<{ estado: string; erro_etapa: string; erro_msg: string; duracao_ms: number; finalizado_em: Date }>(
      "SELECT estado, erro_etapa, erro_msg, duracao_ms, finalizado_em FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.equal(rows[0]?.estado, "erro")
    assert.equal(rows[0]?.erro_etapa, "rm_convocacao")
    assert.equal(rows[0]?.erro_msg, "rm_indisponivel")
    assert.ok(rows[0]?.duracao_ms >= 0)
    assert.ok(rows[0]?.finalizado_em)
  } finally { await limpar() }
})

test("fechar é idempotente — o primeiro desfecho vence", async () => {
  try {
    const ex = await abrir()
    await ex.fechar("erro", { erro: "primeiro" })
    await ex.fechar("ok")
    const { rows } = await query<{ estado: string }>("SELECT estado FROM audit_lancamentos WHERE id=$1", [ex.id])
    assert.equal(rows[0]?.estado, "erro", "um 'ok' posterior sobrescreveu o erro")
  } finally { await limpar() }
})

test("comExecucao fecha 'ok' no caminho felizardo", async () => {
  try {
    const r = await comExecucao(
      { acao: "convocacao", motor: "backend", operador: { email: MARCA } },
      async (ex) => { await ex.etapa("passo", "ok"); return 42 },
    )
    assert.equal(r, 42)
    const { rows } = await query<{ estado: string }>(
      "SELECT estado FROM audit_lancamentos WHERE operador_email=$1", [MARCA],
    )
    assert.equal(rows[0]?.estado, "ok")
  } finally { await limpar() }
})

// O contrato que mantém as ~12 rotas existentes intactas.
test("comExecucao fecha 'erro' e RE-LANÇA o erro de negócio", async () => {
  try {
    await assert.rejects(
      comExecucao(
        { acao: "convocacao", motor: "backend", operador: { email: MARCA } },
        async () => { throw new Error("monday_falhou") },
      ),
      /monday_falhou/,
    )
    const { rows } = await query<{ estado: string; erro_msg: string }>(
      "SELECT estado, erro_msg FROM audit_lancamentos WHERE operador_email=$1", [MARCA],
    )
    assert.equal(rows[0]?.estado, "erro")
    assert.equal(rows[0]?.erro_msg, "monday_falhou")
  } finally { await limpar() }
})

test("comEtapa grava o par rodando→ok com duração", async () => {
  try {
    const ex = await abrir()
    const r = await comEtapa(ex, "caju_pedido", async () => "pedido-1")
    assert.equal(r, "pedido-1")
    const { rows } = await query<{ estado: string; duracao_ms: number | null }>(
      "SELECT estado, duracao_ms FROM atividade_evento WHERE execucao_id=$1 ORDER BY id", [ex.id],
    )
    assert.deepEqual(rows.map((r) => r.estado), ["rodando", "ok"])
    assert.ok((rows[1]?.duracao_ms ?? -1) >= 0, "não mediu duração")
  } finally { await limpar() }
})

test("comEtapa grava 'erro' na fase e re-lança", async () => {
  try {
    const ex = await abrir()
    await assert.rejects(comEtapa(ex, "rm_convocacao", async () => { throw new Error("504 ponte") }), /504 ponte/)
    const { rows } = await query<{ estado: string; mensagem: string | null }>(
      "SELECT estado, mensagem FROM atividade_evento WHERE execucao_id=$1 ORDER BY id", [ex.id],
    )
    assert.deepEqual(rows.map((r) => r.estado), ["rodando", "erro"])
    assert.equal(rows[1]?.mensagem, "504 ponte")
  } finally { await limpar() }
})

test("teto de 200 eventos: o excedente conta em eventos_truncados", async () => {
  try {
    const ex = await abrir()
    for (let i = 0; i < 203; i++) await ex.etapa(`e${i}`, "ok")
    const ev = await query<{ n: number }>(
      "SELECT count(*)::int n FROM atividade_evento WHERE execucao_id=$1", [ex.id],
    )
    assert.equal(ev.rows[0]?.n, 200, "passou do teto")
    const cab = await query<{ eventos_truncados: number }>(
      "SELECT eventos_truncados FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.equal(cab.rows[0]?.eventos_truncados, 3)
  } finally { await limpar() }
})

// A regra central: log nunca derruba negócio. Um id inexistente faz a FK falhar em
// TODAS as chamadas — e nenhuma pode lançar.
test("handle com id órfão não lança em etapa/artefato/fechar", async () => {
  const fantasma = await abrirExecucao({
    id: "00000000-0000-4000-8000-00000000dead", acao: "convocacao", motor: "backend",
  })
  // O próprio abrir pode ter falhado (FK de user_id não, mas o id é livre) — o que
  // importa é que nada abaixo lança.
  await assert.doesNotReject(async () => {
    await fantasma.etapa("x", "ok")
    await fantasma.artefato({ tipo: "monday_item", chave: "1" })
    await fantasma.fechar("ok")
  })
  await query("DELETE FROM audit_lancamentos WHERE id=$1", ["00000000-0000-4000-8000-00000000dead"])
})

test("uuid_alvo é gravado sem alteração de semântica", async () => {
  try {
    const ex = await abrir({ alvo: "12749358219", pessoa: "MARIA", contrato: "CETAM" })
    const { rows } = await query<{ uuid_alvo: string; pessoa_nome: string; contrato: string }>(
      "SELECT uuid_alvo, pessoa_nome, contrato FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.equal(rows[0]?.uuid_alvo, "12749358219")
    assert.equal(rows[0]?.pessoa_nome, "MARIA")
    assert.equal(rows[0]?.contrato, "CETAM")
  } finally { await limpar() }
})
