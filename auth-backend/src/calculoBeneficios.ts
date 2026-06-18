// Cálculo de desconto VR/VT — réplica fiel do WF3 (Code node "Validar e preparar1" +
// "Decidir Desconto1"). Valores DIÁRIOS vêm do board Valores (18413870370), resolvidos
// por contrato+função. Testado por replay contra finalizações reais do n8n.

export type TipoOcorrencia = "falta" | "atraso" | "sem_ocorrencia"
export interface Resposta {
  data: string
  tipo: TipoOcorrencia
  minutos_atraso?: number | null
}

// --- Feriados nacionais (Meeus/Jones/Butcher p/ Páscoa) — espelha src/lib/feriadosBr.ts
const FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]
function sextaSanta(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  const pascoa = new Date(Date.UTC(ano, mes - 1, dia))
  pascoa.setUTCDate(pascoa.getUTCDate() - 2) // sexta-feira santa
  return pascoa.toISOString().slice(0, 10)
}
const cacheFeriados = new Map<number, Set<string>>()
function feriadosDoAno(ano: number): Set<string> {
  let s = cacheFeriados.get(ano)
  if (!s) {
    s = new Set(FIXOS.map((f) => `${ano}-${f}`))
    s.add(sextaSanta(ano))
    cacheFeriados.set(ano, s)
  }
  return s
}
export function isFeriadoNacional(iso: string): boolean {
  if (!iso || iso.length < 10) return false
  return feriadosDoAno(Number(iso.slice(0, 4))).has(iso)
}
function dow(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay()
}
export function isDomingo(iso: string): boolean {
  return dow(iso) === 0
}
export function isSabado(iso: string): boolean {
  return dow(iso) === 6
}

const round2 = (n: number) => Math.round(n * 100) / 100

// --- Resolução do board Valores (réplica de resolverValoresBeneficios)
function norm(v: string | null | undefined): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()
}
export interface LinhaValor {
  contrato: string // título "Contrato"
  regra: string // título "Regra/Função"
  vr: number
  vt: number
  ativo: boolean
}
export function resolverValores(
  linhas: LinhaValor[],
  contrato: string,
  funcao: string,
): { vrDia: number; vtDia: number; regraAplicada: string } | { erro: string } {
  const c = norm(contrato)
  const f = norm(funcao)
  const matches: { l: LinhaValor; esp: number }[] = []
  for (const l of linhas) {
    if (!l.ativo) continue
    const lc = norm(l.contrato)
    const contratoPadrao = ["PADRAO", "GLOBAL", "*"].includes(lc)
    if (lc && lc !== c && !contratoPadrao) continue
    const lr = norm(l.regra)
    const regraPadrao = !lr || ["PADRAO", "GERAL", "*"].includes(lr)
    if (!regraPadrao && !f.includes(lr)) continue
    const esp = (lc === c ? 1000 : 0) + (!regraPadrao ? 100 : 0)
    matches.push({ l, esp })
  }
  if (matches.length === 0) return { erro: "valores_beneficios_sem_regra" }
  matches.sort((a, b) => b.esp - a.esp)
  const e = matches[0].l
  if (!e.vr && !e.vt) return { erro: "valores_beneficios_sem_valor" }
  return { vrDia: e.vr, vtDia: e.vt, regraAplicada: `${e.contrato}/${e.regra}` }
}

// --- Cálculo do desconto (réplica de "Validar e preparar1" + "Decidir Desconto1")
export interface EntradaCalculo {
  respostas: Resposta[]
  diasDesativados?: string[]
  sabadosExtras?: string[]
  trabalhaSabado: boolean
  optanteVT: boolean | "SIM*"
  vrDia: number
  vtDia: number
}
export interface ResultadoCalculo {
  qtdFaltas: number
  qtdAtrasos: number
  totalMinAtraso: number
  diasPerdeVR: number
  diasPerdeVT: number
  descontoVR: number
  descontoVT: number
  ledger: Record<string, unknown>
}

export function calcularDesconto(e: EntradaCalculo): ResultadoCalculo {
  const sabExtras = new Set(e.sabadosExtras ?? [])
  const perdeNoSabado = (d: string) => e.trabalhaSabado || sabExtras.has(d)
  const sabadoSemTrabalho = (d: string) => isSabado(d) && !perdeNoSabado(d)

  // VT diário efetivo: 0 se não optante; metade se "SIM*"
  let vtDia = e.vtDia
  if (e.optanteVT === false) vtDia = 0
  else if (e.optanteVT === "SIM*") vtDia = round2(vtDia / 2)

  type Dia = {
    data: string; vr: boolean; vt: boolean; vr_tipo?: string
    vr_percentual: number; minutos_atraso?: number; origens: string[]
  }
  const porDia: Dia[] = []
  const add = (data: string, p: Partial<Dia> & { origem: string }) => {
    porDia.push({
      data, vr: p.vr ?? false, vt: p.vt ?? false, vr_tipo: p.vr_tipo,
      vr_percentual: p.vr_percentual ?? 100, minutos_atraso: p.minutos_atraso,
      origens: [p.origem],
    })
  }
  for (const d of e.diasDesativados ?? []) {
    add(d, { vt: true, vr: !sabadoSemTrabalho(d), vr_tipo: "integral", origem: "desconsiderado" })
  }
  for (const r of e.respostas) {
    if (r.tipo === "falta") {
      add(r.data, { vt: true, vr: !sabadoSemTrabalho(r.data), vr_tipo: "integral", origem: "falta" })
    } else if (r.tipo === "atraso" && !isSabado(r.data)) {
      add(r.data, { vr: true, vr_tipo: "atraso", minutos_atraso: r.minutos_atraso || 0, origem: "atraso" })
    }
  }

  // fator VR de cada dia (1 = perde VR integral). Atraso = proporcional aos minutos.
  const fatorVR = (d: Dia): number => {
    if (!d.vr) return 0
    if (d.vr_tipo === "atraso" && d.minutos_atraso) {
      return d.minutos_atraso >= 180 ? 1 : d.minutos_atraso / 480
    }
    return (d.vr_percentual || 100) / 100
  }
  const round4 = (n: number) => Math.round(n * 10000) / 10000
  const diasPerdeVT = porDia.filter((d) => d.vt).length
  const diasPerdeVR = round4(porDia.reduce((acc, d) => acc + fatorVR(d), 0))

  let descontoVR = 0
  let descontoVT = 0
  for (const d of porDia) {
    if (d.vt) descontoVT += vtDia
    descontoVR += e.vrDia * fatorVR(d)
  }
  descontoVR = round2(descontoVR)
  descontoVT = round2(descontoVT)

  // Ledger por dia
  const ledger: Record<string, unknown> = {}
  for (const d of porDia) {
    let vrPct = 0
    if (d.vr) {
      if (d.vr_tipo === "atraso" && d.minutos_atraso) {
        const jor = isSabado(d.data) ? 240 : isDomingo(d.data) || isFeriadoNacional(d.data) ? 0 : 480
        vrPct = Math.min(100, Math.round((d.minutos_atraso / (jor || 480)) * 10000) / 100)
      } else {
        vrPct = Math.min(100, d.vr_percentual || 100)
      }
    }
    const ent: Record<string, unknown> = {
      vr: vrPct > 0, vt: !!d.vt, vr_percentual: vrPct,
      vt_percentual: d.vt ? 100 : 0, origens: d.origens,
    }
    if (d.vr_tipo) ent.vr_tipo = d.vr_tipo
    if (d.minutos_atraso) ent.minutos_atraso = d.minutos_atraso
    ledger[d.data] = ent
  }

  const qtdFaltas = e.respostas.filter((r) => r.tipo === "falta").length
  const qtdAtrasos = e.respostas.filter((r) => r.tipo === "atraso").length
  const totalMinAtraso = e.respostas.reduce(
    (acc, r) => acc + (r.tipo === "atraso" ? r.minutos_atraso || 0 : 0),
    0,
  )

  return {
    qtdFaltas, qtdAtrasos, totalMinAtraso,
    diasPerdeVR: round2(diasPerdeVR), diasPerdeVT,
    descontoVR, descontoVT, ledger,
  }
}
