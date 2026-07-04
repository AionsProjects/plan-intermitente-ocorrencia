// Engine do ledger de benefícios — PURO. Porta fiel dos nodes "Preparar
// cancelamento" + "Decidir Desconto" do WF Cancelar (sbKoeewb, versão
// pós-fix total-sobre-parcial de 30/06).
//
// O ledger vive no Histórico (long_text_mm3ct3hg) como JSON { [data]: entrada }.
// Cada entrada acumula percentuais de VR/VT já descontados naquele dia (dedupe
// entre falta/atraso/atestado/PF/cancelamento) + origens.
//
// Regras (não mexer sem conferir o WF):
//  - Domingo e feriado NACIONAL nunca descontam (feriado por contrato NÃO se
//    aplica aqui — o WF usa exclusivamente o nacional no cancelamento).
//  - Sábado só conta se trabalha_sabado ou sábado extra; sábado não perde VR.
//  - Sábado extra JÁ PAGO (veio em sabados_extras persistidos): cancelamento
//    cobra VT integral de volta (cobrar_vt_pago_antecipadamente).
//  - Atraso desconta VR proporcional (minutos / jornada 480; sábado jornada 240).
//  - Desconto novo = só o percentual FALTANTE (1 - já descontado) por benefício.
import { isFeriadoNacional } from "./feriado.js"

export interface EntradaLedger {
  vr: boolean
  vt: boolean
  vr_percentual?: number
  vt_percentual?: number
  vr_tipo?: string
  minutos_atraso?: number | null
  cobrar_vt_pago_antecipadamente?: boolean
  origens: string[]
  [k: string]: unknown
}

export type Ledger = Record<string, EntradaLedger>

export interface RespostaAnterior {
  data: string
  tipo: string
  minutos_atraso?: number | null
  minutosAtraso?: number | null
}

export interface AtestadoAnterior {
  id?: string | null
  data_inicio?: string | null
  data_fim?: string | null
  dataInicio?: string | null
  dataFim?: string | null
  primeiro_dia_foi_trabalhar?: boolean
  primeiro_dia_trabalhou_seis_horas?: boolean | null
}

const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay()
const isSabado = (d: string) => dow(d) === 6
const isDomingo = (d: string) => dow(d) === 0

export function ensureLedger(ledger: Ledger, d: string): EntradaLedger {
  if (!ledger[d] || typeof ledger[d] !== "object") ledger[d] = { vr: false, vt: false, origens: [] }
  if (!Array.isArray(ledger[d].origens)) ledger[d].origens = []
  return ledger[d]
}

export function percentualDescontado(ledger: Ledger, d: string, benefit: "vr" | "vt"): number {
  const e = ensureLedger(ledger, d)
  const explicit = Number(e[`${benefit}_percentual`])
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(1, explicit)
  return e[benefit] === true ? 1 : 0
}

export function marcarPercentual(
  ledger: Ledger,
  d: string,
  benefit: "vr" | "vt",
  percentual: number,
  origem: string,
): void {
  const e = ensureLedger(ledger, d)
  const atual = percentualDescontado(ledger, d, benefit)
  const novo = Math.min(1, atual + Math.max(0, Number(percentual) || 0))
  e[benefit] = novo > 0
  e[`${benefit}_percentual`] = novo
  if (!e.origens.includes(origem)) e.origens.push(origem)
}

function jornadaMin(d: string): number {
  return isFeriadoNacional(d) ? 0 : isSabado(d) ? 240 : isDomingo(d) ? 0 : 480
}

export interface ReconstruirParams {
  respostas: RespostaAnterior[]
  diasDesativados: string[]
  atestados: AtestadoAnterior[]
  trabalhaSabado: boolean
  sabadosExtras: string[]
}

/** Reconstrói o ledger a partir das respostas/desativados/atestados quando o
 *  Histórico ainda não tem ledger gravado. Fiel ao bloco `if (!ledger || vazio)`. */
export function reconstruirLedger(p: ReconstruirParams): Ledger {
  const ledger: Ledger = {}
  const sabEx = new Set(p.sabadosExtras)
  const contaSabado = (d: string) => p.trabalhaSabado || sabEx.has(d)

  for (const r of p.respostas || []) {
    const min = Number(r.minutos_atraso ?? r.minutosAtraso ?? 0)
    if (!r || !r.data || !r.tipo || isFeriadoNacional(r.data)) continue
    if (r.tipo === "falta") {
      const e = ensureLedger(ledger, r.data)
      const sab = isSabado(r.data)
      e.vr = !sab
      e.vt = true
      e.vr_percentual = e.vr ? 1 : 0
      e.vt_percentual = 1
      if (!e.origens.includes("falta")) e.origens.push("falta")
    } else if (r.tipo === "atraso" && min > 0 && !isSabado(r.data)) {
      const e = ensureLedger(ledger, r.data)
      const jor = jornadaMin(r.data) || 480
      const pct = Math.min(1, min / jor)
      e.vr = true
      e.vr_percentual = Math.max(Number(e.vr_percentual) || 0, pct)
      const tag = `atraso:${min}min`
      if (!e.origens.includes(tag)) e.origens.push(tag)
    }
  }

  for (const d of p.diasDesativados || []) {
    if (isDomingo(d) || isFeriadoNacional(d)) continue
    if (isSabado(d) && !contaSabado(d)) continue
    const e = ensureLedger(ledger, d)
    const sab = isSabado(d)
    e.vr = !sab
    e.vt = true
    e.vr_percentual = e.vr ? 1 : 0
    e.vt_percentual = 1
    if (!e.origens.includes("desconsiderado")) e.origens.push("desconsiderado")
  }

  for (const a of p.atestados || []) {
    const ini = a.data_inicio ?? a.dataInicio
    const fim = a.data_fim ?? a.dataFim
    if (!a || !ini || !fim) continue
    const cur = new Date(ini + "T00:00:00Z")
    const end = new Date(fim + "T00:00:00Z")
    let primeiro = true
    while (cur <= end) {
      const iso = cur.toISOString().slice(0, 10)
      const sab = isSabado(iso)
      const dom = isDomingo(iso)
      const fer = isFeriadoNacional(iso)
      if (!dom && !fer && (!sab || contaSabado(iso))) {
        const e = ensureLedger(ledger, iso)
        if (primeiro) {
          if (!a.primeiro_dia_foi_trabalhar) {
            e.vr = !sab
            e.vt = true
            e.vr_percentual = e.vr ? 1 : 0
            e.vt_percentual = 1
          } else if (a.primeiro_dia_trabalhou_seis_horas === false && !sab) {
            e.vr = true
            e.vr_percentual = Math.max(Number(e.vr_percentual) || 0, 1)
          }
        } else {
          e.vr = !sab
          e.vt = true
          e.vr_percentual = e.vr ? 1 : 0
          e.vt_percentual = 1
        }
        const tag = `atestado:${a.id || "sem-id"}`
        if (!e.origens.includes(tag)) e.origens.push(tag)
      }
      primeiro = false
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }
  return ledger
}

/** Dias canceláveis no período (exclui domingo, feriado nacional e sábado
 *  não-trabalhado/não-extra). Fiel ao dateRange do WF. */
export function diasCancelaveis(
  inicio: string,
  fim: string,
  trabalhaSabado: boolean,
  sabadosExtras: string[],
): string[] {
  const sabEx = new Set(sabadosExtras)
  const out: string[] = []
  const cur = new Date(inicio + "T00:00:00Z")
  const end = new Date(fim + "T00:00:00Z")
  while (cur <= end) {
    const d = cur.getUTCDay()
    const iso = cur.toISOString().slice(0, 10)
    const incluiSabado = trabalhaSabado || sabEx.has(iso)
    if (d !== 0 && !isFeriadoNacional(iso) && (d !== 6 || incluiSabado)) out.push(iso)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

export interface CancelamentoCalc {
  descontoVR: number
  descontoVT: number
  diasPerdeVR: number
  diasPerdeVT: number
  ledger: Ledger
  diasIgnoradosDuplicidade: Array<{ data: string; beneficio: "vr" | "vt" }>
}

export interface CancelamentoParams {
  ledger: Ledger // ledger vigente (ou reconstruído) — MUTADO e retornado
  diasCancelados: string[]
  tipo: "total" | "parcial"
  vrDia: number
  vtDia: number // já com meia-volta/zerado por optante aplicado
  optanteVT: boolean
  trabalhaSabado: boolean
  sabadosExtras: string[]
}

const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100

/** Aplica o cancelamento sobre o ledger — desconta só o percentual faltante de
 *  cada dia; sábado extra pago cobra VT integral de volta. Fiel ao WF. */
export function aplicarCancelamento(p: CancelamentoParams): CancelamentoCalc {
  const ledger = p.ledger
  const origem = `cancelamento:${p.tipo}`
  const sabEx = new Set(p.sabadosExtras)
  const diasIgnorados: Array<{ data: string; beneficio: "vr" | "vt" }> = []
  let diasPerdeVR = 0
  let diasPerdeVT = 0
  let descontoVR = 0
  let descontoVT = 0

  for (const d of p.diasCancelados) {
    if (isDomingo(d) || isFeriadoNacional(d)) continue
    const ehSabado = isSabado(d)
    const ehSabadoExtraPago = ehSabado && sabEx.has(d)
    if (ehSabado && !p.trabalhaSabado && !ehSabadoExtraPago) continue

    if (!ehSabado) {
      const jaVr = percentualDescontado(ledger, d, "vr")
      const faltVr = Math.max(0, 1 - jaVr)
      if (faltVr > 0) {
        diasPerdeVR += faltVr
        descontoVR += p.vrDia * faltVr
        marcarPercentual(ledger, d, "vr", faltVr, origem)
      } else {
        diasIgnorados.push({ data: d, beneficio: "vr" })
      }
    }

    if (p.optanteVT) {
      if (ehSabadoExtraPago) {
        // VT do sábado extra já foi pago via boleto — cancelamento vira dívida total no VT.
        diasPerdeVT += 1
        descontoVT += p.vtDia
        const e = ensureLedger(ledger, d)
        e.vt = true
        e.vt_percentual = Math.min(1, (Number(e.vt_percentual) || 0) + 1)
        e.cobrar_vt_pago_antecipadamente = true
        const tag = "cancelamento:sabado_extra_pago"
        if (!e.origens.includes(tag)) e.origens.push(tag)
      } else {
        const jaVt = percentualDescontado(ledger, d, "vt")
        const faltVt = Math.max(0, 1 - jaVt)
        if (faltVt > 0) {
          diasPerdeVT += faltVt
          descontoVT += p.vtDia * faltVt
          marcarPercentual(ledger, d, "vt", faltVt, origem)
        } else {
          diasIgnorados.push({ data: d, beneficio: "vt" })
        }
      }
    }
  }

  if (!p.optanteVT) descontoVT = 0
  return {
    descontoVR: round2(descontoVR),
    descontoVT: round2(descontoVT),
    diasPerdeVR,
    diasPerdeVT,
    ledger,
    diasIgnoradosDuplicidade: diasIgnorados,
  }
}

/** Range do desconto do cancelamento (pós-fix 30/06): total-sobre-parcial
 *  cancela só os dias ainda não cancelados (origem cancelamento:* no ledger). */
export function rangeCancelamento(p: {
  tipo: "total" | "parcial"
  eraParcial: boolean
  ledger: Ledger
  dataInicio: string
  dataFim: string
  dataCancel: string | null
  trabalhaSabado: boolean
  sabadosExtras: string[]
}): { inicio: string; fim: string; dias: string[] } {
  if (p.tipo === "total" && p.eraParcial) {
    const jaCancel = new Set(
      Object.keys(p.ledger).filter((d) => {
        const o = p.ledger[d]?.origens
        return Array.isArray(o) && o.some((x) => String(x).startsWith("cancelamento"))
      }),
    )
    const todos = diasCancelaveis(p.dataInicio, p.dataFim, p.trabalhaSabado, p.sabadosExtras)
    const dias = todos.filter((d) => !jaCancel.has(d))
    return {
      inicio: dias[0] || p.dataInicio,
      fim: dias[dias.length - 1] || p.dataFim,
      dias,
    }
  }
  const inicio = p.tipo === "total" ? p.dataInicio : p.dataCancel!
  const dias = diasCancelaveis(inicio, p.dataFim, p.trabalhaSabado, p.sabadosExtras)
  return { inicio, fim: p.dataFim, dias }
}
