// Mobilidade × Vale-Transporte + categorias Caju — PURO. Porta fiel do node
// "Definir Benefícios" (caju-QUINZENA) + "Resolver Interior" (Sábados Extras).
//
// Regra (não mexer sem conferir o WF):
//  - Código do contrato é pontilhado (ex "01.01.0004.01.0001"). base = partes[2].slice(-2),
//    composto = base + "." + partes[3].
//  - SEMPRE mobilidade: base "79" (TRE PB), "15" (Barco) ; composto "11.02" (SEDUC INTERIOR).
//  - eDoInterior = (Interior? === "SIM") OU eMobilidade.
//  - Caju: VR -> FOOD_AID ; VT -> TRANSPORTATION (mobilidade) | TRANSPORTATION_VOUCHER (normal).
//    (Categoria MOBILITY NÃO existe na Caju — ver memória.)

export const CATEGORIA_VR = "FOOD_AID" as const
export const CATEGORIA_VT_MOBILIDADE = "TRANSPORTATION" as const
export const CATEGORIA_VT_NORMAL = "TRANSPORTATION_VOUCHER" as const

const CONTRATOS_MOBILIDADE_BASE = ["79", "15"]
const COMPOSTOS_MOBILIDADE = ["11.02"]

export const MAPA_CONTRATOS: Record<string, string> = {
  "04": "DETRAN", "07": "ADM CONTATO", "07.03": "INSTITUTO PCD",
  "10": "SEDUC SEDE", "11": "SEDUC ESCOLA", "11.02": "SEDUC INTERIOR",
  "15": "BARCO CONTATO", "74": "CETAM", "78": "APRENDIZES",
  "79": "TRE PB", "84": "ESTAGIÁRIOS", "85": "SEMSA",
}

export interface CodigoParseado {
  base: string // 2 dígitos (ex "04", "79", "11")
  composto: string // base.sub (ex "11.02")
  nomeContrato: string // ex "04-DETRAN" | "11.02-SEDUC INTERIOR" | "CONTRATO_DESCONHECIDO"
}

/** Quebra o código pontilhado do RM em base/composto + resolve nome do contrato. */
export function parseCodigoContrato(codigo: string): CodigoParseado {
  const partes = String(codigo || "").split(".")
  const base = (partes[2] || "").slice(-2)
  const sub = partes[3] || ""
  const composto = base + "." + sub
  let nomeContrato = "CONTRATO_DESCONHECIDO"
  if (partes.length >= 4) {
    if (MAPA_CONTRATOS[composto]) nomeContrato = composto + "-" + MAPA_CONTRATOS[composto]
    else if (MAPA_CONTRATOS[base]) nomeContrato = base + "-" + MAPA_CONTRATOS[base]
    else nomeContrato = "COD-" + base
  }
  return { base, composto, nomeContrato }
}

/** true se o benefício VT deve ser tratado como mobilidade (TRANSPORTATION). */
export function ehMobilidade(codigo: string, interior?: string | boolean | null): boolean {
  const { base, composto } = parseCodigoContrato(codigo)
  const eMob = CONTRATOS_MOBILIDADE_BASE.includes(base) || COMPOSTOS_MOBILIDADE.includes(composto)
  const interiorSim =
    interior === true || String(interior ?? "").trim().toUpperCase() === "SIM"
  return interiorSim || eMob
}

/** Categoria Caju do VT conforme mobilidade. */
export function categoriaVT(mobilidade: boolean): typeof CATEGORIA_VT_MOBILIDADE | typeof CATEGORIA_VT_NORMAL {
  return mobilidade ? CATEGORIA_VT_MOBILIDADE : CATEGORIA_VT_NORMAL
}

export interface AmountCaju {
  category: string
  amount: number // centavos
}

/**
 * Monta o array `amounts` do pedido Caju (em centavos). VR -> FOOD_AID;
 * VT -> TRANSPORTATION|TRANSPORTATION_VOUCHER conforme mobilidade. Ignora valores <= 0.
 */
export function montarAmountsCaju(
  valorVR: number,
  valorVT: number,
  mobilidade: boolean,
): AmountCaju[] {
  const amounts: AmountCaju[] = []
  if (valorVR > 0) amounts.push({ category: CATEGORIA_VR, amount: Math.round(valorVR * 100) })
  if (valorVT > 0) amounts.push({ category: categoriaVT(mobilidade), amount: Math.round(valorVT * 100) })
  return amounts
}
