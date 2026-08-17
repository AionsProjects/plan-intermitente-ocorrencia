// Split de convocação — os 2 subitems no item da Entrada. Builders PUROS.
//
// Porta dos nós `Preparar Subitems Split` / `Preparar Mutacao Subitems` do WF3
// (backup em docs/n8n/backups/rlxTk4VZLM2gTzx7-nodes-2026-08-13.json).
//
// O split parte UMA convocação em duas metades com contratos diferentes: a parte 1 vai até o
// dia anterior ao corte, a parte 2 do corte ao fim. Cada metade recebe as próprias respostas
// e os próprios agregados, porque cada contrato tem valores de VR/VT diferentes.
import type { RespostaDia } from "../domain/descontoDia.js"

/** Colunas do board de SUBITEMS da Entrada. Ids estáveis — o subitem não é duplicado na virada. */
export const COL_SUB = {
  dataInicio: "date_mm41xsnq",
  dataFim: "date_mm41drra",
  contrato: "color_mktqewwq",
  respostas: "long_text_mm418z0z",
  qtdFaltas: "numeric_mm3h1g0",
  qtdAtrasos: "numeric_mm413fsm",
  totalMin: "numeric_mm41pnsy",
  diasExtras: "long_text_mm41971g",
  diasDesativados: "long_text_mm41m5rv",
  sabadosExtras: "long_text_mm412w8n",
  status: "color_mm41xff4",
  empregadoSubstituido: "text_mktq90cy",
  insalubridade: "color_mktqs6xg",
} as const

/** Colunas do PAI (Entrada) que são propagadas iguais pras duas metades. */
export const COL_PAI_PROPAGA = {
  empregadoSubstituido: "text_mktc23av",
  insalubridade: "color_mktq63xa",
} as const

export interface SplitSnake {
  data_inicio_parte2: string
  contrato_parte1: string
  contrato_parte2: string
}

export interface EntradaParticao {
  dataInicio: string
  dataFim: string
  split: SplitSnake
  respostas: RespostaDia[]
  diasExtras?: string[]
  diasDesativados?: string[]
  sabadosExtras?: string[]
}

export interface ParteSplit {
  parte: 1 | 2
  contrato: string
  inicio: string
  fim: string
  respostas: RespostaDia[]
  diasExtras: string[]
  diasDesativados: string[]
  sabadosExtras: string[]
  qtdFaltas: number
  qtdAtrasos: number
  totalMin: number
}

function somarDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Comparação de string ISO — `<` funciona porque YYYY-MM-DD ordena lexicograficamente. */
const ladoDe = (data: string, corte: string): 1 | 2 => (data < corte ? 1 : 2)

export function splitValido(v: unknown): v is SplitSnake {
  const s = v as SplitSnake | null
  return (
    !!s &&
    typeof s.data_inicio_parte2 === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.data_inicio_parte2) &&
    !!String(s.contrato_parte1 ?? "").trim() &&
    !!String(s.contrato_parte2 ?? "").trim()
  )
}

/**
 * Parte a convocação em duas. O corte pertence à parte 2 — `>= corte` é parte 2, e a parte 1
 * termina em `corte - 1 dia`. Nenhum dia fica nas duas nem fora das duas.
 */
export function particionarSplit(e: EntradaParticao): [ParteSplit, ParteSplit] {
  const corte = e.split.data_inicio_parte2
  const dias = (lista: string[] | undefined, lado: 1 | 2) =>
    (lista ?? []).filter((d) => typeof d === "string" && ladoDe(d, corte) === lado)

  const monta = (parte: 1 | 2): ParteSplit => {
    const respostas = (e.respostas ?? []).filter((r) => r?.data && ladoDe(r.data, corte) === parte)
    const atrasos = respostas.filter((r) => r.tipo === "atraso")
    return {
      parte,
      contrato: parte === 1 ? e.split.contrato_parte1 : e.split.contrato_parte2,
      inicio: parte === 1 ? e.dataInicio : corte,
      fim: parte === 1 ? somarDias(corte, -1) : e.dataFim,
      respostas,
      diasExtras: dias(e.diasExtras, parte),
      diasDesativados: dias(e.diasDesativados, parte),
      sabadosExtras: dias(e.sabadosExtras, parte),
      qtdFaltas: respostas.filter((r) => r.tipo === "falta").length,
      qtdAtrasos: atrasos.length,
      totalMin: atrasos.reduce((s, r) => s + (Number(r.minutos_atraso) || 0), 0),
    }
  }
  return [monta(1), monta(2)]
}

/** `Parte 1 - SEDUC SEDE`. O prefixo `Parte N` é o que casa o subitem existente. */
export function nomeSubitem(p: ParteSplit): string {
  return `Parte ${p.parte} - ${p.contrato}`
}

export function colunasSubitem(
  p: ParteSplit,
  propaga: { empregadoSubstituido?: string | null; insalubridade?: string | null } = {},
): Record<string, unknown> {
  const texto = (v: unknown) => ({ text: JSON.stringify(v) })
  const v: Record<string, unknown> = {
    [COL_SUB.dataInicio]: { date: p.inicio },
    [COL_SUB.dataFim]: { date: p.fim },
    [COL_SUB.contrato]: { label: p.contrato },
    [COL_SUB.respostas]: texto(p.respostas),
    [COL_SUB.qtdFaltas]: String(p.qtdFaltas),
    [COL_SUB.qtdAtrasos]: String(p.qtdAtrasos),
    [COL_SUB.totalMin]: String(p.totalMin),
    [COL_SUB.diasExtras]: texto(p.diasExtras),
    [COL_SUB.diasDesativados]: texto(p.diasDesativados),
    [COL_SUB.sabadosExtras]: texto(p.sabadosExtras),
    [COL_SUB.status]: { label: "Concluido" },
  }
  // Só quando o pai tem valor: mandar vazio APAGARIA o que já está no subitem.
  if (propaga.empregadoSubstituido) v[COL_SUB.empregadoSubstituido] = { text: propaga.empregadoSubstituido }
  if (propaga.insalubridade) v[COL_SUB.insalubridade] = { label: propaga.insalubridade }
  return v
}

/**
 * Casa a parte com o subitem que já existe, pelo PREFIXO `Parte N`.
 *
 * Por prefixo e não por nome inteiro porque o contrato faz parte do nome: uma correção que
 * troca o contrato da parte 2 mudaria o nome, e casar por igualdade criaria um subitem novo
 * em vez de atualizar — a convocação terminaria com três.
 */
export function acharSubitemExistente(
  subitems: Array<{ id: string; name?: string | null; board?: { id?: string | number } | null }>,
  parte: 1 | 2,
): { id: string; boardId: string | null } | null {
  const achado = (subitems ?? []).find((s) => String(s.name ?? "").startsWith(`Parte ${parte}`))
  if (!achado) return null
  return { id: String(achado.id), boardId: achado.board?.id != null ? String(achado.board.id) : null }
}
