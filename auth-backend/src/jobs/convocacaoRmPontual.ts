// Job que grava no RM a convocação criada pelo /convocar. Fora do request de propósito:
// escrita no RM é best-effort com retry, o item do Monday nasce na hora e o operador não espera.
//
// Escrever inline seria pior de um jeito específico: para não travar a tela seria preciso um
// timeout curto do nosso lado, e timeout curto cai exatamente em `indeterminado: true` — ou
// seja, transformaria o caso perigoso ("pode ter gravado, não posso reenviar") no caso comum.
import { config } from "../config.js"
import { changeColumnValues } from "../monday.js"
import { chaveEfeitoConvocacaoRm, convocacaoJaNoRm } from "../domain/convocacaoRm.js"
import { convocacoesExistentesRm, gravarConvocacaoRm } from "../services/convocacaoRm.js"
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
  mudarColunas: typeof changeColumnValues
  habilitado: () => boolean
}

const DEPS_PADRAO: DepsConvocacaoRmPontual = {
  gravar: gravarConvocacaoRm,
  existentes: convocacoesExistentesRm,
  mudarColunas: changeColumnValues,
  habilitado: () => config.convocacaoRmHabilitada,
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

/** Eco do código no item. Só o C03S###### real vai nessa coluna — ver aviso no handler. */
function ecoNoMonday(p: PayloadConvocacaoRmPontual, deps: DepsConvocacaoRmPontual) {
  if (!p.col_cod_rm) return undefined
  return async ({ codConvocacao }: { codConvocacao: string }) => {
    await deps.mudarColunas(p.board_id, p.item_id, { [p.col_cod_rm!]: codConvocacao })
  }
}

/**
 * Passo 1 — conciliação por LEITURA, para o caso em que o SOAP ficou mudo.
 *
 * A camada de idempotência sozinha resolve a duplicidade (não reenvia), mas deixa o caso preso
 * para sempre esperando humano. Com o volume do pontual isso viraria trabalho manual diário.
 * Então em vez de adivinhar, pergunta ao RM o que de fato aconteceu.
 */
async function conciliar(job: Job, p: PayloadConvocacaoRmPontual, deps: DepsConvocacaoRmPontual): Promise<void> {
  const pendentes = (await lancamentosDoItem(p.item_id)).filter(
    (l) => l.estado === "reservado" && l.data_inicio === p.data_inicio,
  )
  const alvo = pendentes[0]
  if (!alvo) {
    // Alguém (retry anterior, cancelamento) já resolveu. Nada a conciliar.
    await avancar(job.id, { estado: "concluido", cursor: { conciliacao: "nada_pendente" } })
    return
  }

  const existentes = await deps.existentes({
    chapas: [p.chapa],
    dataInicio: p.data_inicio,
    dataFim: p.data_fim,
    timeoutMs: 20_000,
  })
  const achado = convocacaoJaNoRm(existentes, {
    chapa: p.chapa,
    dataInicio: p.data_inicio,
    dataFim: p.data_fim,
  })
  const chave = chaveEfeitoConvocacaoRm(alvo.id)

  if (achado) {
    // O SaveRecord tinha persistido: adota o registro em vez de gravar outro.
    const pk = `${alvo.coligada};${alvo.chapa};${achado.codConvocacao}`
    await confirmarEfeito(chave, pk, { pks: [pk], codConvocacao: achado.codConvocacao, conciliado: true })
    await confirmarLancamentoRm(alvo.id, { codigo: achado.codConvocacao, pkRm: pk })
    const eco = ecoNoMonday(p, deps)
    if (eco) await eco({ codConvocacao: achado.codConvocacao }).catch(() => {})
    await avancar(job.id, {
      estado: "concluido",
      cursor: { conciliacao: "adotado", codConvocacao: achado.codConvocacao },
    })
    return
  }

  // Não achou: o RM é síncrono e o ReadView enxerga na hora, então NÃO persistiu. Libera e
  // deixa o passo 0 tentar de novo.
  const voltas = Number((job.cursor as { voltas?: number } | null)?.voltas ?? 0) + 1
  await liberarEfeito(chave).catch(() => {})
  await falharLancamentoRm(alvo.id, "conciliacao: nao persistiu no RM", { indeterminado: false })
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

  const r = await deps.gravar(
    {
      itemOrigemId: p.item_id,
      mondayBoardId: p.board_id,
      chapa: p.chapa,
      contrato: p.contrato,
      dataInicio: p.data_inicio,
      dataFim: p.data_fim,
      dataAdmissao: p.data_admissao ?? undefined,
      origemAcao: "pontual",
      criadoPor: p.operador ?? null,
    },
    { gravarNoMonday: ecoNoMonday(p, deps), timeoutMs: 20_000 },
  )

  switch (r.estado) {
    case "gravado":
      await avancar(job.id, {
        estado: "concluido",
        cursor: { codConvocacao: r.codConvocacao, pk: r.pk, exigeConfirmacaoRm: r.exigeConfirmacaoRm },
      })
      return

    case "gravado_monday_pendente":
      // O RM já tem o registro; só o eco falhou. Retry cai em `ja_lancado` e o eco é refeito lá.
      throw new Error(r.erro ?? "eco no Monday falhou")

    case "ja_lancado": {
      // Nosso rastro já tem este período. Reaproveita o código pra consertar o eco perdido.
      const eco = ecoNoMonday(p, deps)
      if (eco && r.codConvocacao) await eco({ codConvocacao: r.codConvocacao }).catch(() => {})
      await avancar(job.id, {
        estado: "concluido",
        cursor: { pulado: "ja_lancado", codConvocacao: r.codConvocacao },
      })
      return
    }

    case "ja_no_rm":
      // O DP lançou à mão. Terminal e informativo — não é falha da fila.
      await avancar(job.id, { estado: "concluido", cursor: { pulado: "ja_no_rm", detalhe: r.detalhe } })
      return

    case "reserva_pendente":
      await avancar(job.id, { estado: "pendente", passo: 1, proximoEmSeg: 30 })
      return

    default: {
      // `indeterminado` já deixou a reserva travada; o passo 1 pergunta ao RM o que aconteceu.
      if (r.indeterminado) {
        await avancar(job.id, { estado: "pendente", passo: 1, proximoEmSeg: 30 })
        return
      }
      // Erro de validação nunca melhora com retry — encerra e mostra o motivo.
      if (/convocacao_rm_invalida/.test(r.erro ?? "")) {
        await avancar(job.id, { estado: "falhou", erro: r.erro })
        return
      }
      throw new Error(r.erro ?? "falha ao gravar convocacao no RM")
    }
  }
}
