// Job da convocação pontual no RM. É a REDE, não o caminho principal.
//
// O caminho principal é o próprio request do /convocar, que tenta gravar na hora pra devolver o
// código ao operador. Este job existe pro que o request não fechou: RM lento, RM fora, ou SOAP
// mudo (o caso em que não se pode reenviar e só a leitura resolve).
//
// A orquestração em si (quebra por atestado, gravar cada pedaço, eco no board) mora em
// services/convocacaoPontual.ts, compartilhada com a rota — duplicá-la aqui seria garantir que
// as duas divergissem, e divergir significa dois S-2260 pela mesma convocação.
import { config } from "../config.js"
import { changeColumnValues } from "../monday.js"
import { chaveEfeitoConvocacaoRm, convocacaoJaNoRm } from "../domain/convocacaoRm.js"
import { convocacoesExistentesRm } from "../services/convocacaoRm.js"
import {
  DEPS_PONTUAL_PADRAO,
  ecoAcumulado,
  processarConvocacaoPontual,
  TIMEOUT_FILA_MS,
  type DadosConvocacaoPontual,
  type DepsPontual,
} from "../services/convocacaoPontual.js"
import { confirmarLancamentoRm, falharLancamentoRm, lancamentosDoItem } from "../repo/convocacoesRm.js"
import { confirmarEfeito, liberarEfeito, avancar, type Job } from "./repo.js"

export const TIPO_JOB_CONVOCACAO_RM = "convocacao_rm_pontual"

/** Teto de idas ao passo 1 — evita pêndulo entre "RM recusa" e "conciliação libera". */
const MAX_CONCILIACOES = 3

export interface DepsConvocacaoRmPontual {
  processar: typeof processarConvocacaoPontual
  existentes: typeof convocacoesExistentesRm
  mudarColunas: typeof changeColumnValues
  habilitado: () => boolean
  /** Repassadas ao serviço na conciliação (eco). */
  pontual: DepsPontual
}

const DEPS_PADRAO: DepsConvocacaoRmPontual = {
  processar: processarConvocacaoPontual,
  existentes: convocacoesExistentesRm,
  mudarColunas: changeColumnValues,
  habilitado: () => config.convocacaoRmHabilitada,
  pontual: DEPS_PONTUAL_PADRAO,
}

export interface PayloadConvocacaoRmPontual {
  item_id: string
  board_id: string
  col_cod_rm?: string | null
  contrato: string
  chapa: string
  nome?: string
  data_inicio: string
  data_fim: string
  data_admissao?: string | null
  operador?: string | null
}

function dados(p: PayloadConvocacaoRmPontual): DadosConvocacaoPontual {
  return {
    itemId: p.item_id,
    boardId: p.board_id,
    colCodRm: p.col_cod_rm,
    contrato: p.contrato,
    chapa: p.chapa,
    dataInicio: p.data_inicio,
    dataFim: p.data_fim,
    dataAdmissao: p.data_admissao,
    operador: p.operador,
  }
}

/**
 * Passo 1 — conciliação por LEITURA, para o caso em que o SOAP ficou mudo.
 *
 * A idempotência sozinha resolve a duplicidade (não reenvia), mas deixa o caso preso para sempre
 * esperando humano. Com o volume do pontual isso viraria trabalho manual diário. Então em vez de
 * adivinhar, pergunta ao RM o que de fato aconteceu.
 */
async function conciliar(job: Job, p: PayloadConvocacaoRmPontual, deps: DepsConvocacaoRmPontual): Promise<void> {
  // TODOS os reservados do item, não só o do início original: com a quebra por atestado o pedaço
  // pendente pode começar num dia que não é `data_inicio`, e filtrar por ele deixaria o pedaço
  // órfão preso em `reservado` — slot ocupado que nunca libera.
  const pendentes = (await lancamentosDoItem(p.item_id)).filter((l) => l.estado === "reservado")
  if (!pendentes.length) {
    await avancar(job.id, { estado: "concluido", cursor: { conciliacao: "nada_pendente" } })
    return
  }

  // Uma leitura só cobrindo o período inteiro — é a mesma pessoa, e o ReadView é o caro aqui.
  const existentes = await deps.existentes({
    chapas: [p.chapa],
    dataInicio: p.data_inicio,
    dataFim: p.data_fim,
    timeoutMs: TIMEOUT_FILA_MS,
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

  if (adotados.length) await ecoAcumulado(dados(p), deps.pontual, adotados).catch(() => {})

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

  const r = await deps.processar(dados(p), { timeoutMs: TIMEOUT_FILA_MS, deps: deps.pontual })

  if (r.cobertoPorAusencia) {
    await avancar(job.id, {
      estado: "concluido",
      cursor: { pulado: "coberto_por_ausencia", cortes: r.cortes },
    })
    return
  }
  // Precedência: conciliar > retry > inválido. O mudo tem que ser resolvido por leitura antes de
  // qualquer nova tentativa — é a única regra que impede duplicar um S-2260.
  if (r.precisaConciliar) {
    await avancar(job.id, { estado: "pendente", passo: 1, proximoEmSeg: 30 })
    return
  }
  if (r.retryavel) throw new Error(r.retryavel)
  if (r.invalido) {
    await avancar(job.id, { estado: "falhou", erro: r.invalido })
    return
  }
  await avancar(job.id, {
    estado: "concluido",
    cursor: { codigos: r.codigos, pedacos: r.pedacos, cortes: r.cortes },
  })
}
