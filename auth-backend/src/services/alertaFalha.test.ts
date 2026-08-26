// Integração contra o banco real. `MONITOR_ENVIO_HABILITADO` está desligado no ambiente
// de teste, então nada sai de verdade: o alerta é gravado com `enviado_em` nulo e
// `erro='nao_enviado:desabilitado'`. É exatamente o modo de homologação, e é o que
// permite testar o dedupe e o fusível sem mandar WhatsApp.
import { test } from "node:test"
import assert from "node:assert/strict"
import { query } from "../db.js"
import { abrirExecucao } from "./execucao.js"
import { alertarFalha, varrerAbandonadas } from "./alertaFalha.js"

const MARCA = "alerta.test@local"
const PISO = "2020-01-01T00:00:00Z"

async function limpar(): Promise<void> {
  // alerta_falha usa ON DELETE SET NULL, então some por assinatura, não por cascade.
  await query("DELETE FROM alerta_falha WHERE acao LIKE 'teste_%' OR etapa LIKE 'teste_%'")
  await query("DELETE FROM audit_lancamentos WHERE operador_email = $1", [MARCA])
}

const abrir = (extra: Record<string, unknown> = {}) =>
  abrirExecucao({
    acao: "convocacao", motor: "backend", operador: { email: MARCA },
    pessoa: "MISSILENE ALENCAR", contrato: "CETAM", ...extra,
  })

test("alerta grava com corpo, link e destino", async () => {
  try {
    const ex = await abrir()
    const r = await alertarFalha({
      execucaoId: ex.id, origem: "execucao", acao: "convocacao",
      etapa: "teste_fase", erro: "rm_indisponivel: HTTP 504",
    })
    assert.equal(r.gravado, true)
    const { rows } = await query<{ corpo: string; link: string; destino: string; enviado_em: Date | null; erro: string | null }>(
      "SELECT corpo, link, destino, enviado_em, erro FROM alerta_falha WHERE etapa='teste_fase'",
    )
    assert.equal(rows.length, 1)
    assert.match(rows[0]!.corpo, /Falha na automação/)
    assert.match(rows[0]!.link, /\/atividade\?exec=/)
    assert.ok(rows[0]!.destino)
    // Envio desligado: gravado, não enviado, e o motivo fica explícito.
    assert.equal(rows[0]!.enviado_em, null)
    assert.equal(rows[0]!.erro, "nao_enviado:desabilitado")
  } finally { await limpar() }
})

// O comportamento central: dedupe ANTES do fusível. RM fora do ar no mensal dá 100+
// falhas idênticas; sem isto o teto colapsaria as 100 cópias iguais e engoliria a falha
// DIFERENTE que veio depois.
test("mesma assinatura na mesma hora nao duplica — incrementa qtd", async () => {
  try {
    const ex = await abrir()
    const entrada = {
      execucaoId: ex.id, origem: "execucao" as const, acao: "convocacao",
      etapa: "teste_fase", erro: "rm_indisponivel: HTTP 504",
    }
    const a = await alertarFalha(entrada)
    const b = await alertarFalha(entrada)
    const c = await alertarFalha(entrada)
    assert.equal(a.deduplicado, false)
    assert.equal(b.deduplicado, true)
    assert.equal(c.deduplicado, true)
    const { rows } = await query<{ n: number; qtd: number }>(
      "SELECT count(*)::int n, max(qtd)::int qtd FROM alerta_falha WHERE etapa='teste_fase'",
    )
    assert.equal(rows[0]!.n, 1, "criou linha duplicada")
    assert.equal(rows[0]!.qtd, 3)
  } finally { await limpar() }
})

test("erro com id de request variavel ainda deduplica (normalizacao)", async () => {
  try {
    const ex = await abrir()
    await alertarFalha({ execucaoId: ex.id, origem: "execucao", acao: "convocacao", etapa: "teste_fase", erro: "HTTP 504 req-id aaa111 tentativa 2" })
    await alertarFalha({ execucaoId: ex.id, origem: "execucao", acao: "convocacao", etapa: "teste_fase", erro: "HTTP 504 req-id bbb222 tentativa 3" })
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM alerta_falha WHERE etapa='teste_fase'",
    )
    assert.equal(rows[0]!.n, 1, "id de request diferente furou o dedupe")
  } finally { await limpar() }
})

test("fase DIFERENTE gera alerta proprio (nao e engolida)", async () => {
  try {
    const ex = await abrir()
    await alertarFalha({ execucaoId: ex.id, origem: "execucao", acao: "convocacao", etapa: "teste_a", erro: "x" })
    await alertarFalha({ execucaoId: ex.id, origem: "execucao", acao: "convocacao", etapa: "teste_b", erro: "y" })
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM alerta_falha WHERE etapa IN ('teste_a','teste_b')",
    )
    assert.equal(rows[0]!.n, 2)
  } finally { await limpar() }
})

// Leitura que deu 502 não é alerta — senão o grupo vira lixo.
test("acao irrelevante nao gera alerta", async () => {
  try {
    const r = await alertarFalha({ origem: "execucao", acao: "consulta_qualquer", etapa: "teste_fase", erro: "502" })
    assert.equal(r.gravado, false)
    assert.equal(r.motivo, "acao_irrelevante")
    const { rows } = await query<{ n: number }>("SELECT count(*)::int n FROM alerta_falha WHERE etapa='teste_fase'")
    assert.equal(rows[0]!.n, 0)
  } finally { await limpar() }
})

test("sempre=true fura o filtro (job e workflow sao sempre negocio)", async () => {
  try {
    const r = await alertarFalha({ origem: "job", acao: "convocacao_rm_pontual", etapa: "teste_fase", erro: "morreu", sempre: true })
    assert.equal(r.gravado, true)
  } finally { await limpar() }
})

// A ponta que amarra tudo: fechar 'erro' no log dispara o alerta sozinho.
test("comExecucao fechando 'erro' dispara o alerta com pessoa e contrato", async () => {
  try {
    const ex = await abrir()
    await ex.etapa("teste_fase", "erro", { mensagem: "quebrou aqui" })
    await ex.fechar("erro", { erro: new Error("rm_indisponivel"), etapaErro: "teste_fase" })
    const { rows } = await query<{ corpo: string; execucao_id: string }>(
      "SELECT corpo, execucao_id FROM alerta_falha WHERE etapa='teste_fase'",
    )
    assert.equal(rows.length, 1, "fechar('erro') nao gerou alerta")
    assert.equal(rows[0]!.execucao_id, ex.id)
    assert.match(rows[0]!.corpo, /MISSILENE ALENCAR — CETAM/)
  } finally { await limpar() }
})

// 'parcial' é convocação que existe com Drive/RM pendente — a fila cuida, e alertar
// faria o grupo receber mensagem de coisa que se resolve sozinha.
test("fechar 'parcial' NAO alerta", async () => {
  try {
    const ex = await abrir()
    await ex.etapa("teste_fase", "aviso")
    await ex.fechar("parcial")
    const { rows } = await query<{ n: number }>("SELECT count(*)::int n FROM alerta_falha WHERE etapa='teste_fase'")
    assert.equal(rows[0]!.n, 0)
  } finally { await limpar() }
})

test("fechar 'ok' NAO alerta", async () => {
  try {
    const ex = await abrir()
    await ex.fechar("ok")
    const { rows } = await query<{ n: number }>("SELECT count(*)::int n FROM alerta_falha WHERE execucao_id=$1", [ex.id])
    assert.equal(rows[0]!.n, 0)
  } finally { await limpar() }
})

test("varrerAbandonadas marca 'aberta' velha e alerta", async () => {
  try {
    const ex = await abrir()
    // Envelhece a execução: a varredura só pega o que passou do limite de minutos.
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [ex.id])
    await query("UPDATE audit_lancamentos SET etapa_atual='teste_fase' WHERE id=$1", [ex.id])
    const r = await varrerAbandonadas(PISO, 15)
    assert.ok(r.marcadas >= 1)
    const { rows } = await query<{ estado: string; erro_msg: string }>(
      "SELECT estado, erro_msg FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.equal(rows[0]!.estado, "abandonada")
    assert.match(rows[0]!.erro_msg, /abandonada/)
  } finally { await limpar() }
})

test("varrerAbandonadas NAO toca execucao recem-aberta", async () => {
  try {
    const ex = await abrir()
    await varrerAbandonadas(PISO, 15)
    const { rows } = await query<{ estado: string }>("SELECT estado FROM audit_lancamentos WHERE id=$1", [ex.id])
    assert.equal(rows[0]!.estado, "aberta", "matou execucao que ainda estava rodando")
  } finally { await limpar() }
})

// O caso REAL de 12/08 20:08 (KETLEM, item 12788484122): a rota gravou a convocação com 5
// fases e 4 artefatos e fechou 'ok', e sobrou uma linha fantasma do front que ninguém
// fechou. A varredura marcou 'abandonada' e disparou alerta de algo que DEU CERTO. A causa
// (Promise.race que não cancelava o fetch) foi corrigida no front; este é o cinto.
test("abandonada NAO alerta quando outra execucao do mesmo alvo fechou ok", async () => {
  try {
    const alvo = "12788484122"
    // A execução que funcionou.
    const boa = await abrir({ alvo })
    await boa.fechar("ok")
    // A fantasma: mesmo alvo, aberta e nunca fechada.
    const fantasma = await abrir({ alvo })
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [fantasma.id])

    const r = await varrerAbandonadas(PISO, 15)
    assert.ok(r.marcadas >= 1, "nao marcou a fantasma")
    assert.equal(r.alertadas, 0, "alertou sobre uma convocacao que deu certo")

    // Marcada como abandonada (é história), mas sem alerta.
    const { rows } = await query<{ estado: string }>("SELECT estado FROM audit_lancamentos WHERE id=$1", [fantasma.id])
    assert.equal(rows[0]!.estado, "abandonada")
    const al = await query<{ n: number }>("SELECT count(*)::int n FROM alerta_falha WHERE execucao_id=$1", [fantasma.id])
    assert.equal(al.rows[0]!.n, 0)
  } finally { await limpar() }
})

// 25/08: `abandonada` PAROU de alertar, mesmo sozinha. As 4 de produção tinham TODAS
// `uuid_alvo` preenchido — o item existia no board. Alerta é pra falha da automação; isto
// é conferência, e o `erro_msg` é que diz o que conferir.
test("abandonada NAO alerta nem sozinha, e o erro_msg aponta o item a conferir", async () => {
  try {
    const ex = await abrir({ alvo: "sozinha-999" })
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [ex.id])
    const r = await varrerAbandonadas(PISO, 15)
    assert.equal(r.alertadas, 0, "voltou a alertar abandonada")
    assert.ok(r.comEfeito >= 1, "nao contou a abandonada que deixou item pra tras")
    const { rows } = await query<{ estado: string; erro_msg: string }>(
      "SELECT estado, erro_msg FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.equal(rows[0]!.estado, "abandonada")
    assert.match(rows[0]!.erro_msg, /item sozinha-999 criado, fim nao confirmado/)
    const al = await query<{ n: number }>("SELECT count(*)::int n FROM alerta_falha WHERE execucao_id=$1", [ex.id])
    assert.equal(al.rows[0]!.n, 0, "gravou alerta de abandonada")
  } finally { await limpar() }
})

// O outro lado do par: sem item nenhum criado, não há o que conferir — e a mensagem tem
// que dizer isso, senão a lista de conferência nasce cheia de linha inofensiva.
test("abandonada sem alvo nenhum registra que nao houve efeito", async () => {
  try {
    const ex = await abrir()
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [ex.id])
    const r = await varrerAbandonadas(PISO, 15)
    assert.equal(r.alertadas, 0)
    // Assere na LINHA, não no contador: a varredura é global, e outra execução aberta
    // qualquer entraria na contagem e faria este teste falhar sem culpa.
    const { rows } = await query<{ erro_msg: string }>(
      "SELECT erro_msg FROM audit_lancamentos WHERE id=$1", [ex.id],
    )
    assert.match(rows[0]!.erro_msg, /nenhum efeito registrado/)
  } finally { await limpar() }
})

// 26/08 11:01, alerta da FABIANA — o furo que ESTE par existe pra fechar. A fantasma
// nasceu 19:10:45 sem uuid_alvo e com zero fases; a irmã 'ok' nasceu 19:10:46 com o item
// 12895813874. O guarda comparava só `irma.uuid_alvo = a.uuid_alvo`, e com `a.uuid_alvo`
// NULL isso nunca é verdade — NULL não casa nem com outro NULL. Resultado: alerta no
// WhatsApp sobre uma convocação que DEU CERTO.
test("fantasma SEM uuid_alvo casa a irma por pessoa+periodo", async () => {
  try {
    const resumo = { chapa: "007209", data_inicio: "2026-08-26", data_fim: "2026-08-31" }
    const boa = await abrir({ alvo: "12895813874", resumo })
    await boa.fechar("ok")
    const fantasma = await abrir({ resumo })
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [fantasma.id])

    const r = await varrerAbandonadas(PISO, 15)
    assert.equal(r.alertadas, 0)
    assert.ok(r.fantasmas >= 1, "nao reconheceu a fantasma sem alvo")
    const { rows } = await query<{ erro_msg: string }>(
      "SELECT erro_msg FROM audit_lancamentos WHERE id=$1", [fantasma.id],
    )
    assert.match(rows[0]!.erro_msg, /linha fantasma/)
    const al = await query<{ n: number }>("SELECT count(*)::int n FROM alerta_falha WHERE execucao_id=$1", [fantasma.id])
    assert.equal(al.rows[0]!.n, 0, "gravou alerta de uma convocacao que deu certo")
  } finally { await limpar() }
})

// Controle do par: mesma pessoa, período DIFERENTE, não é fantasma — senão a regra nova
// engoliria abandonada legítima de quem foi convocado duas vezes no mesmo dia.
test("mesma pessoa com periodo diferente NAO conta como fantasma", async () => {
  try {
    const boa = await abrir({ alvo: "12895813874", resumo: { data_inicio: "2026-08-26", data_fim: "2026-08-31" } })
    await boa.fechar("ok")
    const outra = await abrir({ resumo: { data_inicio: "2026-09-10", data_fim: "2026-09-12" } })
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [outra.id])

    await varrerAbandonadas(PISO, 15)
    const { rows } = await query<{ erro_msg: string }>(
      "SELECT erro_msg FROM audit_lancamentos WHERE id=$1", [outra.id],
    )
    assert.doesNotMatch(rows[0]!.erro_msg, /linha fantasma/, "casou fantasma com periodo diferente")
  } finally { await limpar() }
})

// A assinatura sem a pessoa colapsava duas falhas de gente DIFERENTE numa mensagem só,
// que nomeava apenas a primeira. Medido em 25/08 nas 15 linhas de assinatura b3e13358….
test("clique unico de pessoas diferentes NAO colapsa numa mensagem", async () => {
  try {
    const ex = await abrir()
    const base = {
      execucaoId: ex.id, origem: "execucao" as const, acao: "convocacao",
      etapa: "teste_fase", erro: "rm_indisponivel: HTTP 504",
    }
    const a = await alertarFalha({ ...base, pessoa: "PESSOA UM" })
    const b = await alertarFalha({ ...base, pessoa: "PESSOA DOIS" })
    assert.equal(a.deduplicado, false)
    assert.equal(b.deduplicado, false, "colapsou falha de outra pessoa na primeira")
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int n FROM alerta_falha WHERE etapa='teste_fase'",
    )
    assert.equal(rows[0]!.n, 2)
  } finally { await limpar() }
})

// E o contrário continua valendo: processo em massa ('job') fica FORA da assinatura por
// pessoa, senão RM fora do ar no mensal manda uma mensagem por contrato.
test("job em massa ainda colapsa mesmo com pessoas diferentes", async () => {
  try {
    const base = {
      origem: "job" as const, acao: "convocacao", sempre: true,
      etapa: "teste_massa", erro: "rm_indisponivel: HTTP 504",
    }
    const a = await alertarFalha({ ...base, pessoa: "PESSOA UM" })
    const b = await alertarFalha({ ...base, pessoa: "PESSOA DOIS" })
    assert.equal(a.deduplicado, false)
    assert.equal(b.deduplicado, true, "deixou de colapsar falha em massa")
  } finally { await limpar() }
})

// A trava que impede a primeira passada de alertar sobre o histórico inteiro.
test("varrerAbandonadas respeita o piso e ignora o passado", async () => {
  try {
    const ex = await abrir()
    await query("UPDATE audit_lancamentos SET criado_em = now() - interval '30 minutes' WHERE id=$1", [ex.id])
    const r = await varrerAbandonadas("2099-01-01T00:00:00Z", 15)
    assert.equal(r.marcadas, 0)
    const { rows } = await query<{ estado: string }>("SELECT estado FROM audit_lancamentos WHERE id=$1", [ex.id])
    assert.equal(rows[0]!.estado, "aberta")
  } finally { await limpar() }
})
