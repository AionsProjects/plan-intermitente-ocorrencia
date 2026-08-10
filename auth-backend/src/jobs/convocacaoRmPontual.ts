// Job que grava no RM a convocação criada pelo /convocar. Fora do request de propósito:
// escrita no RM é best-effort com retry, o item do Monday nasce na hora e o operador não espera.
//
// Escrever inline seria pior de um jeito específico: para não travar a tela seria preciso um
// timeout curto do nosso lado, e timeout curto cai exatamente em `indeterminado: true` — ou
// seja, transformaria o caso perigoso ("pode ter gravado, não posso reenviar") no caso comum.
import { config } from "../config.js"
import { changeColumnValues } from "../monday.js"
import {
  calcularDataConvocacao,
  chaveEfeitoConvocacaoRm,
  convocacaoJaNoRm,
  quebrarPeriodoPorAusencias,
  type PeriodoConvocacao,
} from "../domain/convocacaoRm.js"
import { convocacoesExistentesRm, gravarConvocacaoRm } from "../services/convocacaoRm.js"
import { ausenciasDaConvocacao } from "../services/ausenciasRm.js"
import { confirmarLancamentoRm, falharLancamentoRm, lancamentosDoItem } from "../repo/convocacoesRm.js"
import { confirmarEfeito, liberarEfeito, avancar, type Job } from "./repo.js"

export const TIPO_JOB_CONVOCACAO_RM = "convocacao_rm_pontual"

/** Teto de idas ao passo 1 — evita pêndulo entre "RM recusa" e "conciliação libera". */
const MAX_CONCILIACOES = 3

/**
 * Dependências injetáveis. Existem porque namespace de módulo ESM é congelado — não dá pra
 * trocar o import em teste. Injetar é o mesmo padrão que `gravarNoMonday` já usa no serviço.
 */
export interface DepsConvocacaoRmPontual {
  gravar: typeof gravarConvocacaoRm
  existentes: typeof convocacoesExistentesRm
  ausencias: typeof ausenciasDaConvocacao
  mudarColunas: typeof changeColumnValues
  habilitado: () => boolean
  quebraHabilitada: () => boolean
}

const DEPS_PADRAO: DepsConvocacaoRmPontual = {
  gravar: gravarConvocacaoRm,
  existentes: convocacoesExistentesRm,
  ausencias: ausenciasDaConvocacao,
  mudarColunas: changeColumnValues,
  habilitado: () => config.convocacaoRmHabilitada,
  quebraHabilitada: () => config.atestadoQuebraConvocacao,
}

export interface PayloadConvocacaoRmPontual {
  item_id: string
  board_id: string
  /** Coluna `Código Convocação RM` já resolvida no request (o board do mês é cópia). */
  col_cod_rm?: string | null
  contrato: string
  chapa: string
  nome?: string
  data_inicio: string
  data_fim: string
  data_admissao?: string | null
  operador?: string | null
}

/**
 * Eco do código no item, ACUMULADO por item.
 *
 * Uma convocação partida por atestado gera N códigos no MESMO item; escrever um por vez faria o
 * segundo apagar o primeiro. Junta o que esta rodada gravou com o que o rastro já tem — o que
 * também conserta o eco perdido de um retry parcial.
 *
 * A coluna deixou de ser o de-dup (isso agora é o índice em pi.convocacoes_rm), então ela pode
 * carregar mais de um código sem risco de o item ser lido como "já lançado".
 */
async function ecoAcumulado(
  p: PayloadConvocacaoRmPontual,
  deps: DepsConvocacaoRmPontual,
  destaRodada: string[],
): Promise<void> {
  if (!p.col_cod_rm) return
  const doRastro = (await lancamentosDoItem(p.item_id).catch(() => []))
    .filter((l) => l.estado === "no_rm" && l.codigo)
    .sort((a, b) => String(a.data_inicio).localeCompare(String(b.data_inicio)))
    .map((l) => l.codigo!)
  const codigos = [...new Set([...doRastro, ...destaRodada.filter(Boolean)])]
  if (!codigos.length) return
  await deps.mudarColunas(p.board_id, p.item_id, { [p.col_cod_rm]: codigos.join(", ") })
}

/**
 * Pedaços do período que ainda podem ser convocados.
 *
 * Convocação 05→20 com atestado 10→11 vira 05→09 e 12→20: dia coberto por atestado não é dia
 * convocado, e afirmar que é gera um S-2260 errado.
 *
 * A leitura FALHA FECHADO — RM fora do ar joga, e o job retenta. "Sem atestado" por
 * indisponibilidade é a resposta perigosa, porque grava por cima do dia coberto.
 */
async function planejarPedacos(
  p: PayloadConvocacaoRmPontual,
  deps: DepsConvocacaoRmPontual,
): Promise<{ pedacos: PeriodoConvocacao[]; cortes: { inicio: string; fim: string }[] }> {
  const inteiro = [{ inicio: p.data_inicio, fim: p.data_fim }]
  if (!deps.quebraHabilitada()) return { pedacos: inteiro, cortes: [] }
  const { cortes } = await deps.ausencias(p.chapa, p.data_inicio, p.data_fim)
  if (!cortes.length) return { pedacos: inteiro, cortes }
  return { pedacos: quebrarPeriodoPorAusencias(p.data_inicio, p.data_fim, cortes), cortes }
}

/**
 * Passo 1 — conciliação por LEITURA, para o caso em que o SOAP ficou mudo.
 *
 * A camada de idempotência sozinha resolve a duplicidade (não reenvia), mas deixa o caso preso
 * para sempre esperando humano. Com o volume do pontual isso viraria trabalho manual diário.
 * Então em vez de adivinhar, pergunta ao RM o que de fato aconteceu.
 */
async function conciliar(job: Job, p: PayloadConvocacaoRmPontual, deps: DepsConvocacaoRmPontual): Promise<void> {
  // TODOS os reservados do item, não só o do início original: com a quebra por atestado o pedaço
  // pendente pode começar num dia que não é `data_inicio`, e filtrar por ele deixaria o pedaço
  // órfão preso em `reservado` — slot ocupado que nunca mais libera.
  const pendentes = (await lancamentosDoItem(p.item_id)).filter((l) => l.estado === "reservado")
  if (!pendentes.length) {
    // Alguém (retry anterior, cancelamento) já resolveu. Nada a conciliar.
    await avancar(job.id, { estado: "concluido", cursor: { conciliacao: "nada_pendente" } })
    return
  }

  // Uma leitura só cobrindo o período inteiro — é a mesma pessoa, e o ReadView é o caro aqui.
  const existentes = await deps.existentes({
    chapas: [p.chapa],
    dataInicio: p.data_inicio,
    dataFim: p.data_fim,
    timeoutMs: 20_000,
  })

  const adotados: string[] = []
  let liberados = 0
  for (const alvo of pendentes) {
    const chave = chaveEfeitoConvocacaoRm(alvo.id)
    const achado = convocacaoJaNoRm(existentes, {
      chapa: alvo.chapa,
      dataInicio: String(alvo.data_inicio),
      dataFim: String(alvo.data_fim),
    })
    if (achado) {
      // O SaveRecord tinha persistido: adota o registro em vez de gravar outro.
      const pk = `${alvo.coligada};${alvo.chapa};${achado.codConvocacao}`
      await confirmarEfeito(chave, pk, { pks: [pk], codConvocacao: achado.codConvocacao, conciliado: true })
      await confirmarLancamentoRm(alvo.id, { codigo: achado.codConvocacao, pkRm: pk })
      adotados.push(achado.codConvocacao)
      continue
    }
    // Não achou: o RM é síncrono e o ReadView enxerga na hora, então NÃO persistiu. Libera e
    // deixa o passo 0 tentar de novo.
    await liberarEfeito(chave).catch(() => {})
    await falharLancamentoRm(alvo.id, "conciliacao: nao persistiu no RM", { indeterminado: false })
    liberados++
  }

  if (adotados.length) await ecoAcumulado(p, deps, adotados).catch(() => {})

  if (!liberados) {
    await avancar(job.id, { estado: "concluido", cursor: { conciliacao: "adotado", codigos: adotados } })
    return
  }
  const voltas = Number((job.cursor as { voltas?: number } | null)?.voltas ?? 0) + 1
  if (voltas >= MAX_CONCILIACOES) {
    await avancar(job.id, { estado: "falhou", erro: "conciliacao_sem_convergencia" })
    return
  }
  await avancar(job.id, { estado: "pendente", passo: 0, proximoEmSeg: 30, cursor: { voltas } })
}

/**
 * `throw` = retryável (o tick chama `falhar()`, que conta tentativa e reagenda 30/60/90/120s).
 * `avancar()` = terminal. Chamar `avancar({estado:'falhou'})` direto NÃO conta tentativa.
 */
export async function handlerConvocacaoRmPontual(
  job: Job,
  deps: DepsConvocacaoRmPontual = DEPS_PADRAO,
): Promise<void> {
  const p = job.payload as unknown as PayloadConvocacaoRmPontual

  // Flag relida em runtime: pode ter sido desligada entre enfileirar e rodar.
  if (!deps.habilitado()) {
    await avancar(job.id, { estado: "concluido", cursor: { nota: "desligado" } })
    return
  }
  if (job.passo === 1) return conciliar(job, p, deps)

  const { pedacos, cortes } = await planejarPedacos(p, deps)
  if (!pedacos.length) {
    // Atestado cobre o período inteiro: não há dia a convocar. Terminal, e não é falha.
    await avancar(job.id, {
      estado: "concluido",
      cursor: { pulado: "coberto_por_ausencia", cortes },
    })
    return
  }

  const codigos: string[] = []
  const notas: Record<string, unknown>[] = []
  let conciliar1 = false
  let retryavel = ""
  let invalido = ""

  for (const pedaco of pedacos) {
    const r = await deps.gravar(
      {
        itemOrigemId: p.item_id,
        mondayBoardId: p.board_id,
        chapa: p.chapa,
        contrato: p.contrato,
        dataInicio: pedaco.inicio,
        dataFim: pedaco.fim,
        dataAdmissao: p.data_admissao ?? undefined,
        // Data do ato HERDADA do período original: houve UM ato de convocação, e o atestado é
        // evento posterior. Recalculando por pedaço, o ato do segundo cairia dentro do atestado —
        // afirmando um convite que não houve.
        dataConvocacao: pedacos.length > 1 ? dataDoAtoOriginal(p) : undefined,
        origemAcao: "pontual",
        criadoPor: p.operador ?? null,
      },
      { timeoutMs: 20_000 },
    )
    if (r.codConvocacao) codigos.push(r.codConvocacao)
    notas.push({ periodo: `${pedaco.inicio}..${pedaco.fim}`, estado: r.estado, cod: r.codConvocacao })

    switch (r.estado) {
      case "gravado":
      case "ja_lancado":
      case "ja_no_rm":
        break // terminais e bons; o eco no fim cobre todos
      case "gravado_monday_pendente":
        retryavel ||= r.erro ?? "eco no Monday falhou"
        break
      case "reserva_pendente":
        conciliar1 = true
        break
      default:
        if (r.indeterminado) conciliar1 = true
        else if (/convocacao_rm_invalida/.test(r.erro ?? "")) invalido ||= r.erro ?? "entrada invalida"
        else retryavel ||= r.erro ?? "falha ao gravar convocacao no RM"
    }
  }

  // Eco antes de decidir o desfecho: o que JÁ está no RM tem que aparecer no board mesmo que
  // outro pedaço tenha falhado — senão o DP fica sem o número do que existe.
  if (codigos.length) {
    try {
      await ecoAcumulado(p, deps, codigos)
    } catch (e) {
      retryavel ||= `gravou no RM, falhou no Monday: ${(e as Error).message.slice(0, 200)}`
    }
  }

  // Precedência: conciliar > retry > inválido. O indeterminado tem que ser resolvido por leitura
  // antes de qualquer nova tentativa — é a única regra que impede duplicar um S-2260.
  if (conciliar1) {
    await avancar(job.id, { estado: "pendente", passo: 1, proximoEmSeg: 30 })
    return
  }
  if (retryavel) throw new Error(retryavel)
  if (invalido) {
    await avancar(job.id, { estado: "falhou", erro: invalido })
    return
  }
  await avancar(job.id, { estado: "concluido", cursor: { codigos, pedacos: notas, cortes } })
}

/**
 * Data do ato do período ORIGINAL — o que os pedaços herdam.
 *
 * Recalcular a partir do payload (e não guardar do primeiro pedaço) mantém a regra num lugar só:
 * `montarConvocacaoRm` aplica os 3 dias e o piso da admissão sobre o início original.
 */
function dataDoAtoOriginal(p: PayloadConvocacaoRmPontual): string | undefined {
  return (
    calcularDataConvocacao({
      dataInicio: p.data_inicio,
      dataAdmissao: p.data_admissao ?? undefined,
    }).data || undefined
  )
}
