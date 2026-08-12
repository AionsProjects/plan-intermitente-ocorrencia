// Relatório de atividade em PDF — o documento que o DP anexa e encaminha.
//
// Linguagem visual da casa levada pro papel: faixa fumê meia-noite no cabeçalho com o
// título em serifa (eco do display do app), dourado como fio condutor, lâmpadas de
// status como pontos coloridos e tabela zebrada de leitura rápida. Impresso continua
// legível: o fundo do miolo é branco, cor só onde é informação.
import { A4_PAISAGEM, DocumentoPdf, cor, medirTexto, truncar, type CorRgb } from "../clients/pdf.js"
import { nomeLimpo } from "../domain/mensagemAlteracao.js"
import { rotuloAcao, rotuloEstadoExecucao, rotuloEtapa } from "../domain/rotulosAtividade.js"

export interface LinhaRelatorio {
  id: string
  acao: string
  estado: string
  pessoa_nome: string | null
  contrato: string | null
  operador_nome: string | null
  operador_email: string | null
  erro_etapa: string | null
  erro_msg: string | null
  criado_em: Date
}

export interface DadosRelatorio {
  escopo: string          // "todas as pessoas" | nome do operador
  periodoLabel: string    // "01/08/2026 a 12/08/2026"
  geradoPor: string
  linhas: LinhaRelatorio[]
  truncadoEm: number | null // teto atingido, ou null
}

// Paleta — a do app, calibrada pra papel branco (o dourado do tema claro, não o do escuro).
const NAVY = cor("#10151f")     // faixa fumê meia-noite
const NAVY_2 = cor("#1a2130")
const OURO = cor("#c9982f")     // --cta-lo do tema claro: dourado que segura contraste no branco
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

const COR_ESTADO: Record<string, CorRgb> = {
  ok: VERDE,
  erro: VERMELHO,
  abandonada: VERMELHO,
  parcial: AMARELO,
  aberta: AMARELO,
}

const MARGEM = 36
const LARG = A4_PAISAGEM.largura
const ALT = A4_PAISAGEM.altura
const RODAPE_Y = ALT - 30
const ALTURA_LINHA = 17

// Colunas (soma = área útil). "Problema" por último: é o campo longo e o único que
// pode sangrar sem empurrar os demais.
const COLUNAS: Array<{ titulo: string; w: number }> = [
  { titulo: "DATA · HORA", w: 82 },
  { titulo: "AÇÃO", w: 106 },
  { titulo: "DESFECHO", w: 102 },
  { titulo: "PESSOA", w: 160 },
  { titulo: "CONTRATO", w: 70 },
  { titulo: "QUEM EXECUTOU", w: 112 },
  { titulo: "PROBLEMA", w: LARG - 2 * MARGEM - 632 },
]

const fmtManaus = (d: Date, o: Intl.DateTimeFormatOptions): string =>
  d.toLocaleString("pt-BR", { ...o, timeZone: "America/Manaus" })

function cabecalhoGrande(doc: DocumentoPdf, dados: DadosRelatorio): number {
  // Faixa fumê sangrada — o "vidro" do app virando papel timbrado.
  doc.retangulo(0, 0, LARG, 92, NAVY)
  doc.retangulo(0, 88, LARG, 4, NAVY_2)
  // Fio dourado na base da faixa: o acento como assinatura, não como enfeite.
  doc.retangulo(0, 92, LARG, 2.2, OURO)

  doc.texto(MARGEM, 18, "PLANO DE INTERMITENTES", { tamanho: 8, fonte: "helvB", cor: OURO_CLARO })
  doc.texto(MARGEM, 34, "Relatório de atividade", { tamanho: 26, fonte: "timesB", cor: BRANCO })

  // Metadados à direita, no mesmo eixo do título.
  const dir = LARG - MARGEM
  doc.texto(0, 22, `Período  ${dados.periodoLabel}`, { tamanho: 9, cor: BRANCO, alinharDireita: dir })
  doc.texto(0, 38, `Escopo  ${dados.escopo}`, { tamanho: 9, cor: BRANCO_70, alinharDireita: dir })
  doc.texto(0, 54, `Gerado em ${fmtManaus(new Date(), { dateStyle: "short", timeStyle: "short" })} (Manaus) por ${dados.geradoPor}`, {
    tamanho: 8, cor: BRANCO_70, alinharDireita: dir,
  })
  return 112
}

function cabecalhoCurto(doc: DocumentoPdf, dados: DadosRelatorio): number {
  doc.retangulo(0, 0, LARG, 34, NAVY)
  doc.retangulo(0, 34, LARG, 1.6, OURO)
  doc.texto(MARGEM, 10, "Relatório de atividade", { tamanho: 12, fonte: "timesB", cor: BRANCO })
  doc.texto(0, 13, dados.periodoLabel, { tamanho: 8, cor: BRANCO_70, alinharDireita: LARG - MARGEM })
  return 50
}

/** Pílulas de resumo: total + contagem por desfecho, com a lâmpada do app. */
function resumo(doc: DocumentoPdf, y: number, linhas: LinhaRelatorio[]): number {
  const porEstado = new Map<string, number>()
  for (const l of linhas) porEstado.set(l.estado, (porEstado.get(l.estado) ?? 0) + 1)
  const itens: Array<{ rotulo: string; n: number; cor: CorRgb | null }> = [
    { rotulo: "execuções", n: linhas.length, cor: null },
    ...["ok", "erro", "parcial", "abandonada", "aberta"]
      .filter((e) => porEstado.has(e))
      .map((e) => ({ rotulo: rotuloEstadoExecucao(e), n: porEstado.get(e)!, cor: COR_ESTADO[e] ?? APAGADO })),
  ]
  let x = MARGEM
  for (const it of itens) {
    const texto = `${it.n} ${it.rotulo}`
    const wTexto = medirTexto(texto, 9, "helvB")
    const wPill = wTexto + (it.cor ? 30 : 20)
    doc.retangulo(x, y, wPill, 20, ZEBRA, 10)
    if (it.cor) doc.circulo(x + 12, y + 10, 3, it.cor)
    doc.texto(x + (it.cor ? 20 : 10), y + 5.5, texto, { tamanho: 9, fonte: "helvB", cor: TINTA })
    x += wPill + 8
  }
  return y + 34
}

function cabecalhoTabela(doc: DocumentoPdf, y: number): number {
  let x = MARGEM
  for (const c of COLUNAS) {
    doc.texto(x, y, c.titulo, { tamanho: 7, fonte: "helvB", cor: APAGADO })
    x += c.w
  }
  doc.linha(MARGEM, y + 13, LARG - MARGEM, y + 13, OURO, 1.1)
  return y + 18
}

function rodape(doc: DocumentoPdf, pagina: number, total: number): void {
  doc.linha(MARGEM, RODAPE_Y - 8, LARG - MARGEM, RODAPE_Y - 8, FIO, 0.7)
  doc.texto(MARGEM, RODAPE_Y - 2, "Plano de Intermitentes · horários no fuso de Manaus", {
    tamanho: 7.5, cor: APAGADO,
  })
  doc.texto(0, RODAPE_Y - 2, `página ${pagina} de ${total}`, {
    tamanho: 7.5, cor: APAGADO, alinharDireita: LARG - MARGEM,
  })
}

function linhaTabela(doc: DocumentoPdf, y: number, l: LinhaRelatorio, zebra: boolean): void {
  const falhou = l.estado === "erro" || l.estado === "abandonada"
  // Falha ganha o fundo tintado — é a linha que o leitor procura. Zebra só organiza.
  if (falhou) doc.retangulo(MARGEM - 4, y - 3, LARG - 2 * MARGEM + 8, ALTURA_LINHA, VERMELHO_FUNDO, 4)
  else if (zebra) doc.retangulo(MARGEM - 4, y - 3, LARG - 2 * MARGEM + 8, ALTURA_LINHA, ZEBRA, 4)

  const corEstado = COR_ESTADO[l.estado] ?? APAGADO
  const problema = l.erro_etapa || l.erro_msg
    ? [l.erro_etapa ? rotuloEtapa(l.erro_etapa) : "", l.erro_msg ?? ""].filter(Boolean).join(" — ")
    : ""
  const celulas: Array<{ texto: string; cor?: CorRgb; bold?: boolean; lamp?: CorRgb }> = [
    { texto: `${fmtManaus(l.criado_em, { day: "2-digit", month: "2-digit" })} · ${fmtManaus(l.criado_em, { hour: "2-digit", minute: "2-digit" })}` },
    { texto: rotuloAcao(l.acao), bold: true },
    { texto: rotuloEstadoExecucao(l.estado), cor: corEstado, lamp: corEstado },
    { texto: l.pessoa_nome ?? "—" },
    { texto: l.contrato ?? "—" },
    { texto: nomeLimpo(l.operador_nome) ?? l.operador_email ?? "—", cor: APAGADO },
    { texto: problema, cor: falhou ? VERMELHO : APAGADO },
  ]
  let x = MARGEM
  celulas.forEach((cel, i) => {
    const wCol = COLUNAS[i]!.w
    let tx = x
    if (cel.lamp) {
      doc.circulo(x + 3.4, y + 7, 3, cel.lamp)
      tx += 12
    }
    doc.texto(tx, y, truncar(cel.texto, wCol - (cel.lamp ? 20 : 8), 8.6, cel.bold ? "helvB" : "helv"), {
      tamanho: 8.6,
      fonte: cel.bold ? "helvB" : "helv",
      cor: cel.cor ?? TINTA,
    })
    x += wCol
  })
}

/**
 * Flui o documento inteiro. `totalPaginas` nulo = passada de CONTAGEM (sem rodapé);
 * preenchido = passada final, carimbando "página X de Y".
 *
 * Duas passadas porque o total só se conhece depois de fluir a tabela, e manter API
 * de "reabrir página fechada" no gerador custaria mais que refluir um documento
 * barato.
 */
function montar(dados: DadosRelatorio, totalPaginas: number | null): DocumentoPdf {
  const doc = new DocumentoPdf(A4_PAISAGEM)
  doc.novaPagina()
  let pagina = 1
  let y = cabecalhoGrande(doc, dados)
  y = resumo(doc, y, dados.linhas)
  y = cabecalhoTabela(doc, y)
  if (totalPaginas != null) rodape(doc, pagina, totalPaginas)

  let zebra = false
  for (const l of dados.linhas) {
    if (y + ALTURA_LINHA > RODAPE_Y - 14) {
      doc.novaPagina()
      pagina++
      y = cabecalhoCurto(doc, dados)
      y = cabecalhoTabela(doc, y)
      if (totalPaginas != null) rodape(doc, pagina, totalPaginas)
      zebra = false
    }
    linhaTabela(doc, y, l, zebra)
    zebra = !zebra
    y += ALTURA_LINHA
  }

  if (dados.linhas.length === 0) {
    doc.texto(MARGEM, y + 10, "Nenhuma execução no período.", { tamanho: 10, cor: APAGADO })
  }
  if (dados.truncadoEm != null) {
    doc.retangulo(MARGEM - 4, y + 6, LARG - 2 * MARGEM + 8, 22, VERMELHO_FUNDO, 6)
    doc.texto(MARGEM + 6, y + 11, `Relatório cortado em ${dados.truncadoEm} execuções — estreite o período para ver o restante.`, {
      tamanho: 8.6, fonte: "helvB", cor: VERMELHO,
    })
  }
  return doc
}

export function gerarRelatorioPdf(dados: DadosRelatorio): Buffer {
  const contagem = montar(dados, null)
  return montar(dados, contagem.totalPaginas).gerar()
}
