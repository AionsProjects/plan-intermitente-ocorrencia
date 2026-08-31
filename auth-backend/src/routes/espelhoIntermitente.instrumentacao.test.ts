// Instrumentação das rotas de registro/cancelamento/split.
//
// Foco no que a instrumentação promete e o typecheck não garante: que a execução é
// ABERTA antes de qualquer efeito, que uma recusa de negócio fecha 'erro' (e não fica
// 'aberta' até a varredura de abandonadas), e que o alerta sai com pessoa e contrato.
//
// Usa uma convocação descartável no espelho PG. Ela NÃO tem item no Histórico do Monday,
// e isso é parte do cenário: a rota resolve o item por uuid, não acha, empilha
// `historico_nao_encontrado` e fecha 'parcial'. Por isso o caminho feliz aqui afirma
// 'parcial' com o motivo, e não 'ok' — o que este arquivo garante é o FECHAMENTO
// EXPLÍCITO (o defeito seria a linha ficar 'aberta' até a varredura de abandonadas).
import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { construirApp } from "../app.js"
import { query } from "../db.js"

const MARCA = "instrum.test@local"
let app: Awaited<ReturnType<typeof construirApp>>

async function limpar(uuid: string): Promise<void> {
  await query("DELETE FROM alerta_falha WHERE acao IN ('registro','cancelamento','split')")
  await query("DELETE FROM audit_lancamentos WHERE operador_email = $1", [MARCA])
  await query("DELETE FROM descontos WHERE uuid_convocacao = $1", [uuid])
  await query("DELETE FROM convocacoes WHERE uuid = $1", [uuid])
}

/** Convocação mínima no espelho PG, com período curto e sem sábado. */
async function semearConvocacao(uuid: string, extra: Record<string, unknown> = {}): Promise<void> {
  await query(
    `INSERT INTO convocacoes (uuid, chapa, contrato, nome, data_inicio, data_fim, status,
                              optante_vt, trabalha_sabado, status_cancelamento)
     VALUES ($1,'007406','CETAM','MISSILENE ALENCAR','2026-08-03','2026-08-05',$2,true,false,$3)`,
    [uuid, extra.status ?? "Aguardando", extra.status_cancelamento ?? null],
  )
}

const postar = (url: string, body: unknown) =>
  app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: body })

const execucaoDe = (uuid: string) =>
  query<{ id: string; acao: string; estado: string; erro_etapa: string | null; pessoa_nome: string; contrato: string }>(
    `SELECT id, acao, estado, erro_etapa, pessoa_nome, contrato
       FROM audit_lancamentos WHERE uuid_alvo = $1 ORDER BY criado_em DESC LIMIT 1`,
    [uuid],
  ).then((r) => r.rows[0])

test("setup", async () => { app = await construirApp() })

test("registro: execucao abre com pessoa/contrato e FECHA, com fases e artefatos", async () => {
  const uuid = randomUUID()
  try {
    await semearConvocacao(uuid)
    const r = await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ABCD-2345",
      respostas: [{ data: "2026-08-03", tipo: "falta" }],
      operador: { email: MARCA, nome: "Operador Teste" },
    })
    assert.equal(r.statusCode, 200, r.payload)

    const ex = await execucaoDe(uuid)
    assert.ok(ex, "nao abriu execucao")
    assert.equal(ex!.acao, "registro")
    // O que importa é ter FECHADO: 'aberta' é que seria o defeito, porque deixaria a linha
    // na mão da varredura de abandonadas. 'parcial' porque a convocação semeada só existe
    // no espelho PG e a rota não acha o item do Histórico — asserir o motivo é o que
    // impede este teste de virar "aceita qualquer desfecho".
    assert.equal(ex!.estado, "parcial")
    const { rows: fechamento } = await query<{ payload_resumo: { monday_falhas?: string[] } }>(
      "SELECT payload_resumo FROM audit_lancamentos WHERE id=$1", [ex!.id],
    )
    assert.deepEqual(fechamento[0]!.payload_resumo.monday_falhas, ["historico_nao_encontrado"])
    assert.equal(ex!.pessoa_nome, "MISSILENE ALENCAR")
    assert.equal(ex!.contrato, "CETAM")

    const fases = await query<{ etapa: string; estado: string }>(
      "SELECT etapa, estado FROM atividade_evento WHERE execucao_id=$1 ORDER BY id", [ex!.id],
    )
    const nomes = fases.rows.map((f) => f.etapa)
    assert.ok(nomes.includes("ledger"), `sem fase ledger: ${nomes.join(",")}`)
    assert.ok(nomes.includes("gravar_convocacao"), `sem fase gravar_convocacao: ${nomes.join(",")}`)

    const arts = await query<{ tipo: string; chave: string }>(
      "SELECT tipo, chave FROM atividade_artefato WHERE execucao_id=$1", [ex!.id],
    )
    assert.ok(arts.rows.some((a) => a.tipo === "protocolo" && a.chave === "PROT-ABCD-2345"))
    assert.ok(arts.rows.some((a) => a.tipo === "convocacao_uuid" && a.chave === uuid))
  } finally { await limpar(uuid) }
})

// O caso que a instrumentação existe pra pegar: recusa de negócio precisa deixar rastro
// com o MOTIVO, não sumir nem virar linha 'aberta'.
test("registro: 409 de convocacao cancelada fecha 'erro' com o motivo", async () => {
  const uuid = randomUUID()
  try {
    await semearConvocacao(uuid, { status_cancelamento: "Cancelada" })
    const r = await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ABCD-2345", respostas: [], operador: { email: MARCA },
    })
    assert.equal(r.statusCode, 409)
    assert.equal(r.json().erro, "convocacao_cancelada")

    const ex = await execucaoDe(uuid)
    assert.equal(ex!.estado, "erro")
    assert.equal(ex!.erro_etapa, "validacao")
    const { rows } = await query<{ erro_msg: string }>(
      "SELECT erro_msg FROM audit_lancamentos WHERE id=$1", [ex!.id],
    )
    assert.equal(rows[0]!.erro_msg, "convocacao_cancelada")
  } finally { await limpar(uuid) }
})

test("registro: 409 de ja_concluido tambem fecha 'erro'", async () => {
  const uuid = randomUUID()
  try {
    await semearConvocacao(uuid, { status: "Concluido" })
    const r = await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ABCD-2345", respostas: [], operador: { email: MARCA },
    })
    assert.equal(r.statusCode, 409)
    const ex = await execucaoDe(uuid)
    assert.equal(ex!.estado, "erro")
  } finally { await limpar(uuid) }
})

// A recusa fecha 'erro', e fechar 'erro' dispara o escape — com pessoa e contrato, que é
// o que faz o DP conseguir agir na mensagem.
test("recusa de negocio gera alerta com pessoa e contrato", async () => {
  const uuid = randomUUID()
  try {
    await semearConvocacao(uuid, { status_cancelamento: "Cancelada" })
    await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ABCD-2345", respostas: [], operador: { email: MARCA },
    })
    const { rows } = await query<{ corpo: string; etapa: string }>(
      "SELECT corpo, etapa FROM alerta_falha WHERE acao='registro' ORDER BY criado_em DESC LIMIT 1",
    )
    assert.equal(rows.length, 1, "recusa nao gerou alerta")
    assert.equal(rows[0]!.etapa, "validacao")
    assert.match(rows[0]!.corpo, /MISSILENE ALENCAR — CETAM/)
    assert.match(rows[0]!.corpo, /Registro de ocorrência/)
  } finally { await limpar(uuid) }
})

test("registro sem desconto marca a fase como 'pulado', nao a esconde", async () => {
  const uuid = randomUUID()
  try {
    await semearConvocacao(uuid)
    // Só dia sem ocorrência: não há falta nem atraso, logo nada a descontar.
    const r = await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ABCD-2345",
      respostas: [{ data: "2026-08-03", tipo: "sem_ocorrencia" }],
      operador: { email: MARCA },
    })
    assert.equal(r.statusCode, 200, r.payload)
    const ex = await execucaoDe(uuid)
    const { rows } = await query<{ estado: string }>(
      "SELECT estado FROM atividade_evento WHERE execucao_id=$1 AND etapa='desconto'", [ex!.id],
    )
    assert.equal(rows[0]?.estado, "pulado")
  } finally { await limpar(uuid) }
})

test("uuid ausente nem abre execucao (400 e erro de quem chamou, nao falha de automacao)", async () => {
  try {
    const r = await postar("/api/intermitente-finalizar", { protocolo: "PROT-ABCD-2345", operador: { email: MARCA } })
    assert.equal(r.statusCode, 400)
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM audit_lancamentos WHERE operador_email=$1", [MARCA],
    )
    assert.equal(rows[0]!.n, 0, "abriu execucao pra payload malformado")
  } finally { await limpar(randomUUID()) }
})

// O front cunha o id e injeta no payload; a rota tem que se ANEXAR, não abrir outra.
test("execucao_id do front reataca em vez de criar cabecalho novo", async () => {
  const uuid = randomUUID()
  try {
    await semearConvocacao(uuid)
    const { abrirExecucao } = await import("../services/execucao.js")
    const aberta = await abrirExecucao({
      acao: "registro", motor: "app", operador: { email: MARCA }, alvo: uuid,
    })
    const r = await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ABCD-2345",
      respostas: [{ data: "2026-08-03", tipo: "falta" }],
      execucao_id: aberta.id,
      operador: { email: MARCA },
    })
    assert.equal(r.statusCode, 200, r.payload)
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM audit_lancamentos WHERE operador_email=$1", [MARCA],
    )
    assert.equal(rows[0]!.n, 1, "criou cabecalho duplicado")
    const ex = await execucaoDe(uuid)
    assert.equal(ex!.id, aberta.id)
    // 'parcial' pelo mesmo motivo do primeiro teste (sem item de Histórico). O ponto aqui
    // é o reataque no cabeçalho existente — e que ele foi FECHADO, não deixado 'aberta'.
    assert.equal(ex!.estado, "parcial")
  } finally { await limpar(uuid) }
})

test("cleanup", async () => {
  await query("DELETE FROM alerta_falha WHERE acao IN ('registro','cancelamento','split')")
  await query("DELETE FROM audit_lancamentos WHERE operador_email = $1", [MARCA])
})

// A adoção existe porque `pi.convocacoes` só é povoada por `/api/monday/ativar`, e o webhook
// `ativar` do board ainda dispara o WF1 — então toda convocação viva nasceu só no Monday e o
// registro pelo código respondia 404 (PRISCILA CASTRO, 31/08/2026, seis tentativas).
// Aqui o uuid não existe em lugar NENHUM: nem no espelho, nem no board. O 404 tem de sobreviver
// à adoção, senão a rota passaria a aceitar uuid inventado.
test("registro: uuid que não existe nem no espelho nem no board segue 404", async () => {
  const uuid = randomUUID()
  try {
    const r = await postar(`/api/intermitente-finalizar?uuid=${uuid}`, {
      protocolo: "PROT-ZZZZ-9999",
      respostas: [{ data: "2026-08-03", tipo: "falta" }],
      operador: { email: MARCA, nome: "Operador Teste" },
    })
    assert.equal(r.statusCode, 404, r.payload)
    assert.equal(JSON.parse(r.payload).erro, "nao_encontrado")
    // E nada foi adotado: 404 antes de qualquer escrita.
    const { rows } = await query(`SELECT 1 FROM convocacoes WHERE uuid = $1`, [uuid])
    assert.equal(rows.length, 0, "não pode ter criado linha no espelho")
  } finally {
    await limpar(uuid)
  }
})
