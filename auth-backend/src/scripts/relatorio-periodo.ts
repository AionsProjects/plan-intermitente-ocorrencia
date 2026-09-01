/**
 * Relatório de período em PDF — tudo que mudou no sistema numa janela, com autor.
 *
 *   npm run relatorio -- --de="2026-08-31T14:00" --saida=relatorio.pdf
 *   npm run relatorio -- --de="2026-08-31T14:00" --ate="2026-08-31T23:59" --dia=2026-08-31
 *
 * `--de`/`--ate` são horários de MANAUS (UTC-4 fixo, sem horário de verão). Sem `--de`, a
 * janela começa à meia-noite de hoje em Manaus. `--dia` é o dia usado na seção de convocações
 * retroativas (default: o dia de `--de`).
 *
 * Por que não é a rota `/api/atividade/relatorio`: aquela lê só `audit_lancamentos` e recorta
 * por dia inteiro. Na noite de 31/08 isso seriam 4 linhas — enquanto o mensal produziu 449
 * eventos e 74 convocações no RM. A pergunta "o que mudou" precisa das outras fontes.
 *
 * SOMENTE LEITURA no Postgres, no Monday e no arquivo de intervenções.
 */
import fs from "node:fs"
import path from "node:path"
import { query } from "../db.js"
import { mondayGraphql } from "../monday.js"
import { rotuloAcao, rotuloEstadoExecucao } from "../domain/rotulosAtividade.js"
import {
  LARGURA_UTIL,
  gerarRelatorioPeriodo,
  type CelulaSecao,
  type SecaoRelatorio,
  type TomCelula,
} from "../services/relatorioPeriodo.js"
import { dataHora, dia, hojeManaus, hora, instante, quem } from "../services/janelaManaus.js"

// Helpers de janela/fuso e de autoria vivem em services/janelaManaus.ts — o teste precisa
// deles sem carregar este script, que executa `main()` no import.
function arg(nome: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`))
  return p ? p.slice(nome.length + 3) : undefined
}

const TOM_ESTADO: Record<string, TomCelula> = {
  ok: "verde",
  erro: "vermelho",
  abandonada: "vermelho",
  parcial: "amarelo",
  aberta: "amarelo",
  rodando: "amarelo",
  cancelado: "apagado",
  bloqueado: "amarelo",
  pendente: "apagado",
}

// Colunas: a soma tem de fechar a área útil (≈ 770pt na A4 paisagem com margem 36).
const col = (titulo: string, w: number): { titulo: string; w: number } => ({ titulo, w })

// ── Seção 1 — execuções do app ──────────────────────────────────────────────
async function secaoExecucoes(de: Date, ate: Date): Promise<SecaoRelatorio> {
  const { rows } = await query<{
    acao: string; estado: string; motor: string | null; pessoa_nome: string | null
    contrato: string | null; operador_nome: string | null; operador_email: string | null
    erro_etapa: string | null; erro_msg: string | null; criado_em: Date
  }>(
    `SELECT acao, estado, motor, pessoa_nome, contrato, operador_nome, operador_email,
            erro_etapa, erro_msg, criado_em
       FROM audit_lancamentos
      WHERE criado_em >= $1 AND criado_em <= $2
      ORDER BY criado_em`,
    [de.toISOString(), ate.toISOString()],
  )
  return {
    titulo: "Execuções do aplicativo",
    fonte: "pi.audit_lancamentos",
    colunas: [col("HORA", 46), col("AÇÃO", 108), col("DESFECHO", 86), col("PESSOA", 168),
      col("CONTRATO", 76), col("QUEM EXECUTOU", 130), col("OBSERVAÇÃO", LARGURA_UTIL - 614)],
    vazio: "Nenhuma execução do app nesta janela.",
    linhas: rows.map((r): CelulaSecao[] => {
      const tom = TOM_ESTADO[r.estado] ?? "apagado"
      const obs = [r.erro_etapa, r.erro_msg].filter(Boolean).join(" — ")
      return [
        { texto: hora(r.criado_em) },
        { texto: rotuloAcao(r.acao), tom: "forte" },
        { texto: rotuloEstadoExecucao(r.estado), tom, lamp: true },
        { texto: r.pessoa_nome ?? "—" },
        { texto: r.contrato ?? "—" },
        { texto: quem(r.operador_nome, r.operador_email), tom: "apagado" },
        { texto: obs || (r.motor ? `motor ${r.motor}` : ""), tom: obs ? "vermelho" : "apagado" },
      ]
    }),
  }
}

// ── Log de alterações do Monday ─────────────────────────────────────────────
// A fonte da verdade de "o que mudou no board" é o activity_log do próprio Monday, não as
// nossas tabelas: ele registra TAMBÉM a edição feita à mão, que não passa por lugar nenhum
// do nosso sistema. `created_at` vem em décimos de microssegundo — dividir por 10.000 dá ms.
const BOARDS_LOG = [
  { id: "", papel: "atual", rotulo: "Plano de Intermitentes" },
  { id: "18411141462", papel: null, rotulo: "Histórico de Ocorrências" },
  { id: "18400981023", papel: null, rotulo: "Base de Desconto" },
]

/** Colunas que carregam LANÇAMENTO de ocorrência — o que o Isaac pediu para ver primeiro. */
const COLUNAS_OCORRENCIA = new Set([
  "numeric", "texto5", "color_mm3a8ana", "date_mm3b88ta",                      // Entrada
  "long_text_mm2xtcpw", "numeric_mm2xe2zk", "numeric_mm2x18hh",                // Histórico
  "numeric_mm2x4fjj", "color_mm3b9v4n", "color_mm2xkqpc", "date_mm2x62fq",
  "numeric_mm0rgsaw", "numeric_mm0r5tca", "color_mm0r8mjr",                    // Desconto
])

interface AlteracaoBoard {
  quando: Date
  board: string
  pulseId: string
  pessoa: string
  coluna: string
  colunaId: string
  de: string
  para: string
  /** Quem o Monday registra — na escrita da automação, é o dono do TOKEN, não quem clicou. */
  gravadoPor: string
  /** Quem clicou de verdade, quando dá para cruzar com uma execução do app. */
  autorReal: string | null
  via: string
  ocorrencia: boolean
}

/**
 * Execução do app candidata a explicar uma alteração do board.
 *
 * Existe porque o log do Monday atribui TODA escrita da automação ao usuário do token (a conta
 * de serviço). Sem este cruzamento o relatório diz "Isaac Raylen" em lançamento que a Karine
 * fez pelo app — foi o que a versão anterior fez, e é justamente a pergunta que o relatório
 * precisa responder: quem alterou DE VERDADE.
 */
interface ExecucaoApp {
  quem: string
  acao: string
  pessoa: string | null
  inicio: Date
  fim: Date
  itens: Set<string>
}

const norm = (v: string | null | undefined): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()

/** Execuções do app na janela (com folga), já com os ids de item do Monday que cada uma tocou. */
async function lerExecucoesApp(de: Date, ate: Date): Promise<ExecucaoApp[]> {
  const folga = 5 * 60_000
  const { rows } = await query<{
    id: string; acao: string; pessoa_nome: string | null; quem: string | null
    criado_em: Date; finalizado_em: Date | null; itens: string[] | null
  }>(
    `SELECT l.id, l.acao, l.pessoa_nome,
            COALESCE(l.operador_nome, l.operador_email) quem,
            l.criado_em, l.finalizado_em,
            ARRAY(SELECT a.chave FROM atividade_artefato a
                   WHERE a.execucao_id = l.id AND a.chave ~ '^[0-9]{6,}$') itens
       FROM audit_lancamentos l
      WHERE l.criado_em >= $1 AND l.criado_em <= $2
      ORDER BY l.criado_em`,
    [new Date(de.getTime() - folga).toISOString(), new Date(ate.getTime() + folga).toISOString()],
  )
  return rows.map((r) => ({
    quem: quem(r.quem, null),
    acao: r.acao,
    pessoa: r.pessoa_nome,
    inicio: r.criado_em,
    // Execução sem fim registrado: dá 3 minutos de janela, que cobre o mais lento que já vimos.
    fim: r.finalizado_em ?? new Date(r.criado_em.getTime() + 180_000),
    itens: new Set(r.itens ?? []),
  }))
}

/**
 * Casa uma alteração do board com a execução que a causou. Três chaves, da mais forte pra mais
 * fraca — e quando nenhuma casa, o relatório NÃO inventa: fica com o autor do Monday.
 */
function casarExecucao(a: AlteracaoBoard, execs: ExecucaoApp[]): ExecucaoApp | null {
  const dentro = (e: ExecucaoApp, folgaAntes = 60_000, folgaDepois = 180_000): boolean =>
    a.quando.getTime() >= e.inicio.getTime() - folgaAntes &&
    a.quando.getTime() <= e.fim.getTime() + folgaDepois
  // 1) id do item registrado como artefato da execução — chave exata.
  const porItem = execs.find((e) => e.itens.has(a.pulseId) && dentro(e))
  if (porItem) return porItem
  // 2) mesma pessoa, dentro da janela da execução.
  const alvo = norm(a.pessoa)
  const porPessoa = execs.find((e) => {
    const p = norm(e.pessoa)
    return p && alvo && (alvo.includes(p) || p.includes(alvo)) && dentro(e)
  })
  if (porPessoa) return porPessoa
  // 3) uma ÚNICA execução cobrindo o instante — sem ambiguidade, vale; com duas, não.
  const noTempo = execs.filter((e) => dentro(e, 5_000, 30_000))
  return noTempo.length === 1 ? noTempo[0]! : null
}

/**
 * Texto legível de um valor do log, que vem cru e em formato diferente por tipo de coluna.
 *
 * Status é o caso que obriga o `rotulos`: o log guarda só o ÍNDICE do rótulo
 * (`{"index":2,...}`), e sem o mapa de labels da coluna o relatório imprimiria
 * "[object Object]" — foi o que a primeira versão fez.
 */
function valorLegivel(v: unknown, rotulos?: Map<number, string>): string {
  if (v == null) return "vazio"
  if (typeof v === "string") return v.slice(0, 120)
  if (typeof v === "number") return String(v)
  const o = v as Record<string, unknown>
  // Status: {label:{index,text}} no valor novo, {index} no anterior.
  const lab = o.label as Record<string, unknown> | string | undefined
  if (typeof lab === "string" && lab.trim()) return lab.slice(0, 120)
  if (lab && typeof lab === "object") {
    if (typeof lab.text === "string" && lab.text.trim()) return lab.text.slice(0, 120)
    if (typeof lab.index === "number") return rotulos?.get(lab.index) ?? `índice ${lab.index}`
  }
  if (typeof o.index === "number") return rotulos?.get(o.index) ?? `índice ${o.index}`
  for (const k of ["text", "name", "value"]) {
    const x = o[k]
    if (typeof x === "string" && x.trim()) return x.slice(0, 120)
    if (typeof x === "number") return String(x)
  }
  if (typeof o.date === "string") return o.date
  const j = JSON.stringify(v)
  return j.length > 120 ? `${j.slice(0, 117)}…` : j
}

/** index -> rótulo das colunas de status, lido do `settings_str` do board. */
function rotulosDeStatus(colunas: Array<{ id: string; settings_str?: string | null }>, boardId: string): Map<string, Map<number, string>> {
  const fora = new Map<string, Map<number, string>>()
  for (const c of colunas) {
    if (!c.settings_str) continue
    try {
      const s = JSON.parse(c.settings_str) as { labels?: Record<string, string> }
      if (!s.labels) continue
      fora.set(`${boardId}:${c.id}`, new Map(Object.entries(s.labels).map(([i, t]) => [Number(i), t])))
    } catch {
      /* coluna sem settings utilizável */
    }
  }
  return fora
}

async function lerAlteracoesBoard(de: Date, ate: Date): Promise<AlteracaoBoard[]> {
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel = 'atual' AND ativo ORDER BY atualizado_em DESC LIMIT 1`,
  )
  const boards = BOARDS_LOG.map((b) => ({ ...b, id: b.id || rows[0]?.monday_board_id || "" })).filter((b) => b.id)

  // Título das colunas por board: sem isso o relatório diria "color_mm3a8ana" ao DP.
  const titulos = new Map<string, string>()
  const nomes = new Map<number, string>()
  const saida: AlteracaoBoard[] = []
  for (const b of boards) {
    const d = await mondayGraphql<{
      boards: Array<{
        columns: Array<{ id: string; title: string; settings_str: string | null }>
        activity_logs: Array<{ event: string; created_at: string; data: string; user_id: number }>
      }>
    }>(
      `query($b:[ID!],$de:ISO8601DateTime!,$ate:ISO8601DateTime!){
         boards(ids:$b){ columns{ id title settings_str }
           activity_logs(from:$de, to:$ate, limit:500){ event created_at data user_id } } }`,
      { b: [b.id], de: de.toISOString(), ate: ate.toISOString() },
    )
    const board = d.boards?.[0]
    if (!board) continue
    for (const c of board.columns) titulos.set(`${b.id}:${c.id}`, c.title)
    const rotulos = rotulosDeStatus(board.columns, b.id)
    for (const l of board.activity_logs) {
      if (l.event !== "update_column_value") continue
      let j: Record<string, unknown>
      try {
        j = JSON.parse(l.data) as Record<string, unknown>
      } catch {
        continue
      }
      const colunaId = String(j.column_id ?? "")
      saida.push({
        quando: new Date(Number(l.created_at) / 10_000),
        board: b.rotulo,
        pulseId: String(j.pulse_id ?? ""),
        pessoa: String(j.pulse_name ?? "—"),
        coluna: titulos.get(`${b.id}:${colunaId}`) ?? colunaId,
        colunaId,
        de: valorLegivel(j.previous_value, rotulos.get(`${b.id}:${colunaId}`)),
        para: valorLegivel(j.value, rotulos.get(`${b.id}:${colunaId}`)),
        gravadoPor: String(l.user_id),
        autorReal: null,
        via: "",
        ocorrencia: COLUNAS_OCORRENCIA.has(colunaId),
      })
      nomes.set(l.user_id, "")
    }
  }

  // user_id -> nome. Ids negativos são a automação do próprio Monday, e a API recusa consultá-los.
  const ids = [...nomes.keys()].filter((i) => i > 0)
  if (ids.length) {
    const u = await mondayGraphql<{ users: Array<{ id: string; name: string }> }>(
      `query($ids:[ID!]){ users(ids:$ids){ id name } }`,
      { ids: ids.map(String) },
    )
    for (const x of u.users) nomes.set(Number(x.id), x.name)
  }
  for (const a of saida) {
    const n = nomes.get(Number(a.gravadoPor))
    a.gravadoPor = Number(a.gravadoPor) < 0 ? "automação do Monday" : (n || `usuário ${a.gravadoPor}`)
  }

  // O cruzamento com o app: sem ele o relatório credita à conta de serviço o que a operação fez.
  const execs = await lerExecucoesApp(de, ate)
  for (const a of saida) {
    const e = casarExecucao(a, execs)
    if (e) {
      a.autorReal = e.quem
      a.via = `app · ${rotuloAcao(e.acao)}`
    } else {
      a.via = "à mão no board"
    }
  }
  return saida.sort((x, y) => x.quando.getTime() - y.quando.getTime())
}

function secaoOcorrencias(alteracoes: AlteracaoBoard[]): SecaoRelatorio {
  const linhas = alteracoes.filter((a) => a.ocorrencia).map((a): CelulaSecao[] => [
    { texto: hora(a.quando) },
    { texto: a.pessoa, tom: "forte" },
    { texto: a.board, tom: "apagado" },
    { texto: a.coluna },
    { texto: a.de, tom: "apagado" },
    { texto: a.para, tom: "amarelo" },
    { texto: a.autorReal ?? a.gravadoPor, tom: a.autorReal ? "forte" : "normal" },
    { texto: a.autorReal ? a.via : `${a.via} · ${a.gravadoPor}`, tom: "apagado" },
  ])
  return {
    titulo: "Lançamentos de ocorrência (falta, atraso, cancelamento, desconto)",
    fonte: "activity_log do Monday cruzado com pi.audit_lancamentos (quem clicou de verdade)",
    colunas: [col("HORA", 40), col("PESSOA", 132), col("BOARD", 96), col("O QUE MUDOU", 104),
      col("DE", 90), col("PARA", 90), col("QUEM ALTEROU", 118), col("POR ONDE", LARGURA_UTIL - 670)],
    vazio: "Nenhum lançamento de falta, atraso ou cancelamento nesta janela.",
    linhas,
  }
}

function secaoOutrasAlteracoes(alteracoes: AlteracaoBoard[]): SecaoRelatorio {
  // Agrupado: 100+ linhas de coluna administrativa afogariam o que interessa.
  const mapa = new Map<string, { board: string; coluna: string; autor: string; n: number; primeiro: Date; ultimo: Date }>()
  for (const a of alteracoes.filter((x) => !x.ocorrencia)) {
    const autor = a.autorReal ? `${a.autorReal} (${a.via})` : `${a.gravadoPor} (à mão)`
    const k = `${a.board}|${a.coluna}|${autor}`
    const atual = mapa.get(k)
    if (atual) {
      atual.n++
      atual.ultimo = a.quando
    } else {
      mapa.set(k, { board: a.board, coluna: a.coluna, autor, n: 1, primeiro: a.quando, ultimo: a.quando })
    }
  }
  return {
    titulo: "Outras alterações no board",
    fonte: "activity_log do Monday cruzado com o app — agrupado por board, coluna e autor",
    colunas: [col("BOARD", 150), col("COLUNA", 200), col("QUEM ALTEROU · POR ONDE", 250),
      col("QTD", 50), col("PRIMEIRA", 60), col("ÚLTIMA", LARGURA_UTIL - 710)],
    vazio: "Nenhuma outra alteração no board nesta janela.",
    linhas: [...mapa.values()]
      .sort((a, b) => b.n - a.n)
      .map((g): CelulaSecao[] => [
        { texto: g.board, tom: "forte" },
        { texto: g.coluna },
        { texto: g.autor },
        { texto: String(g.n) },
        { texto: hora(g.primeiro), tom: "apagado" },
        { texto: hora(g.ultimo), tom: "apagado" },
      ]),
  }
}

// ── Seção 5 — intervenções técnicas (curadas) ───────────────────────────────
interface Intervencao {
  hora: string
  o_que: string
  quem: string
  detalhe: string
  fonte: string
  tom?: TomCelula
}

function secaoIntervencoes(arquivo: string | undefined): SecaoRelatorio {
  let itens: Intervencao[] = []
  if (arquivo && fs.existsSync(arquivo)) {
    itens = JSON.parse(fs.readFileSync(arquivo, "utf8")) as Intervencao[]
  }
  return {
    titulo: "Intervenções técnicas",
    fonte: arquivo ? path.basename(arquivo) : "sem arquivo de intervenções",
    colunas: [col("HORA", 46), col("O QUE FOI FEITO", 250), col("QUEM", 120),
      col("DETALHE", 230), col("ONDE CONFERIR", LARGURA_UTIL - 646)],
    vazio: "Nenhuma intervenção técnica registrada para esta janela.",
    linhas: itens.map((i): CelulaSecao[] => [
      { texto: i.hora },
      { texto: i.o_que, tom: i.tom ?? "forte" },
      { texto: i.quem },
      { texto: i.detalhe, tom: "apagado" },
      { texto: i.fonte, tom: "apagado" },
    ]),
  }
}

// ── Seção 6 — convocações retroativas ───────────────────────────────────────
/**
 * Criada no dia, para período que COMEÇA antes do dia.
 *
 * Duas fontes porque `convocacoes_rm` só tem quem chegou ao RM: convocação criada no board e
 * barrada antes disso (antifraude, RM fora do ar, contrato sem convocação no RM) não aparece
 * lá, e some do relatório sem que ninguém perceba.
 */
async function secaoRetroativas(diaIso: string): Promise<SecaoRelatorio> {
  const { rows } = await query<{
    chapa: string; codigo: string; contrato: string | null; data_inicio: Date; data_fim: Date
    criado_em: Date; criado_por: string | null; origem_acao: string | null; removido_em: Date | null
  }>(
    `SELECT chapa, codigo, contrato, data_inicio, data_fim, criado_em, criado_por, origem_acao, removido_em
       FROM convocacoes_rm
      WHERE (criado_em AT TIME ZONE 'America/Manaus')::date = $1::date
        AND data_inicio < $1::date
      ORDER BY criado_em`,
    [diaIso],
  )
  const linhas: CelulaSecao[][] = rows.map((r): CelulaSecao[] => [
    { texto: hora(r.criado_em) },
    { texto: r.codigo, tom: "forte" },
    { texto: r.chapa },
    { texto: r.contrato ?? "—" },
    { texto: `${dia(r.data_inicio)} a ${dia(r.data_fim)}`, tom: "amarelo" },
    { texto: quem(null, r.criado_por) },
    { texto: r.removido_em ? "apagada depois" : (r.origem_acao ?? "—"), tom: "apagado" },
  ])

  // Cruzamento com o board de Entrada do mês: pega convocação criada hoje que não virou código.
  const semCodigo = await retroativasSoNoBoard(diaIso, new Set(rows.map((r) => r.chapa)))
  linhas.push(...semCodigo)

  return {
    titulo: `Convocações criadas em ${dia(diaIso)} para períodos ANTERIORES a esse dia`,
    fonte: "pi.convocacoes_rm + board de Entrada do mês (Monday)",
    colunas: [col("HORA", 46), col("CÓDIGO RM", 110), col("CHAPA", 60), col("CONTRATO", 120),
      col("PERÍODO DA CONVOCAÇÃO", 150), col("QUEM CRIOU", 150), col("SITUAÇÃO", LARGURA_UTIL - 636)],
    vazio: "Nenhuma convocação retroativa nesse dia.",
    linhas,
  }
}

/** Itens criados no dia no board de Entrada cuja Data/Início é anterior — e que não têm código RM. */
async function retroativasSoNoBoard(diaIso: string, chapasComCodigo: Set<string>): Promise<CelulaSecao[][]> {
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel = 'atual' AND ativo ORDER BY atualizado_em DESC LIMIT 1`,
  )
  const board = rows[0]?.monday_board_id
  if (!board) return []
  const d = await mondayGraphql<{ boards: Array<{ items_page: { items: Array<{ id: string; name: string; created_at: string; column_values: Array<{ id: string; text: string | null }> }> } }> }>(
    `query($b:[ID!]){ boards(ids:$b){ items_page(limit:500){ items{ id name created_at
        column_values(ids:["texto","color_mktcnxwn","date_mktayxhb","date_mktasnwq"]){ id text } } } } }`,
    { b: [board] },
  )
  const itens = d.boards?.[0]?.items_page.items ?? []
  const saida: CelulaSecao[][] = []
  for (const it of itens) {
    const criado = new Date(it.created_at)
    if (criado.toLocaleDateString("en-CA", { timeZone: "America/Manaus" }) !== diaIso) continue
    const cv = new Map(it.column_values.map((c) => [c.id, c.text ?? ""]))
    const inicio = cv.get("date_mktayxhb") ?? ""
    if (!inicio || inicio >= diaIso) continue
    const chapa = (cv.get("texto") ?? "").trim()
    if (chapasComCodigo.has(chapa)) continue // já listada pela via do RM
    saida.push([
      { texto: hora(criado) },
      { texto: "sem código RM", tom: "amarelo" },
      { texto: chapa || "—" },
      { texto: cv.get("color_mktcnxwn") || "—" },
      { texto: `${dia(inicio)} a ${dia(cv.get("date_mktasnwq") ?? "")}`, tom: "amarelo" },
      { texto: "(ver item no board)", tom: "apagado" },
      { texto: it.name.slice(0, 40), tom: "apagado" },
    ])
  }
  return saida
}

// ── Montagem ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const deArg = arg("de") ?? hojeManaus()
  const de = instante(deArg)
  const ate = arg("ate") ? instante(arg("ate")!, true) : new Date()
  const diaIso = arg("dia") ?? deArg.slice(0, 10)
  const saida = arg("saida") ?? `relatorio-${diaIso}.pdf`
  const intervencoes = arg("intervencoes")
    ?? path.resolve(process.cwd(), `../docs/relatorios/intervencoes-${diaIso}.json`)

  const [execucoes, retroativas, alteracoes] = await Promise.all([
    secaoExecucoes(de, ate),
    secaoRetroativas(diaIso),
    lerAlteracoesBoard(de, ate),
  ])
  const ocorrencias = secaoOcorrencias(alteracoes)
  const outras = secaoOutrasAlteracoes(alteracoes)
  const tecnicas = secaoIntervencoes(intervencoes)

  const pdf = gerarRelatorioPeriodo({
    titulo: "Alterações no board e lançamentos",
    subtitulo: "O que mudou no Monday na janela, quem mudou, e as convocações retroativas do dia",
    periodoLabel: `${dataHora(de)} a ${dataHora(ate)}`,
    geradoPor: process.env.USER ?? process.env.USERNAME ?? "automação",
    resumo: [
      { rotulo: "lançamentos de ocorrência", n: ocorrencias.linhas.length, tom: ocorrencias.linhas.length ? "amarelo" : undefined },
      { rotulo: "outras alterações", n: alteracoes.length - ocorrencias.linhas.length },
      { rotulo: "convocações retroativas", n: retroativas.linhas.length, tom: retroativas.linhas.length ? "amarelo" : undefined },
      { rotulo: "execuções do app", n: execucoes.linhas.length },
      { rotulo: "intervenções técnicas", n: tecnicas.linhas.length },
    ],
    secoes: [ocorrencias, retroativas, outras, execucoes, tecnicas],
  })
  fs.writeFileSync(saida, pdf)
  console.log(`PDF: ${path.resolve(saida)} (${(pdf.length / 1024).toFixed(0)} KB)`)
  console.log(`janela: ${dataHora(de)} a ${dataHora(ate)} (Manaus) | dia das retroativas: ${dia(diaIso)}`)
  for (const s of [ocorrencias, retroativas, outras, execucoes, tecnicas]) {
    console.log(`  ${String(s.linhas.length).padStart(4)} linha(s)  ${s.titulo}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })

