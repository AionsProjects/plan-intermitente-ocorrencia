// Parsing, classificação e mensagem de alterações do board do Plano.
// Os payloads abaixo são REAIS, capturados do board 18418191275 em 08/08/2026.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseLog, classificar, classificarOrigem, classificarSeveridade, deveNotificar, agruparPorAcao,
  formatarValor, diffDropdown, dataDoLog, ehColunaOperacional, normalizar,
  type ConfigClassificacao, type LogBruto, type AlteracaoClassificada,
} from "./alteracaoBoard.js"
import { mensagemUnica, mensagemAgrupada, nomeLimpo, competenciaCurta } from "./mensagemAlteracao.js"

const ISAAC = "98663994"       // token do app/WFs
const THIFANY = "41622430"     // DP
const KAMILLY = "98079621"     // OP

const CFG: ConfigClassificacao = {
  autorAutomacao: ISAAC,
  colunasMotor: new Set(["VR - MENSAL", "CREDITO CAJU", "CREDITO VT", "DESCONTO - VR", "VR - UNITARIO"]),
  colunasCriticas: new Set(["VR - MENSAL", "CREDITO CAJU", "STATUS PEDIDO", "ESCALA"]),
}

function log(over: Partial<LogBruto> & { data: Record<string, unknown> }): LogBruto {
  return { id: "log-1", event: "update_column_value", user_id: ISAAC, created_at: "17861306519147374", ...over }
}

// ---------------------------------------------------------------------------
test("dataDoLog: 17 digitos sao ticks de 100ns, nao microssegundos", () => {
  assert.equal(dataDoLog("17861306519147374").toISOString(), "2026-08-07T19:24:11.914Z")
})

test("formatarValor cobre os shapes reais do board", () => {
  assert.equal(formatarValor("numeric", { unit: null, value: 24.5 }), "24,5")
  assert.equal(formatarValor("numeric", { unit: null, value: 0 }), "0")
  assert.equal(formatarValor("numeric", null), null)
  assert.equal(formatarValor("text", { value: "PROT-QHTM-PC2C" }), "PROT-QHTM-PC2C")
  assert.equal(formatarValor("color", { post_id: null, label: { text: "REALIZADO", index: 1 } }), "REALIZADO")
  assert.equal(formatarValor("date", { date: "2026-08-31", time: null }), "31/08/2026")
  assert.equal(formatarValor("date", { date: "2026-08-31", time: "14:30:00" }), "31/08/2026 14:30")
  assert.equal(formatarValor("name", { name: "INTERMITENTE - FULANO" }), "INTERMITENTE - FULANO")
  assert.equal(formatarValor("button", { clicks: 2 }), "2 clique(s)")
  assert.equal(formatarValor("link", { url: "https://x", text: "https://x" }), "https://x")
  assert.equal(formatarValor("numeric", {}), null, "{} = coluna limpa")
})

test("dropdown: manda o diff, nunca a lista inteira do board", () => {
  // O Nome do Empregado devolve 193+ labels dos dois lados; sem diff a mensagem estoura.
  const antes = { labels: ["1__ELIANE DA SILVA", "2__DOILY COELHO", "3__ADRIA GOMES"] }
  const depois = { labels: ["1__ELIANE DA SILVA", "3__ADRIA GOMES", "9__NOVA PESSOA"] }
  assert.equal(diffDropdown(antes, depois), "+ NOVA PESSOA | - DOILY COELHO")
  assert.equal(diffDropdown(antes, antes), null, "lista igual = nada mudou")
})

test("status que so trocou post_id NAO conta como alteracao", () => {
  // Caso real: mesmo label REALIZADO nos dois lados, so o post_id mudou.
  const a = parseLog(log({
    data: {
      column_type: "color", column_title: "Status Pedido", board_id: 18418191275, pulse_id: 1,
      previous_value: { post_id: null, label: { text: "REALIZADO", index: 1 } },
      value: { post_id: 5438621110, label: { text: "REALIZADO", index: 1 } },
    },
  }))
  assert.equal(a.mudou, false)
  assert.equal(a.resumo, null)
  assert.equal(classificarSeveridade(a, "monday_direto", CFG), "informativa", "ruido nao vira alerta")
})

test("parseLog: eventos que nao sao update_column_value", () => {
  const criado = parseLog(log({ event: "create_pulse", data: { pulse_name: "INTERMITENTE - MARIA", group_name: "PONTUAL", board_id: 1, pulse_id: 2 } }))
  assert.equal(criado.resumo, "criado no grupo PONTUAL")

  const movido = parseLog(log({ event: "move_pulse_from_group", data: { source_group: "PONTUAL", dest_group: "CANCELADOS", board_id: 1, pulse_id: 2 } }))
  assert.equal(movido.resumo, "grupo: PONTUAL -> CANCELADOS")

  const lote = parseLog(log({
    event: "batch_change_pulses_column_value",
    data: { column_type: "numeric", column_title: "DESCONTO - VR", pulse_ids: [1, 2, 3, 4], value: { value: 0 }, board_id: 1 },
  }))
  assert.equal(lote.qtdItens, 4, "1 evento para N itens")
  assert.equal(lote.resumo, "4 item(ns) -> 0")
})

// ---------------------------------------------------------------------------
test("classificarOrigem: as 4 rotas", () => {
  const ev = { itemId: 12749358219, evento: "update_column_value" }
  const audit = { operadorNome: "KAMILLY SILVA", operadorEmail: "k@x", auditId: "a1" }
  assert.equal(classificarOrigem({ ...ev, autorId: ISAAC, colunaTitulo: "OP - Data/Fim" }, audit, CFG), "app")
  assert.equal(classificarOrigem({ ...ev, autorId: ISAAC, colunaTitulo: "VR - MENSAL" }, null, CFG), "motor")
  assert.equal(classificarOrigem({ ...ev, autorId: ISAAC, colunaTitulo: "Escala" }, null, CFG), "api_inexplicada")
  assert.equal(classificarOrigem({ ...ev, autorId: KAMILLY, colunaTitulo: "OP - Data/Fim" }, null, CFG), "monday_direto")
  assert.equal(classificarOrigem({ ...ev, autorId: "-4", colunaTitulo: "x" }, null, CFG), "motor", "app nativo do Monday")
})

test("ehColunaOperacional: o board nomeia os campos do OP", () => {
  assert.ok(ehColunaOperacional("OP - Data/Inicio"))
  assert.ok(ehColunaOperacional("Op - Contrato"), "aceita a variacao de caixa do board")
  assert.ok(!ehColunaOperacional("CREDITO CAJU"))
  assert.equal(normalizar("Dias Úteis/Mês - VR"), "DIAS UTEIS/MES - VR")
})

test("severidade: motor cala, api_inexplicada sempre alerta", () => {
  const base = { evento: "update_column_value", mudou: true }
  assert.equal(classificarSeveridade({ ...base, colunaTitulo: "VR - MENSAL" }, "motor", CFG), "informativa")
  assert.equal(classificarSeveridade({ ...base, colunaTitulo: "Observacao" }, "api_inexplicada", CFG), "critica")
  assert.equal(classificarSeveridade({ ...base, colunaTitulo: "OP - Data/Fim" }, "monday_direto", CFG), "critica")
  assert.equal(classificarSeveridade({ ...base, colunaTitulo: "VR - MENSAL" }, "app", CFG), "critica")
  assert.equal(classificarSeveridade({ ...base, colunaTitulo: "Observacao" }, "app", CFG), "informativa")
  assert.equal(classificarSeveridade({ ...base, evento: "create_pulse", colunaTitulo: null }, "monday_direto", CFG), "critica")
})

test("deveNotificar espelha o indice parcial de pi.board_alteracao", () => {
  const f = (o: Partial<AlteracaoClassificada>) => deveNotificar({ mudou: true, severidade: "critica", origem: "app", ...o } as AlteracaoClassificada)
  assert.ok(f({}))
  assert.ok(!f({ origem: "motor" }))
  assert.ok(!f({ severidade: "informativa" }))
  assert.ok(!f({ mudou: false }))
})

test("classificar: operador so aparece quando veio do app", () => {
  const alt = parseLog(log({ data: { column_type: "numeric", column_title: "DESCONTO - VR", board_id: 1, pulse_id: 2, previous_value: { value: 24.5 }, value: { value: 0 } } }))
  const audit = { operadorNome: "KAMILLY SILVA", operadorEmail: "k@x", auditId: "a1" }
  assert.equal(classificar(alt, audit, CFG).operadorNome, "KAMILLY SILVA")
  // sem match, coluna do motor -> nao atribui operador nenhum
  assert.equal(classificar(alt, null, CFG).operadorNome, null)
})

// ---------------------------------------------------------------------------
test("nomeLimpo tira o sobrenome repetido do cadastro", () => {
  assert.equal(nomeLimpo("THALLISON GOMES SOUZA SOUZA"), "THALLISON GOMES SOUZA")
  assert.equal(nomeLimpo("KARINE ROMASKEVIS DE OLIVEIRA ROMASKEVIS"), "KARINE ROMASKEVIS DE OLIVEIRA")
  assert.equal(nomeLimpo("ISAAC RAYLEN FEIJO CALDAS GOMES Gomes"), "ISAAC RAYLEN FEIJO CALDAS GOMES")
  assert.equal(nomeLimpo("ROSELY DOS SANTOS MACEDO"), "ROSELY DOS SANTOS MACEDO", "nao mexe em nome sao")
  assert.equal(nomeLimpo(null), null)
})

function classificada(over: Partial<AlteracaoClassificada> = {}): AlteracaoClassificada {
  const alt = parseLog(log({
    user_id: KAMILLY,
    data: {
      column_type: "numeric", column_title: "DESCONTO - VR", board_id: 18418191275,
      pulse_id: 12749358219, pulse_name: "INTERMITENTE - ROSELY DOS SANTOS MACEDO",
      previous_value: { value: 24.5 }, value: { value: 0 },
    },
  }), new Map([[KAMILLY, "Kamilly da Silva Ferreira"]]))
  return { ...alt, origem: "monday_direto", severidade: "critica", operadorNome: null, operadorEmail: null, auditId: null, ...over }
}

test("mensagem: edicao direta no Monday leva o aviso", () => {
  const m = mensagemUnica(classificada(), { competencia: "2026-08" })
  assert.match(m, /^\*Alteração no Plan de Intermitente 08\/26\*$/m)
  assert.match(m, /\*INTERMITENTE - ROSELY DOS SANTOS MACEDO\*/)
  assert.match(m, /DESCONTO - VR: 24,5 -> 0/)
  assert.match(m, /Por Kamilly da Silva Ferreira, 07\/08/)
  assert.match(m, /por fora do app/)
  assert.match(m, /boards\/18418191275\/pulses\/12749358219/)
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(m), "sem emoji")
})

test("mensagem: vinda do app mostra o operador real, sem aviso", () => {
  const m = mensagemUnica(
    classificada({ origem: "app", operadorNome: "THALLISON GOMES SOUZA SOUZA" }),
    { competencia: "2026-08" },
  )
  assert.match(m, /Por THALLISON GOMES SOUZA \(pelo app\)/)
  assert.ok(!/por fora do app/.test(m))
})

test("mensagem: api_inexplicada pede investigacao", () => {
  const m = mensagemUnica(classificada({ origem: "api_inexplicada" }), { competencia: "2026-08" })
  assert.match(m, /sem registro no app\. Investigar/)
})

test("mensagem agrupada: junta por item e avisa quando o fusivel estoura", () => {
  const a = classificada()
  const b = classificada({ colunaTitulo: "OP - Data/Fim", resumo: "31/08/2026 -> (vazio)" })
  const c = { ...classificada(), itemId: 999, itemNome: "INTERMITENTE - OUTRO" }
  const m = mensagemAgrupada([a, b, c], { competencia: "2026-08" }, { colapsada: true, janelaMin: 60 })
  assert.match(m, /^\*Alteração no Plan de Intermitente 08\/26\*$/m)
  assert.match(m, /^3 alterações em 2 item\(ns\)$/m)
  assert.match(m, /volume alto nos últimos 60 min/)
  assert.match(m, /- DESCONTO - VR: 24,5 -> 0/)
  assert.match(m, /- OP - Data\/Fim: 31\/08\/2026 -> \(vazio\)/)
  assert.equal((m.match(/INTERMITENTE - ROSELY/g) ?? []).length, 1, "nome do item nao repete por coluna")
})

test("mensagem agrupada com 1 alteracao cai na mensagem unica", () => {
  const a = classificada()
  assert.equal(mensagemAgrupada([a], { competencia: "2026-08" }), mensagemUnica(a, { competencia: "2026-08" }))
})

// --- correções vindas da medição de 5 dias (402 -> 50 mensagens) ---
test("DP nao se auto-notifica, mas fica gravado pro relatorio", () => {
  const cfg = { ...CFG, autoresDp: new Set([THIFANY]) }
  const alt = { autorId: THIFANY, colunaTitulo: "Status Pedido", itemId: 1, evento: "update_column_value" }
  assert.equal(classificarOrigem(alt, null, cfg), "dp_direto")
  assert.equal(classificarOrigem(alt, null, CFG), "monday_direto", "sem a lista, DP vira OP")
  const c = { ...classificada(), origem: "dp_direto" as const }
  assert.equal(deveNotificar(c), false, "nao vai pro WhatsApp do proprio DP")
})

test("evento de board (sem pulse_id) nao vira api_inexplicada", () => {
  // change_column_settings nao tem pulse_id -> nunca casaria no audit. Chamar de
  // "inexplicada" seria alarme falso por construcao; e o app criando label de dropdown.
  const semItem = { autorId: ISAAC, colunaTitulo: "Nome do Empregado", itemId: null, evento: "change_column_settings" }
  assert.equal(classificarOrigem(semItem, null, CFG), "motor")
  const comItem = { autorId: ISAAC, colunaTitulo: "Observacao", itemId: 5, evento: "update_column_value" }
  assert.equal(classificarOrigem(comItem, null, CFG), "api_inexplicada")
})

test("agruparPorAcao: 1 clique do operador = 1 mensagem, nao 12", () => {
  const doApp = (col: string) => ({ ...classificada({ origem: "app", auditId: "audit-1" }), colunaTitulo: col })
  const colunas = ["DESCONTO - VR", "DESCONTO - VT", "CREDITO VT", "CREDITO CAJU", "Dias Úteis/Mês - VR", "Dias Úteis/Mês - VT"]
  const grupos = agruparPorAcao(colunas.map(doApp))
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0]!.length, 6)
})

test("agruparPorAcao: edicao direta no Monday e sua propria acao (1:1)", () => {
  const a = { ...classificada(), activityLogId: "L1", auditId: null }
  const b = { ...classificada(), activityLogId: "L2", auditId: null }
  assert.equal(agruparPorAcao([a, b]).length, 2)
})

test("competenciaCurta segue o nome do board (08/26)", () => {
  assert.equal(competenciaCurta("2026-08"), "08/26")
  assert.equal(competenciaCurta("2026-12"), "12/26")
})

test("grupo de automacao nao vira api_inexplicada (achado da homologacao 08/08)", () => {
  // A Convocacao no RM cria 1 item por contrato no grupo "LANCAR NO RM (por contrato)".
  // Sem essa regra, 9 de 11 api_inexplicada numa janela de 24h eram isso.
  const cfg = { ...CFG, gruposMotor: new Set([normalizar("LANÇAR NO RM (por contrato)")]) }
  const doGrupo = {
    autorId: ISAAC, colunaTitulo: null, itemId: 12753255051,
    evento: "create_pulse", grupoNome: "LANÇAR NO RM (por contrato)",
  }
  assert.equal(classificarOrigem(doGrupo, null, cfg), "motor")
  assert.equal(classificarOrigem(doGrupo, null, CFG), "api_inexplicada", "sem a config, alarme falso")
  // grupo de convocacao normal segue vigiado
  assert.equal(
    classificarOrigem({ ...doGrupo, grupoNome: "PONTUAL" }, null, cfg), "api_inexplicada")
})

test("parseLog captura grupoNome do create_pulse", () => {
  const a = parseLog(log({ event: "create_pulse", data: { pulse_name: "SEDUC INTERIOR", group_name: "LANÇAR NO RM (por contrato)", board_id: 1, pulse_id: 2 } }))
  assert.equal(a.grupoNome, "LANÇAR NO RM (por contrato)")
})
