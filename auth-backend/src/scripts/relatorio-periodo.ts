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
import { lerAlteracoesBoard, type AlteracaoBoard } from "../services/coletaAtividade.js"

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

// ── Convocações criadas na janela ───────────────────────────────────────────
// Voltou ao relatório: é o VOLUME do dia. Vem de pi.convocacoes_rm, onde `criado_por` já é o
// operador do app (não a conta de serviço), então aqui não há o problema de autoria do board.
// Uma linha por pessoa seriam ~74; o DP quer ver quem convocou quanto, então agrupa por
// contrato + origem + autor e mostra a faixa de códigos.
async function secaoConvocacoes(de: Date, ate: Date): Promise<SecaoRelatorio> {
  const { rows } = await query<{
    contrato: string | null; origem_acao: string | null; criado_por: string | null
    n: number; de_cod: string; ate_cod: string; removidas: number; primeiro: Date; ultimo: Date
  }>(
    `SELECT contrato, origem_acao, criado_por, COUNT(*)::int n,
            MIN(codigo) de_cod, MAX(codigo) ate_cod,
            COUNT(*) FILTER (WHERE removido_em IS NOT NULL)::int removidas,
            MIN(criado_em) primeiro, MAX(criado_em) ultimo
       FROM convocacoes_rm
      WHERE criado_em >= $1 AND criado_em <= $2
      GROUP BY 1,2,3 ORDER BY 4 DESC`,
    [de.toISOString(), ate.toISOString()],
  )
  const total = rows.reduce((t, r) => t + r.n, 0)
  return {
    titulo: `Convocações criadas na janela — ${total} no total`,
    fonte: "pi.convocacoes_rm — agrupado por contrato, origem e quem criou",
    colunas: [col("CONTRATO", 130), col("ORIGEM", 84), col("QUEM CRIOU", 150), col("QTD", 44),
      col("FAIXA DE CÓDIGOS", 176), col("HORÁRIO", 92), col("APAGADAS", LARGURA_UTIL - 676)],
    vazio: "Nenhuma convocação criada nesta janela.",
    linhas: rows.map((r): CelulaSecao[] => [
      { texto: r.contrato ?? "—", tom: "forte" },
      { texto: r.origem_acao ?? "—", tom: "apagado" },
      { texto: quem(null, r.criado_por) },
      { texto: String(r.n) },
      { texto: r.de_cod === r.ate_cod ? r.de_cod : `${r.de_cod} … ${r.ate_cod}`, tom: "apagado" },
      { texto: `${hora(r.primeiro)}–${hora(r.ultimo)}`, tom: "apagado" },
      { texto: r.removidas ? `${r.removidas}` : "—", tom: r.removidas ? "amarelo" : "apagado" },
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

  const [execucoes, convocacoes, retroativas, alteracoes] = await Promise.all([
    secaoExecucoes(de, ate),
    secaoConvocacoes(de, ate),
    secaoRetroativas(diaIso),
    lerAlteracoesBoard(de, ate),
  ])
  const ocorrencias = secaoOcorrencias(alteracoes)
  const outras = secaoOutrasAlteracoes(alteracoes)
  const tecnicas = secaoIntervencoes(intervencoes)

  const pdf = gerarRelatorioPeriodo({
    titulo: "Alterações no board e lançamentos",
    subtitulo: "Board do Plano do mês · quem alterou de verdade · convocações criadas e retroativas",
    periodoLabel: `${dataHora(de)} a ${dataHora(ate)}`,
    geradoPor: process.env.USER ?? process.env.USERNAME ?? "automação",
    resumo: [
      { rotulo: "lançamentos de ocorrência", n: ocorrencias.linhas.length, tom: ocorrencias.linhas.length ? "amarelo" : undefined },
      { rotulo: "convocações criadas", n: convocacoes.linhas.reduce((t, l) => t + Number(l[3]?.texto ?? 0), 0) },
      { rotulo: "convocações retroativas", n: retroativas.linhas.length, tom: retroativas.linhas.length ? "amarelo" : undefined },
      { rotulo: "outras alterações no Plano", n: alteracoes.length - ocorrencias.linhas.length },
      { rotulo: "execuções do app", n: execucoes.linhas.length },
      { rotulo: "intervenções técnicas", n: tecnicas.linhas.length },
    ],
    secoes: [ocorrencias, convocacoes, retroativas, outras, execucoes, tecnicas],
  })
  fs.writeFileSync(saida, pdf)
  console.log(`PDF: ${path.resolve(saida)} (${(pdf.length / 1024).toFixed(0)} KB)`)
  console.log(`janela: ${dataHora(de)} a ${dataHora(ate)} (Manaus) | dia das retroativas: ${dia(diaIso)}`)
  for (const s of [ocorrencias, convocacoes, retroativas, outras, execucoes, tecnicas]) {
    console.log(`  ${String(s.linhas.length).padStart(4)} linha(s)  ${s.titulo}`)
  }
}

// Idem ao relatorio-atrasos: só executa como script.
if (process.argv[1]?.split("\\").join("/").includes("relatorio-periodo")) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    })
}

