// Gravação de convocação no RM, UMA PESSOA por vez.
//
// Por pessoa, e não por contrato, porque é assim que os dois consumidores funcionam: o pontual
// grava uma convocação quando o operador cria uma; o mensal chama isto em laço no fim do
// pagamento. Lote por contrato foi o modelo antigo e saiu.
//
// O pré-voo existe porque o DP lança convocação no RM na mão desde 2023 (3746 registros na
// coligada 3) e continua lançando. Sem consultar antes, a automação duplica o que um humano
// gravou minutos atrás — e convocação de intermitente é evento eSocial S-2260, então duplicata é
// problema trabalhista, não sujeira de tabela.
import {
  chaveEfeitoConvocacaoRm,
  convocacaoJaNoRm,
  ESTADO_CONVOCACAO_CONCLUIDA,
  filtroReadViewConvocacao,
  lotesDeChapas,
  montarConvocacaoRm,
  parseConvocacoesReadView,
  RM_COLIGADA_CONVOCACAO,
  RM_DATA_SERVER_CONVOCACAO,
  type ConvocacaoExistenteRm,
} from "../domain/convocacaoRm.js"
import {
  contextoDataServer,
  desescaparXml,
  readViewDireto,
  saveRecordDireto,
  temRmSoap,
  type RmSoapError,
} from "../clients/rmSoap.js"
import { confirmarEfeito, liberarEfeito, reservarEfeito } from "../jobs/repo.js"
import {
  confirmarLancamentoRm,
  falharLancamentoRm,
  reservarLancamentoRm,
  type LancamentoRm,
} from "../repo/convocacoesRm.js"

/** Teto do ReadView de uma pessoa. O default do transporte é de PROCESSO (120s) e é absurdo aqui. */
const TIMEOUT_PREVOO_MS = 20_000

export interface JanelaConvocacoesRm {
  chapas: string[]
  /** Janela de sobreposição — normalmente o período que se pretende convocar. */
  dataInicio: string
  dataFim: string
  coligada?: number
  /**
   * Teto do ReadView. Sem isto herda o timeout de PROCESSO (120s), que é absurdo pra ler UMA
   * chapa e é o que faz um job de convocação estourar a função inteira.
   */
  timeoutMs?: number
}

/**
 * Convocações que já existem no RM cruzando a janela, para as chapas pedidas.
 *
 * Vai em lotes de chapas porque o filtro do DataServer é uma string só. Um lote que falha NÃO é
 * engolido: sem a lista completa não há como afirmar "não existe", e afirmar isso errado é
 * exatamente o que gera a convocação duplicada.
 */
export async function convocacoesExistentesRm(j: JanelaConvocacoesRm): Promise<ConvocacaoExistenteRm[]> {
  if (!temRmSoap()) throw new Error("rm_soap_nao_configurado")
  const contexto = contextoDataServer(j.coligada ?? RM_COLIGADA_CONVOCACAO)
  const out: ConvocacaoExistenteRm[] = []
  for (const lote of lotesDeChapas(j.chapas)) {
    const filtro = filtroReadViewConvocacao({ ...j, chapas: lote })
    // ReadView devolve HTML-escapado — sem desescapar, o parse acha zero e mente "não existe".
    const xml = desescaparXml(
      await readViewDireto(RM_DATA_SERVER_CONVOCACAO, filtro, contexto, j.timeoutMs),
    )
    out.push(...parseConvocacoesReadView(xml))
  }
  return out
}

export interface AlvoConvocacaoRm {
  chapa: string
  dataInicio: string
  dataFim: string
  /** Identificador de quem pediu (item do Monday) — só pra devolver junto no relatório. */
  ref?: string
}

export interface PreVooConvocacaoRm {
  /** Sem convocação no RM cruzando o período — pode gravar. */
  aGravar: AlvoConvocacaoRm[]
  /** Já existe convocação cruzando o período — NÃO gravar sem decisão humana. */
  jaExistem: { alvo: AlvoConvocacaoRm; existente: ConvocacaoExistenteRm }[]
  /** Tudo que o RM devolveu na janela, pra conferência. */
  existentesNoRm: ConvocacaoExistenteRm[]
}

/**
 * Cruza os alvos com o que o RM já tem. A janela do ReadView cobre o menor início e o maior fim
 * dos alvos — uma consulta só em vez de uma por pessoa.
 */
export async function preVooConvocacaoRm(
  alvos: AlvoConvocacaoRm[],
  opts: { coligada?: number; timeoutMs?: number } = {},
): Promise<PreVooConvocacaoRm> {
  if (!alvos.length) return { aGravar: [], jaExistem: [], existentesNoRm: [] }
  const dataInicio = alvos.map((a) => a.dataInicio).sort()[0]
  const dataFim = alvos.map((a) => a.dataFim).sort().at(-1)!
  const existentesNoRm = await convocacoesExistentesRm({
    chapas: alvos.map((a) => a.chapa),
    dataInicio,
    dataFim,
    coligada: opts.coligada,
    timeoutMs: opts.timeoutMs,
  })

  const aGravar: AlvoConvocacaoRm[] = []
  const jaExistem: { alvo: AlvoConvocacaoRm; existente: ConvocacaoExistenteRm }[] = []
  for (const alvo of alvos) {
    const existente = convocacaoJaNoRm(existentesNoRm, alvo)
    if (existente) jaExistem.push({ alvo, existente })
    else aGravar.push(alvo)
  }
  return { aGravar, jaExistem, existentesNoRm }
}

// ---------------------------------------------------------------------------
// Gravação. Aqui é onde escreve no RM.
// ---------------------------------------------------------------------------

export type EstadoGravacaoRm =
  /** Gravou e o código voltou. */
  | "gravado"
  /** Gravou no RM, mas o eco do código no Monday falhou. O ledger impede regravar. */
  | "gravado_monday_pendente"
  /** Nosso rastro já tem um lançamento vivo para este item+início. */
  | "ja_lancado"
  /** O pré-voo achou no RM uma convocação cruzando o período (provável lançamento manual do DP). */
  | "ja_no_rm"
  /** Slot preso por reserva anterior sem confirmação: pode ter gravado e morrido. Conferir lendo. */
  | "reserva_pendente"
  | "erro"

export interface ResultadoGravacaoRm {
  estado: EstadoGravacaoRm
  chapa: string
  dataInicio: string
  dataFim: string
  dataConvocacao?: string
  antecedenciaDias?: number
  /** Fora da antecedência legal do art. 452-A — vai no relatório, não bloqueia. */
  exigeConfirmacaoRm?: boolean
  lancamentoId?: string
  chave?: string
  codConvocacao?: string
  /** PK no RM (`3;chapa;codigo`) — é o caminho de volta. */
  pk?: string
  erro?: string
  /** true = pode ter gravado. NUNCA reenviar; conferir lendo. */
  indeterminado?: boolean
  detalhe?: string
  /**
   * No `ja_no_rm`, o registro que o pré-voo achou — com ESTADO. O mensal precisa distinguir
   * convocação válida (pula de verdade) de CANCELADA no RM (vira `requer_decisao_dp`, decisão do
   * Isaac em 10/08: nem regravar por cima nem pular calado).
   */
  existente?: ConvocacaoExistenteRm
}

export interface AlvoGravacaoRm {
  itemOrigemId: string | number
  mondayBoardId?: string | number | null
  uuidConvocacao?: string | null
  chapa: string
  contrato: string
  dataInicio: string
  dataFim: string
  /** Piso da regra dos 3 dias. Sem ela o ato pode cair antes da admissão de um recém-contratado. */
  dataAdmissao?: string
  /**
   * Override da data do ato. É por aqui que os pedaços de um período partido herdam o ato do
   * período original — houve UM ato de convocação, o atestado só interrompeu a prestação.
   */
  dataConvocacao?: string
  coligada?: number
  origemAcao?: string
  criadoPor?: string | null
  origemLancamentoId?: string | null
}

/**
 * Grava UMA convocação no RM.
 *
 * Ordem que importa (lição do mensal em 01/08): reserva ANTES do SaveRecord, nos dois lugares.
 * Morrer no meio deixa rastro `reservado` — que na passada seguinte vira `reserva_pendente` e pede
 * conferência — em vez de gravar a convocação duas vezes.
 *
 * Três barreiras, e nenhuma é redundante:
 *   1. `reservarLancamentoRm` — nosso rastro (pega o retry do mesmo pedido);
 *   2. pré-voo `ReadView` — o que o DP lançou à mão, que o rastro não conhece;
 *   3. `reservarEfeito` — o ledger transversal de efeitos irreversíveis.
 */
export async function gravarConvocacaoRm(
  alvo: AlvoGravacaoRm,
  opts: {
    /** Eco do código no item do Monday. Injetado: este módulo não conhece board de propósito. */
    gravarNoMonday?: (r: { codConvocacao: string; pk: string }) => Promise<void>
    /** Pula o ReadView quando o caller já fez o pré-voo do grupo todo (mensal). */
    pularPreVoo?: boolean
    timeoutMs?: number
  } = {},
): Promise<ResultadoGravacaoRm> {
  const coligada = alvo.coligada ?? RM_COLIGADA_CONVOCACAO
  const contexto = contextoDataServer(coligada)

  // 1) Monta e valida antes de qualquer I/O — entrada ruim não merece round-trip.
  let montada: ReturnType<typeof montarConvocacaoRm>
  try {
    montada = montarConvocacaoRm({
      chapa: alvo.chapa,
      dataInicio: alvo.dataInicio,
      dataFim: alvo.dataFim,
      dataAdmissao: alvo.dataAdmissao,
      dataConvocacao: alvo.dataConvocacao,
      coligada,
    })
  } catch (e) {
    return {
      estado: "erro",
      chapa: alvo.chapa,
      dataInicio: alvo.dataInicio,
      dataFim: alvo.dataFim,
      erro: (e as Error).message,
    }
  }

  const base = {
    chapa: montada.chapa,
    dataInicio: montada.dataInicio,
    dataFim: montada.dataFim,
    dataConvocacao: montada.dataConvocacao,
    antecedenciaDias: montada.antecedenciaDias,
    exigeConfirmacaoRm: montada.exigeConfirmacaoRm,
  }

  // 2) Pré-voo: o DP lança à mão e o nosso rastro não sabe disso.
  if (!opts.pularPreVoo) {
    const pre = await preVooConvocacaoRm(
      [{ chapa: montada.chapa, dataInicio: montada.dataInicio, dataFim: montada.dataFim }],
      { coligada, timeoutMs: opts.timeoutMs ?? TIMEOUT_PREVOO_MS },
    )
    const jaLa = pre.jaExistem[0]?.existente
    if (jaLa) {
      return {
        ...base,
        estado: "ja_no_rm",
        codConvocacao: jaLa.codConvocacao,
        detalhe: `${jaLa.codConvocacao} ${jaLa.dataInicio}..${jaLa.dataFim} (${jaLa.estadoDescricao || jaLa.estado})`,
        existente: jaLa,
      }
    }
  }

  // 3) Reserva no nosso rastro. É o índice parcial que decide, não uma chave semântica.
  const reserva = await reservarLancamentoRm({
    itemOrigemId: alvo.itemOrigemId,
    mondayBoardId: alvo.mondayBoardId,
    uuidConvocacao: alvo.uuidConvocacao,
    chapa: montada.chapa,
    contrato: alvo.contrato,
    dataInicio: montada.dataInicio,
    dataFim: montada.dataFim,
    dataConvocacao: montada.dataConvocacao,
    estadoConvocacao: ESTADO_CONVOCACAO_CONCLUIDA,
    coligada,
    origemAcao: alvo.origemAcao,
    criadoPor: alvo.criadoPor,
    origemLancamentoId: alvo.origemLancamentoId,
    payload: { xml: montada.dadosXml },
  })
  if (reserva.status === "ocupado") {
    const dono: LancamentoRm = reserva.lancamento
    return {
      ...base,
      lancamentoId: dono.id,
      estado: dono.estado === "no_rm" ? "ja_lancado" : "reserva_pendente",
      codConvocacao: dono.codigo ?? undefined,
      pk: dono.pk_rm ?? undefined,
      indeterminado: dono.indeterminado,
      detalhe: dono.codigo ?? dono.erro ?? undefined,
    }
  }
  const lancamentoId = reserva.lancamento.id

  // 4) Ledger transversal. A chave é o id da linha: uuid fresco, então nunca colide — e é por
  // isso que ela pode ser a mesma para uma segunda gravação legítima do mesmo período.
  const chave = chaveEfeitoConvocacaoRm(lancamentoId)
  await reservarEfeito(chave, "convocacao_rm", {
    itemOrigemId: String(alvo.itemOrigemId),
    contrato: alvo.contrato,
    chapa: montada.chapa,
    periodo: [montada.dataInicio, montada.dataFim],
  })

  // 5) Grava.
  let pk = ""
  let codConvocacao = ""
  try {
    const r = await saveRecordDireto(RM_DATA_SERVER_CONVOCACAO, montada.dadosXml, contexto, opts.timeoutMs)
    pk = r.chave
    // O RM ignora o código enviado e devolve o do contador automático — é ele que vale.
    codConvocacao = pk.split(";").pop() ?? ""
    await confirmarEfeito(chave, pk, { pks: [pk], codConvocacao })
    await confirmarLancamentoRm(lancamentoId, { codigo: codConvocacao, pkRm: pk })
  } catch (e) {
    const err = e as RmSoapError
    const determinístico = err?.indeterminado === false
    // Fault = respondeu e recusou, COM rollback: está PROVADO que não gravou, então os dois slots
    // voltam. Timeout/5xx é o oposto — pode ter gravado, e reenviar é o único jeito de duplicar.
    if (determinístico) await liberarEfeito(chave).catch(() => {})
    await falharLancamentoRm(lancamentoId, err?.message ?? String(e), {
      indeterminado: err?.indeterminado === true,
    }).catch(() => {})
    return {
      ...base,
      lancamentoId,
      chave,
      estado: "erro",
      erro: err?.message?.slice(0, 300) ?? String(e),
      indeterminado: err?.indeterminado === true,
    }
  }

  // 6) Eco no Monday. A partir daqui o RM já tem o registro: falhar aqui só deixa a tela sem o
  // número, e quem impede a regravação é o rastro + o ledger.
  if (opts.gravarNoMonday) {
    try {
      await opts.gravarNoMonday({ codConvocacao, pk })
    } catch (e) {
      return {
        ...base,
        lancamentoId,
        chave,
        estado: "gravado_monday_pendente",
        codConvocacao,
        pk,
        erro: `gravou no RM, falhou no Monday: ${(e as Error).message.slice(0, 200)}`,
      }
    }
  }

  return { ...base, lancamentoId, chave, estado: "gravado", codConvocacao, pk }
}
