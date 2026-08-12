import { test } from "node:test"
import assert from "node:assert/strict"
import {
  linkExecucao, mensagemFalha, mensagemFalhaAgrupada, normalizarErro, quandoCurto,
} from "./mensagemFalha.js"

const BASE = "https://plan-intermitente-ocorrencia.vercel.app"

test("mensagem tem titulo em negrito e nao tem emoji", () => {
  const m = mensagemFalha(
    { origem: "job", acao: "convocacao", acaoLabel: "Convocação", etapa: "convocacao_rm", etapaLabel: "Convocação no RM" },
    BASE,
  )
  assert.match(m, /^\*Falha na fila \(esgotou as tentativas\) — Convocação\*/)
  // Padrão do dono do produto (2026-08-04): sem emoji, em toda a frota.
  assert.doesNotMatch(m, /\p{Extended_Pictographic}/u)
})

test("mensagem traz fase, pessoa, contrato, erro e link", () => {
  const m = mensagemFalha({
    execucaoId: "abc-123",
    origem: "execucao",
    acao: "convocacao", acaoLabel: "Convocação",
    etapa: "convocacao_rm", etapaLabel: "Convocação no RM (eSocial)",
    erro: "rm_indisponivel: HTTP 504 ponte AIONS",
    pessoa: "MISSILENE ALENCAR", contrato: "CETAM",
    tentativa: 5, maxTentativas: 5,
    quando: "2026-08-12T18:07:00.000Z",
  }, BASE)
  assert.match(m, /Fase: Convocação no RM \(eSocial\) \(tentativa 5 de 5\)/)
  assert.match(m, /Pessoa: MISSILENE ALENCAR — CETAM/)
  assert.match(m, /Erro: rm_indisponivel: HTTP 504 ponte AIONS/)
  assert.match(m, /Ver: https:\/\/.+\/atividade\?exec=abc-123/)
})

// O corpo é gravado e enviado por WhatsApp — é a última barreira antes de vazar.
test("erro com Bearer e CPF sai redigido no corpo", () => {
  const m = mensagemFalha({
    origem: "execucao", acao: "convocacao",
    erro: "falhou com Authorization: Bearer eyJhbGciOi.abc do cpf 123.456.789-01",
  }, BASE)
  assert.doesNotMatch(m, /eyJhbGciOi/)
  assert.match(m, /\[redigido\]/)
})

test("hora sai no fuso de Manaus, nao em UTC", () => {
  // 18:07Z = 14:07 em Manaus (UTC-4). Se sair 18:07, a mensagem nao bate com o log.
  assert.equal(quandoCurto("2026-08-12T18:07:00.000Z"), "12/08 14:07")
})

test("link poe o evento no HASH, nunca em query", () => {
  const l = linkExecucao(BASE, "abc-123", 48213)
  assert.equal(l, `${BASE}/atividade?exec=abc-123#e:48213`)
  // Hash não é enviado ao servidor nem aparece em log da Vercel, e esta URL vai por WhatsApp.
  assert.doesNotMatch(l, /[?&]evento=/)
})

test("link sem evento nao deixa hash solto", () => {
  assert.equal(linkExecucao(BASE, "abc-123"), `${BASE}/atividade?exec=abc-123`)
  assert.equal(linkExecucao(`${BASE}/`, "abc-123"), `${BASE}/atividade?exec=abc-123`)
})

test("abandonada explica que nao houve erro, a execucao parou de reportar", () => {
  const m = mensagemFalha({ origem: "abandonada", acao: "convocacao", execucaoId: "x" }, BASE)
  assert.match(m, /Execução interrompida no meio/)
  assert.match(m, /abriu e nunca fechou/)
})

// Sem isto o fusível engoliria mensagens sem dizer que engoliu, que é pior que ruído.
test("mensagem agrupada avisa que colapsou e conta por acao+fase", () => {
  const itens = [
    { origem: "execucao" as const, acaoLabel: "Convocação", etapaLabel: "Convocação no RM", execucaoId: "a" },
    { origem: "execucao" as const, acaoLabel: "Convocação", etapaLabel: "Convocação no RM" },
    { origem: "execucao" as const, acaoLabel: "Pagamento mensal", etapaLabel: "Pedido PIX Caju" },
  ]
  const m = mensagemFalhaAgrupada(itens, BASE)
  assert.match(m, /\*3 falhas na automação na última hora\*/)
  assert.match(m, /agrupadas/)
  assert.match(m, /2x Convocação · Convocação no RM/)
  assert.match(m, /1x Pagamento mensal · Pedido PIX Caju/)
  assert.match(m, /Uma delas: .+\?exec=a/)
  assert.match(m, /Todas: .+\/atividade\?st=erro/)
})

// A razão de existir do dedupe: sem normalizar, cada 504 tem id diferente e a
// assinatura nunca repete — a tempestade passa inteira.
test("normalizarErro colapsa numero, uuid e id de request", () => {
  const a = normalizarErro("HTTP 504 req-id abc12345-1111-4000-8000-abcdefabcdef tentativa 3")
  const b = normalizarErro("HTTP 504 req-id def67890-2222-4000-8000-fedcbafedcba tentativa 4")
  assert.equal(a, b)
})

// O caso que o teste de uuid NAO cobria: id curto alfanumerico, que e o formato real
// do reqId do Fastify (`req-9`). `\b\d+\b` nao pega o `111` dentro de `aaa111`.
test("normalizarErro colapsa id alfanumerico curto", () => {
  assert.equal(
    normalizarErro("HTTP 504 req-id aaa111 tentativa 2"),
    normalizarErro("HTTP 504 req-id bbb222 tentativa 3"),
  )
})

test("normalizarErro colapsa codigo de convocacao do RM", () => {
  assert.equal(
    normalizarErro("falhou ao gravar C03S003779"),
    normalizarErro("falhou ao gravar C03S003781"),
  )
})

test("normalizarErro NAO colapsa erros de causa diferente", () => {
  assert.notEqual(
    normalizarErro("rm_indisponivel: HTTP 504"),
    normalizarErro("pessoa_nao_cadastrada_na_caju: chapa 007406"),
  )
})

test("normalizarErro tolera nulo", () => {
  assert.equal(normalizarErro(null), "")
  assert.equal(normalizarErro(undefined), "")
})
