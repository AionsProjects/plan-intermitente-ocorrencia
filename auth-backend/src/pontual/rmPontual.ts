// RM do PONTUAL — o que difere do mensal e por quê:
//
// - eventos do FopRotinas: 100 (VR) / 110 (VT). O mensal usa 101/111 (chumbado em
//   chapasEventosPix); trocar lá quebraria o mensal, então a variante vive aqui.
// - eventos derivam do VALOR FINAL (pix>0), fidelidade ao WF5: o Code10 monta a lista a
//   partir do líquido, e o WF6 só roda quando há boleto — quem garante "crédito não gera
//   financeiro" é a ORDEM (histórico do crédito só depois do FopRotinas), não um if.
// - TPBEN: 0 no histórico do BOLETO (diário), 1 no do CRÉDITO (mensal) — paridade WF5.
//   O mensal grava tudo com 1; por isso o parâmetro em montarXmlHistorico tem default 1.
// - competência = mês da data_inicio da CONVOCAÇÃO (permite retroativo), não o mês corrente.
import { chapa6, montarXmlHistorico, type RegistroHistoricoRm } from "../mensal/rmEfeitos.js"
import type { PessoaPreviaMensal } from "../mensal/types.js"

export const EVENTO_PONTUAL_VR = "100"
export const EVENTO_PONTUAL_VT = "110"

/** Eventos do FopRotinas — do valor FINAL (pix por benefício), nunca de "teve boleto". */
export function eventosPontual(pessoa: Pick<PessoaPreviaMensal, "pixVR" | "pixVT">): string[] {
  const out: string[] = []
  if ((Number(pessoa.pixVR) || 0) > 0) out.push(EVENTO_PONTUAL_VR)
  if ((Number(pessoa.pixVT) || 0) > 0) out.push(EVENTO_PONTUAL_VT)
  return out
}

/** Competência do RM = mês/ano do INÍCIO da convocação. */
export function competenciaPontual(dataInicio: string): { anoComp: number; mesComp: number } {
  const [ano, mes] = String(dataInicio).split("-").map(Number)
  return { anoComp: ano || 0, mesComp: mes || 0 }
}

/**
 * Registros ZMDHSTBENFUNC de UMA pessoa. `tipo` decide valor E TPBEN:
 * pix → pixVR/pixVT com TPBEN=0; credito → creditoVR/creditoVT com TPBEN=1.
 */
export function registrosHistoricoPontual(
  pessoa: PessoaPreviaMensal,
  tipo: "pix" | "credito",
  ctx: { codSecao: string; dataImport: string },
): RegistroHistoricoRm[] {
  const chapa = chapa6(pessoa.chapa)
  if (!chapa || chapa === "000000") return []
  const { anoComp, mesComp } = competenciaPontual(pessoa.dataInicio)
  const tpben: 0 | 1 = tipo === "pix" ? 0 : 1
  const label = tipo === "pix" ? "PIX" : "CREDITO"
  const out: RegistroHistoricoRm[] = []
  const pares: Array<{ beneficio: 1 | 2; sufixo: "VR" | "VT"; valor: number }> = [
    { beneficio: 1, sufixo: "VR", valor: Number((tipo === "pix" ? pessoa.pixVR : pessoa.creditoVR) || 0) },
    { beneficio: 2, sufixo: "VT", valor: Number((tipo === "pix" ? pessoa.pixVT : pessoa.creditoVT) || 0) },
  ]
  for (const p of pares) {
    if (p.valor <= 0) continue
    out.push({
      tipo: `HIST_${label}_${p.sufixo}`,
      chapa,
      nome: pessoa.nome,
      valor: p.valor,
      codBeneficio: p.beneficio,
      dadosXml: montarXmlHistorico({
        anoComp, mesComp, chapa, nome: pessoa.nome,
        codSecao: ctx.codSecao, codBeneficio: p.beneficio,
        vlrTotal: p.valor, dataImport: ctx.dataImport, tpben,
      }),
    })
  }
  return out
}

/** Uma linha do IDFNAN, no que interessa pra decidir o que integrar. */
export interface LancamentoIdfinanc {
  IDFINANC: number | string
  VALORORIGINAL?: number
  tipoEvento?: string
}

export interface ClassificacaoIdfinanc<T> {
  /** Valor bate com o esperado → integra (dedup por IDFINANC fica com quem executa). */
  integrar: T[]
  /** Valor NÃO bate → é de outro pagamento da mesma seção/dia. */
  divergentes: T[]
}

/**
 * Separa os lançamentos da seção/dia entre "deste pagamento" e "de outro".
 *
 * A consulta IDFNAN é por SEÇÃO e DIA, não por pessoa — e toda a SEMSA compartilha
 * `01.01.0085`. Do segundo pagamento do dia em diante, os lançamentos dos anteriores sempre
 * aparecem: em 14/08 a run da MÁRCIA encontrou 4 (os 2 dela e os 2 da TRIMEIA, de 40min antes).
 * Integrar por posição ou "todos os que apareceram" lançaria o boleto de um na conta do outro.
 *
 * O critério é o VALOR (±0,05), único campo que distingue as pessoas nessa resposta. Tolerância e
 * não igualdade porque o RM devolve float.
 *
 * `alvo <= 0` sai fora: benefício que este pagamento não tem (só VR, por exemplo) não pode casar
 * com lançamento nenhum — sem isso um VT alheio de valor zero entraria.
 */
export function classificarLancamentosIdfinanc<T extends LancamentoIdfinanc>(
  rows: T[],
  esperado: { VR: number; VT: number },
  tolerancia = 0.05,
): ClassificacaoIdfinanc<T> {
  const integrar: T[] = []
  const divergentes: T[] = []
  for (const row of rows) {
    if (row.tipoEvento !== "VR" && row.tipoEvento !== "VT") continue
    const alvo = esperado[row.tipoEvento]
    if (!(alvo > 0)) continue
    // Sem VALORORIGINAL não há como distinguir — integra, que é o comportamento herdado do WF5.
    if (typeof row.VALORORIGINAL === "number" && Math.abs(row.VALORORIGINAL - alvo) > tolerancia) {
      divergentes.push(row)
      continue
    }
    integrar.push(row)
  }
  return { integrar, divergentes }
}
