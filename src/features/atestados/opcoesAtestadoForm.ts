import {
  UNIDADE_NAO_ENCONTRADA as UNIDADE_NAO_ENCONTRADA_COMPARTILHADA,
  unidadesParaContrato as unidadesCompartilhadasParaContrato,
} from "@/lib/unidadesContrato"

/**
 * Constantes hardcoded das opções do formulário "Atestado Ponta"
 * (board Controle de Atestados, ID 18298015951, view 223887647).
 *
 * TODO: substituir por endpoint dinâmico `GET /atestado-form-opcoes`
 * que parseia `settings_str` das colunas do monday. Padrão igual ao
 * `useOpcoesConvocacao` do /convocar (WF9). Cada constante anota o
 * `column_id` correspondente pra facilitar mapeamento.
 */

/** Coluna monday: `single_select5yq25pm` */
export const MODALIDADES_CONTRATO = [
  { id: 0, label: "CELETISTA" },
  { id: 1, label: "INTERMITENTE" },
] as const

export type ModalidadeContrato = (typeof MODALIDADES_CONTRATO)[number]["label"]

/** Coluna monday: `sele__o_individual__1` */
export const TIPOS_DOCUMENTACAO = [
  { id: 1, label: "Atestado Médico" },
  { id: 0, label: "Atestado Odontológico" },
  { id: 2, label: "Atestado Psicológico" },
  { id: 3, label: "Atestado Ocupacional" },
  { id: 19, label: "Atestado de acompanhamento" },
  { id: 7, label: "Atestado Escolar (Aprendiz)" },
  { id: 17, label: "Declaração Médica" },
  { id: 101, label: "Declaração Acompanhamento" },
  { id: 4, label: "Licença-nojo (Óbito)" },
  { id: 6, label: "Licença-Maternidade" },
  { id: 8, label: "Licença-Paternidade" },
  { id: 9, label: "Licença Gala (Casamento)" },
  { id: 10, label: "Licença para Doação de Sangue" },
  { id: 11, label: "Licença Eleitoral" },
  { id: 12, label: "Licença para Serviço Militar" },
  { id: 13, label: "Licença para Comparação à Justiça" },
  { id: 14, label: "Licença para Tratamento de Saúde" },
  { id: 15, label: "Licença para Atividades Sindicais" },
  { id: 16, label: "Licença por Adoção" },
] as const

export type TipoDocumentacaoLabel = (typeof TIPOS_DOCUMENTACAO)[number]["label"]

/** Tipos que disparam o campo "Acompanhante" como obrigatório/visível. */
export const TIPOS_COM_ACOMPANHANTE: ReadonlySet<TipoDocumentacaoLabel> = new Set([
  "Atestado de acompanhamento",
  "Declaração Acompanhamento",
])

/** Tipos que computam desconto VR/VT (regra antiga de atestado integral).
 *  Outros tipos (licenças, declarações) deixam o backend decidir. */
export const TIPOS_COM_DESCONTO_INTEGRAL: ReadonlySet<TipoDocumentacaoLabel> = new Set([
  "Atestado Médico",
  "Atestado Odontológico",
  "Atestado Psicológico",
  "Atestado Ocupacional",
  "Atestado de acompanhamento",
])

/** Coluna monday: `single_selectkiwkh2d` */
export const HORARIOS_ALMOCO = [
  { id: 0, label: "Tirou" },
  { id: 1, label: "Não tirou" },
  { id: 2, label: "NDA" },
] as const

export type HorarioAlmocoLabel = (typeof HORARIOS_ALMOCO)[number]["label"]

/** Coluna monday: `sele__o_individual8__1` */
export const ACOMPANHANTES = [
  { id: 4, label: "Sem acompanhamento" },
  { id: 0, label: "Ascendentes diretos (Pais e Avós)" },
  { id: 1, label: "Conjugação (marido ou esposa)" },
  { id: 2, label: "Descendentes diretos (Filhos e netos)" },
  { id: 3, label: "Irmão (ã)" },
  { id: 7, label: "Dependente legal (Pessoa registrada como dependente econômico do trabalhador.)" },
] as const

export type AcompanhanteLabel = (typeof ACOMPANHANTES)[number]["label"]

/** Coluna monday: `department` */
export const CONTRATOS_COLABORADOR = [
  { id: 0, label: "SEDUC ESCOLA" },
  { id: 1, label: "SEDUC COORDENADORIAS" },
  { id: 6, label: "SEDUC SEDE" },
  { id: 16, label: "SEDUC INTERIOR" },
  { id: 2, label: "TRE PB" },
  { id: 3, label: "SEMSA" },
  { id: 4, label: "DETRAN" },
  { id: 7, label: "CETAM" },
] as const

export type ContratoColaboradorLabel =
  (typeof CONTRATOS_COLABORADOR)[number]["label"]

/** Mapeia contrato → coluna monday do dropdown de unidade. */
export const UNIDADE_COLUMN_POR_CONTRATO: Record<string, string> = {
  CETAM: "dropdown_mkztj8wp",
  DETRAN: "dropdown_mkztpndp",
  SEMSA: "dropdown_mkzte97y",
  "SEDUC COORDENADORIAS": "dropdown_mkztph7r",
  "SEDUC INTERIOR": "dropdown_mkztf29k",
  "SEDUC ESCOLA": "dropdown_mkztt8h0",
}

/** Sentinela usada em todos os dropdowns de unidade pra fallback. */
export const UNIDADE_NAO_ENCONTRADA = UNIDADE_NAO_ENCONTRADA_COMPARTILHADA

/** Coluna `dropdown_mkztj8wp` — CETAM */
export const UNIDADES_CETAM = [
  "CETAM - ALVARAES",
  "CETAM - AUTAZES",
  "CETAM - BORBA",
  "CETAM - CAAPIRANGA",
  "CETAM - CARAUARI",
  "CETAM - CAREIRO CASTANHO",
  "CETAM - CAREIRO DA VARZEA",
  "CETAM - CODAJAS",
  "CETAM - GASTRONOMIA",
  "CETAM - HUMAITA",
  "CETAM - INTERMITENTE",
  "CETAM - IRANDUBA",
  "CETAM - MANACAPURU",
  "CETAM - MANAQUIRI",
  "CETAM - MANICORE",
  "CETAM - MAUES",
  "CETAM - NOVO AIRÃO",
  "CETAM - NOVO ARIPUANA",
  "CETAM - PARINTINS",
  "CETAM - PRES. FIGUEIREDO",
  "CETAM - PRESIDÊNCIA",
  "CETAM - RIO PRETO DA EVA",
  "CETAM - S. GABRIEL DA CACHOEIRA",
  "CETAM - TABATINGA",
  "CETAM - TAPAUA",
  "CETAM - ZONA LESTE",
  UNIDADE_NAO_ENCONTRADA,
] as const

/** Coluna `dropdown_mkztpndp` — DETRAN */
export const UNIDADES_DETRAN = [
  "DETRAN -ALVARAES",
  "DETRAN - AUTAZES",
  "DETRAN - BORBA",
  "DETRAN -CAAPIRANGA",
  "DETRAN - CARAUARI",
  "DETRAN - CARREIRO CASTANHO",
  "DETRAN - CODAJAS",
  "DETRAN - GASTRONOMIA",
  "DETRAN - HUMAITA",
  "DETRAN - INTERMITENTE",
  "DETRAN - IRANDUBA",
  "DETRAN - MANACAPURU",
  "DETRAN - MANAQUIRI",
  "DETRAN - MANICORE",
  "DETRAN - MAUES",
  "DETRAN - NOVO AIRAO",
  "DETRAN - NOVO ARIPUANA",
  "DETRAN - PARINTINS",
  "DETRAN - PRES. FIGUEIREDO",
  "DETRAN - PRESIDENCIA",
  "DETRAN - RIO PRETO DA EVA",
  "DETRAN - S. GABRIEL DA CACHOEIRA",
  "DETRAN - TABATINGA",
  "DETRAN - TAPAUÁ",
  "DETRAN - ZONA LESTE",
  "DETRAN - SEDE",
  "DETRAN - UNIDADE NÃO ENCONTRADA",
] as const

/** Coluna `dropdown_mkztph7r` — COORDENADORIAS */
export const UNIDADES_COORDENADORIAS = [
  "SEDUC - COORDENADORIA 1",
  "SEDUC - COORDENADORIA 2",
  "SEDUC - COORDENADORIA 3",
  "SEDUC - COORDENADORIA 4",
  "SEDUC - COORDENADORIA 5",
  "SEDUC - COORDENADORIA 6",
  "SEDUC - COORDENADORIA 7",
  "SEDUC INTERIOR - SEDE DA COORDENADORIA",
  UNIDADE_NAO_ENCONTRADA,
] as const

/**
 * Listas grandes (SEMSA 180, INTERIOR 65, ESCOLA 101) ficam como
 * placeholders até endpoint dinâmico. Operacional sempre tem fallback
 * `UNIDADE_NAO_ENCONTRADA` + campo de texto livre, então qualquer
 * unidade ausente é preenchida manualmente.
 *
 * TODO: trocar por dados do `GET /atestado-form-opcoes`.
 */
export const UNIDADES_SEMSA_PLACEHOLDER = [
  "SEMSA - ADM",
  "SEMSA - DEPÓSITO CENTRAL",
  "SEMSA - DISA LESTE",
  "SEMSA - DISA NORTE",
  "SEMSA - DISA OESTE",
  "SEMSA - DISA SUL",
  "SEMSA - SEDE",
  UNIDADE_NAO_ENCONTRADA,
] as const

export const UNIDADES_INTERIOR_PLACEHOLDER = [
  "SEDUC INTERIOR - ALVARÃES",
  "SEDUC INTERIOR - AUTAZES",
  "SEDUC INTERIOR - PARINTINS",
  "SEDUC INTERIOR - TABATINGA",
  UNIDADE_NAO_ENCONTRADA,
] as const

export const UNIDADES_ESCOLA_PLACEHOLDER = [
  "ESCOLA - CENTRAL",
  "ESCOLA - NORTE",
  "ESCOLA - SUL",
  UNIDADE_NAO_ENCONTRADA,
] as const

export function unidadesParaContrato(
  contrato: string | null | undefined,
): readonly string[] {
  if (!contrato) return []
  const unidades = unidadesCompartilhadasParaContrato(contrato)
  return unidades.length > 0 ? [...unidades, UNIDADE_NAO_ENCONTRADA] : []
}

export function unidadeColumnIdParaContrato(
  contrato: string | null | undefined,
): string | null {
  if (!contrato) return null
  return UNIDADE_COLUMN_POR_CONTRATO[contrato.trim().toUpperCase()] ?? null
}

export const EXEMPLOS_SAIDA_RETORNO = [
  "Saída às 07:30 – Retorno às 15:00",
  "Saída às 07:30 – Não retornou",
  "Entrada às 08:00",
  "NÃO trabalhou",
] as const
