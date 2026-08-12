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
  /** null quando a regra é MENSAL (paga por mês) — limpa a célula VR - Unitário no board. */
  vrDia: number | null
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
  /** Só quem TEM saldo a pagar (`liquido > 0`) — é quem entra na rodada de pagamento. */
  pessoas: PessoaCalculadaMensal[]
  /**
   * Quem o FIFO zerou: o desconto pendente consumiu o benefício inteiro.
   *
   * Não é erro nem lista vazia — é desfecho de negócio conhecido (o `If2#false` do WF5
   * Pontual, ajustado em 30/07/2026): o board ainda recebe dias, valor unitário,
   * `CRÉDITO = 0` e o `DESCONTO - VR/VT` mostrando para onde o benefício foi, e **nada**
   * de Caju/RM/Solicitação acontece.
   *
   * O mensal ignora esta lista (`pessoas` já é o filtro que ele quer). Existe porque o
   * PONTUAL precisa distinguir "dívida comeu tudo" de "não há dias elegíveis" — dois
   * motivos com tratamento oposto na felipeta.
   */
  pessoasSemSaldo: PessoaCalculadaMensal[]
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
// Feriado: mantém a regra do board FERIADOS (SEDUC*/DETRAN recebem; demais não) —
// única divergência consciente do pontual, que não filtra feriado.
//
// EXCEÇÃO — regra de VR MENSAL (`vrTodosDias`, hoje DETRAN e TRE PB): conta DIAS CORRIDOS,
// sábado e domingo incluídos. O par é indissociável: o valor-dia vem de `vrMensal / 30`, e 30
// é mês CORRIDO. Dividir por 30 e contar só dias úteis mistura duas bases e paga menos que o
// mensal — era o bug do DETRAN (588,00/mês virava 411,60 em agosto/2026: 19,60 × 21 úteis, em
// vez de × 30 corridos). Espelha o nó "Code in JavaScript1" do WF5 Pontual, que faz
// `if (__vrTodosDias && !__ehUtil) diasVR++`. Só o VR muda; o VT segue seg-sex (+sábado).
//
// TETO DO MÊS — o dia 31 NÃO conta no VR de regra mensal. O divisor é 30 fixo, então contar 31
// dias corridos paga 31/30 do benefício: em agosto/2026 o MICHEL levou 607,60 de um mensal de
// 588,00. Com o dia 31 fora, mês cheio fecha EXATAMENTE o mensal e período parcial segue
// proporcional (03–31/08 = 28 dias, não 29). Regra do DP, apurada na correção manual do DETRAN
// de 03/08/2026 (Thifany, board 08/26): pagamos 149,45 a mais em 8 pessoas — 1 dia cada — e o
// TRE PB 22,00. Mês de 30 dias ou menos não é afetado. ✅ O WF5 Pontual TAMBÉM tem o teto desde
// 07/08/2026 (`__vrForaDoTeto`, no mesmo `Code in JavaScript1`, aplicado via UPDATE na coluna
// `nodes` do Postgres do n8n) — sem ele os 3 pontuais DETRAN de 08/2026 saíam com 28 dias em vez
// de 27. Então nesta regra as duas pontas concordam; a divergência que sobra é o feriado (acima).
function diasElegiveis(
  p: ConvocacaoMensal,
  feriados: FeriadoMensal[],
  vr: boolean,
  vrTodosDias = false,
): string[] {
  return intervalo(p.inicio, p.fim).filter((data) => {
    const dia = Number(data.slice(-2)), dow = new Date(`${data}T00:00:00Z`).getUTCDay()
    if (p.escala12x36) return p.escala12x36 === "PAR" ? dia % 2 === 0 : dia % 2 === 1
    const corrido = vr && vrTodosDias
    if (corrido && dia > 30) return false
    if (!corrido && (dow === 0 || (dow === 6 && (vr || !p.trabalhaSabado)))) return false
    const feriado = feriados.some((f) => f.data === data && (normMensal(f.tipo) === "NACIONAL" || f.contratos.map(normMensal).includes(normMensal(p.contrato))))
    return !feriado || normMensal(p.contrato).startsWith("SEDUC") || normMensal(p.contrato) === "DETRAN"
  })
}

/**
 * Teto de crédito em conta Caju, em DIAS de benefício.
 *
 * Parametrizado porque os dois fluxos divergem por decisão de negócio, não por acidente:
 * no MENSAL o DP credita os 3 primeiros dias à mão na Caju (conferido contra o pedido
 * oficial `622cd7d3`), então o cálculo espelha isso; no PONTUAL não há crédito manual, e a
 * regra segue 2 dias de VR + 2 de VT (decisão do Isaac, 12/08/2026).
 *
 * ⚠️ `calcularPontual` NÃO pode chamar `calcularMensal` sem passar isto: herdar 3/0 em
 * silêncio é erro de dinheiro em toda convocação, e contamina `pixVR`/`pixVT`, que derivam
 * do crédito.
 */
export interface TetoCreditoDias {
  vr: number
  vt: number
}
export const TETO_CREDITO_MENSAL: TetoCreditoDias = { vr: 3, vt: 0 }
export const TETO_CREDITO_PONTUAL: TetoCreditoDias = { vr: 2, vt: 2 }

export function calcularMensal(
  convocacoes: ConvocacaoMensal[], regras: RegraBeneficioMensal[], feriados: FeriadoMensal[], descontosOriginais: DescontoMensal[],
  tetoCredito: TetoCreditoDias = TETO_CREDITO_MENSAL,
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
        // Regra mensal -> VR por dias corridos (o /30 é mês corrido). VT nunca muda.
        nVR: diasElegiveis(l, feriados, true, tipoVRMensal).length,
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
      // Crédito em conta Caju, em DIAS de benefício — vem de `tetoCredito` (ver
      // TETO_CREDITO_MENSAL / TETO_CREDITO_PONTUAL no topo).
      //
      // MENSAL = 3 dias de VR e VT NENHUM (o VT vai 100% no boleto). Confirmado pelo DP em
      // 01/08/2026 contra o pagamento oficial do SEMSA (pedido Caju 622cd7d3): 73,50/pessoa
      // em alimentação (3 × 24,50) e VT zerado nas 29 linhas. Antes eram 2+2 ("estilo
      // pontual"), o que dava 69,00/pessoa e divergia do oficial em 4,50 por pessoa
      // (130,50 no contrato).
      //
      // PONTUAL = 2 dias de VR + 2 de VT: lá o DP não credita nada à mão, então não há o
      // que espelhar (decisão do Isaac, 12/08/2026).
      //
      // É TETO, não valor fixo: quem tem menos dias recebe o que tem direito (Math.min abaixo).
      const tetoVR = r2(vrDia * tetoCredito.vr)
      const tetoVT = r2(vtDia * tetoCredito.vt)
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
          // Regra MENSAL (ex. DETRAN): o board recebe SÓ o VR - MENSAL, e o VR - Unitário fica
          // VAZIO — o benefício é pago por mês, e mostrar os dois lado a lado dava leitura dúbia.
          // Regra diária: o inverso (unitário preenchido, VR - MENSAL zerado).
          // O cálculo NÃO muda: o valor-dia efetivo (mensal/30) continua sendo o que multiplica
          // os dias e alimenta o teto de crédito — só não vai mais pra célula.
          vrDia: tipoVRMensal ? null : vrDia,
          // `VR - MENSAL` é o valor GANHO no período desta linha (dias × valor-dia), não o
          // parâmetro mensal do board de valores. Escrevíamos o parâmetro cru (588,00 em toda
          // linha DETRAN, inclusive numa convocação de 3 dias) e o DP reescrevia à mão as 8 linhas
          // que divergiam — em 08/2026 a coluna somava 5.659,50 contra os 4.331,60 devidos.
          // É o BRUTO: o desconto FIFO tem coluna própria (`DESCONTO - VR`) no mesmo board.
          vrMensal: tipoVRMensal ? maxVR : 0,
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
      pessoasSemSaldo: pessoas.filter((p) => p.liquidoVR + p.liquidoVT <= 0),
      planUpdates, descontoUpdates,
      totais: ativas.reduce((t, p) => ({ vr: r2(t.vr + p.liquidoVR), vt: r2(t.vt + p.liquidoVT),
        credito: r2(t.credito + p.creditoVR + p.creditoVT), pix: r2(t.pix + p.pixVR + p.pixVT) }), { vr: 0, vt: 0, credito: 0, pix: 0 }) })
  }
  // Contrato sem NINGUÉM sai do resultado — o mensal não abre rodada pra contrato vazio.
  // Mas "todo mundo com líquido zero" NÃO é contrato vazio: o desconto consumiu o benefício,
  // e o board + o ledger ainda têm que ser gravados (o `If2#false` do WF5). Por isso o filtro
  // olha as DUAS listas. Sem `pessoasSemSaldo` aqui, o pontual perdia o caso inteiro e
  // lançava "sem dias elegíveis", que é motivo errado — e a reserva ia embora com ele.
  return {
    contratos: contratos.filter((c) => c.pessoas.length || c.pessoasSemSaldo.length),
    descontos: descontos.map((d) => ({ ...d, status: d.residualVR <= 0 && d.residualVT <= 0 ? "FINALIZADO" : "PARCIAL" })),
  }
}
