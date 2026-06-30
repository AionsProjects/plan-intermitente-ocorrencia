// Cálculo de desconto VR/VT — PURO. Porta fiel do node "Decidir Desconto1" do WF3 Finalizar.
// Regras (não mexer sem conferir o WF):
//  - Valores vêm do board Valores (18413870370) por contrato+função, maior especificidade.
//  - !optanteVT -> vtDia = 0 ; optante "SIM*" (vtSoVolta) -> vtDia / 2.
//  - Por dia: VT inteiro se d.vt; VR por atraso (min>=180 integral, senão vrDia*min/480) ou
//    integral (vrDia * vr_percentual/100).
//  - DETRAN / TRE PB: NUNCA descontam por falta/atestado (declara, desconto = 0).
//  - desconto_em_consumo: bloqueia correção se desconto do período já está PARCIAL/FINALIZADO
//    ou já teve algo descontado.

const round2 = (n: number): number => Math.round(Number(n || 0) * 100) / 100
const num = (v: unknown): number => Number(String(v ?? "0").replace(",", ".")) || 0

export function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
}

/** Contratos que declaram a falta mas NÃO geram desconto VR/VT. */
export const CONTRATOS_NAO_DESCONTAM = ["DETRAN", "TRE PB"]
export function naoDesconta(contrato: string): boolean {
  return CONTRATOS_NAO_DESCONTAM.includes(norm(contrato))
}

// ---- Resolução de valores no board Valores ----

export interface LinhaValores {
  contrato: string // texto da coluna Contrato (ou PADRAO/GLOBAL/*)
  regra: string // Regra/Função (ou vazio/PADRAO = geral)
  vrDia: number
  vtDia: number
  prioridade?: number
  ativo?: boolean // default true
}

export interface ValoresResolvidos {
  vrDia: number
  vtDia: number
  regraAplicada: string
}

export interface ErroValores {
  erro: string
  mensagem: string
}

const WILD_CONTRATO = ["PADRAO", "PADRÃO", "GLOBAL", "*"]
const WILD_REGRA = ["PADRAO", "PADRÃO", "GERAL", "*"]

/**
 * Escolhe a linha de valores mais específica pro contrato+função.
 * Especificidade = (contrato exato 1000) + (regra específica 100) + prioridade.
 */
export function resolverValores(
  linhas: LinhaValores[],
  alvo: { contrato: string; funcao: string },
): ValoresResolvidos | ErroValores {
  const contrato = norm(alvo.contrato)
  const funcao = norm(alvo.funcao)
  const ativas = linhas.filter((l) => l.ativo !== false)
  if (ativas.length === 0)
    return { erro: "valores_beneficios_vazio", mensagem: "Board de valores sem linhas ativas." }

  const matches: Array<{ l: LinhaValores; esp: number }> = []
  for (const l of ativas) {
    const c = norm(l.contrato)
    const regra = norm(l.regra)
    const contratoPadrao = WILD_CONTRATO.includes(c)
    if (c && c !== contrato && !contratoPadrao) continue
    const regraPadrao = !regra || WILD_REGRA.includes(regra)
    if (!regraPadrao && !funcao.includes(regra)) continue
    const esp = (c === contrato ? 1000 : 0) + (!regraPadrao ? 100 : 0) + (l.prioridade || 0)
    matches.push({ l, esp })
  }
  if (matches.length === 0)
    return {
      erro: "valores_beneficios_sem_regra",
      mensagem: `Nenhuma regra para contrato ${contrato || "(vazio)"} e funcao ${funcao || "(vazia)"}.`,
    }
  matches.sort((a, b) => b.esp - a.esp)
  const e = matches[0]!.l
  if (!e.vrDia && !e.vtDia)
    return { erro: "valores_beneficios_sem_valor", mensagem: "Regra achada mas VR e VT zerados." }
  return {
    vrDia: round2(e.vrDia),
    vtDia: round2(e.vtDia),
    regraAplicada: `Board valores - ${e.contrato || contrato}${e.regra ? " / " + e.regra : ""}`,
  }
}

// ---- Cálculo do desconto ----

export interface DiaDesconto {
  vr?: boolean
  vt?: boolean
  vr_tipo?: "atraso" | "integral" | string
  minutos_atraso?: number | null
  vr_percentual?: number | null
}

export interface CalcParams {
  vrDia: number
  vtDia: number
  optanteVT: boolean
  vtSoVolta?: boolean // optante "SIM*"
  contrato: string
  descontosPorDia: DiaDesconto[]
  // Falta/atestado: DETRAN/TRE PB não descontam (default true). CANCELAMENTO desconta
  // SEMPRE (inclusive DETRAN/TRE) -> o cancelar passa false. Ver guia §3.5/§7.
  aplicarRegraNaoDesconta?: boolean
}

export interface DescontoCalculado {
  descontoVR: number
  descontoVT: number
  vrDia: number
  vtDia: number
}

/** Calcula desconto VR/VT total a partir dos dias. Fiel ao WF3. */
export function calcularDesconto(p: CalcParams): DescontoCalculado {
  let vtDia = p.optanteVT ? round2(p.vtDia) : 0
  if (p.vtSoVolta && vtDia > 0) vtDia = round2(vtDia / 2)
  const vrDia = round2(p.vrDia)

  let descontoVR = 0
  let descontoVT = 0
  for (const d of p.descontosPorDia || []) {
    if (d.vt) descontoVT += vtDia
    if (d.vr) {
      if (d.vr_tipo === "atraso" && d.minutos_atraso) {
        descontoVR += d.minutos_atraso >= 180 ? vrDia : vrDia * (d.minutos_atraso / 480)
      } else {
        descontoVR += vrDia * ((d.vr_percentual || 100) / 100)
      }
    }
  }
  descontoVR = round2(descontoVR)
  descontoVT = round2(p.optanteVT ? descontoVT : 0)

  if (p.aplicarRegraNaoDesconta !== false && naoDesconta(p.contrato)) {
    descontoVR = 0
    descontoVT = 0
  }
  return { descontoVR, descontoVT, vrDia, vtDia }
}

// ---- Bloqueio desconto em consumo ----

export interface DescontoExistente {
  status?: string // PENDENTE / PARCIAL / FINALIZADO
  descontadoVR?: number
  descontadoVT?: number
}

/** true se o desconto do período já foi (parcial/total) consumido -> não pode corrigir. */
export function jaConsumido(d: DescontoExistente | null | undefined): boolean {
  if (!d) return false
  const s = norm(d.status)
  return s === "PARCIAL" || s === "FINALIZADO" || num(d.descontadoVR) > 0 || num(d.descontadoVT) > 0
}
