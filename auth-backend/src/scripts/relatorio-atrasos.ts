/**
 * Dashboard de atraso do operacional, em PDF.
 *
 *   npm run relatorio:atrasos -- --dia=2026-08-31 --corte=14:00 --saida=x.pdf
 *
 * Responde três perguntas e nada mais:
 *
 *  1. Quais convocações saíram ATRASADAS — criadas no dia para período que já havia começado.
 *     A régua é a distância entre `data_inicio` e a criação (decisão do Isaac, 31/08): a
 *     convocação deveria existir ANTES de o período começar.
 *  2. Quais ocorrências foram lançadas depois do corte (14h por padrão).
 *  3. O que foi editado À MÃO no board, ignorando quem o `--ignorar` listar.
 *
 * A classificação "à mão" é confiável porque o app escreve no Monday com o token do Isaac: no
 * `activity_log`, autor humano diferente do token = alguém digitou na interface. Não é heurística
 * de tempo.
 *
 * SOMENTE LEITURA (Postgres + Monday).
 */
import fs from "node:fs"
import path from "node:path"
import { query } from "../db.js"
import { rotuloAcao, rotuloEstadoExecucao } from "../domain/rotulosAtividade.js"
import {
  LARGURA_UTIL,
  gerarRelatorioPeriodo,
  type BlocoBarras,
  type CelulaSecao,
  type KpiItem,
  type SecaoRelatorio,
} from "../services/relatorioPeriodo.js"
import { dia, hojeManaus, hora, instante, quem } from "../services/janelaManaus.js"
import { atrasoEmDias, lerAlteracoesBoard, norm } from "../services/coletaAtividade.js"

// uids do Monday, não e-mails: o nome no board ("Thifany Castro") não casa com o prefixo do
// e-mail ("thifany.souza"), e foi assim que a primeira execução listou justamente quem devia
// ficar de fora. `--ignorar` aceita uid ou pedaço do nome.
const IGNORAR_PADRAO = ["98663994", "41622430"] // Isaac Raylen, Thifany Castro

function arg(nome: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`))
  return p ? p.slice(nome.length + 3) : undefined
}

const col = (titulo: string, w: number): { titulo: string; w: number } => ({ titulo, w })

/**
 * YYYY-MM-DD de um valor que pode vir Date OU string.
 *
 * O driver do Postgres devolve coluna `date` como string em algumas versões e como Date em
 * outras — chamar `toISOString()` direto quebrou na primeira execução real.
 */
const soData = (v: Date | string): string =>
  typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10)

// ── 1. Convocações atrasadas ────────────────────────────────────────────────
interface Atrasada {
  codigo: string
  chapa: string
  contrato: string
  inicio: string
  fim: string
  criadoEm: Date
  autor: string
  origem: string
  atraso: number
}

async function lerAtrasadas(diaIso: string): Promise<Atrasada[]> {
  const { rows } = await query<{
    codigo: string; chapa: string; contrato: string | null
    data_inicio: Date | string; data_fim: Date | string; criado_em: Date
    criado_por: string | null; origem_acao: string | null
  }>(
    `SELECT codigo, chapa, contrato, data_inicio, data_fim, criado_em, criado_por, origem_acao
       FROM convocacoes_rm
      WHERE (criado_em AT TIME ZONE 'America/Manaus')::date = $1::date
        AND data_inicio::date < $1::date
      ORDER BY criado_em`,
    [diaIso],
  )
  return rows
    .map((r) => ({
      codigo: r.codigo,
      chapa: r.chapa,
      contrato: r.contrato ?? "—",
      inicio: soData(r.data_inicio),
      fim: soData(r.data_fim),
      criadoEm: r.criado_em,
      autor: quem(null, r.criado_por),
      origem: r.origem_acao ?? "—",
      atraso: atrasoEmDias(r.data_inicio, diaIso),
    }))
    .sort((a, b) => b.atraso - a.atraso)
}

function secaoAtrasadas(itens: Atrasada[], diaIso: string): SecaoRelatorio {
  return {
    titulo: `Convocações atrasadas — criadas em ${dia(diaIso)} para período já iniciado`,
    fonte: "pi.convocacoes_rm · atraso = dias entre o início do período e a criação",
    colunas: [col("CRIADA", 52), col("CÓDIGO RM", 100), col("CHAPA", 54), col("CONTRATO", 120),
      col("PERÍODO CONVOCADO", 130), col("ATRASO", 56), col("QUEM CRIOU", 140),
      col("ORIGEM", LARGURA_UTIL - 652)],
    vazio: "Nenhuma convocação atrasada no dia. Tudo criado antes do período começar.",
    linhas: itens.map((a): CelulaSecao[] => [
      { texto: hora(a.criadoEm) },
      { texto: a.codigo, tom: "forte" },
      { texto: a.chapa },
      { texto: a.contrato },
      { texto: `${dia(a.inicio)} a ${dia(a.fim)}` },
      // 5 dias ou mais é a semana inteira de atraso: vermelho. Abaixo, âmbar.
      { texto: `${a.atraso} d`, tom: a.atraso >= 5 ? "vermelho" : "amarelo", lamp: true },
      { texto: a.autor },
      { texto: a.origem, tom: "apagado" },
    ]),
  }
}

// ── 2. Ocorrências lançadas depois do corte ─────────────────────────────────
async function secaoOcorrencias(
  corte: Date,
  ate: Date,
  alteracoes: Awaited<ReturnType<typeof lerAlteracoesBoard>>,
  ignorar: string[],
): Promise<SecaoRelatorio> {
  const { rows } = await query<{
    acao: string; estado: string; pessoa_nome: string | null; contrato: string | null
    quem_nome: string | null; quem_email: string | null; criado_em: Date
    payload_resumo: Record<string, unknown> | null
  }>(
    `SELECT acao, estado, pessoa_nome, contrato,
            operador_nome quem_nome, operador_email quem_email, criado_em, payload_resumo
       FROM audit_lancamentos
      WHERE criado_em >= $1 AND criado_em <= $2
        AND acao IN ('registro','cancelamento','ponto_facultativo','atestado','split')
      ORDER BY criado_em`,
    [corte.toISOString(), ate.toISOString()],
  )
  const resumo = (p: Record<string, unknown> | null): string => {
    if (!p) return ""
    const partes: string[] = []
    if (p.protocolo) partes.push(String(p.protocolo))
    if (p.qtd_faltas != null) partes.push(`${p.qtd_faltas} falta(s)`)
    if (p.qtd_atrasos != null) partes.push(`${p.qtd_atrasos} atraso(s)`)
    if (p.tipo) partes.push(`tipo ${p.tipo}`)
    if (p.dias_cancelados != null) partes.push(`${p.dias_cancelados} dia(s) cancelado(s)`)
    return partes.join(" · ")
  }
  const linhas: CelulaSecao[][] = rows.map((r): CelulaSecao[] => [
    { texto: hora(r.criado_em) },
    { texto: rotuloAcao(r.acao), tom: "forte" },
    { texto: r.pessoa_nome ?? "—" },
    { texto: r.contrato ?? "—" },
    { texto: rotuloEstadoExecucao(r.estado), tom: r.estado === "ok" ? "verde" : "vermelho", lamp: true },
    { texto: quem(r.quem_nome, r.quem_email) },
    { texto: "app", tom: "apagado" },
    { texto: resumo(r.payload_resumo), tom: "apagado" },
  ])

  // Ocorrência digitada DIRETO no board depois do corte — não passou pelo app, e é o que ninguém
  // veria sem cruzar as duas fontes.
  for (const a of alteracoes) {
    if (!a.ocorrencia || a.quando < corte) continue
    if (a.autorReal) continue // já apareceu acima, via app
    // O mesmo `--ignorar` das manuais vale aqui: pedido do Isaac era não listar o que ele e a
    // Thifany fizeram. Sem isso, as 12 desconvocações da tarde afogavam o único lançamento real.
    if (ignorado(a, ignorar)) continue
    linhas.push([
      { texto: hora(a.quando) },
      { texto: a.coluna, tom: "forte" },
      { texto: a.pessoa },
      { texto: "—" },
      { texto: "à mão", tom: "amarelo", lamp: true },
      { texto: a.gravadoPor },
      { texto: "board", tom: "amarelo" },
      { texto: `${a.de} → ${a.para}`, tom: "apagado" },
    ])
  }
  linhas.sort((x, y) => String(x[0]?.texto).localeCompare(String(y[0]?.texto)))
  return {
    titulo: `Ocorrências lançadas depois de ${hora(corte)}`,
    fonte: "pi.audit_lancamentos + colunas de ocorrência do board (o que foi à mão aparece marcado)",
    colunas: [col("HORA", 46), col("AÇÃO / COLUNA", 130), col("PESSOA", 150), col("CONTRATO", 90),
      col("DESFECHO", 70), col("QUEM LANÇOU", 140), col("VIA", 44),
      col("DETALHE", LARGURA_UTIL - 670)],
    vazio: "Nenhuma ocorrência lançada depois do corte.",
    linhas,
  }
}

// ── 3. Alterações à mão no board ────────────────────────────────────────────
function ignorado(a: { gravadoPor: string; gravadoPorId: number }, lista: string[]): boolean {
  return lista.some((i) => {
    const t = i.trim()
    if (/^-?\d+$/.test(t)) return a.gravadoPorId === Number(t)
    return norm(a.gravadoPor).includes(norm(t))
  })
}

function secoesManuais(
  alteracoes: Awaited<ReturnType<typeof lerAlteracoesBoard>>,
  ignorar: string[],
): { resumo: SecaoRelatorio; detalhe: SecaoRelatorio; porPessoa: Array<{ pessoa: string; n: number }> } {
  // Autor humano ≠ token = digitou na interface. `autorReal` preenchido significa que uma
  // execução do app explica a linha, então ela NÃO é manual.
  const manuais = alteracoes.filter(
    (a) => a.via === "à mão no board" && !ignorado(a, ignorar),
  )
  const porPessoa = new Map<string, { n: number; colunas: Set<string>; primeiro: Date; ultimo: Date }>()
  for (const a of manuais) {
    const g = porPessoa.get(a.gravadoPor)
    if (g) {
      g.n++
      g.colunas.add(a.coluna)
      g.ultimo = a.quando
    } else {
      porPessoa.set(a.gravadoPor, { n: 1, colunas: new Set([a.coluna]), primeiro: a.quando, ultimo: a.quando })
    }
  }
  const ordenado = [...porPessoa.entries()].sort((x, y) => y[1].n - x[1].n)
  return {
    porPessoa: ordenado.map(([pessoa, g]) => ({ pessoa, n: g.n })),
    resumo: {
      titulo: "Alterações à mão no board — por pessoa",
      fonte: `activity_log do Monday · fora ${ignorar.join(", ")} e a automação`,
      colunas: [col("QUEM", 190), col("ALTERAÇÕES", 80), col("COLUNAS TOCADAS", 70),
        col("PRIMEIRA", 70), col("ÚLTIMA", 70), col("QUAIS COLUNAS", LARGURA_UTIL - 480)],
      vazio: "Ninguém editou o board à mão no dia (fora os ignorados).",
      linhas: ordenado.map(([pessoa, g]): CelulaSecao[] => [
        { texto: pessoa, tom: "forte" },
        { texto: String(g.n) },
        { texto: String(g.colunas.size) },
        { texto: hora(g.primeiro), tom: "apagado" },
        { texto: hora(g.ultimo), tom: "apagado" },
        { texto: [...g.colunas].join(", "), tom: "apagado" },
      ]),
    },
    detalhe: {
      titulo: "Alterações à mão no board — detalhe",
      fonte: "activity_log do Monday · uma linha por alteração",
      colunas: [col("HORA", 46), col("QUEM", 140), col("PESSOA DO ITEM", 170), col("COLUNA", 130),
        col("DE", 110), col("PARA", LARGURA_UTIL - 596)],
      vazio: "Sem detalhe: nenhuma alteração à mão.",
      linhas: manuais.map((a): CelulaSecao[] => [
        { texto: hora(a.quando) },
        { texto: a.gravadoPor },
        { texto: a.pessoa },
        { texto: a.coluna, tom: a.ocorrencia ? "amarelo" : "normal" },
        { texto: a.de, tom: "apagado" },
        { texto: a.para },
      ]),
    },
  }
}

// ── Montagem ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const diaIso = arg("dia") ?? hojeManaus()
  const corteHora = arg("corte") ?? "14:00"
  const corte = instante(`${diaIso}T${corteHora}`)
  const fim = instante(diaIso, true)
  const ignorar = (arg("ignorar") ?? IGNORAR_PADRAO.join(",")).split(",").map((s) => s.trim()).filter(Boolean)
  const saida = arg("saida") ?? `atrasos-${diaIso}.pdf`

  const [atrasadas, alteracoes] = await Promise.all([
    lerAtrasadas(diaIso),
    // Dia inteiro: as manuais interessam desde a manhã, não só depois do corte.
    lerAlteracoesBoard(instante(diaIso), fim),
  ])
  const ocorrencias = await secaoOcorrencias(corte, fim, alteracoes, ignorar)
  const manuais = secoesManuais(alteracoes, ignorar)

  const atrasos = atrasadas.map((a) => a.atraso)
  const media = atrasos.length ? atrasos.reduce((t, n) => t + n, 0) / atrasos.length : 0
  const maximo = atrasos.length ? Math.max(...atrasos) : 0
  const porOperador = new Map<string, { max: number; n: number }>()
  for (const a of atrasadas) {
    const g = porOperador.get(a.autor)
    if (g) {
      g.max = Math.max(g.max, a.atraso)
      g.n++
    } else porOperador.set(a.autor, { max: a.atraso, n: 1 })
  }
  const porContrato = new Map<string, number>()
  for (const a of atrasadas) porContrato.set(a.contrato, Math.max(porContrato.get(a.contrato) ?? 0, a.atraso))

  const kpis: KpiItem[] = [
    {
      rotulo: "Convocações atrasadas",
      valor: String(atrasadas.length),
      nota: atrasadas.length ? `de ${porOperador.size} operador(es)` : "nenhuma no dia",
      tom: atrasadas.length ? "vermelho" : "verde",
    },
    { rotulo: "Atraso médio", valor: `${media.toFixed(1)} d`, nota: "dias após o início do período" },
    { rotulo: "Pior atraso", valor: `${maximo} d`, nota: atrasadas[0] ? `${atrasadas[0].codigo} · ${atrasadas[0].autor}` : "—", tom: maximo >= 5 ? "vermelho" : "amarelo" },
    {
      rotulo: `Ocorrências após ${corteHora}`,
      valor: String(ocorrencias.linhas.length),
      nota: "lançamentos de falta, atraso e cancelamento",
    },
    {
      rotulo: "Alterações à mão",
      valor: String(manuais.detalhe.linhas.length),
      nota: `${manuais.porPessoa.length} pessoa(s), fora os ignorados`,
      tom: manuais.detalhe.linhas.length ? "amarelo" : "verde",
    },
  ]

  const barras: BlocoBarras[] = []
  if (porOperador.size) {
    barras.push({
      titulo: "Pior atraso por operador",
      unidade: " d",
      itens: [...porOperador.entries()]
        .sort((a, b) => b[1].max - a[1].max)
        .map(([pessoa, g]) => ({ rotulo: pessoa, valor: g.max, nota: `${g.n} convocação(ões)` })),
    })
  }
  if (porContrato.size) {
    barras.push({
      titulo: "Pior atraso por contrato",
      unidade: " d",
      itens: [...porContrato.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ rotulo: c, valor: v })),
    })
  }
  if (manuais.porPessoa.length) {
    barras.push({
      titulo: "Alterações à mão no board, por pessoa",
      itens: manuais.porPessoa.map((p) => ({ rotulo: p.pessoa, valor: p.n })),
    })
  }

  const pdf = gerarRelatorioPeriodo({
    titulo: "Atraso do operacional",
    subtitulo: `Convocações atrasadas do dia · ocorrências após ${corteHora} · o que foi feito à mão no board`,
    periodoLabel: `${dia(diaIso)} · corte ${corteHora}`,
    geradoPor: process.env.USER ?? process.env.USERNAME ?? "automação",
    kpis,
    resumo: [],
    barras,
    secoes: [secaoAtrasadas(atrasadas, diaIso), ocorrencias, manuais.resumo, manuais.detalhe],
  })
  fs.writeFileSync(saida, pdf)
  console.log(`PDF: ${path.resolve(saida)} (${(pdf.length / 1024).toFixed(0)} KB)`)
  console.log(`dia ${dia(diaIso)} · corte ${corteHora} · ignorando: ${ignorar.join(", ")}`)
  console.log(`  ${String(atrasadas.length).padStart(4)} convocações atrasadas (média ${media.toFixed(1)} d, pior ${maximo} d)`)
  console.log(`  ${String(ocorrencias.linhas.length).padStart(4)} ocorrências após o corte`)
  console.log(`  ${String(manuais.detalhe.linhas.length).padStart(4)} alterações à mão, de ${manuais.porPessoa.length} pessoa(s)`)
  for (const p of manuais.porPessoa) console.log(`       ${String(p.n).padStart(3)}  ${p.pessoa}`)
}

// Só roda quando invocado como script. Sem esta guarda, um `import` em teste dispara um PDF de
// verdade e derruba o runner — aconteceu duas vezes hoje.
const ehEntrypoint = process.argv[1]?.split("\\").join("/").includes("relatorio-atrasos")
if (ehEntrypoint) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    })
}

