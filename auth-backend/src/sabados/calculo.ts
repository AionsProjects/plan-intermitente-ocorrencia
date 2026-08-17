// Sábados extras — validação e cálculo. PURO, sem efeito externo.
//
// Porta dos nós `Validar payload` e da parte de valores do `Extrair CPF + Seção` do WF
// `3TAyDuKFkWGvXTHT` (backup em docs/n8n/backups/sabados-3TAyDuKFkWGvXTHT-nodes-2026-08-17.json).
//
// O que o sábado extra é: dia que o intermitente trabalhou fora da escala (o contrato dele
// não tem sábado) e por isso RECEBE VT daquele dia. É CRÉDITO, não desconto — então a regra
// de não-desconto de DETRAN/TRE PB (`naoDesconta`) NÃO se aplica aqui. Quem não trabalha
// sábado e trabalhou, recebe.
//
// VR não entra: o sábado extra paga só transporte, igual ao WF (CODBENEFICIO=2, evento 110).
import { resolverValores, vtDiaEfetivo, type LinhaValores } from "../domain/desconto.js"

const ISO = /^\d{4}-\d{2}-\d{2}$/

export interface EntradaSabados {
  uuid?: string | null
  nome: string
  chapa: string
  contrato: string
  funcao?: string | null
  sabados: string[]
  optanteVT: boolean
  /** Optante "SIM*" — a empresa cobre só a volta, então VT do dia vale metade. */
  vtSoVolta?: boolean
  interior?: boolean
  anoComp: number
  mesComp: number
}

export interface PedidoSabados {
  uuid: string | null
  nome: string
  /** Sempre 6 dígitos — o RM casa por chapa com zero à esquerda. */
  chapa: string
  contrato: string
  sabados: string[]
  qtdSabados: number
  vtDia: number
  valorTotal: number
  optanteVT: true
  vtSoVolta: boolean
  interior: boolean
  anoComp: number
  mesComp: number
  regraAplicada: string | null
}

export interface ErroSabados {
  erro: string
  mensagem: string
  status: number
}

export const ehErroSabados = (v: PedidoSabados | ErroSabados): v is ErroSabados => "erro" in v

function chapa6(v: string): string {
  return String(v || "").replace(/\D/g, "").padStart(6, "0")
}

/** Sábados válidos, únicos e ordenados. Duplicata no payload não paga duas vezes. */
export function normalizarSabados(v: unknown): string[] {
  const bruto = Array.isArray(v) ? v : []
  const vistos = new Set<string>()
  for (const d of bruto) if (typeof d === "string" && ISO.test(d)) vistos.add(d)
  return [...vistos].sort()
}

/**
 * Valida e calcula o pedido de sábado extra.
 *
 * `optanteVT` falso é RECUSA, não zero: pagar boleto de R$ 0 criaria pedido vazio na Caju e
 * lançamento de nada no RM. É o mesmo `nao_optante_vt` do WF.
 */
export function montarPedidoSabados(
  e: EntradaSabados,
  linhasValores: LinhaValores[],
): PedidoSabados | ErroSabados {
  const sabados = normalizarSabados(e.sabados)
  if (sabados.length === 0)
    return { status: 400, erro: "sem_sabados", mensagem: "Nenhum sábado extra informado." }

  const chapa = chapa6(e.chapa)
  if (!chapa || chapa === "000000")
    return { status: 400, erro: "chapa_obrigatoria", mensagem: "Chapa é obrigatória." }
  const nome = String(e.nome ?? "").trim()
  if (!nome) return { status: 400, erro: "nome_obrigatorio", mensagem: "Nome é obrigatório." }

  if (!e.optanteVT)
    return {
      status: 400,
      erro: "nao_optante_vt",
      mensagem: "Empregado não é optante de VT — sábado extra não gera benefício.",
    }

  const contrato = String(e.contrato ?? "").trim().toUpperCase()
  const v = resolverValores(linhasValores, { contrato, funcao: String(e.funcao ?? "") })
  if ("erro" in v) return { status: 422, erro: v.erro, mensagem: v.mensagem }

  const vtDia = vtDiaEfetivo({ vtDia: v.vtDia, optanteVT: true, vtSoVolta: e.vtSoVolta === true })
  if (vtDia <= 0)
    return {
      status: 422,
      erro: "vt_dia_zero",
      mensagem: `Contrato ${contrato} resolveu VT/dia = 0 — nada a pagar.`,
    }

  // Arredonda o TOTAL, não o produto parcial: vtDia já vem em 2 casas, e somar N vezes um
  // valor de 2 casas não cria dízima. Round no fim protege de ruído de float.
  const valorTotal = Math.round(vtDia * sabados.length * 100) / 100

  return {
    uuid: e.uuid ?? null,
    nome,
    chapa,
    contrato,
    sabados,
    qtdSabados: sabados.length,
    vtDia,
    valorTotal,
    optanteVT: true,
    vtSoVolta: e.vtSoVolta === true,
    interior: e.interior === true,
    anoComp: e.anoComp,
    mesComp: e.mesComp,
    regraAplicada: v.regraAplicada ?? null,
  }
}
