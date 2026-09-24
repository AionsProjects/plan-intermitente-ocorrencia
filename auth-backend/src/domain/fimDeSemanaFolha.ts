// Fim de semana só para a FOLHA — sábado/domingo logo depois do fim da convocação.
//
// Pedido do DP (O.S. 13033746674, ponto 7) e desenho do Isaac (24/09/2026): o operacional
// adiciona pelo link o fim de semana que o intermitente trabalhou DEPOIS do período, pra folha
// enxergar os dias sem ninguém mexer na data da convocação no board (que fica travada depois do
// pagamento dos benefícios). Não gera VR/VT e não entra no ledger de desconto — só ESTENDE a
// convocação no RM (DTFIMPRESTSERV), que é de onde a FOPAG lê.
//
// Só o fim de semana COLADO no fim, no mesmo mês:
//   - os de dentro do período o RM já cobre (a convocação no RM é período, não dia a dia);
//   - antes do início exigiria mexer no início no RM, e com ele na data do ato (3 dias antes);
//   - passar do mês cruzaria competência, e o board é mensal.
// Convocação cancelada (total ou parcial) não estende: o fim dela no RM já foi cortado.
//
// PURO: sem I/O, testável sem env.

const ISO = /^\d{4}-\d{2}-\d{2}$/

function somar(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const diaDaSemana = (iso: string): number => new Date(`${iso}T12:00:00Z`).getUTCDay()

/** Sábado e domingo do primeiro fim de semana DEPOIS de `dataFim`, dentro do mesmo mês. */
export function finsDeSemanaDisponiveis(dataFim: string): string[] {
  const fim = String(dataFim ?? "").slice(0, 10)
  if (!ISO.test(fim)) return []
  const out: string[] = []
  for (let i = 1; i <= 7; i++) {
    const d = somar(fim, i)
    if (d.slice(0, 7) !== fim.slice(0, 7)) break
    const dia = diaDaSemana(d)
    if (dia === 6 || dia === 0) out.push(d)
    if (dia === 0) break
  }
  return out
}

export interface FinsDeSemanaValidados {
  /** Dias que entram — já gravados antes somados aos novos. */
  validos: string[]
  /** O que veio e não cabe (fora do fim de semana colado, outro mês, convocação cancelada). */
  descartados: string[]
  /** Novo DTFIMPRESTSERV no RM: o último dia válido. Nulo = nada a estender. */
  novoFim: string | null
}

/**
 * Valida a lista do corpo contra a convocação.
 *
 * Gravado não sai: a extensão no RM só anda pra frente (o link não encurta de volta), então o
 * dia que já foi estendido continua na lista mesmo que o corpo venha sem ele.
 */
export function validarFinsDeSemanaFolha(
  doCorpo: readonly unknown[],
  ctx: { dataFim: string; cancelada: boolean; jaGravados?: readonly string[] },
): FinsDeSemanaValidados {
  const permitidos = new Set(ctx.cancelada ? [] : finsDeSemanaDisponiveis(ctx.dataFim))
  const gravados = (ctx.jaGravados ?? []).map((d) => String(d).slice(0, 10)).filter((d) => ISO.test(d))
  const validos = new Set<string>(gravados)
  const descartados: string[] = []
  for (const d of [...new Set(doCorpo.map((s) => String(s).slice(0, 10)))].sort()) {
    if (validos.has(d)) continue
    if (permitidos.has(d)) validos.add(d)
    else descartados.push(d)
  }
  const lista = [...validos].sort()
  return { validos: lista, descartados, novoFim: lista.length ? lista[lista.length - 1]! : null }
}

/** ISO puro → dd/mm/aaaa sem passar por Date: data seca não tem fuso. */
const fmtData = (iso: string): string => {
  const [aaaa, mm, dd] = String(iso).slice(0, 10).split("-")
  return `${dd}/${mm}/${aaaa}`
}

/**
 * Balãozinho no item do Plano quando a convocação é estendida no RM: o que entrou, que não tem
 * benefício, e até onde o RM foi. É o rastro que o DP enxerga sem abrir o RM.
 */
export function montarTextoBalaoFolha(
  dias: readonly string[],
  rm: { codConvocacao: string | null; de: string; ate: string },
): string {
  const datas = [...dias].sort().map(fmtData)
  const lista = datas.length > 1 ? `${datas.slice(0, -1).join(", ")} e ${datas[datas.length - 1]}` : (datas[0] ?? "")
  return [
    `Fim de semana para a folha: ${lista} (sem VR/VT).`,
    `Convocação no RM${rm.codConvocacao ? ` ${rm.codConvocacao}` : ""} estendida de ${fmtData(rm.de)} até ${fmtData(rm.ate)}.`,
  ].join("\n")
}
