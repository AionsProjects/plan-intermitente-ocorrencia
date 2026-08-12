// Gerador de PDF mínimo, sem dependência — mesma filosofia do clients/xlsx.ts.
//
// Cobre o que o relatório precisa e nada além: páginas A4 paisagem, texto nas 14
// fontes-base (Helvetica, Helvetica-Bold e Times-Bold — a serifada ecoa o display do
// app), retângulos com canto arredondado, linhas e medição de largura pra truncar com
// reticências. Fontes-base não são embutidas: o PDF sai pequeno e abre em qualquer
// leitor.
//
// Texto em WinAnsiEncoding — cobre TODO o pt-BR (á é í ó ú â ê ô ã õ ç à ü). O que não
// existir em WinAnsi vira "?" em vez de quebrar o arquivo.

export type FontePdf = "helv" | "helvB" | "timesB"

export interface CorRgb { r: number; g: number; b: number }

export const cor = (hex: string): CorRgb => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
})

// ── Métricas (AFM das fontes-base, por 1000 de em) ──────────────────────────
// Sem isto não há truncação honesta: cortar por nº de caracteres estoura coluna
// com "W" e desperdiça com "i".
const W_HELV =
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584"
const W_HELV_B =
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584"

function tabela(s: string): number[] {
  return s.split(" ").map(Number)
}
const LARGURAS: Record<FontePdf, number[]> = {
  helv: tabela(W_HELV),
  helvB: tabela(W_HELV_B),
  // Times-Bold só carrega o título (string fixa, sem truncação) — média serve.
  timesB: tabela(W_HELV_B),
}

/** Largura de um char (por 1000). Acentuado usa a largura da letra-base (á = a). */
function larguraChar(c: string, fonte: FontePdf): number {
  const t = LARGURAS[fonte]
  let cod = c.charCodeAt(0)
  if (cod < 32) return 0
  if (cod > 126) {
    const base = c.normalize("NFD")[0] ?? "?"
    cod = base.charCodeAt(0)
    if (cod < 32 || cod > 126) return 556
  }
  return t[cod - 32] ?? 556
}

export function medirTexto(s: string, tamanho: number, fonte: FontePdf = "helv"): number {
  let w = 0
  for (const c of s) w += larguraChar(c, fonte)
  return (w / 1000) * tamanho
}

/** Trunca com reticências pra caber em `larguraMax` pontos. */
export function truncar(s: string, larguraMax: number, tamanho: number, fonte: FontePdf = "helv"): string {
  if (medirTexto(s, tamanho, fonte) <= larguraMax) return s
  const el = "…"
  const wEl = medirTexto(el, tamanho, fonte)
  let out = ""
  let w = 0
  for (const c of s) {
    const wc = (larguraChar(c, fonte) / 1000) * tamanho
    if (w + wc + wEl > larguraMax) break
    out += c
    w += wc
  }
  return out + el
}

// ── WinAnsi ──────────────────────────────────────────────────────────────────
// 0xA0–0xFF do WinAnsi = Latin-1, então o charCode passa direto; a faixa
// 0x80–0x9F é a dos tipográficos, mapeada à mão.
const WINANSI_EXTRA: Record<number, number> = {
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x2018: 0x91, 0x2019: 0x92, // ' '
  0x201c: 0x93, 0x201d: 0x94, // " "
  0x2022: 0x95, // •
  0x2026: 0x85, // …
  0x20ac: 0x80, // €
}

function paraWinAnsi(s: string): Buffer {
  const bytes: number[] = []
  for (const c of s.normalize("NFC")) {
    const cod = c.codePointAt(0)!
    if (cod <= 0xff && !(cod >= 0x80 && cod <= 0x9f)) bytes.push(cod)
    else if (WINANSI_EXTRA[cod] != null) bytes.push(WINANSI_EXTRA[cod]!)
    else bytes.push(0x3f) // ?
  }
  return Buffer.from(bytes)
}

function escaparPdf(b: Buffer): Buffer {
  const out: number[] = []
  for (const byte of b) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c) // ( ) \
    out.push(byte)
  }
  return Buffer.from(out)
}

const n3 = (v: number): string => (Math.round(v * 1000) / 1000).toString()

// ── Documento ────────────────────────────────────────────────────────────────

export const A4_PAISAGEM = { largura: 841.89, altura: 595.28 } as const

/**
 * Uma página por vez, coordenadas do PDF (origem no canto INFERIOR esquerdo — quem
 * monta layout de cima pra baixo converte com `altura - y`).
 */
export class DocumentoPdf {
  readonly largura: number
  readonly altura: number
  #paginas: string[][] = []
  #atual: string[] | null = null

  constructor(tamanho: { largura: number; altura: number } = A4_PAISAGEM) {
    this.largura = tamanho.largura
    this.altura = tamanho.altura
  }

  novaPagina(): void {
    this.#atual = []
    this.#paginas.push(this.#atual)
  }

  get totalPaginas(): number {
    return this.#paginas.length
  }

  #op(s: string): void {
    if (!this.#atual) this.novaPagina()
    this.#atual!.push(s)
  }

  texto(
    x: number,
    yTopo: number,
    s: string,
    o: { tamanho?: number; fonte?: FontePdf; cor?: CorRgb; alinharDireita?: number } = {},
  ): void {
    const tamanho = o.tamanho ?? 9
    const fonte = o.fonte ?? "helv"
    const c = o.cor ?? { r: 0.1, g: 0.11, b: 0.14 }
    let px = x
    if (o.alinharDireita != null) px = o.alinharDireita - medirTexto(s, tamanho, fonte)
    const y = this.altura - yTopo - tamanho * 0.78 // yTopo = topo visual do texto
    const bytes = escaparPdf(paraWinAnsi(s)).toString("latin1")
    this.#op(
      `BT /${fonte} ${n3(tamanho)} Tf ${n3(c.r)} ${n3(c.g)} ${n3(c.b)} rg ${n3(px)} ${n3(y)} Td (${bytes}) Tj ET`,
    )
  }

  /** Retângulo preenchido, canto arredondado opcional. yTopo/altura em coordenada visual. */
  retangulo(x: number, yTopo: number, w: number, h: number, c: CorRgb, raio = 0): void {
    const y = this.altura - yTopo - h
    if (raio <= 0) {
      this.#op(`${n3(c.r)} ${n3(c.g)} ${n3(c.b)} rg ${n3(x)} ${n3(y)} ${n3(w)} ${n3(h)} re f`)
      return
    }
    const r = Math.min(raio, w / 2, h / 2)
    const k = r * 0.5523 // aproximação de arco por Bézier
    const p = (vx: number, vy: number) => `${n3(vx)} ${n3(vy)}`
    this.#op(
      `${n3(c.r)} ${n3(c.g)} ${n3(c.b)} rg ` +
      `${p(x + r, y)} m ` +
      `${p(x + w - r, y)} l ${p(x + w - r + k, y)} ${p(x + w, y + r - k)} ${p(x + w, y + r)} c ` +
      `${p(x + w, y + h - r)} l ${p(x + w, y + h - r + k)} ${p(x + w - r + k, y + h)} ${p(x + w - r, y + h)} c ` +
      `${p(x + r, y + h)} l ${p(x + r - k, y + h)} ${p(x, y + h - r + k)} ${p(x, y + h - r)} c ` +
      `${p(x, y + r)} l ${p(x, y + r - k)} ${p(x + r - k, y)} ${p(x + r, y)} c f`,
    )
  }

  linha(x1: number, yTopo1: number, x2: number, yTopo2: number, c: CorRgb, espessura = 0.7): void {
    this.#op(
      `${n3(c.r)} ${n3(c.g)} ${n3(c.b)} RG ${n3(espessura)} w ` +
      `${n3(x1)} ${n3(this.altura - yTopo1)} m ${n3(x2)} ${n3(this.altura - yTopo2)} l S`,
    )
  }

  circulo(cx: number, cyTopo: number, raio: number, c: CorRgb): void {
    const cy = this.altura - cyTopo
    const k = raio * 0.5523
    const p = (vx: number, vy: number) => `${n3(vx)} ${n3(vy)}`
    this.#op(
      `${n3(c.r)} ${n3(c.g)} ${n3(c.b)} rg ` +
      `${p(cx + raio, cy)} m ` +
      `${p(cx + raio, cy + k)} ${p(cx + k, cy + raio)} ${p(cx, cy + raio)} c ` +
      `${p(cx - k, cy + raio)} ${p(cx - raio, cy + k)} ${p(cx - raio, cy)} c ` +
      `${p(cx - raio, cy - k)} ${p(cx - k, cy - raio)} ${p(cx, cy - raio)} c ` +
      `${p(cx + k, cy - raio)} ${p(cx + raio, cy - k)} ${p(cx + raio, cy)} c f`,
    )
  }

  /** Monta o arquivo. Streams sem compressão — grep-ável em teste, e texto comprime mal o custo. */
  gerar(): Buffer {
    const objetos: Buffer[] = []
    const push = (s: string | Buffer): number => {
      objetos.push(Buffer.isBuffer(s) ? s : Buffer.from(s, "latin1"))
      return objetos.length // ids 1-based
    }

    const FONTES: Array<[FontePdf, string]> = [
      ["helv", "Helvetica"],
      ["helvB", "Helvetica-Bold"],
      ["timesB", "Times-Bold"],
    ]
    const fonteIds = new Map<FontePdf, number>()
    for (const [chave, nome] of FONTES) {
      fonteIds.set(
        chave,
        push(`<< /Type /Font /Subtype /Type1 /BaseFont /${nome} /Encoding /WinAnsiEncoding >>`),
      )
    }
    const recursos =
      `<< /Font << ` +
      FONTES.map(([chave]) => `/${chave} ${fonteIds.get(chave)} 0 R`).join(" ") +
      ` >> >>`

    const pageIds: number[] = []
    const pagesId = objetos.length + this.#paginas.length * 2 + 1 // reservado após streams+pages
    for (const ops of this.#paginas) {
      const conteudo = Buffer.from(ops.join("\n"), "latin1")
      const streamId = push(
        Buffer.concat([
          Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`, "latin1"),
          conteudo,
          Buffer.from("\nendstream", "latin1"),
        ]),
      )
      pageIds.push(
        push(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n3(this.largura)} ${n3(this.altura)}] ` +
          `/Resources ${recursos} /Contents ${streamId} 0 R >>`,
        ),
      )
    }
    const pagesReal = push(
      `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] >>`,
    )
    if (pagesReal !== pagesId) throw new Error(`pdf: id de Pages divergiu (${pagesReal} != ${pagesId})`)
    const catalogoId = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

    const partes: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")]
    const offsets: number[] = [0]
    let pos = partes[0]!.length
    objetos.forEach((corpo, idx) => {
      offsets.push(pos)
      const obj = Buffer.concat([
        Buffer.from(`${idx + 1} 0 obj\n`, "latin1"),
        corpo,
        Buffer.from("\nendobj\n", "latin1"),
      ])
      partes.push(obj)
      pos += obj.length
    })
    const xrefPos = pos
    const xref =
      `xref\n0 ${objetos.length + 1}\n` +
      `0000000000 65535 f \n` +
      offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
      `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
    partes.push(Buffer.from(xref, "latin1"))
    return Buffer.concat(partes)
  }
}
