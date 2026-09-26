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
  registroRmExiste,
  saveRecordDireto,
  temRmSoap,
  type RmSoapError,
} from "../clients/rmSoap.js"
import { confirmarEfeito, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import {
  atualizarPeriodoLancamentoRm,
  confirmarRemocaoRm,
  fecharRastroAusenteRm,
  lancamentosDoItem,
  marcarParaRemocaoRm,
  type LancamentoRm,
  type MotivoSaidaRm,
} from "../repo/convocacoesRm.js"

/** Teto do SOAP quando alguém espera na tela. Ver `saveRecordDireto`. */
export const TIMEOUT_REMOCAO_MS = 15_000

/** O que este módulo toca fora dele (RM, ledger, rastro) — trocável nos testes. */
export interface DepsRm {
  temSoap: typeof temRmSoap
  /** Estrito: lança se o RM não responder. Ver `registroRmExiste`. */
  existe: typeof registroRmExiste
  salvar: typeof saveRecordDireto
  apagar: typeof deleteRecordByKeyDireto
  reservar: typeof reservarEfeito
  confirmar: typeof confirmarEfeito
  liberar: typeof liberarEfeito
  lancamentos: typeof lancamentosDoItem
  marcarRemocao: typeof marcarParaRemocaoRm
  confirmarRemocao: typeof confirmarRemocaoRm
  fecharAusente: typeof fecharRastroAusenteRm
  atualizarPeriodo: typeof atualizarPeriodoLancamentoRm
}

const DEPS_RM: DepsRm = {
  temSoap: temRmSoap,
  existe: registroRmExiste,
  salvar: saveRecordDireto,
  apagar: deleteRecordByKeyDireto,
  reservar: reservarEfeito,
  confirmar: confirmarEfeito,
  liberar: liberarEfeito,
  lancamentos: lancamentosDoItem,
  marcarRemocao: marcarParaRemocaoRm,
  confirmarRemocao: confirmarRemocaoRm,
  fecharAusente: fecharRastroAusenteRm,
  atualizarPeriodo: atualizarPeriodoLancamentoRm,
}

const msg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300)

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
 *
 * As duas provas usam a leitura ESTRITA (`registroRmExiste`): RM sem resposta não é "não existe".
 * Antes, com a leitura que engole erro, um RM fora do ar no passo 1 fechava o rastro como
 * `ja_ausente` com o registro vivo lá — board cancelado e S-2260 de pé, sem pendência nenhuma.
 */
export async function removerLancamentoRm(
  lancamento: LancamentoRm,
  p: { motivo: MotivoSaidaRm; removidoPor?: string | null; timeoutMs?: number },
  deps: Partial<DepsRm> = {},
): Promise<ResultadoRemocaoRm> {
  const d = { ...DEPS_RM, ...deps }
  if (!d.temSoap()) return { estado: "erro", lancamentoId: lancamento.id, erro: "rm_soap_nao_configurado" }

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

  let antes: boolean
  try {
    antes = await d.existe(RM_DATA_SERVER_CONVOCACAO, pk, contexto)
  } catch (e) {
    // Nada foi escrito ainda: é erro comum, retryável — o job tenta de novo.
    return { ...base, estado: "erro", erro: `existencia_nao_confirmada: ${msg(e)}` }
  }
  if (!antes) {
    // Não está lá. Fecha o rastro do mesmo jeito: deixar `no_rm` faria o pré-voo continuar
    // achando que existe convocação viva e bloquear a próxima gravação legítima.
    await d.fecharAusente(lancamento.id, { motivo: p.motivo, removidoPor: p.removidoPor })
    return { ...base, estado: "ja_ausente" }
  }

  const marcado = await d.marcarRemocao(lancamento.id, { motivo: p.motivo, removidoPor: p.removidoPor })
  if (!marcado) {
    // Só `no_rm` vira `a_remover`. Não casar aqui = alguém já removeu, ou a linha nunca confirmou.
    return { ...base, estado: "sem_rastro", erro: `estado_nao_removivel:${lancamento.estado}` }
  }

  const chave = chaveEfeitoRemocaoConvocacaoRm(lancamento.id)
  await d.reservar(chave, "convocacao_rm_remover", {
    pk, chapa: lancamento.chapa, codigo: lancamento.codigo, motivo: p.motivo,
  })

  try {
    await d.apagar(RM_DATA_SERVER_CONVOCACAO, pk, contexto, p.timeoutMs)
  } catch (e) {
    const err = e as RmSoapError
    // Fault = respondeu e recusou, COM rollback: nada foi apagado, então o slot volta e a linha
    // também. Timeout/5xx é o oposto — pode ter apagado; aí só a releitura resolve.
    if (err?.indeterminado === false) {
      await d.liberar(chave).catch(() => {})
      return { ...base, estado: "erro", erro: msg(e) }
    }
    return { ...base, estado: "indeterminado", erro: msg(e) }
  }

  let depois: boolean
  try {
    depois = await d.existe(RM_DATA_SERVER_CONVOCACAO, pk, contexto)
  } catch (e) {
    // O delete foi aceito, mas não deu pra conferir. Pode ter apagado: indeterminado, e o retry
    // resolve lendo (se sumiu, cai no `ja_ausente` acima).
    return { ...base, estado: "indeterminado", erro: `remocao_nao_conferida: ${msg(e)}` }
  }
  if (depois) {
    // O RM aceitou a chamada e o registro continua lá. Não confirma nada: dizer "removido" aqui
    // seria a mentira mais cara possível — o board fica limpo e o S-2260 continua de pé.
    return { ...base, estado: "erro", erro: "delete_aceito_mas_registro_continua_no_rm" }
  }

  await d.confirmar(chave, pk, { pk, codConvocacao: lancamento.codigo })
  await d.confirmarRemocao(lancamento.id, { pk })
  return { ...base, estado: "removido" }
}

/**
 * Remove TODOS os lançamentos vivos de um item — é o cancelamento total: a convocação pode ter
 * virado N registros no RM (quebra por atestado, bifurcação), e cancelar tem que levar todos.
 */
export async function removerConvocacoesDoItem(
  itemOrigemId: string | number,
  p: { motivo: MotivoSaidaRm; removidoPor?: string | null; timeoutMs?: number },
  deps: Partial<DepsRm> = {},
): Promise<RemocaoRmSumario> {
  const d = { ...DEPS_RM, ...deps }
  const vivos = await d.lancamentos(itemOrigemId, { apenasVivos: true })
  if (!vivos.length) return { removidos: [], temPendencia: false }

  const removidos: ResultadoRemocaoRm[] = []
  for (const l of vivos) {
    try {
      removidos.push(await removerLancamentoRm(l, p, deps))
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

export type EstadoEdicaoRm =
  | "editado"
  | "ja_no_periodo"
  /** O rastro dizia vivo, mas o RM não tem o registro: rastro fechado, nada a editar. Não é pendência. */
  | "ja_ausente"
  | "sem_rastro"
  | "indeterminado"
  | "erro"

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
 *
 * Prova que o registro EXISTE antes de editar (25/09/2026, KAREN 007355). O rastro dizia `no_rm`
 * para C03S003983, mas o registro tinha saído do RM em 31/08 na limpeza do run b4a1f614. SaveRecord
 * numa chave que não existe não edita nada: devolve texto de erro, que vira `indeterminado`, a
 * chave do ledger fica presa e o cancelamento termina "com pendência" que nenhum retry resolve.
 * `motivo`/`removidoPor` só servem pra fechar o rastro nesse caso.
 */
export async function editarFimLancamentoRm(
  lancamento: LancamentoRm,
  p: { dataFim: string; timeoutMs?: number; motivo?: MotivoSaidaRm; removidoPor?: string | null },
  deps: Partial<DepsRm> = {},
): Promise<ResultadoEdicaoRm> {
  const d = { ...DEPS_RM, ...deps }
  if (!d.temSoap()) return { estado: "erro", lancamentoId: lancamento.id, erro: "rm_soap_nao_configurado" }
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

  let existe: boolean
  try {
    existe = await d.existe(RM_DATA_SERVER_CONVOCACAO, base.pk, contexto)
  } catch (e) {
    // RM sem resposta: não dá pra saber. Nada foi escrito, então é erro retryável — e não
    // "ausente": fechar o rastro com o registro vivo faria o rastro mentir.
    return { ...base, estado: "erro", dataFimNova: montada.dataFim, erro: `existencia_nao_confirmada: ${msg(e)}` }
  }
  if (!existe) {
    // Reserva de tentativa anterior (a que bateu na chave inexistente) sai do ledger: não existe
    // registro pra essa edição ter alcançado, e presa ela só confunde a conciliação.
    await d.liberar(chave).catch(() => {})
    await d.fecharAusente(lancamento.id, {
      motivo: p.motivo ?? "correcao_manual",
      removidoPor: p.removidoPor ?? null,
    })
    return { ...base, estado: "ja_ausente", dataFimNova: montada.dataFim }
  }

  const reserva = await d.reservar(chave, "convocacao_rm_editar", {
    pk: base.pk, de: anterior, para: montada.dataFim,
  })
  if (reserva === "confirmado") return { ...base, estado: "ja_no_periodo", dataFimNova: montada.dataFim }

  try {
    await d.salvar(RM_DATA_SERVER_CONVOCACAO, montada.dadosXml, contexto, p.timeoutMs)
  } catch (e) {
    const err = e as RmSoapError
    // Fault = recusou com rollback: nada mudou, libera o slot. Timeout = pode ter editado; deixa
    // a chave presa e devolve indeterminado — reeditar pro mesmo fim seria inofensivo, mas quem
    // decide isso é o retry, não este ponto.
    if (err?.indeterminado === false) {
      await d.liberar(chave).catch(() => {})
      return { ...base, estado: "erro", dataFimNova: montada.dataFim, erro: msg(e) }
    }
    return { ...base, estado: "indeterminado", dataFimNova: montada.dataFim, erro: msg(e) }
  }

  await d.confirmar(chave, base.pk, { de: anterior, para: montada.dataFim })
  // O rastro tem que acompanhar: sem isso o pré-voo e `lancamentosPorChapaPeriodo` seguem
  // afirmando o período antigo, e passam a mentir sobre sobreposição.
  await d.atualizarPeriodo(lancamento.id, {
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
 *
 * É também o que o job de reconciliação refaz quando o parcial ficou pendente — nunca a remoção
 * do item inteiro, que apagaria do RM os dias trabalhados antes do corte.
 */
export async function encurtarConvocacoesDoItem(
  itemOrigemId: string | number,
  p: { novoFim: string; removidoPor?: string | null; timeoutMs?: number },
  deps: Partial<DepsRm> = {},
): Promise<{ edicoes: ResultadoEdicaoRm[]; remocoes: ResultadoRemocaoRm[]; temPendencia: boolean }> {
  const d = { ...DEPS_RM, ...deps }
  const vivos = await d.lancamentos(itemOrigemId, { apenasVivos: true })
  const edicoes: ResultadoEdicaoRm[] = []
  const remocoes: ResultadoRemocaoRm[] = []

  for (const l of vivos) {
    const inicio = String(l.data_inicio).slice(0, 10)
    const fim = String(l.data_fim).slice(0, 10)
    if (fim <= p.novoFim) continue // termina antes do corte: nada a fazer
    // Erro inesperado num pedaço não pode impedir os outros — nem sumir: vira `erro` (pendência).
    const base = { lancamentoId: l.id, codConvocacao: l.codigo ?? undefined }
    if (inicio > p.novoFim) {
      // O pedaço inteiro caiu dentro do cancelamento — encurtar deixaria fim < início.
      remocoes.push(
        await removerLancamentoRm(l, {
          motivo: "cancelamento_parcial", removidoPor: p.removidoPor, timeoutMs: p.timeoutMs,
        }, deps).catch((e): ResultadoRemocaoRm => ({ ...base, estado: "erro", erro: msg(e) })),
      )
      continue
    }
    edicoes.push(
      await editarFimLancamentoRm(l, {
        dataFim: p.novoFim, timeoutMs: p.timeoutMs,
        motivo: "cancelamento_parcial", removidoPor: p.removidoPor,
      }, deps).catch((e): ResultadoEdicaoRm => ({ ...base, estado: "erro", erro: msg(e) })),
    )
  }

  return {
    edicoes,
    remocoes,
    temPendencia:
      edicoes.some((e) => e.estado === "erro" || e.estado === "indeterminado") ||
      remocoes.some((r) => r.estado === "erro" || r.estado === "indeterminado"),
  }
}
