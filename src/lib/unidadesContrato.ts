export const CONTRATOS_OPERACIONAIS = [
  "SEMSA",
  "SEDUC ESCOLA",
  "SEDUC SEDE",
  "SEDUC INTERIOR",
  "DETRAN",
  "TRE PB",
  "CETAM",
] as const

export type ContratoOperacional = (typeof CONTRATOS_OPERACIONAIS)[number]

export const UNIDADE_NAO_ENCONTRADA = "UNIDADE NÃO ENCONTRADA"

export const UNIDADES_POR_CONTRATO: Record<ContratoOperacional, readonly string[]> = {
  CETAM: [
    "CETAM - ALVARAES",
    "CETAM - AUTAZES",
    "CETAM - BORBA",
    "CETAM - CAAPIRANGA",
    "CETAM - CARAUARI",
    "CETAM - CAREIRO CASTANHO",
    "CETAM - CODAJAS",
    "CETAM - GASTRONOMIA",
    "CETAM - INTERMITENTE",
    "CETAM - IRANDUBA",
    "CETAM - MANACAPURU",
    "CETAM - PARINTINS",
    "CETAM - PRES. FIGUEIREDO",
    "CETAM - RIO PRETO DA EVA",
    "CETAM - TABATINGA",
  ],
  DETRAN: ["DETRAN - INTERMITENTE"],
  "SEDUC SEDE": ["SEDUC - MANAUS"],
  "SEDUC ESCOLA": [
    "SEDUC - DEPOSITO V8",
    "SEDUC ESCOLA - CMPM V",
    "SEDUC ESCOLA - IRMÃ GABRIELLE",
    "SEDUC ESCOLA - MAYARA REDMAN",
    "SEDUC ESCOLA - PROF. JACIRA CABOCLO",
  ],
  "SEDUC INTERIOR": [
    "SEDUC INTERIOR - CETI AURISTELIO S DE OL",
    "SEDUC INTERIOR - CETI BENEDITA BARBOSA D",
    "SEDUC INTERIOR - CETI CALIXTO RIBEIRO",
    "SEDUC INTERIOR - CETI NEUZA ALVES",
    "SEDUC INTERIOR - E. E. ANTONIO FERREIRA",
    "SEDUC INTERIOR - E. E. DESMB. JOAO REBEL",
    "SEDUC INTERIOR - E. E. DOM BOSCO",
    "SEDUC INTERIOR - E. E. EDUARDO RIBEIRO",
    "SEDUC INTERIOR - E. E. I MANUEL JOAQUIM",
    "SEDUC INTERIOR - E. E. I PROFª ROSA CRUZ",
    "SEDUC INTERIOR - E. E. IZAURA TORRES",
    "SEDUC INTERIOR - E. E. JOSE CARLOS MARTI",
    "SEDUC INTERIOR - E. E. NOVO CEU",
    "SEDUC INTERIOR - E. E. PRESIDENTE VARGAS",
    "SEDUC INTERIOR - E. E. PROF JOHANNES PET",
    "SEDUC INTERIOR - E. E. ROMERITO BRITO",
    "SEDUC INTERIOR - E. E. SÃO JOSÉ",
    "SEDUC INTERIOR - E. E. VIDAL DE MELO",
    "SEDUC INTERIOR - E.E. DEUZALINA P. RIBEIRO",
    "SEDUC INTERIOR - SEDE DA COORDENADORIA",
  ],
  SEMSA: ["SEMSA - INTERMITENTE"],
  "TRE PB": ["TRE PB - INTERMITENTE"],
}

export const UNIDADES_OFICIAIS = Object.values(UNIDADES_POR_CONTRATO).flat()

export const UNIDADES_FORA_ESCOPO = [
  "ADMINISTRAÇÃO - INTERMITENTES",
  "LICENÇA MATERNIDADE",
  "IFAM TEFE",
  "AFASTADO INSS",
] as const

function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
}

export function contratoOperacionalValido(
  contrato: string | null | undefined,
): contrato is ContratoOperacional {
  const alvo = normalizar(String(contrato ?? ""))
  return CONTRATOS_OPERACIONAIS.some((c) => normalizar(c) === alvo)
}

export function contratoOperacionalCanonico(
  contrato: string | null | undefined,
): ContratoOperacional | null {
  const alvo = normalizar(String(contrato ?? ""))
  return CONTRATOS_OPERACIONAIS.find((c) => normalizar(c) === alvo) ?? null
}

export function unidadesParaContrato(
  contrato: string | null | undefined,
): readonly string[] {
  const canonico = contratoOperacionalCanonico(contrato)
  return canonico ? UNIDADES_POR_CONTRATO[canonico] : []
}

export function unidadePertenceAoContrato(
  contrato: string | null | undefined,
  unidade: string | null | undefined,
): boolean {
  const unidadeNorm = normalizar(String(unidade ?? ""))
  if (!unidadeNorm) return false
  return unidadesParaContrato(contrato).some((u) => normalizar(u) === unidadeNorm)
}
