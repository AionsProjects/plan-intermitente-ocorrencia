// Convocações do MENSAL no RM — o lote de um contrato, chamado ao fim do pagamento mensal.
//
// Decisões do Isaac (10/08/2026, docs/rm/plano-convocacao-mensal.md):
//   1. TODO o grupo MENSAL recebe S-2260 — inclusive quem foi 100% descontado (líquido zero) e o
//      cancelado parcial (período truncado). Por isso este serviço LÊ O BOARD, e não o snapshot
//      da prévia: o snapshot filtra o líquido-zero e nem enxerga o grupo CANCELADOS PARCIAL.
//   3. Convocação CANCELADA no RM (lançada à mão) = requer_decisao_dp. Nem regravar nem pular
//      calado.
//   4. Falha parcial = contrato ERRO — quem traduz é o step do workflow; aqui só se relata.
//
// Sobre duplicidade, as três barreiras do pontual continuam TODAS ativas — o pré-voo por pessoa
// NÃO é pulado. O plano previa pré-voo do grupo + pularPreVoo como otimização; medido, um
// ReadView por pessoa custa ~1-2s e o step roda em lotes de ~10, então a otimização não paga o
// risco (com pularPreVoo, a checagem por PEDAÇO viraria responsabilidade daqui — mais um lugar
// pra errar a mesma coisa). Se o volume crescer, otimiza-se depois, com o índice e o ledger ainda
// de rede.
import { query } from "../db.js"
import { config } from "../config.js"
import { mondayGraphql } from "../monday.js"
import { effectivePeriod } from "../domain/antifraude.js"
import { chapaAceitavelNoFiltro, estadoConvocacaoValido } from "../domain/convocacaoRm.js"
import { enfileirar } from "../jobs/repo.js"
import { ausenciasDoContrato } from "./ausenciasRm.js"
import {
  processarConvocacaoPontual,
  TIMEOUT_FILA_MS,
  type DepsPontual,
  DEPS_PONTUAL_PADRAO,
} from "./convocacaoPontual.js"

// Mesmo tipo do job do pontual — o mensal reusa a MESMA fila pra conciliação de pedaço mudo.
// Import direto criaria ciclo (o job importa convocacaoPontual); a constante é estável.
const TIPO_JOB_CONVOCACAO_RM = "convocacao_rm_pontual"

// ---------------------------------------------------------------------------
// Leitura do board — grupo MENSAL + CANCELADOS PARCIAL, filtrado por contrato.
// ---------------------------------------------------------------------------

export interface ItemConvocacaoMensal {
  itemId: string
  nome: string
  chapa: string
  contrato: string
  dataInicio: string
  dataFim: string
  dataAdmissao: string | null
  statusConvocacao: string | null
  cancelamentoInicio: string | null
  grupo: string
}

interface RawItem {
  id: string
  name: string
  column_values: Array<{ id: string; text: string | null; column: { title: string } }>
}

const norm = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()

/**
 * Board do run. O snapshot da prévia já resolveu qual board é (o run carrega `papel`, e desde
 * 03/08 o mensal roda com `papel='proximo'`) — resolver `atual` aqui de novo faria o passo do RM
 * ler um board DIFERENTE do resto do mensal. Depois da virada de 14/08 isso deixa de ser
 * teórico: `atual` passa a ser a cópia do mês fechado.
 */
async function boardDoRun(boardId?: string): Promise<string> {
  if (boardId) return boardId
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel='atual' AND ativo=true
      ORDER BY atualizado_em DESC LIMIT 1`,
  )
  const b = rows[0]?.monday_board_id
  if (!b) throw new Error("board_atual_nao_registrado")
  return b
}

/**
 * Itens do contrato nos grupos MENSAL e CANCELADOS PARCIAL do board do run.
 *
 * CANCELADOS PARCIAL entra por decisão de negócio: o DP MOVE o item de grupo ao cancelar
 * parcialmente, e essa pessoa trabalhou até `Cancelamento Início - 1` — dias que precisam de
 * S-2260 como quaisquer outros. Era um dos "invisíveis" apontados na análise (2 itens reais).
 */
export async function lerItensConvocacaoMensal(
  contrato: string,
  boardIdDoRun?: string,
): Promise<ItemConvocacaoMensal[]> {
  const boardId = await boardDoRun(boardIdDoRun)

  const { rows: grupos } = await query<{ group_id: string; titulo: string }>(
    `SELECT group_id, titulo FROM board_grupos
      WHERE monday_board_id=$1 AND upper(titulo) IN ('MENSAL','CANCELADOS PARCIAL')`,
    [boardId],
  )
  const grupoMensal = grupos.find((g) => norm(g.titulo) === "MENSAL")
  // Sem o grupo MENSAL não há o que convocar — erro, não lista vazia (lista vazia silenciosa é
  // como um contrato inteiro ficaria sem S-2260 depois de uma virada mal-registrada).
  if (!grupoMensal) throw new Error("grupo_mensal_nao_registrado")

  const d = await mondayGraphql<{
    boards: Array<{ groups: Array<{ title: string; items_page: { items: RawItem[] } }> }>
  }>(
    `query($b:[ID!],$g:[String!]){
      boards(ids:$b){
        groups(ids:$g){ title items_page(limit:500){
          items{ id name column_values{ id text column{ title } } }
        } }
      }
    }`,
    { b: [boardId], g: grupos.map((g) => g.group_id) },
  )

  const alvo = norm(contrato)
  const out: ItemConvocacaoMensal[] = []
  for (const g of d.boards?.[0]?.groups ?? []) {
    for (const item of g.items_page?.items ?? []) {
      const col = (titulo: string): string => {
        const c = item.column_values.find((cv: RawItem["column_values"][number]) => norm(cv.column.title) === norm(titulo))
        return (c?.text ?? "").trim()
      }
      if (norm(col("Op - Contrato")) !== alvo) continue
      out.push({
        itemId: item.id,
        nome: col("Nome do Empregado") || item.name,
        chapa: col("Funcionário"),
        contrato: col("Op - Contrato"),
        dataInicio: col("OP - Data/Inicio"),
        dataFim: col("OP - Data/Fim"),
        dataAdmissao: col("Admissão") || null,
        statusConvocacao: col("Status") || null,
        cancelamentoInicio: col("Cancelamento Início") || null,
        grupo: g.title,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// O lote.
// ---------------------------------------------------------------------------

export interface PessoaRelatorioMensal {
  itemId: string
  nome: string
  chapa: string
  periodo: string
  desfecho:
    | "gravado"
    | "ja_lancado"
    | "ja_no_rm"
    | "coberto_por_ausencia"
    | "requer_decisao_dp"
    | "conciliando"
    | "falha"
    | "invalido"
    | "cancelada_sem_dias"
  codigos?: string[]
  detalhe?: string
}

export interface RelatorioConvocacaoMensal {
  contrato: string
  total: number
  gravados: number
  jaExistiam: number
  cobertos: number
  canceladasSemDias: number
  requerDecisao: PessoaRelatorioMensal[]
  conciliando: PessoaRelatorioMensal[]
  falhas: PessoaRelatorioMensal[]
  invalidos: PessoaRelatorioMensal[]
  pessoas: PessoaRelatorioMensal[]
  /** true = tem falha retryável ou decisão pendente — o step decide se o contrato marca erro. */
  temPendencia: boolean
}

export interface DepsConvocacaoMensal {
  lerItens: typeof lerItensConvocacaoMensal
  ausenciasContrato: typeof ausenciasDoContrato
  processar: typeof processarConvocacaoPontual
  enfileirarJob: typeof enfileirar
  quebraHabilitada: () => boolean
  pontual: DepsPontual
}

export const DEPS_MENSAL_PADRAO: DepsConvocacaoMensal = {
  lerItens: lerItensConvocacaoMensal,
  ausenciasContrato: ausenciasDoContrato,
  processar: processarConvocacaoPontual,
  enfileirarJob: enfileirar,
  quebraHabilitada: () => config.atestadoQuebraConvocacao,
  pontual: DEPS_PONTUAL_PADRAO,
}

/** Alvo pronto pra gravar: item + período EFETIVO (já truncado se cancelado parcial). */
export interface AlvoConvocacaoMensal {
  item: ItemConvocacaoMensal
  inicio: string
  fim: string
}

function relatorioVazio(contrato: string, total: number): RelatorioConvocacaoMensal {
  return {
    contrato,
    total,
    gravados: 0,
    jaExistiam: 0,
    cobertos: 0,
    canceladasSemDias: 0,
    requerDecisao: [],
    conciliando: [],
    falhas: [],
    invalidos: [],
    pessoas: [],
    temPendencia: false,
  }
}

/**
 * Filtra e trunca ANTES de qualquer I/O — puro e serializável de propósito: o step do workflow
 * guarda o resultado (WDK memoíza) e fatia os alvos em lotes.
 *
 * Cancelada total/sem datas sai aqui; cancelada parcial vira o período truncado (até
 * Cancelamento Início - 1).
 */
export function planejarAlvosMensal(
  contrato: string,
  itens: ItemConvocacaoMensal[],
): { alvos: AlvoConvocacaoMensal[]; previa: RelatorioConvocacaoMensal } {
  // `total` da prévia = só quem ELA classificou (inválidos/canceladas). O lote conta os alvos;
  // a soma dos dois fecha em itens.length sem contar ninguém duas vezes.
  const previa = relatorioVazio(contrato, 0)
  const alvos: AlvoConvocacaoMensal[] = []
  for (const item of itens) {
    const pessoaBase = { itemId: item.itemId, nome: item.nome, chapa: item.chapa }
    if (!chapaAceitavelNoFiltro(item.chapa)) {
      const p: PessoaRelatorioMensal = { ...pessoaBase, periodo: "", desfecho: "invalido", detalhe: "chapa_invalida" }
      previa.invalidos.push(p)
      previa.pessoas.push(p)
      previa.total++
      continue
    }
    const periodo = effectivePeriod(
      item.dataInicio || null,
      item.dataFim || null,
      item.statusConvocacao,
      item.cancelamentoInicio,
    )
    if (!periodo) {
      // Cancelada antes de começar (ou sem datas): não há dia trabalhado, não há S-2260.
      const semDatas = !item.dataInicio || !item.dataFim
      const p: PessoaRelatorioMensal = {
        ...pessoaBase,
        periodo: `${item.dataInicio}..${item.dataFim}`,
        desfecho: semDatas ? "invalido" : "cancelada_sem_dias",
        detalhe: semDatas ? "sem_datas" : `cancelamento em ${item.cancelamentoInicio}`,
      }
      if (semDatas) previa.invalidos.push(p)
      else previa.canceladasSemDias++
      previa.pessoas.push(p)
      previa.total++
      continue
    }
    alvos.push({ item, inicio: periodo.start, fim: periodo.end })
  }
  return { alvos, previa }
}

/** Soma dois relatórios do MESMO contrato (a prévia do planejamento + os lotes). */
export function mesclarRelatorios(
  a: RelatorioConvocacaoMensal,
  b: RelatorioConvocacaoMensal,
): RelatorioConvocacaoMensal {
  return {
    contrato: a.contrato,
    total: a.total + b.total,
    gravados: a.gravados + b.gravados,
    jaExistiam: a.jaExistiam + b.jaExistiam,
    cobertos: a.cobertos + b.cobertos,
    canceladasSemDias: a.canceladasSemDias + b.canceladasSemDias,
    requerDecisao: [...a.requerDecisao, ...b.requerDecisao],
    conciliando: [...a.conciliando, ...b.conciliando],
    falhas: [...a.falhas, ...b.falhas],
    invalidos: [...a.invalidos, ...b.invalidos],
    pessoas: [...a.pessoas, ...b.pessoas],
    temPendencia: a.temPendencia || b.temPendencia,
  }
}

/**
 * Board do run + coluna do eco (`Código Convocação RM`), resolvidos pelo registry.
 *
 * `colCodRm` nulo NÃO é erro: o eco é opcional (a fonte de verdade é `pi.convocacoes_rm`). Mas o
 * step registra `eco_coluna: "AUSENTE"` na timeline de propósito — coluna renomeada no board faz
 * o lookup por título devolver null, e sem esse rastro o C03S###### sumiria do board em silêncio.
 */
export async function resolverEcoConvocacaoRm(
  boardIdDoRun?: string,
): Promise<{ boardId: string; colCodRm: string | null }> {
  const boardId = await boardDoRun(boardIdDoRun)
  const { rows: cols } = await query<{ column_id: string }>(
    `SELECT column_id FROM board_colunas
      WHERE monday_board_id=$1 AND nome='Código Convocação RM' LIMIT 1`,
    [boardId],
  )
  return { boardId, colCodRm: cols[0]?.column_id ?? null }
}

/**
 * Grava no RM as convocações de um LOTE de alvos (o step fatia em ~10 por invocação).
 * Idempotente por pessoa (índice parcial + ledger + pré-voo, iguais ao pontual) — re-rodar
 * pula quem já gravou.
 *
 * NÃO decide política: devolve o relatório e quem traduz em erro-de-contrato é o step.
 */
export async function processarLoteConvocacaoMensal(
  contrato: string,
  alvos: AlvoConvocacaoMensal[],
  opts: {
    boardId: string
    colCodRm: string | null
    deps?: DepsConvocacaoMensal
    timeoutMs?: number
    /**
     * Escrever o código na coluna do board. `false` num run de desenvolvedor que não marcou
     * `monday_escritas`: gravar no RM sem tocar no Monday. Default true — em run normal o eco é
     * parte da convocação (é onde o C03S###### fica visível pro DP).
     */
     ecoNoBoard?: boolean
  },
): Promise<RelatorioConvocacaoMensal> {
  const deps = opts.deps ?? DEPS_MENSAL_PADRAO
  const ecoNoBoard = opts.ecoNoBoard !== false
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_FILA_MS
  const r = relatorioVazio(contrato, alvos.length)
  if (!alvos.length) return r

  // Atestados do contrato inteiro numa consulta (falha fechado: estourou aqui, o lote nem começa
  // — melhor contrato atrasado que S-2260 por cima de dia coberto).
  const janelaIni = alvos.map((a) => a.inicio).sort()[0]!
  const janelaFim = alvos.map((a) => a.fim).sort().at(-1)!
  const cortesPorChapa = deps.quebraHabilitada()
    ? await deps.ausenciasContrato(alvos.map((a) => a.item.chapa), janelaIni, janelaFim)
    : new Map<string, { inicio: string; fim: string }[]>()

  for (const { item, inicio, fim } of alvos) {
    const pessoaBase = { itemId: item.itemId, nome: item.nome, chapa: item.chapa, periodo: `${inicio}..${fim}` }
    const chapaNorm = item.chapa.trim().replace(/^0+/, "")

    // As ausências da pessoa vêm do Map pré-carregado — a leitura por pessoa do serviço é
    // substituída por lookup local, mantendo o resto do fluxo idêntico ao pontual.
    const depsPessoa: DepsPontual = {
      ...deps.pontual,
      // Eco desligado = no-op. O serviço do pontual sempre ecoa (lá é o comportamento certo);
      // quem decide no mensal é o run.
      mudarColunas: ecoNoBoard ? deps.pontual.mudarColunas : (async () => {}) as DepsPontual["mudarColunas"],
      ausencias: async () => ({
        cortes: cortesPorChapa.get(chapaNorm) ?? [],
        ausencias: [],
        descartadas: [],
        linhas: 0,
      }),
      quebraHabilitada: deps.quebraHabilitada,
    }

    let resultado
    try {
      resultado = await deps.processar(
        {
          itemId: item.itemId,
          boardId: opts.boardId,
          colCodRm: opts.colCodRm,
          contrato: item.contrato,
          chapa: item.chapa,
          dataInicio: inicio,
          dataFim: fim,
          dataAdmissao: item.dataAdmissao,
          operador: "mensal-workflow",
        },
        { timeoutMs, deps: depsPessoa, origemAcao: "mensal" },
      )
    } catch (e) {
      const p: PessoaRelatorioMensal = { ...pessoaBase, desfecho: "falha", detalhe: (e as Error).message.slice(0, 200) }
      r.falhas.push(p)
      r.pessoas.push(p)
      continue
    }

    // Classificação por pessoa, na ordem de gravidade.
    const canceladaNoRm = resultado.pedacos.some(
      (pc) => pc.estado === "ja_no_rm" && !estadoConvocacaoValido(pc.existenteEstado),
    )
    let p: PessoaRelatorioMensal
    if (resultado.cobertoPorAusencia) {
      p = { ...pessoaBase, desfecho: "coberto_por_ausencia" }
      r.cobertos++
    } else if (canceladaNoRm) {
      // Decisão 3: lançamento manual CANCELADO no RM cobre o período — nem regrava nem pula
      // calado. O DP resolve no RM (apaga a cancelada ou lança a válida) e retoma o run.
      p = {
        ...pessoaBase,
        desfecho: "requer_decisao_dp",
        detalhe: resultado.pedacos
          .filter((pc) => pc.estado === "ja_no_rm")
          .map((pc) => `${pc.periodo}: ${pc.codConvocacao} (${pc.existenteEstadoDescricao || pc.existenteEstado})`)
          .join("; "),
      }
      r.requerDecisao.push(p)
    } else if (resultado.precisaConciliar) {
      // SOAP mudo: pode ter gravado. Job da fila NO PASSO 1 — só leitura resolve, nunca reenvio.
      await deps.enfileirarJob(
        TIPO_JOB_CONVOCACAO_RM,
        {
          item_id: item.itemId,
          board_id: opts.boardId,
          col_cod_rm: opts.colCodRm,
          contrato: item.contrato,
          chapa: item.chapa,
          nome: item.nome,
          data_inicio: inicio,
          data_fim: fim,
          data_admissao: item.dataAdmissao,
          operador: "mensal-workflow",
        },
        { passo: 1 },
      )
      p = { ...pessoaBase, desfecho: "conciliando", codigos: resultado.codigos }
      r.conciliando.push(p)
    } else if (resultado.retryavel) {
      p = { ...pessoaBase, desfecho: "falha", detalhe: resultado.retryavel.slice(0, 200), codigos: resultado.codigos }
      r.falhas.push(p)
    } else if (resultado.invalido) {
      p = { ...pessoaBase, desfecho: "invalido", detalhe: resultado.invalido.slice(0, 200) }
      r.invalidos.push(p)
    } else {
      const gravouAlgo = resultado.pedacos.some((pc) => pc.estado === "gravado")
      p = { ...pessoaBase, desfecho: gravouAlgo ? "gravado" : "ja_lancado", codigos: resultado.codigos }
      if (gravouAlgo) r.gravados++
      else r.jaExistiam++
    }
    r.pessoas.push(p)
  }

  r.temPendencia = r.falhas.length > 0 || r.requerDecisao.length > 0 || r.conciliando.length > 0
  return r
}

/**
 * O contrato inteiro numa chamada — composição de planejar + lote único. É o caminho dos testes
 * e de qualquer caller fora do workflow; o step do workflow usa as partes pra fatiar em lotes.
 */
export async function processarConvocacaoMensalContrato(
  contrato: string,
  opts: { boardId: string; colCodRm: string | null; deps?: DepsConvocacaoMensal; timeoutMs?: number },
): Promise<RelatorioConvocacaoMensal> {
  const deps = opts.deps ?? DEPS_MENSAL_PADRAO
  const itens = await deps.lerItens(contrato)
  const { alvos, previa } = planejarAlvosMensal(contrato, itens)
  if (!alvos.length) return previa
  const lote = await processarLoteConvocacaoMensal(contrato, alvos, opts)
  return mesclarRelatorios(previa, lote)
}
