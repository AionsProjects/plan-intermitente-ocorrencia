// Derivação dos descontos por dia a partir das respostas — PURO. Porta fiel do
// node "Validar e preparar1" do WF3 (parte do ledger). Produz entradas compatíveis
// com calcularDesconto (domain/desconto). Falta/desconsiderado = VR integral (exceto
// sábado) + VT; atraso = VR proporcional à jornada (sáb=240, senão 480).
import { isFeriadoNacional } from "./feriado.js"

export interface RespostaDia {
  data: string
  tipo: "sem_ocorrencia" | "falta" | "atraso" | string
  minutos_atraso?: number | null
}

export interface EntradaLedger {
  data: string
  vr: boolean
  vt: boolean
  vr_tipo: "integral" | "parcial" | "atraso" | null
  vr_percentual: number
  vt_percentual: number
  minutos_atraso: number
  origens: string[]
}

export interface DeriveParams {
  dataInicio: string
  dataFim: string
  trabalhaSabado: boolean
  sabadosExtras?: string[]
  diasExtras?: string[]
  diasDesativados?: string[]
  respostas: RespostaDia[]
}

function dow(d: string): number {
  return new Date(d + "T00:00:00Z").getUTCDay()
}
const isSabado = (d: string) => dow(d) === 6
const isDomingo = (d: string) => dow(d) === 0

/** Jornada em minutos: domingo/feriado=0, sábado=240, dia útil=480. */
export function jornadaMin(d: string): number {
  if (isDomingo(d) || isFeriadoNacional(d)) return 0
  if (isSabado(d)) return 240
  return 480
}

/**
 * Deriva o ledger por dia (descontosPorDia) das respostas. Regras do WF3:
 *  - diaConta: não domingo/feriado; sábado só se trabalhaSabado ou sábado extra.
 *  - desconsiderado (dia desativado): VT + VR integral (exceto sábado), origem 'desconsiderado'.
 *  - falta: VT + VR integral (exceto sábado), origem 'falta'.
 *  - atraso (não sábado): VR proporcional = minutos/jornada, vr_tipo 'atraso', origem 'atraso'.
 */
export function derivarDescontosPorDia(p: DeriveParams): EntradaLedger[] {
  const sabExtras = new Set(p.sabadosExtras ?? [])
  const trabalhaSabado = p.trabalhaSabado
  const diaConta = (d: string): boolean => {
    if (isDomingo(d) || isFeriadoNacional(d)) return false
    if (isSabado(d)) return trabalhaSabado || sabExtras.has(d)
    return true
  }

  const map = new Map<string, EntradaLedger>()
  const entry = (data: string): EntradaLedger => {
    let e = map.get(data)
    if (!e) {
      e = { data, vr: false, vt: false, vr_tipo: null, vr_percentual: 0, vt_percentual: 0, minutos_atraso: 0, origens: [] }
      map.set(data, e)
    }
    return e
  }
  const pushOrigem = (e: EntradaLedger, o?: string) => {
    if (o && !e.origens.includes(o)) e.origens.push(o)
  }
  const addDesconto = (
    data: string,
    opts: { vr?: boolean; vt?: boolean; vr_tipo?: string; vr_percentual?: number; minutos_atraso?: number; origem?: string },
  ): void => {
    if (!diaConta(data)) return
    const e = entry(data)
    let tocou = false
    if (opts.vt) {
      e.vt = true
      e.vt_percentual = Math.min(100, Math.max(e.vt_percentual || 0, 100))
      tocou = true
    }
    if (opts.vr) {
      e.vr = true
      if (opts.vr_tipo === "atraso") {
        const jor = jornadaMin(data) || 480
        const atrasoPct = Math.min(100, Math.round(((opts.minutos_atraso || 0) / jor) * 10000) / 100)
        if ((e.vr_percentual || 0) < 100) {
          e.vr_percentual = Math.min(100, Math.max(e.vr_percentual || 0, atrasoPct))
          if (e.vr_percentual < 100) e.vr_tipo = "atraso"
          e.minutos_atraso = Math.max(e.minutos_atraso || 0, opts.minutos_atraso || 0)
        }
      } else {
        const pct = opts.vr_percentual ?? 100
        e.vr_percentual = Math.min(100, (e.vr_percentual || 0) + pct)
        e.vr_tipo = e.vr_percentual >= 100 ? "integral" : "parcial"
      }
      tocou = true
    }
    if (tocou) pushOrigem(e, opts.origem)
  }

  for (const d of p.diasDesativados ?? []) {
    addDesconto(d, { vt: true, vr: !isSabado(d), vr_tipo: "integral", origem: "desconsiderado" })
  }
  for (const r of p.respostas) {
    if (r.tipo === "falta") {
      addDesconto(r.data, { vt: true, vr: !isSabado(r.data), vr_tipo: "integral", origem: "falta" })
    } else if (r.tipo === "atraso" && !isSabado(r.data)) {
      addDesconto(r.data, { vr: true, vr_tipo: "atraso", minutos_atraso: r.minutos_atraso || 0, origem: "atraso" })
    }
  }
  return [...map.values()].sort((a, b) => a.data.localeCompare(b.data))
}

/** Agregados pro Histórico/ledger a partir das respostas + ledger derivado. */
export function agregados(respostas: RespostaDia[], ledger: EntradaLedger[]) {
  const qtd_faltas = respostas.filter((r) => r.tipo === "falta").length
  const atrasos = respostas.filter((r) => r.tipo === "atraso")
  const qtd_atrasos = atrasos.length
  const total_minutos = atrasos.reduce((s, r) => s + (r.minutos_atraso || 0), 0)
  const dias_perde_vr = ledger.filter((e) => e.vr).length
  const dias_perde_vt = ledger.filter((e) => e.vt).length
  return { qtd_faltas, qtd_atrasos, total_minutos, dias_perde_vr, dias_perde_vt }
}
