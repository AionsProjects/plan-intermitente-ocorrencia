// Relatório de pagamento em PDF — o documento que fica no Drive e que o financeiro consulta.
//
// Por que existe: hoje o que sobra de um pagamento é um TXT ("comprovante técnico") que ninguém
// lê como documento, e o lado do CRÉDITO não deixa rastro nenhum. Este PDF junta, numa folha, o
// que o DP precisa pra conferir sem abrir cinco abas: quem, quanto, quanto foi abatido de dívida,
// quais pedidos na Caju, quais IDFINANC no RM.
//
// NÃO é a nota de débito da Caju — essa sai do painel deles, depois que o crédito é confirmado.
// A frase está no rodapé de propósito: um documento nosso com cara de oficial, sem essa ressalva,
// vira "nota fiscal" na mão de quem só bate o olho.
//
// Mesma linguagem visual do relatório de atividade (faixa fumê + fio dourado + serifa no título),
// mas em RETRATO quando é uma pessoa só: é a forma de documento. O mensal, que carrega tabela de
// N pessoas, sai em paisagem.
import { notaDebitoUrl, summaryUrlCaju } from "../clients/caju.js"
import { A4_PAISAGEM, A4_RETRATO, DocumentoPdf, cor, truncar } from "../clients/pdf.js"

export interface PessoaRelatorioPagamento {
  nome: string
  chapa?: string | null
  cpf?: string | null
  diasVR?: number | null
  diasVT?: number | null
  vrDia?: number | null
  vtDia?: number | null
  brutoVR?: number | null
  brutoVT?: number | null
  descontoVR?: number | null
  descontoVT?: number | null
  liquidoVR?: number | null
  liquidoVT?: number | null
  creditoVR?: number | null
  creditoVT?: number | null
  pixVR?: number | null
  pixVT?: number | null
}

export interface PedidoRelatorioPagamento {
  natureza: "CRÉDITO" | "BOLETO"
  /** "VR", "VT" ou "VR + VT" — no pontual um pedido carrega os dois. */
  beneficio: string
  orderId: string
  valor: number
  resumoUrl: string
  /** Nota de débito (só faz sentido no crédito, e só depois de confirmado no painel). */
  notaUrl?: string
}

export interface DividaRelatorioPagamento {
  descontoMondayItemId: string
  vr: number
  vt: number
  status?: "PARCIAL" | "FINALIZADO"
  residualVR?: number
  residualVT?: number
  url?: string
}

export interface DadosRelatorioPagamento {
  origem: "PONTUAL" | "MENSAL"
  contrato: string
  /** "01/08/2026 a 05/08/2026" no pontual; "AGOSTO/2026" no mensal. */
  periodoLabel: string
  /** ISO — o que vai nas colunas de data do board e no nome do arquivo. */
  dataInicio: string
  dataFim: string
  competenciaLabel?: string | null
  regraAplicada?: string | null
  pessoas: PessoaRelatorioPagamento[]
  pedidos: PedidoRelatorioPagamento[]
  idfinancVR?: string | null
  idfinancVT?: string | null
  solicitacaoUrl?: string | null
  pastaDriveUrl?: string | null
  dividas: DividaRelatorioPagamento[]
  /** Quem/o que gerou — "automação (felipeta)" ou o e-mail do admin no back-fill. */
  geradoPor: string
  /** Data/hora de geração. Injetada pra o PDF ser determinístico em teste. */
  geradoEm: Date
}

// Paleta — a mesma do relatório de atividade (dourado do tema claro, que segura contraste no papel).
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
const AMARELO = cor("#a87a16")

const MARGEM = 40
const ALTURA_LINHA = 16

const r2 = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100

export const fmtBrl = (v: unknown): string =>
  `R$ ${r2(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** ISO puro → dd/MM/yyyy sem passar por Date (fuso não tem o que opinar sobre data seca). */
export function fmtDataIso(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—"
}

const fmtManaus = (d: Date): string =>
  d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Manaus" })

/** Soma o que a pessoa levou por benefício — usado no total do rodapé da tabela. */
function totais(pessoas: PessoaRelatorioPagamento[]): Record<string, number> {
  const s = (k: keyof PessoaRelatorioPagamento): number =>
    r2(pessoas.reduce((a, p) => a + (Number(p[k]) || 0), 0))
  return {
    brutoVR: s("brutoVR"), brutoVT: s("brutoVT"),
    descontoVR: s("descontoVR"), descontoVT: s("descontoVT"),
    liquidoVR: s("liquidoVR"), liquidoVT: s("liquidoVT"),
    creditoVR: s("creditoVR"), creditoVT: s("creditoVT"),
    pixVR: s("pixVR"), pixVT: s("pixVT"),
  }
}

// ---------------------------------------------------------------------------
// Blocos de layout — cada um recebe `y` e devolve o `y` seguinte (padrão do
// relatorioAtividade.ts). Nada de estado global: a largura sai do doc, porque
// pontual sai em retrato e mensal em paisagem.
// ---------------------------------------------------------------------------

function cabecalhoGrande(doc: DocumentoPdf, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  doc.retangulo(0, 0, LARG, 84, NAVY)
  doc.retangulo(0, 80, LARG, 4, NAVY_2)
  doc.retangulo(0, 84, LARG, 2.2, OURO)

  doc.texto(MARGEM, 16, `INTERMITENTE ${d.origem}`, { tamanho: 8, fonte: "helvB", cor: OURO_CLARO })
  doc.texto(MARGEM, 31, "Relatório de pagamento", { tamanho: 24, fonte: "timesB", cor: BRANCO })

  const dir = LARG - MARGEM
  doc.texto(0, 20, d.contrato, { tamanho: 11, fonte: "helvB", cor: BRANCO, alinharDireita: dir })
  doc.texto(0, 37, d.periodoLabel, { tamanho: 9, cor: BRANCO_70, alinharDireita: dir })
  doc.texto(0, 52, `Gerado ${fmtManaus(d.geradoEm)} (Manaus) · ${d.geradoPor}`, {
    tamanho: 7.5, cor: BRANCO_70, alinharDireita: dir,
  })
  return 104
}

function cabecalhoCurto(doc: DocumentoPdf, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  doc.retangulo(0, 0, LARG, 32, NAVY)
  doc.retangulo(0, 32, LARG, 1.6, OURO)
  doc.texto(MARGEM, 9, "Relatório de pagamento", { tamanho: 11, fonte: "timesB", cor: BRANCO })
  doc.texto(0, 12, `${d.contrato} · ${d.periodoLabel}`, { tamanho: 8, cor: BRANCO_70, alinharDireita: LARG - MARGEM })
  return 48
}

function tituloSecao(doc: DocumentoPdf, y: number, texto: string): number {
  doc.texto(MARGEM, y, texto.toUpperCase(), { tamanho: 7.5, fonte: "helvB", cor: APAGADO })
  doc.linha(MARGEM, y + 12, doc.largura - MARGEM, y + 12, FIO, 0.7)
  return y + 20
}

/** Identificação: nome grande + linha de metadados. No mensal vira "N intermitentes". */
function identificacao(doc: DocumentoPdf, y: number, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  doc.retangulo(MARGEM - 6, y - 6, LARG - 2 * MARGEM + 12, 52, ZEBRA, 8)
  const p = d.pessoas[0]
  const titulo = d.pessoas.length === 1 && p
    ? p.nome
    : `${d.pessoas.length} intermitentes — ${d.contrato}`
  doc.texto(MARGEM + 4, y + 2, truncar(titulo, LARG - 2 * MARGEM - 16, 15, "timesB"), {
    tamanho: 15, fonte: "timesB", cor: TINTA,
  })
  const meta = d.pessoas.length === 1 && p
    ? [
        p.chapa ? `Chapa ${p.chapa}` : null,
        p.cpf ? `CPF ${p.cpf}` : null,
        d.contrato,
        d.competenciaLabel ? `Competência ${d.competenciaLabel}` : null,
        d.regraAplicada ? `Regra ${d.regraAplicada}` : null,
      ].filter(Boolean).join("   ·   ")
    : [d.periodoLabel, d.competenciaLabel ? `Competência ${d.competenciaLabel}` : null]
        .filter(Boolean).join("   ·   ")
  doc.texto(MARGEM + 4, y + 26, truncar(meta, LARG - 2 * MARGEM - 16, 8.6), { tamanho: 8.6, cor: APAGADO })
  return y + 62
}

/**
 * Tabela do dinheiro: uma linha por benefício + total. É a resposta pra "por que esse valor?" —
 * apurado, o que a dívida comeu, o que sobrou, e como esse líquido foi entregue (crédito × boleto).
 */
function tabelaDinheiro(doc: DocumentoPdf, y: number, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  const util = LARG - 2 * MARGEM
  const wRot = 78
  const wCol = (util - wRot) / 5
  const cabec = ["APURADO", "DESCONTO", "LÍQUIDO", "CRÉDITO CAJU", "BOLETO PIX"]

  y = tituloSecao(doc, y, "Valores")
  let x = MARGEM + wRot
  for (const c of cabec) {
    doc.texto(0, y, c, { tamanho: 7, fonte: "helvB", cor: APAGADO, alinharDireita: x + wCol - 6 })
    x += wCol
  }
  y += 14

  const t = totais(d.pessoas)
  const linhas: Array<{ rotulo: string; vals: number[]; forte?: boolean }> = [
    { rotulo: "VR", vals: [t.brutoVR!, t.descontoVR!, t.liquidoVR!, t.creditoVR!, t.pixVR!] },
    { rotulo: "VT", vals: [t.brutoVT!, t.descontoVT!, t.liquidoVT!, t.creditoVT!, t.pixVT!] },
    {
      rotulo: "TOTAL",
      forte: true,
      vals: [
        r2(t.brutoVR! + t.brutoVT!), r2(t.descontoVR! + t.descontoVT!), r2(t.liquidoVR! + t.liquidoVT!),
        r2(t.creditoVR! + t.creditoVT!), r2(t.pixVR! + t.pixVT!),
      ],
    },
  ]
  for (const l of linhas) {
    if (l.forte) doc.linha(MARGEM, y - 4, LARG - MARGEM, y - 4, OURO, 1.1)
    doc.texto(MARGEM, y, l.rotulo, { tamanho: l.forte ? 9 : 8.6, fonte: "helvB", cor: l.forte ? TINTA : APAGADO })
    let cx = MARGEM + wRot
    l.vals.forEach((v, i) => {
      // Desconto em âmbar: é o número que gera pergunta ("por que recebeu menos?").
      const c = i === 1 && v > 0 ? AMARELO : TINTA
      doc.texto(0, y, fmtBrl(v), {
        tamanho: l.forte ? 9 : 8.6,
        fonte: l.forte ? "helvB" : "helv",
        cor: c,
        alinharDireita: cx + wCol - 6,
      })
      cx += wCol
    })
    y += l.forte ? 20 : 17
  }
  // Dias/valor-dia só no pontual (1 pessoa) — no mensal cada um tem os seus.
  const p = d.pessoas.length === 1 ? d.pessoas[0] : null
  if (p) {
    const base = [
      p.diasVR != null ? `${p.diasVR} dia(s) VR × ${fmtBrl(p.vrDia)}` : null,
      p.diasVT != null ? `${p.diasVT} dia(s) VT × ${fmtBrl(p.vtDia)}` : null,
    ].filter(Boolean).join("   ·   ")
    if (base) {
      doc.texto(MARGEM, y, base, { tamanho: 7.8, cor: APAGADO })
      y += 16
    }
  }
  return y + 6
}

/** Pedidos na Caju — id, valor e os links. Sem pedido nenhum, diz isso em vez de sumir. */
function blocoPedidos(doc: DocumentoPdf, y: number, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  y = tituloSecao(doc, y, "Pedidos na Caju")
  if (!d.pedidos.length) {
    doc.texto(MARGEM, y, "Nenhum pedido gerado — pagamento sem valor a creditar.", { tamanho: 8.6, cor: APAGADO })
    return y + 22
  }
  for (const pd of d.pedidos) {
    const cabecalho = `${pd.natureza} · ${pd.beneficio} · ${fmtBrl(pd.valor)}`
    doc.circulo(MARGEM + 3, y + 5, 3, pd.natureza === "BOLETO" ? OURO : VERDE)
    doc.texto(MARGEM + 12, y, cabecalho, { tamanho: 9, fonte: "helvB", cor: TINTA })
    doc.texto(0, y, `pedido ${pd.orderId}`, { tamanho: 7.5, cor: APAGADO, alinharDireita: LARG - MARGEM })
    y += 14
    doc.texto(MARGEM + 12, y, truncar(pd.resumoUrl, LARG - 2 * MARGEM - 20, 7.5), { tamanho: 7.5, cor: APAGADO })
    y += 12
    if (pd.natureza === "CRÉDITO") {
      const nota = pd.notaUrl
        ? truncar(`Nota de débito  ${pd.notaUrl}`, LARG - 2 * MARGEM - 20, 7.5)
        : "Nota de débito  disponível no painel da Caju depois que o crédito for confirmado."
      doc.texto(MARGEM + 12, y, nota, { tamanho: 7.5, cor: APAGADO })
      y += 12
    }
    y += 4
  }
  return y + 4
}

/** RM + destinos: onde o lançamento financeiro e os arquivos foram parar. */
function blocoRastro(doc: DocumentoPdf, y: number, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  y = tituloSecao(doc, y, "Rastro")
  const itens: Array<[string, string]> = []
  const idf = [d.idfinancVR ? `VR ${d.idfinancVR}` : null, d.idfinancVT ? `VT ${d.idfinancVT}` : null]
    .filter(Boolean).join("   ·   ")
  itens.push(["IDFINANC (RM)", idf || "sem lançamento financeiro — pagamento sem boleto"])
  if (d.solicitacaoUrl) itens.push(["Solicitação de Pagamento", d.solicitacaoUrl])
  if (d.pastaDriveUrl) itens.push(["Pasta no Drive", d.pastaDriveUrl])
  for (const [rot, val] of itens) {
    doc.texto(MARGEM, y, rot, { tamanho: 7.8, fonte: "helvB", cor: APAGADO })
    doc.texto(MARGEM + 118, y, truncar(val, LARG - 2 * MARGEM - 126, 7.8), { tamanho: 7.8, cor: TINTA })
    y += 14
  }
  return y + 8
}

/** Dívidas abatidas — o "por que recebeu menos", com o item de onde saiu. */
function blocoDividas(doc: DocumentoPdf, y: number, d: DadosRelatorioPagamento): number {
  const LARG = doc.largura
  const usadas = d.dividas.filter((x) => (Number(x.vr) || 0) > 0 || (Number(x.vt) || 0) > 0)
  if (!usadas.length) return y
  y = tituloSecao(doc, y, "Dívidas abatidas")
  // Teto: o bloco não pagina, e um contrato mensal com 40 dívidas correria pra fora da folha.
  // Quem precisa da lista inteira tem o board — aqui o que importa é a ordem de grandeza.
  const TETO = 12
  for (const dv of usadas.slice(0, TETO)) {
    const abatido = [dv.vr > 0 ? `VR ${fmtBrl(dv.vr)}` : null, dv.vt > 0 ? `VT ${fmtBrl(dv.vt)}` : null]
      .filter(Boolean).join(" + ")
    let desfecho = ""
    if (dv.status === "FINALIZADO") desfecho = " — QUITADA"
    else if (dv.status === "PARCIAL") {
      const resta = [
        (dv.residualVR ?? 0) > 0 ? `VR ${fmtBrl(dv.residualVR)}` : null,
        (dv.residualVT ?? 0) > 0 ? `VT ${fmtBrl(dv.residualVT)}` : null,
      ].filter(Boolean).join(" + ")
      desfecho = resta ? ` — ainda resta ${resta}` : " — quitada"
    }
    doc.texto(MARGEM, y, `• ${abatido}${desfecho}`, { tamanho: 8.6, cor: TINTA })
    y += 12
    doc.texto(MARGEM + 10, y, truncar(dv.url ?? `item ${dv.descontoMondayItemId}`, LARG - 2 * MARGEM - 20, 7.5), {
      tamanho: 7.5, cor: APAGADO,
    })
    y += 15
  }
  if (usadas.length > TETO) {
    doc.texto(MARGEM, y, `… e mais ${usadas.length - TETO} dívida(s) — lista completa no board de Desconto.`, {
      tamanho: 7.8, cor: APAGADO,
    })
    y += 15
  }
  return y + 6
}

// Tabela por pessoa (só no mensal). Colunas em paisagem.
const COLS_PESSOA: Array<{ titulo: string; w: number; dir?: boolean }> = [
  { titulo: "INTERMITENTE", w: 190 },
  { titulo: "CHAPA", w: 55 },
  { titulo: "CPF", w: 88 },
  { titulo: "VR", w: 72, dir: true },
  { titulo: "VT", w: 72, dir: true },
  { titulo: "DESCONTO", w: 78, dir: true },
  { titulo: "CRÉDITO", w: 72, dir: true },
  { titulo: "BOLETO", w: 72, dir: true },
]

function cabecalhoPessoas(doc: DocumentoPdf, y: number): number {
  let x = MARGEM
  for (const c of COLS_PESSOA) {
    doc.texto(c.dir ? 0 : x, y, c.titulo, {
      tamanho: 7, fonte: "helvB", cor: APAGADO,
      ...(c.dir ? { alinharDireita: x + c.w - 6 } : {}),
    })
    x += c.w
  }
  doc.linha(MARGEM, y + 12, doc.largura - MARGEM, y + 12, OURO, 1.1)
  return y + 17
}

function linhaPessoa(doc: DocumentoPdf, y: number, p: PessoaRelatorioPagamento, zebra: boolean): void {
  const LARG = doc.largura
  if (zebra) doc.retangulo(MARGEM - 4, y - 3, LARG - 2 * MARGEM + 8, ALTURA_LINHA, ZEBRA, 4)
  const cels: string[] = [
    p.nome,
    p.chapa ?? "—",
    p.cpf ?? "—",
    fmtBrl(p.liquidoVR),
    fmtBrl(p.liquidoVT),
    fmtBrl((Number(p.descontoVR) || 0) + (Number(p.descontoVT) || 0)),
    fmtBrl((Number(p.creditoVR) || 0) + (Number(p.creditoVT) || 0)),
    fmtBrl((Number(p.pixVR) || 0) + (Number(p.pixVT) || 0)),
  ]
  let x = MARGEM
  cels.forEach((texto, i) => {
    const c = COLS_PESSOA[i]!
    doc.texto(c.dir ? 0 : x, y, truncar(texto, c.w - 8, 8.4), {
      tamanho: 8.4, cor: TINTA,
      ...(c.dir ? { alinharDireita: x + c.w - 6 } : {}),
    })
    x += c.w
  })
}

function rodape(doc: DocumentoPdf, pagina: number, total: number): void {
  const LARG = doc.largura
  const yBase = doc.altura - 30
  doc.linha(MARGEM, yBase - 8, LARG - MARGEM, yBase - 8, FIO, 0.7)
  // A ressalva não é rodapé decorativo: sem ela o documento passa por nota fiscal da Caju.
  doc.texto(MARGEM, yBase - 2, "Documento gerado pela automação do Plano de Intermitentes — não é a nota de débito da Caju.", {
    tamanho: 7, cor: APAGADO,
  })
  doc.texto(0, yBase - 2, `página ${pagina} de ${total}`, {
    tamanho: 7, cor: APAGADO, alinharDireita: LARG - MARGEM,
  })
}

/**
 * Flui o documento. `totalPaginas` nulo = passada de CONTAGEM (sem rodapé); preenchido = passada
 * final, carimbando "página X de Y". Mesmo motivo do relatório de atividade: o total só se conhece
 * depois de fluir, e refluir um documento barato custa menos que reabrir página fechada.
 */
function montar(d: DadosRelatorioPagamento, totalPaginas: number | null): DocumentoPdf {
  const umaPessoa = d.pessoas.length <= 1
  const doc = new DocumentoPdf(umaPessoa ? A4_RETRATO : A4_PAISAGEM)
  doc.novaPagina()
  let pagina = 1
  // Última linha que ainda cabe: o topo dela + ALTURA_LINHA tem de terminar ANTES do fio do
  // rodapé (altura - 38), senão a última linha da página passa por cima dele.
  const limiteY = doc.altura - 38 - ALTURA_LINHA - 2

  let y = cabecalhoGrande(doc, d)
  y = identificacao(doc, y, d)
  y = tabelaDinheiro(doc, y, d)
  y = blocoPedidos(doc, y, d)
  y = blocoRastro(doc, y, d)
  y = blocoDividas(doc, y, d)
  if (totalPaginas != null) rodape(doc, pagina, totalPaginas)

  if (!umaPessoa) {
    y = tituloSecao(doc, y, `Intermitentes (${d.pessoas.length})`)
    y = cabecalhoPessoas(doc, y)
    let zebra = false
    for (const p of d.pessoas) {
      if (y + ALTURA_LINHA > limiteY) {
        doc.novaPagina()
        pagina++
        y = cabecalhoCurto(doc, d)
        y = cabecalhoPessoas(doc, y)
        if (totalPaginas != null) rodape(doc, pagina, totalPaginas)
        zebra = false
      }
      linhaPessoa(doc, y, p, zebra)
      zebra = !zebra
      y += ALTURA_LINHA
    }
  }
  return doc
}

export function gerarRelatorioPagamentoPdf(d: DadosRelatorioPagamento): Buffer {
  const contagem = montar(d, null)
  return montar(d, contagem.totalPaginas).gerar()
}

/**
 * Sanitiza nome de arquivo. Cópia local de propósito: importar `safeNomeArquivo` do mensal
 * criaria ciclo em runtime (driveEfeitos precisa GERAR o PDF, e este módulo é quem gera).
 */
function safeNome(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

/** Nome do arquivo no Drive — prefixo `relatorio-pagamento` pra ordenar junto na pasta. */
export function nomeArquivoRelatorio(d: DadosRelatorioPagamento): string {
  const quem = d.pessoas.length === 1 && d.pessoas[0] ? safeNome(d.pessoas[0].nome) : safeNome(d.contrato)
  return `relatorio-pagamento-${d.origem.toLowerCase()}-${quem}-${d.dataInicio}.pdf`
}

export interface EntradaPedidoRelatorio {
  natureza: "CRÉDITO" | "BOLETO"
  beneficio: "VR" | "VT"
  orderId: string
}

/**
 * Converte ids de pedido em linhas de relatório.
 *
 * Trata os DOIS formatos que existem em produção: o atual do pontual (UM pedido por natureza,
 * carregando VR e VT no mesmo `amounts[]`) e o do mensal / o antigo do pontual (um pedido POR
 * benefício). Id único nos dois benefícios = uma linha "VR + VT" com o valor somado; ids
 * distintos = uma linha por benefício, cada uma com o SEU valor.
 *
 * Sem essa distinção os 5 primeiros pagamentos de 13/08 (formato antigo) sairiam com o valor
 * dobrado — duas linhas carregando o total da natureza.
 */
export function montarPedidosRelatorio(
  entradas: EntradaPedidoRelatorio[],
  valores: { creditoVR: number; creditoVT: number; pixVR: number; pixVT: number },
): PedidoRelatorioPagamento[] {
  const out: PedidoRelatorioPagamento[] = []
  for (const natureza of ["CRÉDITO", "BOLETO"] as const) {
    const daNatureza = entradas.filter((e) => e.natureza === natureza && e.orderId)
    if (!daNatureza.length) continue
    const vr = r2(natureza === "CRÉDITO" ? valores.creditoVR : valores.pixVR)
    const vt = r2(natureza === "CRÉDITO" ? valores.creditoVT : valores.pixVT)
    const ids = [...new Set(daNatureza.map((e) => e.orderId))]
    if (ids.length === 1) {
      const beneficio = [vr > 0 ? "VR" : null, vt > 0 ? "VT" : null].filter(Boolean).join(" + ") || "VR"
      out.push(linhaPedido(natureza, beneficio, ids[0]!, r2(vr + vt)))
      continue
    }
    for (const id of ids) {
      const bens = [...new Set(daNatureza.filter((e) => e.orderId === id).map((e) => e.beneficio))]
      out.push(linhaPedido(natureza, bens.join(" + "), id, r2(bens.reduce((a, b) => a + (b === "VR" ? vr : vt), 0))))
    }
  }
  return out
}

function linhaPedido(
  natureza: "CRÉDITO" | "BOLETO",
  beneficio: string,
  orderId: string,
  valor: number,
): PedidoRelatorioPagamento {
  const nota = natureza === "CRÉDITO" ? notaDebitoUrl(orderId) : ""
  return {
    natureza,
    beneficio,
    orderId,
    valor,
    resumoUrl: summaryUrlCaju(orderId),
    ...(nota ? { notaUrl: nota } : {}),
  }
}
