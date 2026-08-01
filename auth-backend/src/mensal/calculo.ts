export interface ConvocacaoMensal {
  itemId: string
  nome: string
  chapa: string
  cpf: string
  contrato: string
  funcao: string
  interior: string
  inicio: string
  fim: string
  trabalhaSabado: boolean
  optanteVT: boolean
  vtSoVolta: boolean
  escala12x36?: "PAR" | "IMPAR" | null
}

export interface RegraBeneficioMensal {
  id: string
  contrato: string
  regra: string
  vrDia: number
  vtDia: number
  vrMensal: number
  vtMensal: number
  prioridade: number
  escala12x36: boolean
}

export interface FeriadoMensal { data: string; tipo: string; contratos: string[] }
export interface DescontoMensal {
  id: string; pessoaKey: string; inicio: string
  residualVR: number; residualVT: number; descontadoVR: number; descontadoVT: number
}

export interface PessoaCalculadaMensal extends ConvocacaoMensal {
  key: string
  itemIds: string[]
  diasVR: number
  diasVT: number
  vrDia: number
  vtDia: number
  vrMensal: number
  brutoVR: number
  brutoVT: number
  descontoVR: number
  descontoVT: number
  liquidoVR: number
  liquidoVT: number
  creditoVR: number
  creditoVT: number
  pixVR: number
  pixVT: number
  regraAplicada: string
}

/** Update de 1 item (linha) do board Plano — alocação de crédito por linha. */
export interface PlanUpdateMensal {
  itemId: string
  vtDia: number
  vrDia: number // valor-dia efetivo (regra mensal vira mensal/30) — estilo pontual
  vrMensal: number // referência da regra quando mensal; 0 quando VR é diário
  diasVR: number
  diasVT: number
  creditoVR: number
  creditoVT: number
}

/** Update de 1 item do board Desconto FIFO (18400981023) — valores finais pós-consumo. */
export interface DescontoUpdateMensal {
  id: string
  residualVR: number
  residualVT: number
  descontadoVR: number
  descontadoVT: number
  status: "PARCIAL" | "FINALIZADO"
}

export interface ContratoCalculadoMensal {
  contrato: string
  codSecao: string
  pessoas: PessoaCalculadaMensal[]
  planUpdates: PlanUpdateMensal[]
  descontoUpdates: DescontoUpdateMensal[]
  totais: { vr: number; vt: number; credito: number; pix: number }
}

export interface ResultadoCalculoMensal {
  contratos: ContratoCalculadoMensal[]
  descontos: Array<DescontoMensal & { status: "PARCIAL" | "FINALIZADO" }>
}

export const normMensal = (v: unknown): string => String(v ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100
const intervalo = (inicio: string, fim: string): string[] => {
  const out: string[] = []
  const atual = new Date(`${inicio}T00:00:00Z`)
  const final = new Date(`${fim}T00:00:00Z`)
  while (atual <= final) { out.push(atual.toISOString().slice(0, 10)); atual.setUTCDate(atual.getUTCDate() + 1) }
  return out
}

export function codigoSecaoContrato(contrato: string): string {
  const codigos: Record<string, string> = {
    DETRAN: "01.01.0004", "SEDUC SEDE": "01.01.0010", "SEDUC ESCOLA": "01.01.0011",
    "SEDUC INTERIOR": "01.01.0011", CETAM: "01.01.0074", "TRE PB": "01.01.0079", SEMSA: "01.01.0085",
  }
  return codigos[normMensal(contrato)] ?? ""
}

// Matching de função tolerante a preposições: "TECNICO EM NIVEL MEDIO" casa com
// "TECNICO DE NIVEL MEDIO" (bug real do DETRAN — a função do Plano usa EM, a regra
// do board usa DE, e a pessoa caía na regra Padrão).
const semPreposicao = (v: string): string =>
  v.replace(/\b(DE|DA|DO|DAS|DOS|EM|NA|NO)\b/g, " ").replace(/\s+/g, " ").trim()

function resolverRegra(regras: RegraBeneficioMensal[], pessoa: ConvocacaoMensal): RegraBeneficioMensal {
  const contrato = normMensal(pessoa.contrato), funcao = semPreposicao(normMensal(pessoa.funcao))
  const escala = !!pessoa.escala12x36
  const candidatas = regras.filter((r) => {
    if (r.escala12x36 !== escala) return false
    const c = normMensal(r.contrato), regra = semPreposicao(normMensal(r.regra))
    if (c && !["PADRAO", "PADRÃO", "GLOBAL", "*"].includes(c) && c !== contrato) return false
    return !regra || ["PADRAO", "PADRÃO", "GERAL", "*"].includes(regra) || funcao.includes(regra) || regra.includes(funcao)
  }).sort((a, b) => {
    const score = (r: RegraBeneficioMensal) => (normMensal(r.contrato) === contrato ? 1000 : 0)
      + (["", "PADRAO", "PADRÃO", "GERAL", "*"].includes(normMensal(r.regra)) ? 50 : 500) + r.prioridade
    return score(b) - score(a)
  })
  if (!candidatas[0]) throw new Error(`regra_beneficio_ausente:${pessoa.contrato}:${pessoa.funcao}`)
  return candidatas[0]
}

// Dias elegíveis — ESTILO PONTUAL (regra unificada, decisão DP 13/07/2026):
// VR: seg-sex (sábado/domingo nunca contam). VT: seg-sex + sábado se trabalha sábado.
// Regra "VR Mensal" NÃO muda a contagem — vira valor-dia (mensal/30) × dias trabalhados.
// Feriado: mantém a regra do board FERIADOS (SEDUC*/DETRAN recebem; demais não) —
// única divergência consciente do pontual, que não filtra feriado.
function diasElegiveis(p: ConvocacaoMensal, feriados: FeriadoMensal[], vr: boolean): string[] {
  return intervalo(p.inicio, p.fim).filter((data) => {
    const dia = Number(data.slice(-2)), dow = new Date(`${data}T00:00:00Z`).getUTCDay()
    if (p.escala12x36) return p.escala12x36 === "PAR" ? dia % 2 === 0 : dia % 2 === 1
    if (dow === 0 || (dow === 6 && (vr || !p.trabalhaSabado))) return false
    const feriado = feriados.some((f) => f.data === data && (normMensal(f.tipo) === "NACIONAL" || f.contratos.map(normMensal).includes(normMensal(p.contrato))))
    return !feriado || normMensal(p.contrato).startsWith("SEDUC") || normMensal(p.contrato) === "DETRAN"
  })
}

export function calcularMensal(
  convocacoes: ConvocacaoMensal[], regras: RegraBeneficioMensal[], feriados: FeriadoMensal[], descontosOriginais: DescontoMensal[],
): ResultadoCalculoMensal {
  const descontos = descontosOriginais.map((d) => ({ ...d }))
  const grupos = new Map<string, ConvocacaoMensal[]>()
  for (const p of convocacoes) grupos.set(normMensal(p.contrato), [...(grupos.get(normMensal(p.contrato)) ?? []), p])
  const contratos: ContratoCalculadoMensal[] = []
  for (const convocacoesContrato of grupos.values()) {
    const porPessoa = new Map<string, ConvocacaoMensal[]>()
    for (const p of convocacoesContrato) {
      const key = p.cpf.replace(/\D/g, "") || p.chapa.trim()
      porPessoa.set(key, [...(porPessoa.get(key) ?? []), p])
    }
    const pessoas: PessoaCalculadaMensal[] = []
    const planUpdates: PlanUpdateMensal[] = []
    const descontosTocados = new Set<DescontoMensal>()
    for (const [key, linhas] of porPessoa) {
      const base = linhas[0]!, regra = resolverRegra(regras, base)
      const escala = !!base.escala12x36
      const tipoVRMensal = !escala && regra.vrMensal > 0
      const tipoVTMensal = !escala && regra.vtMensal > 0
      // ESTILO PONTUAL: regra "mensal" vira valor-dia (mensal/30); paga-se por dia trabalhado.
      const vrDia = tipoVRMensal ? r2(regra.vrMensal / 30) : r2(regra.vrDia)
      let vtDia = tipoVTMensal ? r2(regra.vtMensal / 30) : r2(regra.vtDia)
      if (!base.optanteVT) vtDia = 0
      else if (base.vtSoVolta) vtDia = r2(vtDia / 2)
      // Dias por LINHA (convocação) — necessário pros updates por item do Plano.
      // Paridade pontual: dias VT só contam quando vtDia > 0 (não-optante grava 0 dias).
      const linhasDias = linhas.map((l) => ({
        itemId: l.itemId,
        inicio: l.inicio,
        nVR: diasElegiveis(l, feriados, true).length,
        nVT: vtDia > 0 ? diasElegiveis(l, feriados, false).length : 0,
      }))
      const totalDiasVR = linhasDias.reduce((n, l) => n + l.nVR, 0)
      const totalDiasVT = linhasDias.reduce((n, l) => n + l.nVT, 0)
      let brutoVR = r2(vrDia * totalDiasVR)
      let brutoVT = r2(vtDia * totalDiasVT)
      let descontoVR = 0, descontoVT = 0
      for (const d of descontos.filter((x) => x.pessoaKey === key).sort((a, b) => a.inicio.localeCompare(b.inicio))) {
        const tiraVR = Math.min(brutoVR, d.residualVR), tiraVT = Math.min(brutoVT, d.residualVT)
        if (tiraVR <= 0 && tiraVT <= 0) continue
        brutoVR = r2(brutoVR - tiraVR); brutoVT = r2(brutoVT - tiraVT)
        descontoVR = r2(descontoVR + tiraVR); descontoVT = r2(descontoVT + tiraVT)
        d.residualVR = r2(d.residualVR - tiraVR); d.residualVT = r2(d.residualVT - tiraVT)
        d.descontadoVR = r2(d.descontadoVR + tiraVR); d.descontadoVT = r2(d.descontadoVT + tiraVT)
        descontosTocados.add(d)
      }
      // Crédito em conta Caju: até 3 dias de VR, e VT NENHUM — o VT vai 100% no boleto.
      // Confirmado pelo DP em 01/08/2026 contra o pagamento oficial do SEMSA (pedido Caju
      // 622cd7d3): 73,50/pessoa em alimentação (3 × 24,50) e VT zerado nas 29 linhas.
      // Antes eram 2 dias de VR + 2 de VT ("estilo pontual"), o que dava 69,00/pessoa e
      // divergia do oficial em 4,50 por pessoa (130,50 no contrato).
      // É TETO, não valor fixo: quem tem menos dias recebe o que tem direito (Math.min abaixo).
      const tetoVR = r2(vrDia * 3)
      const tetoVT = 0
      const creditoVR = r2(Math.min(brutoVR, tetoVR)), creditoVT = r2(Math.min(brutoVT, tetoVT))
      // Alocação do crédito por linha (ordem: inicio, itemId) — espelha o n8n.
      let remVR = creditoVR, remVT = creditoVT
      for (const l of [...linhasDias].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.itemId.localeCompare(b.itemId))) {
        const maxVR = r2(vrDia * l.nVR), maxVT = r2(vtDia * l.nVT)
        const credVR = r2(Math.min(remVR, maxVR)), credVT = r2(Math.min(remVT, maxVT))
        remVR = r2(remVR - credVR); remVT = r2(remVT - credVT)
        planUpdates.push({
          itemId: l.itemId,
          vtDia,
          // Estilo pontual: VR-Unitário sempre recebe o valor-dia efetivo (mesmo
          // quando a regra é mensal — mensal/30). VR-MENSAL fica como referência da regra.
          vrDia,
          vrMensal: tipoVRMensal ? r2(regra.vrMensal) : 0,
          diasVR: l.nVR,
          diasVT: l.nVT,
          creditoVR: credVR,
          creditoVT: credVT,
        })
      }
      pessoas.push({ ...base, key, itemIds: linhas.map((p) => p.itemId), diasVR: totalDiasVR, diasVT: totalDiasVT,
        vrDia, vtDia, vrMensal: regra.vrMensal, brutoVR: r2(brutoVR + descontoVR), brutoVT: r2(brutoVT + descontoVT),
        descontoVR, descontoVT, liquidoVR: brutoVR, liquidoVT: brutoVT, creditoVR, creditoVT,
        pixVR: r2(brutoVR - creditoVR), pixVT: r2(brutoVT - creditoVT), regraAplicada: regra.id })
    }
    const ativas = pessoas.filter((p) => p.liquidoVR + p.liquidoVT > 0)
    const descontoUpdates: DescontoUpdateMensal[] = [...descontosTocados].map((d) => ({
      id: d.id, residualVR: d.residualVR, residualVT: d.residualVT,
      descontadoVR: d.descontadoVR, descontadoVT: d.descontadoVT,
      status: d.residualVR <= 0 && d.residualVT <= 0 ? "FINALIZADO" : "PARCIAL",
    }))
    contratos.push({ contrato: convocacoesContrato[0]!.contrato, codSecao: codigoSecaoContrato(convocacoesContrato[0]!.contrato), pessoas: ativas,
      planUpdates, descontoUpdates,
      totais: ativas.reduce((t, p) => ({ vr: r2(t.vr + p.liquidoVR), vt: r2(t.vt + p.liquidoVT),
        credito: r2(t.credito + p.creditoVR + p.creditoVT), pix: r2(t.pix + p.pixVR + p.pixVT) }), { vr: 0, vt: 0, credito: 0, pix: 0 }) })
  }
  return { contratos: contratos.filter((c) => c.pessoas.length), descontos: descontos.map((d) => ({ ...d, status: d.residualVR <= 0 && d.residualVT <= 0 ? "FINALIZADO" : "PARCIAL" })) }
}
