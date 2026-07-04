// VALIDAR ATESTADO (Nexti) — CÓDIGO-PRINCIPAL (04/07). Porta fiel do WF 6efSZ.
// Disparado pela automação do Monday (item novo no Controle de Atestados):
//  1. Lê o item do Controle → CPF + datas + modalidade/contrato.
//  2. Nexti: pessoa por CPF → absences no período → situação de cada absence.
//  3. Decisão por situação: +6 = sem desconto; -6/integral = com desconto.
//  4. Dedupe: board PROCESSADOS por absenceId (nunca processa 2×).
//  5. CELETISTA → acumulador mensal (board 18414330778).
//     INTERMITENTE → ledger no Histórico + item no board Descontos.
//  6. Registra tudo no board PROCESSADOS (18414344192).
import { gql, lerItem } from "../clients/monday.js"
import { pessoaPorCpf, absencesPessoa, situacaoAbsence, type NextiAbsence } from "../clients/nexti.js"

const BOARD_HIST = 18411141462
const BOARD_DESCONTOS = 18400981023
const GRUPO_DESCONTOS = "group_mm0rmjs3"
const BOARD_CELETISTA = 18414330778
const BOARD_PROCESSADOS = 18414344192
const BOARD_ENTRADA_FIXO = 18413180912 // fallback do WF (busca por CPF na Entrada)
const COL_LEDGER = "long_text_mm3ct3hg"

// Colunas do item do CONTROLE de atestados (board 18298015951).
const CT = {
  cpf: "text_mm3j4nt3",
  dataInicio: "date",
  dias: "numberjox5johv",
  tipoDoc: "sele__o_individual__1",
  modalidade: "single_select5yq25pm",
  contrato: "department",
  obs: "short_textl33u569o",
  arquivo: "files",
} as const

// Board PROCESSADOS.
const P = {
  absenceId: "text_mm3jzk1a", cpf: "text_mm3j6dqx", personId: "text_mm3js1wa",
  nome: "text_mm3j9bck", modalidade: "color_mm3jw8qa", controleId: "text_mm3jzynm",
  controleUrl: "link_mm3jkm63", dataInicio: "date_mm3j3waj", dataFim: "date_mm3j79yx",
  situationId: "text_mm3j6gg3", situationName: "text_mm3j4ea4", tipoRegra: "color_mm3jh4vb",
  status: "color_mm3jb4vb", resultadoJson: "long_text_mm3j5cr6", processadoEm: "date_mm3j9d6w",
  observacao: "long_text_mm3jry42",
} as const

// Acumulador CELETISTA.
const C = {
  cpf: "text_mm3jyjkd", chapa: "text_mm3je8we", contrato: "text_mm3jfx8a",
  funcao: "text_mm3jez7f", competencia: "color_mm3jzw8b", ano: "numeric_mm3jvcs5",
  status: "color_mm3j7wsd", qtdDocs: "numeric_mm3jrqra", diasVr: "numeric_mm3j1hj1",
  diasVt: "numeric_mm3jpy4n", valorVr: "numeric_mm3jwhtw", valorVt: "numeric_mm3jw496",
  total: "numeric_mm3jgc1c", regra: "text_mm3jnvpj", docsJson: "long_text_mm3jhwn0",
  observacao: "long_text_mm3jhjbe",
} as const

// Board Descontos (intermitente).
const D = {
  nome: "dropdown_mm0rgfrx", matricula: "text_mm0rpqxs", cpf: "text_mm0r5ted",
  inicio: "date_mm0r6tyr", fim: "date_mm0rzpyv", perdeVt: "numeric_mm3428yj",
  perdeVr: "numeric_mm34p6p7", atrasos: "numeric_mm2pj1av", vr: "numeric_mm0rgsaw",
  vt: "numeric_mm0r5tca", status: "color_mm0r8mjr", residualVr: "numeric_mm0r1691",
  residualVt: "numeric_mm0rtwwg", descontadoVr: "numeric_mm0rqy6z", descontadoVt: "numeric_mm0r6cn0",
} as const

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D+/g, "")
const num = (v: unknown) => Number(String(v ?? "0").replace(",", ".")) || 0
const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100
const dow = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay()

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function range(a: string, b: string): string[] {
  const out: string[] = []
  const d = new Date(a + "T00:00:00Z")
  const end = new Date(b + "T00:00:00Z")
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
function toDdMmYyyy000000(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${d}${m}${y}000000`
}
function nextiDateToIso(v: unknown): string | null {
  const s = String(v ?? "")
  const m = s.match(/^(\d{2})(\d{2})(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}
function inferirContrato(v: string): string {
  const s = norm(v)
  if (s.includes("DETRAN")) return "DETRAN"
  if (s.includes("TRE")) return "TRE PB"
  if (s.includes("SEMSA")) return "SEMSA"
  if (s.includes("CETAM")) return "CETAM"
  if (s.includes("INTERIOR")) return "SEDUC INTERIOR"
  if (s.includes("ESCOLA")) return "SEDUC ESCOLA"
  if (s.includes("SEDE") || s.includes("SEDUC")) return "SEDUC SEDE"
  return String(v || "").trim()
}
const labelMes = (iso: string) =>
  ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"][
    (Number(iso.slice(5, 7)) || 1) - 1
  ] ?? ""

// ── Helpers Monday (raw column_values com column.title) ──
interface RawCol { id: string; text: string | null; value: string | null; column?: { title?: string } }
interface RawItem { id: string; name: string; column_values: RawCol[] }
const colTx = (it: RawItem, id: string) => it.column_values.find((c) => c.id === id)?.text ?? ""
const parseJson = <T,>(v: string, fb: T): T => {
  if (!v) return fb
  try { return JSON.parse(v) as T } catch { return fb }
}
function porTitulo(it: RawItem, candidatos: string[]): RawCol | null {
  const alvo = candidatos.map(norm)
  return it.column_values.find((c) => {
    const t = norm(c.column?.title || c.id)
    return alvo.some((a) => t === a || t.includes(a))
  }) ?? null
}
const buildCV = (v: Record<string, unknown>) => JSON.stringify(v)

// Resolução de valores (mesma heurística por título do WF).
function resolverValoresItems(items: RawItem[], contratoRaw: string, funcaoRaw: string) {
  const contrato = norm(contratoRaw)
  const funcao = norm(funcaoRaw)
  const linhaAtiva = (it: RawItem) => {
    const t = norm(porTitulo(it, ["Ativo", "Status", "Habilitado"])?.text)
    return !t || ["SIM", "ATIVO", "TRUE", "1", "HABILITADO", "REALIZADO", "DONE"].includes(t)
  }
  const matches: Array<{ it: RawItem; score: number }> = []
  for (const it of items.filter(linhaAtiva)) {
    const c = norm(porTitulo(it, ["Contrato"])?.text)
    const regra = norm(porTitulo(it, ["Regra/Função", "Regra", "Funcao", "Função", "Cargo"])?.text)
    const contratoPadrao = ["PADRAO", "PADRÃO", "GLOBAL", "*"].includes(c)
    if (c && c !== contrato && !contratoPadrao) continue
    const regraPadrao = !regra || ["PADRAO", "PADRÃO", "GERAL", "*"].includes(regra)
    if (!regraPadrao && !funcao.includes(regra)) continue
    const pri = num(porTitulo(it, ["Prioridade", "Ordem"])?.text)
    matches.push({ it, score: (c === contrato ? 1000 : 0) + (!regraPadrao ? 100 : 0) + pri })
  }
  matches.sort((a, b) => b.score - a.score)
  const escolhido = matches[0]?.it
  if (!escolhido) return { vrDia: 0, vtDia: 0, regra: "sem_regra_board_valores" }
  const regraTxt = porTitulo(escolhido, ["Regra/Função", "Regra", "Funcao", "Função", "Cargo"])?.text || ""
  return {
    vrDia: num(porTitulo(escolhido, ["VR", "Valor VR", "Vale Refeição", "Vale Refeicao"])?.text),
    vtDia: num(porTitulo(escolhido, ["VT", "Valor VT", "Vale Transporte"])?.text),
    regra: `Board valores - ${porTitulo(escolhido, ["Contrato"])?.text || contratoRaw}${regraTxt ? " / " + regraTxt : ""}`,
  }
}

type LedgerEntry = {
  vr: boolean; vt: boolean; vr_percentual?: number; vt_percentual?: number
  vr_tipo?: string | null; origens: string[]; [k: string]: unknown
}
type LedgerRaw = Record<string, LedgerEntry>

function mergeLedger(ledger: LedgerRaw, dia: string, flags: { vr: boolean; vt: boolean }, origem: string) {
  const l = ledger[dia] ?? { vr: false, vt: false, vr_percentual: 0, vt_percentual: 0, origens: [] }
  if (!Array.isArray(l.origens)) l.origens = []
  if (flags.vr) {
    l.vr = true
    l.vr_percentual = Math.min(100, Math.max(Number(l.vr_percentual || 0), 100))
    l.vr_tipo = "integral"
  }
  if (flags.vt) {
    l.vt = true
    l.vt_percentual = Math.min(100, Math.max(Number(l.vt_percentual || 0), 100))
  }
  if (!l.origens.includes(origem)) l.origens.push(origem)
  ledger[dia] = l
}

// GraphQL com column.title (o cliente lerItens não devolve title).
async function queryItems(query: string): Promise<Record<string, { items?: RawItem[] } | Array<{ items_page: { items: RawItem[] } }>>> {
  return gql(query)
}

export interface ResultadoValidacao {
  ok: boolean
  decisoes: Array<Record<string, unknown>>
  motivo?: string
}

export async function validarAtestado(pulseId: number, log: { warn: (o: unknown, m?: string) => void }): Promise<ResultadoValidacao> {
  // 1. Item do Controle.
  const item = await lerItem(pulseId)
  if (!item) return { ok: false, decisoes: [], motivo: "item_monday_nao_encontrado" }
  const cv = item.cv
  const cpf = onlyDigits(cv[CT.cpf]?.text)
  const dataInicioIso = (cv[CT.dataInicio]?.text || "").slice(0, 10) || null
  const obs = cv[CT.obs]?.text || ""
  const modalidade = norm(cv[CT.modalidade]?.text)
  const contratoColab = inferirContrato(cv[CT.contrato]?.text || "")
  const chapaColab = (obs.match(/Chapa:\s*([0-9A-Za-z.-]+)/i)?.[1] ?? "").trim()
  const itemUrl = `https://contato-serv.monday.com/boards/18298015951/pulses/${item.id}`
  if (!cpf || cpf.length !== 11) return { ok: false, decisoes: [], motivo: "cpf_ausente_ou_invalido" }
  if (!dataInicioIso) return { ok: false, decisoes: [], motivo: "data_inicio_ausente" }

  // 2. Nexti.
  const person = await pessoaPorCpf(cpf)
  if (!person) return { ok: false, decisoes: [], motivo: "nexti_pessoa_nao_encontrada" }
  const raw = await absencesPessoa(person.id, toDdMmYyyy000000(dataInicioIso), "31122099000000")
  const seen = new Set<string>()
  const absences: Array<NextiAbsence & { start_iso: string; finish_iso: string }> = []
  for (const a of raw) {
    const id = a.id ?? a.absenceId
    if (!id || seen.has(String(id))) continue
    seen.add(String(id))
    const startIso = nextiDateToIso(a.start ?? a.startDateTime)
    const finishIso = nextiDateToIso(a.finish ?? a.finishDateTime ?? a.end ?? a.start ?? a.startDateTime)
    if (!startIso || !finishIso) continue
    if (finishIso < dataInicioIso) continue
    absences.push({ ...a, id, start_iso: startIso, finish_iso: finishIso })
  }
  if (!absences.length) return { ok: true, decisoes: [], motivo: "sem_absences_nexti" }
  absences.sort((a, b) => a.start_iso.localeCompare(b.start_iso))

  const decisoes: Array<Record<string, unknown>> = []
  for (const absence of absences) {
    const absenceId = String(absence.id)
    const situationId = absence.absenceSituationId ?? absence.situationId ?? null
    const situation = situationId ? await situacaoAbsence(situationId).catch(() => null) : null
    const situationName = situation?.name || situation?.situationName || absence.situationName || ""
    const sn = norm(situationName)
    const mapeado = sn.includes("ATESTADO") || sn.startsWith("DC") || sn.includes("DECLAR") || sn.includes("LICENCA") || sn.includes("LICENÇA")
    let tipoRegra = "ignorar"
    let decisao = "ignorar"
    if (mapeado && sn.includes("+6")) { tipoRegra = "mais_6"; decisao = "sem_desconto" }
    else if (mapeado && sn.includes("-6")) { tipoRegra = "menos_6"; decisao = "com_desconto" }
    else if (mapeado) { tipoRegra = "integral"; decisao = "com_desconto" }
    if (decisao === "ignorar") {
      decisoes.push({ absenceId, decisao, situationName })
      continue
    }

    // 3. Dedupe (PROCESSADOS) + contexto (valores + entradas/celetista).
    const absEsc = absenceId.replace(/"/g, "")
    let ctxQuery =
      `query { processados: items_page_by_column_values(board_id: ${BOARD_PROCESSADOS}, columns: [{ column_id: "${P.absenceId}", column_values: ["${absEsc}"] }], limit: 1) { items { id name column_values { id text value column { title } } } } `
    if (decisao === "com_desconto") {
      ctxQuery += `valores: boards(ids: [18413870370]) { items_page(limit: 500) { items { id name column_values { id text value column { title } } } } } `
      if (modalidade === "CELETISTA") {
        ctxQuery += `celetistaDescontos: items_page_by_column_values(board_id: ${BOARD_CELETISTA}, columns: [{ column_id: "${C.cpf}", column_values: ["${cpf}"] }], limit: 100) { items { id name column_values { id text value column { title } } } } `
      } else {
        ctxQuery += `entradas: items_page_by_column_values(board_id: ${BOARD_ENTRADA_FIXO}, columns: [{ column_id: "dup__of_matr_cula", column_values: ["${cpf}"] }], limit: 100) { items { id name column_values { id text value column { title } } } } `
      }
    }
    ctxQuery += "}"
    const ctx = (await queryItems(ctxQuery)) as {
      processados?: { items?: RawItem[] }
      valores?: Array<{ items_page: { items: RawItem[] } }>
      celetistaDescontos?: { items?: RawItem[] }
      entradas?: { items?: RawItem[] }
    }
    if (ctx.processados?.items?.length) {
      decisoes.push({ absenceId, decisao: "skip", motivo: "absence_ja_processada" })
      continue
    }
    const valoresItems = ctx.valores?.[0]?.items_page?.items ?? []
    const origem = `nexti-atestado:${absenceId}`
    const agora = new Date().toISOString()

    const processedMutation = (status: string, resultado: unknown, obsTxt: string) => {
      const values: Record<string, unknown> = {
        [P.absenceId]: absenceId,
        [P.cpf]: cpf,
        [P.personId]: String(person.id),
        [P.nome]: person.name || person.personName || item.name,
        [P.modalidade]: { label: modalidade || "INTERMITENTE" },
        [P.controleId]: String(item.id),
        [P.controleUrl]: { url: itemUrl, text: "Controle de Atestados" },
        [P.dataInicio]: { date: absence.start_iso },
        [P.dataFim]: { date: absence.finish_iso },
        [P.situationId]: String(situation?.id ?? situationId ?? ""),
        [P.situationName]: situationName,
        [P.tipoRegra]: { label: tipoRegra },
        [P.status]: { label: status },
        [P.resultadoJson]: { text: JSON.stringify(resultado ?? {}) },
        [P.processadoEm]: { date: agora.slice(0, 10), time: agora.slice(11, 19) },
        [P.observacao]: { text: obsTxt },
      }
      return gql(
        `mutation($v:JSON!){ create_item(board_id: ${BOARD_PROCESSADOS}, item_name: ${JSON.stringify(`${absenceId} - ${person.name || item.name}`)}, column_values: $v, create_labels_if_missing: true) { id } }`,
        { v: buildCV(values) },
      )
    }

    if (decisao === "sem_desconto") {
      await processedMutation("SEM DESCONTO", { absenceId, situationName }, "Situation +6 sem desconto financeiro.")
      decisoes.push({ absenceId, decisao, situationName })
      continue
    }

    // 4a. CELETISTA — acumulador mensal.
    if (modalidade === "CELETISTA") {
      const docsItems = ctx.celetistaDescontos?.items ?? []
      const jaNoAcumulador = docsItems.find((it) => {
        const docs = parseJson<Array<{ absence_id?: string; controle_item_id?: string }>>(colTx(it, C.docsJson), [])
        return docs.some((d) => String(d.absence_id ?? d.controle_item_id) === absenceId)
      })
      if (jaNoAcumulador) {
        await processedMutation("JA_EXISTIA", { acao: "skip", item_desconto_id: jaNoAcumulador.id }, "Ja existia no acumulador celetista.")
        decisoes.push({ absenceId, decisao: "skip", motivo: "ja_no_acumulador" })
        continue
      }
      const competencia = labelMes(absence.start_iso)
      const anoComp = absence.start_iso.slice(0, 4)
      const candidatos = docsItems.filter(
        (it) => norm(colTx(it, C.competencia)) === norm(competencia) && colTx(it, C.ano).trim() === anoComp,
      )
      const alvo = candidatos.find((it) => ["ABERTO", "EM CONFERENCIA", "EM CONFERÊNCIA"].includes(norm(colTx(it, C.status)))) ?? null
      const fechado = candidatos.find((it) => norm(colTx(it, C.status)) === "DESCONTADO")
      const novoStatus = alvo ? colTx(alvo, C.status) || "ABERTO" : fechado ? "REVISÃO" : "ABERTO"
      const vals = resolverValoresItems(valoresItems, contratoColab, "")
      const financeiros = range(absence.start_iso, absence.finish_iso).filter((d) => dow(d) !== 0 && dow(d) !== 6)
      const diasVr = financeiros.length
      const diasVt = tipoRegra === "menos_6" ? Math.max(0, financeiros.length - 1) : financeiros.length
      const doc = {
        absence_id: absenceId, controle_item_id: String(item.id), controle_item_url: itemUrl,
        situation_name: situationName, tipo_regra: tipoRegra,
        data_inicio: absence.start_iso, data_fim: absence.finish_iso,
        dias_financeiros: financeiros, dias_vr: diasVr, dias_vt: diasVt,
        valor_vr: round2(diasVr * vals.vrDia), valor_vt: round2(diasVt * vals.vtDia),
        regra_valores: vals.regra, processado_em: agora,
      }
      const docsDepois = [...(alvo ? parseJson<unknown[]>(colTx(alvo, C.docsJson), []) : []), doc] as Array<Record<string, number>>
      const total = docsDepois.reduce(
        (acc, d) => ({
          diasVr: acc.diasVr + Number(d.dias_vr || 0), diasVt: acc.diasVt + Number(d.dias_vt || 0),
          valorVr: acc.valorVr + Number(d.valor_vr || 0), valorVt: acc.valorVt + Number(d.valor_vt || 0),
        }),
        { diasVr: 0, diasVt: 0, valorVr: 0, valorVt: 0 },
      )
      const values: Record<string, unknown> = {
        [C.cpf]: cpf, [C.chapa]: chapaColab, [C.contrato]: contratoColab, [C.funcao]: "",
        [C.competencia]: { label: competencia }, [C.ano]: anoComp, [C.status]: { label: novoStatus },
        [C.qtdDocs]: String(docsDepois.length),
        [C.diasVr]: String(round2(total.diasVr)), [C.diasVt]: String(round2(total.diasVt)),
        [C.valorVr]: String(round2(total.valorVr)), [C.valorVt]: String(round2(total.valorVt)),
        [C.total]: String(round2(total.valorVr + total.valorVt)),
        [C.regra]: vals.regra, [C.docsJson]: { text: JSON.stringify(docsDepois) },
        [C.observacao]: { text: `Atualizado por ausencia Nexti ${absenceId}\n${itemUrl}` },
      }
      if (alvo) {
        await gql(
          `mutation($v:JSON!){ change_multiple_column_values(board_id: ${BOARD_CELETISTA}, item_id: ${alvo.id}, column_values: $v, create_labels_if_missing: true) { id } }`,
          { v: buildCV(values) },
        )
      } else {
        await gql(
          `mutation($v:JSON!){ create_item(board_id: ${BOARD_CELETISTA}, item_name: ${JSON.stringify(`${item.name} - ${competencia}/${anoComp}`)}, column_values: $v, create_labels_if_missing: true) { id } }`,
          { v: buildCV(values) },
        )
      }
      const resultado = { acao: alvo ? "update_celetista" : "create_celetista", competencia, ano: anoComp, total: round2(total.valorVr + total.valorVt) }
      await processedMutation("PROCESSADO", resultado, "Acumulador celetista atualizado.")
      decisoes.push({ absenceId, decisao, ...resultado })
      continue
    }

    // 4b. INTERMITENTE — entradas afetadas → ledger Histórico + board Descontos.
    const entradas = ctx.entradas?.items ?? []
    const afetadas: Array<{
      entrada_id: string; chapa: string; data_inicio_original: string; data_fim_original: string
      data_inicio_efetiva: string; data_fim_efetiva: string; contrato: string; funcao: string
      optante_vt: string; trabalha_sabado: boolean
    }> = []
    for (const e of entradas) {
      const status = norm(colTx(e, "color_mm3a8ana") || "VALIDA")
      if (["CANCELADA", "CANCELADO", "BLOQUEADA - CONFLITO"].includes(status)) continue
      const di = colTx(e, "date_mktayxhb")
      const df = colTx(e, "date_mktasnwq")
      if (!di || !df) continue
      let fim = df
      const canc = colTx(e, "date_mm3b88ta")
      if (status.includes("PARCIAL") && canc) {
        const novoFim = addDaysIso(canc, -1)
        if (novoFim < di) continue
        if (novoFim < fim) fim = novoFim
      }
      if (!(di <= absence.finish_iso && fim >= absence.start_iso)) continue
      const chapa = colTx(e, "texto").trim()
      if (!chapa) continue
      afetadas.push({
        entrada_id: e.id, chapa, data_inicio_original: di, data_fim_original: df,
        data_inicio_efetiva: di, data_fim_efetiva: fim,
        contrato: colTx(e, "color_mktcnxwn") || contratoColab,
        funcao: colTx(e, "texto0") || "",
        optante_vt: colTx(e, "optante___vt") || colTx(e, "color_mm34ry47") || "NAO",
        trabalha_sabado: /^SIM$/i.test(colTx(e, "color_mktaavmp")),
      })
    }
    if (!afetadas.length) {
      await processedMutation("SEM IMPACTO", { acao: "registrar_sem_impacto" }, "Sem convocacao/historico afetado.")
      decisoes.push({ absenceId, decisao: "sem_impacto" })
      continue
    }
    const chapas = [...new Set(afetadas.map((a) => a.chapa))]
    const values = chapas.map((c) => JSON.stringify(c)).join(", ")
    const hd = (await queryItems(
      `query { historicos: items_page_by_column_values(board_id: ${BOARD_HIST}, columns: [{ column_id: "text_mm33v9kp", column_values: [${values}] }], limit: 500) { items { id name column_values { id text value column { title } } } } ` +
        `descontos: items_page_by_column_values(board_id: ${BOARD_DESCONTOS}, columns: [{ column_id: "${D.matricula}", column_values: [${values}] }], limit: 500) { items { id name column_values { id text value column { title } } } } }`,
    )) as { historicos?: { items?: RawItem[] }; descontos?: { items?: RawItem[] } }
    const historicos = hd.historicos?.items ?? []
    const descontos = hd.descontos?.items ?? []

    const resultados: Array<Record<string, unknown>> = []
    for (const entrada of afetadas) {
      const hist = historicos.find(
        (h) => colTx(h, "text_mm33v9kp").trim() === entrada.chapa && colTx(h, "date_mm2xtp93") === entrada.data_inicio_original,
      )
      if (!hist) {
        resultados.push({ chapa: entrada.chapa, erro: "historico_nao_encontrado" })
        continue
      }
      const sabExtras = colTx(hist, "text_mm3bfn6h").split(/[,;\n]/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
      const sabSet = new Set(sabExtras)
      const inicio = absence.start_iso > entrada.data_inicio_efetiva ? absence.start_iso : entrada.data_inicio_efetiva
      const fim = absence.finish_iso < entrada.data_fim_efetiva ? absence.finish_iso : entrada.data_fim_efetiva
      const diasOverlap = range(inicio, fim)
        .filter((d) => dow(d) !== 0)
        .filter((d) => dow(d) !== 6 || entrada.trabalha_sabado || sabSet.has(d))
      if (!diasOverlap.length) {
        resultados.push({ chapa: entrada.chapa, acao: "sem_dias_financeiros" })
        continue
      }
      const ledger = parseJson<LedgerRaw>(colTx(hist, COL_LEDGER), {})
      const primeiro = diasOverlap[0]!
      for (const dia of diasOverlap) {
        const ehSab = dow(dia) === 6
        const vtPermitido = !ehSab || entrada.trabalha_sabado || sabSet.has(dia)
        const flags = tipoRegra === "menos_6" && dia === primeiro ? { vr: !ehSab, vt: false } : { vr: !ehSab, vt: vtPermitido }
        mergeLedger(ledger, dia, flags, origem)
      }
      await gql(
        `mutation($v:JSON!){ change_multiple_column_values(board_id: ${BOARD_HIST}, item_id: ${hist.id}, column_values: $v, create_labels_if_missing: true) { id } }`,
        { v: buildCV({ [COL_LEDGER]: { text: JSON.stringify(ledger) } }) },
      ).catch((e) => log.warn(e, `atestado: ledger hist ${hist.id} falhou`))

      // Desconto recalculado a partir do ledger COMPLETO (fiel ao WF).
      const vals = resolverValoresItems(valoresItems, entrada.contrato, entrada.funcao)
      const opt = norm(entrada.optante_vt)
      let vtDia = opt === "SIM" || opt === "SIM*" ? round2(vals.vtDia) : 0
      if (opt === "SIM*") vtDia = round2(vtDia / 2)
      const vrDia = round2(vals.vrDia)
      let descontoVR = 0, descontoVT = 0, diasVR = 0, diasVT = 0
      for (const [, v] of Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b))) {
        if (Number(v.vt_percentual || 0) > 0) { descontoVT += vtDia; diasVT += 1 }
        if (Number(v.vr_percentual || 0) > 0) {
          const pct = Math.min(100, Number(v.vr_percentual || 100))
          descontoVR += vrDia * (pct / 100)
          diasVR += pct / 100
        }
      }
      descontoVR = round2(descontoVR)
      descontoVT = round2(descontoVT)
      const existente = descontos.find(
        (d) => colTx(d, D.matricula).trim() === entrada.chapa && colTx(d, D.inicio) === colTx(hist, "date_mm2xtp93") && colTx(d, D.fim) === colTx(hist, "date_mm2xrr5q"),
      )
      const dValues: Record<string, unknown> = {
        [D.nome]: { labels: [hist.name] }, [D.matricula]: entrada.chapa, [D.cpf]: cpf,
        [D.inicio]: { date: colTx(hist, "date_mm2xtp93") }, [D.fim]: { date: colTx(hist, "date_mm2xrr5q") },
        [D.perdeVt]: String(diasVT), [D.perdeVr]: String(round2(diasVR)), [D.atrasos]: "0",
        [D.vr]: String(descontoVR), [D.vt]: String(descontoVT),
        [D.status]: { label: descontoVR || descontoVT ? "PENDENTE" : "FINALIZADO" },
        [D.residualVr]: String(descontoVR), [D.residualVt]: String(descontoVT),
        [D.descontadoVr]: "0", [D.descontadoVt]: "0",
      }
      if (existente) {
        await gql(
          `mutation($v:JSON!){ change_multiple_column_values(board_id: ${BOARD_DESCONTOS}, item_id: ${existente.id}, column_values: $v, create_labels_if_missing: true) { id } }`,
          { v: buildCV(dValues) },
        ).catch((e) => log.warn(e, `atestado: desconto ${entrada.chapa} falhou`))
      } else {
        await gql(
          `mutation($v:JSON!){ create_item(board_id: ${BOARD_DESCONTOS}, group_id: "${GRUPO_DESCONTOS}", item_name: "INTERMITENTE", column_values: $v, create_labels_if_missing: true) { id } }`,
          { v: buildCV(dValues) },
        ).catch((e) => log.warn(e, `atestado: desconto create ${entrada.chapa} falhou`))
      }
      resultados.push({ hist_item_id: hist.id, chapa: entrada.chapa, dias: diasOverlap, descontoVR, descontoVT })
    }
    await processedMutation("PROCESSADO", { acao: "processar_intermitente", resultados }, "Desconto intermitente aplicado.")
    decisoes.push({ absenceId, decisao, resultados })
  }
  return { ok: true, decisoes }
}
