// Extensão do fim da convocação no RM — o que o FIM DE SEMANA SÓ PRA FOLHA precisa.
//
// O cancelamento parcial encurta (`encurtarConvocacoesDoItem`); isto é a mesma edição de
// DTFIMPRESTSERV no sentido contrário, pela mesma `editarFimLancamentoRm`: mesma PK, mesmo
// código, sem S-2260 novo. Decisão do Isaac (24/09/2026): "estender a atual", e não abrir uma
// convocação só com os dias do fim de semana.
//
// Duas travas antes de escrever:
//   1. só o lançamento NOSSO que termina exatamente no fim da convocação — se o último pedaço
//      termina antes (quebra por atestado, corte), estender cobriria dia que não é pra cobrir;
//   2. pré-voo no RM dos dias novos: convocação lançada à mão pelo DP (ou outra nossa) nesses
//      dias viraria sobreposição — aí não estende e devolve o conflito.
import { somarDias } from "../domain/convocacaoRm.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import { editarFimLancamentoRm, type ResultadoEdicaoRm } from "./convocacaoRemover.js"
import { preVooConvocacaoRm } from "./convocacaoRm.js"

export type EstadoExtensaoRm =
  | ResultadoEdicaoRm["estado"]
  /** Nenhum lançamento nosso vivo no RM para o item — não há o que estender. */
  | "sem_convocacao_rm"
  /** O último pedaço no RM não termina no fim da convocação (atestado, corte). */
  | "fim_divergente"
  /** O RM já tem convocação nos dias novos. */
  | "conflito_no_rm"

export interface ResultadoExtensaoRm {
  estado: EstadoExtensaoRm
  codConvocacao?: string
  dataFimAnterior?: string
  dataFimNova?: string
  detalhe?: string
  erro?: string
}

export interface DepsExtensaoRm {
  lancamentos: typeof lancamentosDoItem
  preVoo: typeof preVooConvocacaoRm
  editarFim: typeof editarFimLancamentoRm
}

const DEPS_PADRAO: DepsExtensaoRm = {
  lancamentos: lancamentosDoItem,
  preVoo: preVooConvocacaoRm,
  editarFim: editarFimLancamentoRm,
}

export async function estenderFimConvocacaoDoItem(
  itemOrigemId: string | number,
  p: { dataFimConvocacao: string; novoFim: string; timeoutMs?: number },
  deps: Partial<DepsExtensaoRm> = {},
): Promise<ResultadoExtensaoRm> {
  const d = { ...DEPS_PADRAO, ...deps }
  const vivos = await d.lancamentos(itemOrigemId, { apenasVivos: true })
  if (!vivos.length) {
    return { estado: "sem_convocacao_rm", detalhe: "nenhuma convocação desta automação viva no RM para o item" }
  }
  // O último pedaço: com quebra por atestado ou divisão de contrato, o item tem vários.
  const ultimo = [...vivos].sort((a, b) => String(a.data_fim).localeCompare(String(b.data_fim))).at(-1)!
  const fim = String(ultimo.data_fim).slice(0, 10)
  const novoFim = String(p.novoFim).slice(0, 10)
  const base = { codConvocacao: ultimo.codigo ?? undefined, dataFimAnterior: fim }

  if (fim >= novoFim) return { ...base, estado: "ja_no_periodo", dataFimNova: fim }
  if (fim !== String(p.dataFimConvocacao).slice(0, 10)) {
    return {
      ...base,
      estado: "fim_divergente",
      detalhe: `a convocação no RM termina em ${fim}, não em ${String(p.dataFimConvocacao).slice(0, 10)}`,
    }
  }

  const pre = await d.preVoo(
    [{ chapa: ultimo.chapa, dataInicio: somarDias(fim, 1), dataFim: novoFim }],
    { coligada: ultimo.coligada, timeoutMs: p.timeoutMs },
  )
  const conflito = pre.jaExistem[0]?.existente
  if (conflito) {
    return {
      ...base,
      estado: "conflito_no_rm",
      detalhe: `${conflito.codConvocacao} ${conflito.dataInicio}..${conflito.dataFim}`,
    }
  }

  const r = await d.editarFim(ultimo, { dataFim: novoFim, timeoutMs: p.timeoutMs })
  return {
    estado: r.estado,
    codConvocacao: r.codConvocacao ?? base.codConvocacao,
    dataFimAnterior: r.dataFimAnterior ?? fim,
    dataFimNova: r.dataFimNova,
    erro: r.erro,
  }
}
