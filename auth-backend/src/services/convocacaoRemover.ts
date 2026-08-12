// Remoção de convocação no RM — o que o CANCELAMENTO TOTAL precisa.
//
// Espelho de `gravarConvocacaoRm`, com a mesma ordem e as mesmas travas, porque o risco é o
// mesmo de cabeça pra baixo: lá o perigo é gravar duas vezes, aqui é apagar o que não devia (ou
// dizer que apagou sem ter apagado).
//
// Regra de escopo, decidida pelo Isaac em 11/08: só remove o que ESTE app gravou. O DP tem 3746
// convocações lançadas à mão na coligada 3 — apagar por "chapa e período batem" alcançaria
// registro alheio. Sem rastro nosso, o cancelamento segue normal e a pendência é relatada.
import {
  chaveEfeitoEdicaoConvocacaoRm,
  chaveEfeitoRemocaoConvocacaoRm,
  montarEdicaoFimConvocacaoRm,
  pkConvocacaoRm,
  RM_COLIGADA_CONVOCACAO,
  RM_DATA_SERVER_CONVOCACAO,
} from "../domain/convocacaoRm.js"
import {
  contextoDataServer,
  deleteRecordByKeyDireto,
  existeRegistroRm,
  saveRecordDireto,
  temRmSoap,
  type RmSoapError,
} from "../clients/rmSoap.js"
import { confirmarEfeito, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import {
  atualizarPeriodoLancamentoRm,
  confirmarRemocaoRm,
  lancamentosDoItem,
  marcarParaRemocaoRm,
  type LancamentoRm,
  type MotivoSaidaRm,
} from "../repo/convocacoesRm.js"

/** Teto do SOAP quando alguém espera na tela. Ver `saveRecordDireto`. */
export const TIMEOUT_REMOCAO_MS = 15_000

export type EstadoRemocaoRm =
  /** Apagado no RM e confirmado por releitura. */
  | "removido"
  /** Já não estava lá (removido antes, ou nunca chegou a existir). Terminal e não é falha. */
  | "ja_ausente"
  /** Nosso rastro não tem lançamento vivo pra este item — nada a fazer. */
  | "sem_rastro"
  /** O RM não respondeu / respondeu mudo. PODE ter apagado — conferir lendo, nunca repetir cego. */
  | "indeterminado"
  | "erro"

export interface ResultadoRemocaoRm {
  estado: EstadoRemocaoRm
  lancamentoId?: string
  codConvocacao?: string
  pk?: string
  erro?: string
}

export interface RemocaoRmSumario {
  removidos: ResultadoRemocaoRm[]
  /** true = algo precisa de nova tentativa ou de olho humano. */
  temPendencia: boolean
}

/**
 * Apaga UM lançamento no RM.
 *
 * Ordem que importa:
 *   1. prova que o registro EXISTE (sem isso não se sabe se havia o que apagar);
 *   2. `marcarParaRemocaoRm` — a promessa fica no banco ANTES da chamada, senão morrer no meio
 *      deixa o C03S###### órfão lá e ninguém sabe que ele deveria ter sumido;
 *   3. reserva no ledger;
 *   4. DeleteRecordByKey;
 *   5. prova que SUMIU — em 08/08 um `ReadRecord` que lançou foi lido como "removido" e dois
 *      registros ficaram vivos no RM achando-se apagados;
 *   6. confirma nos dois lugares.
 */
export async function removerLancamentoRm(
  lancamento: LancamentoRm,
  p: { motivo: MotivoSaidaRm; removidoPor?: string | null; timeoutMs?: number },
): Promise<ResultadoRemocaoRm> {
  if (!temRmSoap()) return { estado: "erro", lancamentoId: lancamento.id, erro: "rm_soap_nao_configurado" }

  const coligada = lancamento.coligada ?? RM_COLIGADA_CONVOCACAO
  const contexto = contextoDataServer(coligada)
  const pk =
    lancamento.pk_rm ??
    (lancamento.codigo
      ? pkConvocacaoRm({ coligada, chapa: lancamento.chapa, codConvocacao: lancamento.codigo })
      : null)
  // Sem PK não há o que apagar — e chegar aqui significa rastro inconsistente, não "apague algo".
  if (!pk) return { estado: "sem_rastro", lancamentoId: lancamento.id, erro: "lancamento_sem_pk" }

  const base = { lancamentoId: lancamento.id, codConvocacao: lancamento.codigo ?? undefined, pk }

  const antes = await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pk, contexto)
  if (!antes) {
    // Não está lá. Fecha o rastro do mesmo jeito: deixar `no_rm` faria o pré-voo continuar
    // achando que existe convocação viva e bloquear a próxima gravação legítima.
    const marcado = await marcarParaRemocaoRm(lancamento.id, { motivo: p.motivo, removidoPor: p.removidoPor })
    if (marcado) await confirmarRemocaoRm(lancamento.id, { ausente_no_rm: true })
    return { ...base, estado: "ja_ausente" }
  }

  const marcado = await marcarParaRemocaoRm(lancamento.id, { motivo: p.motivo, removidoPor: p.removidoPor })
  if (!marcado) {
    // Só `no_rm` vira `a_remover`. Não casar aqui = alguém já removeu, ou a linha nunca confirmou.
    return { ...base, estado: "sem_rastro", erro: `estado_nao_removivel:${lancamento.estado}` }
  }

  const chave = chaveEfeitoRemocaoConvocacaoRm(lancamento.id)
  await reservarEfeito(chave, "convocacao_rm_remover", {
    pk, chapa: lancamento.chapa, codigo: lancamento.codigo, motivo: p.motivo,
  })

  try {
    await deleteRecordByKeyDireto(RM_DATA_SERVER_CONVOCACAO, pk, contexto, p.timeoutMs)
  } catch (e) {
    const err = e as RmSoapError
    // Fault = respondeu e recusou, COM rollback: nada foi apagado, então o slot volta e a linha
    // também. Timeout/5xx é o oposto — pode ter apagado; aí só a releitura resolve.
    if (err?.indeterminado === false) {
      await liberarEfeito(chave).catch(() => {})
      return { ...base, estado: "erro", erro: err?.message?.slice(0, 300) ?? String(e) }
    }
    return { ...base, estado: "indeterminado", erro: err?.message?.slice(0, 300) ?? String(e) }
  }

  const depois = await existeRegistroRm(RM_DATA_SERVER_CONVOCACAO, pk, contexto)
  if (depois) {
    // O RM aceitou a chamada e o registro continua lá. Não confirma nada: dizer "removido" aqui
    // seria a mentira mais cara possível — o board fica limpo e o S-2260 continua de pé.
    return { ...base, estado: "erro", erro: "delete_aceito_mas_registro_continua_no_rm" }
  }

  await confirmarEfeito(chave, pk, { pk, codConvocacao: lancamento.codigo })
  await confirmarRemocaoRm(lancamento.id, { pk })
  return { ...base, estado: "removido" }
}

/**
 * Remove TODOS os lançamentos vivos de um item — é o cancelamento total: a convocação pode ter
 * virado N registros no RM (quebra por atestado, bifurcação), e cancelar tem que levar todos.
 */
export async function removerConvocacoesDoItem(
  itemOrigemId: string | number,
  p: { motivo: MotivoSaidaRm; removidoPor?: string | null; timeoutMs?: number },
): Promise<RemocaoRmSumario> {
  const vivos = await lancamentosDoItem(itemOrigemId, { apenasVivos: true })
  if (!vivos.length) return { removidos: [], temPendencia: false }

  const removidos: ResultadoRemocaoRm[] = []
  for (const l of vivos) {
    try {
      removidos.push(await removerLancamentoRm(l, p))
    } catch (e) {
      // Um erro inesperado num lançamento não pode impedir os outros de serem removidos: deixar
      // registro vivo no RM é pior que relatar falha parcial.
      removidos.push({ estado: "erro", lancamentoId: l.id, erro: (e as Error).message.slice(0, 300) })
    }
  }
  return {
    removidos,
    temPendencia: removidos.some((r) => r.estado === "erro" || r.estado === "indeterminado"),
  }
}

// ---------------------------------------------------------------------------
// EDIÇÃO de período — o cancelamento PARCIAL. Fica aqui, junto da remoção, porque as duas são
// "o que fazer com uma convocação que já existe no RM" e compartilham as mesmas travas.
// ---------------------------------------------------------------------------

export type EstadoEdicaoRm = "editado" | "ja_no_periodo" | "sem_rastro" | "indeterminado" | "erro"

export interface ResultadoEdicaoRm {
  estado: EstadoEdicaoRm
  lancamentoId?: string
  codConvocacao?: string
  pk?: string
  dataFimAnterior?: string
  dataFimNova?: string
  erro?: string
}

/**
 * Encurta a data fim de UM lançamento no RM.
 *
 * Editar, e não apagar-e-recriar, foi decisão do Isaac — e só é possível porque o RM aceita
 * UPDATE: medido em 2099 (11/08), `SaveRecord` com `CODCONVOCACAO` preenchido edita no lugar,
 * mesma PK, e o ReadView continua devolvendo UM registro. Recriar geraria `C03S######` novo e um
 * segundo S-2260 pro mesmo período — o oposto de "cancelar parte dele".
 *
 * O XML vai MÍNIMO (chave + fim). Medido no mesmo teste: o RM faz merge, então `DTCONVOCACAO` e
 * `DTRESPOSTA` sobrevivem sozinhos — e é isso que preserva o ato: houve convite, ele não mudou.
 */
export async function editarFimLancamentoRm(
  lancamento: LancamentoRm,
  p: { dataFim: string; timeoutMs?: number },
): Promise<ResultadoEdicaoRm> {
  if (!temRmSoap()) return { estado: "erro", lancamentoId: lancamento.id, erro: "rm_soap_nao_configurado" }
  if (lancamento.estado !== "no_rm" || !lancamento.codigo) {
    return { estado: "sem_rastro", lancamentoId: lancamento.id, erro: `estado_nao_editavel:${lancamento.estado}` }
  }

  const coligada = lancamento.coligada ?? RM_COLIGADA_CONVOCACAO
  const contexto = contextoDataServer(coligada)
  const anterior = String(lancamento.data_fim).slice(0, 10)
  const base = {
    lancamentoId: lancamento.id,
    codConvocacao: lancamento.codigo,
    pk: lancamento.pk_rm ?? pkConvocacaoRm({ coligada, chapa: lancamento.chapa, codConvocacao: lancamento.codigo }),
    dataFimAnterior: anterior,
  }

  let montada: ReturnType<typeof montarEdicaoFimConvocacaoRm>
  try {
    montada = montarEdicaoFimConvocacaoRm({
      coligada, chapa: lancamento.chapa, codConvocacao: lancamento.codigo, dataFim: p.dataFim,
    })
  } catch (e) {
    return { ...base, estado: "erro", erro: (e as Error).message }
  }
  // Nada a fazer — e não é falha. Acontece em retry e quando o parcial repete a mesma data.
  if (montada.dataFim === anterior) return { ...base, estado: "ja_no_periodo", dataFimNova: anterior }

  const chave = chaveEfeitoEdicaoConvocacaoRm(lancamento.id, montada.dataFim)
  const reserva = await reservarEfeito(chave, "convocacao_rm_editar", {
    pk: base.pk, de: anterior, para: montada.dataFim,
  })
  if (reserva === "confirmado") return { ...base, estado: "ja_no_periodo", dataFimNova: montada.dataFim }

  try {
    await saveRecordDireto(RM_DATA_SERVER_CONVOCACAO, montada.dadosXml, contexto, p.timeoutMs)
  } catch (e) {
    const err = e as RmSoapError
    // Fault = recusou com rollback: nada mudou, libera o slot. Timeout = pode ter editado; deixa
    // a chave presa e devolve indeterminado — reeditar pro mesmo fim seria inofensivo, mas quem
    // decide isso é o retry, não este ponto.
    if (err?.indeterminado === false) {
      await liberarEfeito(chave).catch(() => {})
      return { ...base, estado: "erro", dataFimNova: montada.dataFim, erro: err?.message?.slice(0, 300) ?? String(e) }
    }
    return { ...base, estado: "indeterminado", dataFimNova: montada.dataFim, erro: err?.message?.slice(0, 300) ?? String(e) }
  }

  await confirmarEfeito(chave, base.pk, { de: anterior, para: montada.dataFim })
  // O rastro tem que acompanhar: sem isso o pré-voo e `lancamentosPorChapaPeriodo` seguem
  // afirmando o período antigo, e passam a mentir sobre sobreposição.
  await atualizarPeriodoLancamentoRm(lancamento.id, {
    dataFim: montada.dataFim,
    payload: { editado_em_rm: { de: anterior, para: montada.dataFim } },
  })
  return { ...base, estado: "editado", dataFimNova: montada.dataFim }
}

/**
 * Encurta TODOS os lançamentos vivos do item que ultrapassam `novoFim`.
 *
 * Um cancelamento parcial pode atingir vários registros (quebra por atestado): os que terminam
 * antes do corte ficam intactos; os que começam depois do corte não têm período nenhum
 * sobrando — esses são REMOVIDOS, não editados.
 */
export async function encurtarConvocacoesDoItem(
  itemOrigemId: string | number,
  p: { novoFim: string; removidoPor?: string | null; timeoutMs?: number },
): Promise<{ edicoes: ResultadoEdicaoRm[]; remocoes: ResultadoRemocaoRm[]; temPendencia: boolean }> {
  const vivos = await lancamentosDoItem(itemOrigemId, { apenasVivos: true })
  const edicoes: ResultadoEdicaoRm[] = []
  const remocoes: ResultadoRemocaoRm[] = []

  for (const l of vivos) {
    const inicio = String(l.data_inicio).slice(0, 10)
    const fim = String(l.data_fim).slice(0, 10)
    if (fim <= p.novoFim) continue // termina antes do corte: nada a fazer
    if (inicio > p.novoFim) {
      // O pedaço inteiro caiu dentro do cancelamento — encurtar deixaria fim < início.
      remocoes.push(
        await removerLancamentoRm(l, {
          motivo: "cancelamento_parcial", removidoPor: p.removidoPor, timeoutMs: p.timeoutMs,
        }),
      )
      continue
    }
    edicoes.push(await editarFimLancamentoRm(l, { dataFim: p.novoFim, timeoutMs: p.timeoutMs }))
  }

  return {
    edicoes,
    remocoes,
    temPendencia:
      edicoes.some((e) => e.estado === "erro" || e.estado === "indeterminado") ||
      remocoes.some((r) => r.estado === "erro" || r.estado === "indeterminado"),
  }
}
