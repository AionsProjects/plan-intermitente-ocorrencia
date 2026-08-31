// Relatório de período em PDF — multi-seção, para quando a pergunta não cabe numa tabela só.
//
// O `relatorioAtividade.ts` responde "o que os operadores fizeram" e tem UMA tabela de forma
// fixa. Este responde "o que aconteceu no sistema", e isso vem de fontes diferentes: execuções
// do app, eventos do mensal, convocações no RM, efeitos de dinheiro e intervenções técnicas que
// não moram em tabela nenhuma. Por isso a seção é o bloco de montagem, e cada uma declara as
// próprias colunas.
//
// Não reusa o corpo do `relatorioAtividade` de propósito: aquele documento é o que o DP anexa e
// encaminha, não tem teste cobrindo, e extrair o layout dele para cá exigiria mexer no arquivo
// vivo sem rede de proteção. O que os dois compartilham é o `clients/pdf.ts` — que já era comum —
// e a paleta, replicada aqui em constantes próprias.
import { A4_PAISAGEM, DocumentoPdf, cor, medirTexto, truncar, type CorRgb } from "../clients/pdf.js"

export type TomCelula = "normal" | "apagado" | "verde" | "vermelho" | "amarelo" | "forte"

export interface ColunaSecao {
  titulo: string
  /** Largura em pontos. A soma das colunas da seção tem de caber na área útil. */
  w: number
}

export interface CelulaSecao {
  texto: string
  tom?: TomCelula
  /** Ponto colorido antes do texto — a lâmpada de status do app. */
  lamp?: boolean
}

export interface SecaoRelatorio {
  titulo: string
  /** De onde os dados vieram. Vai impresso: quem recebe o PDF tem de poder conferir. */
  fonte: string
  colunas: ColunaSecao[]
  linhas: CelulaSecao[][]
  /** Texto quando não há linhas. Ausência é informação, não espaço em branco. */
  vazio?: string
}

export interface ResumoItem {
  rotulo: string
  n: number
  tom?: TomCelula
}

export interface DadosRelatorioPeriodo {
  titulo: string
  subtitulo: string
  periodoLabel: string
  geradoPor: string
  resumo: ResumoItem[]
  secoes: SecaoRelatorio[]
}

// Paleta do app calibrada para papel branco — mesma do relatório de atividade.
const NAVY = cor("#10151f")
const NAVY_2 = cor("#1a2130")
const OURO = cor("#c9982f")
const OURO_CLARO = cor("#e8c275")
const TINTA = cor("#1a1d24")
const APAGADO = cor("#6b7280")
const BRANCO = cor("#ffffff")
const BRANCO_70 = cor("#b9c1d0")
const ZEBRA = cor("#f4f6f9")
const FIO = cor("#e3e7ee")
const VERDE = cor("#178a50")
const VERMELHO = cor("#c43d3d")
const AMARELO = cor("#a87a16")
const VERMELHO_FUNDO = cor("#fbeeee")

const COR_TOM: Record<TomCelula, CorRgb> = {
  normal: TINTA,
  apagado: APAGADO,
  verde: VERDE,
  vermelho: VERMELHO,
  amarelo: AMARELO,
  forte: TINTA,
}

const MARGEM = 36
const LARG = A4_PAISAGEM.largura
const ALT = A4_PAISAGEM.altura
const RODAPE_Y = ALT - 30
const ALTURA_LINHA = 16
const UTIL = LARG - 2 * MARGEM

const fmtManaus = (d: Date, o: Intl.DateTimeFormatOptions): string =>
  d.toLocaleString("pt-BR", { ...o, timeZone: "America/Manaus" })

function cabecalhoGrande(doc: DocumentoPdf, dados: DadosRelatorioPeriodo): number {
  doc.retangulo(0, 0, LARG, 92, NAVY)
  doc.retangulo(0, 88, LARG, 4, NAVY_2)
  doc.retangulo(0, 92, LARG, 2.2, OURO)
  doc.texto(MARGEM, 18, "PLANO DE INTERMITENTES", { tamanho: 8, fonte: "helvB", cor: OURO_CLARO })
  doc.texto(MARGEM, 34, dados.titulo, { tamanho: 24, fonte: "timesB", cor: BRANCO })
  doc.texto(MARGEM, 66, dados.subtitulo, { tamanho: 8.5, cor: BRANCO_70 })
  const dir = LARG - MARGEM
  doc.texto(0, 22, `Período  ${dados.periodoLabel}`, { tamanho: 9, cor: BRANCO, alinharDireita: dir })
  doc.texto(0, 38, "Horários no fuso de Manaus (UTC-4)", { tamanho: 9, cor: BRANCO_70, alinharDireita: dir })
  doc.texto(0, 54, `Gerado em ${fmtManaus(new Date(), { dateStyle: "short", timeStyle: "short" })} por ${dados.geradoPor}`, {
    tamanho: 8, cor: BRANCO_70, alinharDireita: dir,
  })
  return 110
}

function cabecalhoCurto(doc: DocumentoPdf, dados: DadosRelatorioPeriodo): number {
  doc.retangulo(0, 0, LARG, 34, NAVY)
  doc.retangulo(0, 34, LARG, 1.6, OURO)
  doc.texto(MARGEM, 10, dados.titulo, { tamanho: 12, fonte: "timesB", cor: BRANCO })
  doc.texto(0, 13, dados.periodoLabel, { tamanho: 8, cor: BRANCO_70, alinharDireita: LARG - MARGEM })
  return 48
}

function resumo(doc: DocumentoPdf, y: number, itens: ResumoItem[]): number {
  let x = MARGEM
  for (const it of itens) {
    const texto = `${it.n} ${it.rotulo}`
    const w = medirTexto(texto, 9, "helvB") + (it.tom ? 30 : 20)
    // Quebra de linha das pílulas: com 6+ contadores a faixa estoura a margem direita.
    if (x + w > LARG - MARGEM) {
      x = MARGEM
      y += 26
    }
    doc.retangulo(x, y, w, 20, ZEBRA, 10)
    if (it.tom) doc.circulo(x + 12, y + 10, 3, COR_TOM[it.tom])
    doc.texto(x + (it.tom ? 20 : 10), y + 5.5, texto, { tamanho: 9, fonte: "helvB", cor: TINTA })
    x += w + 8
  }
  return y + 32
}

function tituloSecao(doc: DocumentoPdf, y: number, s: SecaoRelatorio, n: number): number {
  doc.texto(MARGEM, y, `${n}. ${s.titulo.toUpperCase()}`, { tamanho: 10, fonte: "helvB", cor: TINTA })
  doc.texto(0, y + 2, s.fonte, { tamanho: 7.5, cor: APAGADO, alinharDireita: LARG - MARGEM })
  doc.linha(MARGEM, y + 15, LARG - MARGEM, y + 15, OURO, 1.1)
  return y + 20
}

function cabecalhoColunas(doc: DocumentoPdf, y: number, colunas: ColunaSecao[]): number {
  let x = MARGEM
  for (const c of colunas) {
    doc.texto(x, y, c.titulo, { tamanho: 7, fonte: "helvB", cor: APAGADO })
    x += c.w
  }
  doc.linha(MARGEM, y + 11, LARG - MARGEM, y + 11, FIO, 0.7)
  return y + 16
}

function linha(doc: DocumentoPdf, y: number, celulas: CelulaSecao[], colunas: ColunaSecao[], zebra: boolean): void {
  const falhou = celulas.some((c) => c.tom === "vermelho")
  if (falhou) doc.retangulo(MARGEM - 4, y - 3, UTIL + 8, ALTURA_LINHA, VERMELHO_FUNDO, 4)
  else if (zebra) doc.retangulo(MARGEM - 4, y - 3, UTIL + 8, ALTURA_LINHA, ZEBRA, 4)
  let x = MARGEM
  celulas.forEach((cel, i) => {
    const col = colunas[i]
    if (!col) return
    const tom = cel.tom ?? "normal"
    const bold = tom === "forte"
    let tx = x
    if (cel.lamp) {
      doc.circulo(x + 3.4, y + 6.5, 3, COR_TOM[tom])
      tx += 12
    }
    doc.texto(tx, y, truncar(cel.texto, col.w - (cel.lamp ? 20 : 8), 8.2, bold ? "helvB" : "helv"), {
      tamanho: 8.2,
      fonte: bold ? "helvB" : "helv",
      cor: COR_TOM[tom],
    })
    x += col.w
  })
}

function rodape(doc: DocumentoPdf, pagina: number, total: number): void {
  doc.linha(MARGEM, RODAPE_Y - 8, LARG - MARGEM, RODAPE_Y - 8, FIO, 0.7)
  doc.texto(MARGEM, RODAPE_Y - 2, "Plano de Intermitentes · horários no fuso de Manaus (UTC-4)", {
    tamanho: 7.5, cor: APAGADO,
  })
  doc.texto(0, RODAPE_Y - 2, `página ${pagina} de ${total}`, {
    tamanho: 7.5, cor: APAGADO, alinharDireita: LARG - MARGEM,
  })
}

/**
 * Flui o documento. `totalPaginas` nulo = passada de CONTAGEM; preenchido = passada final.
 * Duas passadas porque o total só se conhece depois de fluir tudo — mesmo motivo do
 * relatório de atividade.
 */
function montar(dados: DadosRelatorioPeriodo, totalPaginas: number | null): DocumentoPdf {
  const doc = new DocumentoPdf(A4_PAISAGEM)
  doc.novaPagina()
  let pagina = 1
  let y = cabecalhoGrande(doc, dados)
  y = resumo(doc, y, dados.resumo)
  if (totalPaginas != null) rodape(doc, pagina, totalPaginas)

  const quebrar = (): void => {
    doc.novaPagina()
    pagina++
    y = cabecalhoCurto(doc, dados)
    if (totalPaginas != null) rodape(doc, pagina, totalPaginas)
  }

  dados.secoes.forEach((s, i) => {
    // Título de seção sozinho no pé da página é órfão: exige espaço para o cabeçalho de
    // colunas e ao menos duas linhas, senão empurra a seção inteira para a próxima.
    if (y + 20 + 16 + ALTURA_LINHA * 2 > RODAPE_Y - 14) quebrar()
    y = tituloSecao(doc, y, s, i + 1)
    y = cabecalhoColunas(doc, y, s.colunas)
    if (s.linhas.length === 0) {
      doc.texto(MARGEM, y + 2, s.vazio ?? "Nada no período.", { tamanho: 8.6, cor: APAGADO })
      y += ALTURA_LINHA + 12
      return
    }
    let zebra = false
    for (const l of s.linhas) {
      if (y + ALTURA_LINHA > RODAPE_Y - 14) {
        quebrar()
        y = cabecalhoColunas(doc, y, s.colunas)
        zebra = false
      }
      linha(doc, y, l, s.colunas, zebra)
      zebra = !zebra
      y += ALTURA_LINHA
    }
    y += 14
  })
  return doc
}

export function gerarRelatorioPeriodo(dados: DadosRelatorioPeriodo): Buffer {
  const contagem = montar(dados, null)
  return montar(dados, contagem.totalPaginas).gerar()
}

/** Largura útil da página, para quem monta as colunas de uma seção. */
export const LARGURA_UTIL = UTIL
