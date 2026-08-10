// Orquestração de UMA convocação pontual no RM: planejar os pedaços, gravar cada um, ecoar o
// código no board.
//
// Vive aqui, e não no job, porque TEM DOIS CHAMADORES: o request do /convocar (tenta na hora, pra
// o operador ver o código) e o job da fila (retry do que o request não fechou). Duplicar essa
// sequência nos dois seria garantir que divergissem — e divergir aqui significa gravar dois
// eventos eSocial S-2260 pela mesma convocação.
import { config } from "../config.js"
import { changeColumnValues } from "../monday.js"
import {
  calcularDataConvocacao,
  quebrarPeriodoPorAusencias,
  type PeriodoConvocacao,
} from "../domain/convocacaoRm.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import { ausenciasDaConvocacao } from "./ausenciasRm.js"
import { gravarConvocacaoRm, type EstadoGravacaoRm } from "./convocacaoRm.js"

/** Teto do SOAP quando o operador está esperando. Ver `saveRecordDireto`. */
export const TIMEOUT_INLINE_MS = Number(process.env.RM_INLINE_TIMEOUT_MS || 8000)
/** Teto do SOAP na fila — ninguém olhando, então vale esperar mais e falhar menos. */
export const TIMEOUT_FILA_MS = 20_000

export interface DadosConvocacaoPontual {
  itemId: string
  boardId: string
  /** Coluna `Código Convocação RM` já resolvida (o board do mês é cópia). */
  colCodRm?: string | null
  contrato: string
  chapa: string
  dataInicio: string
  dataFim: string
  dataAdmissao?: string | null
  operador?: string | null
}

/** Deps injetáveis — namespace de módulo ESM é congelado, não dá pra trocar import em teste. */
export interface DepsPontual {
  gravar: typeof gravarConvocacaoRm
  ausencias: typeof ausenciasDaConvocacao
  mudarColunas: typeof changeColumnValues
  quebraHabilitada: () => boolean
}

export const DEPS_PONTUAL_PADRAO: DepsPontual = {
  gravar: gravarConvocacaoRm,
  ausencias: ausenciasDaConvocacao,
  mudarColunas: changeColumnValues,
  quebraHabilitada: () => config.atestadoQuebraConvocacao,
}

export interface PedacoProcessado {
  periodo: string
  estado: EstadoGravacaoRm
  codConvocacao?: string
}

export interface ResultadoPontual {
  /** Códigos que existem no RM ao fim desta passada (gravados agora ou já existentes). */
  codigos: string[]
  pedacos: PedacoProcessado[]
  cortes: { inicio: string; fim: string }[]
  /** Nada a convocar: atestado cobre o período inteiro. Terminal, e não é falha. */
  cobertoPorAusencia: boolean
  /** Algum pedaço ficou mudo (timeout/5xx). Só leitura resolve — NUNCA reenviar. */
  precisaConciliar: boolean
  /** Erro que retry pode consertar. */
  retryavel?: string
  /** Entrada ruim — retry nunca conserta. */
  invalido?: string
}

/**
 * Pedaços do período que ainda podem ser convocados.
 *
 * Convocação 05→20 com atestado 10→11 vira 05→09 e 12→20: dia coberto por atestado não é dia
 * convocado. A leitura FALHA FECHADO — RM fora do ar joga, porque "sem atestado" por
 * indisponibilidade é o que grava por cima do dia coberto.
 */
async function planejarPedacos(
  d: DadosConvocacaoPontual,
  deps: DepsPontual,
): Promise<{ pedacos: PeriodoConvocacao[]; cortes: { inicio: string; fim: string }[] }> {
  const inteiro = [{ inicio: d.dataInicio, fim: d.dataFim }]
  if (!deps.quebraHabilitada()) return { pedacos: inteiro, cortes: [] }
  const { cortes } = await deps.ausencias(d.chapa, d.dataInicio, d.dataFim)
  if (!cortes.length) return { pedacos: inteiro, cortes }
  return { pedacos: quebrarPeriodoPorAusencias(d.dataInicio, d.dataFim, cortes), cortes }
}

/**
 * Eco do código no item, ACUMULADO por item.
 *
 * Uma convocação partida por atestado gera N códigos no MESMO item; escrever um por vez faria o
 * segundo apagar o primeiro. Junta o que esta passada gravou com o que o rastro já tem — o que
 * também conserta o eco perdido de uma passada anterior.
 *
 * A coluna deixou de ser o de-dup (isso agora é o índice em pi.convocacoes_rm), então pode
 * carregar mais de um código sem o item ser lido como "já lançado".
 */
export async function ecoAcumulado(
  d: DadosConvocacaoPontual,
  deps: DepsPontual,
  destaPassada: string[],
): Promise<string[]> {
  const doRastro = (await lancamentosDoItem(d.itemId).catch(() => []))
    .filter((l) => l.estado === "no_rm" && l.codigo)
    .sort((a, b) => String(a.data_inicio).localeCompare(String(b.data_inicio)))
    .map((l) => l.codigo!)
  const codigos = [...new Set([...doRastro, ...destaPassada.filter(Boolean)])]
  if (!codigos.length || !d.colCodRm) return codigos
  await deps.mudarColunas(d.boardId, d.itemId, { [d.colCodRm]: codigos.join(", ") })
  return codigos
}

/**
 * Processa a convocação inteira: quebra, grava cada pedaço, ecoa.
 *
 * NÃO decide o que fazer com o desfecho — só relata. Quem traduz em resposta HTTP é a rota; quem
 * traduz em estado de job é o handler. É o que permite os dois compartilharem isto sem que um
 * herde a política do outro.
 */
export async function processarConvocacaoPontual(
  d: DadosConvocacaoPontual,
  opts: { timeoutMs?: number; deps?: DepsPontual } = {},
): Promise<ResultadoPontual> {
  const deps = opts.deps ?? DEPS_PONTUAL_PADRAO
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_FILA_MS

  const { pedacos, cortes } = await planejarPedacos(d, deps)
  if (!pedacos.length) {
    return { codigos: [], pedacos: [], cortes, cobertoPorAusencia: true, precisaConciliar: false }
  }

  // Data do ato HERDADA do período original quando há mais de um pedaço: houve UM ato de
  // convocação, e o atestado é evento posterior. Recalculando por pedaço, o ato do segundo cairia
  // DENTRO do atestado — afirmando um convite que não houve.
  const dataAtoHerdada =
    pedacos.length > 1
      ? calcularDataConvocacao({
          dataInicio: d.dataInicio,
          dataAdmissao: d.dataAdmissao ?? undefined,
        }).data || undefined
      : undefined

  const out: ResultadoPontual = {
    codigos: [],
    pedacos: [],
    cortes,
    cobertoPorAusencia: false,
    precisaConciliar: false,
  }
  const gravadosAgora: string[] = []

  for (const p of pedacos) {
    const r = await deps.gravar(
      {
        itemOrigemId: d.itemId,
        mondayBoardId: d.boardId,
        chapa: d.chapa,
        contrato: d.contrato,
        dataInicio: p.inicio,
        dataFim: p.fim,
        dataAdmissao: d.dataAdmissao ?? undefined,
        dataConvocacao: dataAtoHerdada,
        origemAcao: "pontual",
        criadoPor: d.operador ?? null,
      },
      { timeoutMs },
    )
    if (r.codConvocacao) gravadosAgora.push(r.codConvocacao)
    out.pedacos.push({
      periodo: `${p.inicio}..${p.fim}`,
      estado: r.estado,
      codConvocacao: r.codConvocacao,
    })

    switch (r.estado) {
      case "gravado":
      case "ja_lancado":
      case "ja_no_rm":
        break // terminais e bons
      case "gravado_monday_pendente":
        out.retryavel ||= r.erro ?? "eco no Monday falhou"
        break
      case "reserva_pendente":
        out.precisaConciliar = true
        break
      default:
        if (r.indeterminado) out.precisaConciliar = true
        else if (/convocacao_rm_invalida/.test(r.erro ?? "")) out.invalido ||= r.erro ?? "entrada invalida"
        else out.retryavel ||= r.erro ?? "falha ao gravar convocacao no RM"
    }
  }

  // Eco ANTES de relatar o desfecho: o que já está no RM tem que aparecer no board mesmo que
  // outro pedaço tenha falhado — senão o DP fica sem o número do que existe.
  try {
    out.codigos = await ecoAcumulado(d, deps, gravadosAgora)
  } catch (e) {
    out.codigos = gravadosAgora
    out.retryavel ||= `gravou no RM, falhou no Monday: ${(e as Error).message.slice(0, 200)}`
  }
  return out
}
