// Pré-voo da convocação no RM: o que JÁ existe lá antes de gravar qualquer coisa.
//
// Existe porque o DP lança convocação no RM na mão desde 2023 (3746 registros na coligada 3).
// O gatilho novo é por CONTRATO — um clique grava o contrato inteiro. Sem consultar antes, o lote
// duplica o que um humano gravou minutos atrás, e convocação de intermitente é evento eSocial
// S-2260: duplicata é problema trabalhista, não sujeira de tabela.
//
// READ-ONLY. Nada aqui grava. O SaveRecord fica na rota do gatilho, atrás de flag + ledger.
import {
  chaveEfeitoConvocacaoRm,
  classificarItensConvocacaoRm,
  convocacaoJaNoRm,
  filtroReadViewConvocacao,
  lotesDeChapas,
  montarConvocacaoRm,
  parseConvocacoesReadView,
  RM_COLIGADA_CONVOCACAO,
  RM_DATA_SERVER_CONVOCACAO,
  type CandidatoConvocacaoRm,
  type ConvocacaoExistenteRm,
  type ItemConvocacaoMonday,
  type PuloConvocacaoRm,
} from "../domain/convocacaoRm.js"
import {
  contextoDataServer,
  desescaparXml,
  readViewDireto,
  saveRecordDireto,
  temRmSoap,
  type RmSoapError,
} from "../clients/rmSoap.js"
import { confirmarEfeito, estadoEfeito, reservarEfeito } from "../jobs/repo.js"

export interface JanelaConvocacoesRm {
  chapas: string[]
  /** Janela de sobreposição — normalmente o período que se pretende convocar. */
  dataInicio: string
  dataFim: string
  coligada?: number
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
    const xml = desescaparXml(await readViewDireto(RM_DATA_SERVER_CONVOCACAO, filtro, contexto))
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
  opts: { coligada?: number } = {},
): Promise<PreVooConvocacaoRm> {
  if (!alvos.length) return { aGravar: [], jaExistem: [], existentesNoRm: [] }
  const dataInicio = alvos.map((a) => a.dataInicio).sort()[0]
  const dataFim = alvos.map((a) => a.dataFim).sort().at(-1)!
  const existentesNoRm = await convocacoesExistentesRm({
    chapas: alvos.map((a) => a.chapa),
    dataInicio,
    dataFim,
    coligada: opts.coligada,
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
// Execução do lote por contrato. Aqui é onde GRAVA.
// ---------------------------------------------------------------------------

export type EstadoConvocacaoRm =
  | "gravado"
  /** Chave de efeito já confirmada: alguém (ou outro run) já gravou. Não gravar de novo. */
  | "pulado_idempotencia"
  /** Reserva anterior sem confirmação: pode ter gravado e morrido no meio. Exige olho humano. */
  | "reserva_pendente"
  | "gravado_monday_pendente"
  | "erro"
  /** Prévia: seria gravado. */
  | "seria_gravado"

export interface ResultadoConvocacaoRm {
  itemId: string
  chapa: string
  nome: string
  estado: EstadoConvocacaoRm
  dataInicio: string
  dataFim: string
  dataConvocacao: string
  antecedenciaDias: number
  /** Fora da antecedência legal — vai no relatório pro DP ver, não bloqueia. */
  exigeConfirmacaoRm: boolean
  chave: string
  /** Código que o RM gerou (contador automático). Só em `gravado`. */
  codConvocacao?: string
  /** PK do registro no RM (`3;chapa;codigo`) — é o caminho de volta. */
  pk?: string
  erro?: string
  /** true = pode ter gravado. NUNCA reenviar; conferir lendo. */
  indeterminado?: boolean
}

export interface LoteConvocacaoRmResultado {
  contrato: string
  previa: boolean
  resultados: ResultadoConvocacaoRm[]
  pulados: { itemId: string; chapa: string; nome: string; motivo: string; detalhe?: string }[]
  totais: Record<string, number>
}

export interface ExecutarLoteConvocacaoRm {
  contrato: string
  itens: ItemConvocacaoMonday[]
  /** true = não grava nada, nem no RM nem no ledger. */
  previa: boolean
  coligada?: number
  /**
   * Grava o código do RM de volta no item do Monday. Injetado pela rota — este módulo não conhece
   * Monday de propósito, pra poder ser exercitado sem board.
   */
  gravarNoMonday?: (item: ItemConvocacaoMonday, codConvocacao: string, pk: string) => Promise<void>
}

/**
 * Executa o lote de um contrato: classifica -> pré-voo no RM -> grava um por um.
 *
 * Ordem que importa (lição do mensal em 01/08): a chave de efeito é reservada ANTES do SaveRecord.
 * Se o processo morrer no meio, sobra `pendente` — que na próxima passada vira
 * `reserva_pendente` e pede conferência humana — em vez de gravar a convocação duas vezes.
 *
 * Um item que falha NÃO derruba o lote: cada pessoa tem chave e resultado próprios. Chave de lote
 * faria uma pessoa nova cancelar a gravação de todo o resto.
 */
export async function executarLoteConvocacaoRm(
  p: ExecutarLoteConvocacaoRm,
): Promise<LoteConvocacaoRmResultado> {
  if (!temRmSoap()) throw new Error("rm_soap_nao_configurado")
  const contexto = contextoDataServer(p.coligada ?? RM_COLIGADA_CONVOCACAO)
  const { candidatos, pulados } = classificarItensConvocacaoRm(p.itens)

  const pool: PuloConvocacaoRm[] = [...pulados]
  let aGravar: CandidatoConvocacaoRm[] = candidatos

  // Pré-voo: o DP lança na mão, então parte do lote pode já estar no RM.
  if (candidatos.length) {
    const preVoo = await preVooConvocacaoRm(
      candidatos.map((c) => ({ chapa: c.item.chapa, dataInicio: c.dataInicio, dataFim: c.dataFim, ref: c.item.itemId })),
      { coligada: p.coligada },
    )
    const jaNoRmPorItem = new Map(preVoo.jaExistem.map((j) => [j.alvo.ref!, j.existente]))
    aGravar = candidatos.filter((c) => !jaNoRmPorItem.has(c.item.itemId))
    for (const c of candidatos) {
      const existente = jaNoRmPorItem.get(c.item.itemId)
      if (existente) {
        pool.push({
          item: c.item,
          motivo: "ja_no_rm",
          detalhe: `${existente.codConvocacao} ${existente.dataInicio}..${existente.dataFim}`,
        })
      }
    }
  }

  const resultados: ResultadoConvocacaoRm[] = []
  for (const c of aGravar) {
    const montada = montarConvocacaoRm({
      chapa: c.item.chapa,
      dataInicio: c.dataInicio,
      dataFim: c.dataFim,
      dataAdmissao: c.item.dataAdmissao,
    })
    const chave = chaveEfeitoConvocacaoRm({
      contrato: p.contrato,
      chapa: c.item.chapa,
      dataInicio: c.dataInicio,
    })
    const base = {
      itemId: c.item.itemId,
      chapa: montada.chapa,
      nome: c.item.nome,
      dataInicio: montada.dataInicio,
      dataFim: montada.dataFim,
      dataConvocacao: montada.dataConvocacao,
      antecedenciaDias: montada.antecedenciaDias,
      exigeConfirmacaoRm: montada.exigeConfirmacaoRm,
      chave,
    }

    if (p.previa) {
      // Prévia NÃO reserva: reservar aqui deixaria a chave 'pendente' e travaria a execução real.
      const estado = await estadoEfeito(chave)
      resultados.push({
        ...base,
        estado:
          estado === "confirmado"
            ? "pulado_idempotencia"
            : estado === "pendente"
              ? "reserva_pendente"
              : "seria_gravado",
      })
      continue
    }

    const reserva = await reservarEfeito(chave, "convocacao_rm", {
      contrato: p.contrato,
      itemId: c.item.itemId,
      dataServer: RM_DATA_SERVER_CONVOCACAO,
      periodo: [montada.dataInicio, montada.dataFim],
    })
    if (reserva === "confirmado") {
      resultados.push({ ...base, estado: "pulado_idempotencia" })
      continue
    }
    if (reserva === "pendente") {
      // Tentativa anterior reservou e não confirmou. Pode ter gravado no RM. Reenviar é o único
      // jeito de duplicar de verdade — então não reenvia.
      resultados.push({
        ...base,
        estado: "reserva_pendente",
        erro: "reserva anterior sem confirmação — conferir no RM antes de repetir",
      })
      continue
    }

    let pk = ""
    let codConvocacao = ""
    try {
      const r = await saveRecordDireto(RM_DATA_SERVER_CONVOCACAO, montada.dadosXml, contexto)
      pk = r.chave
      // O RM ignora o código enviado e devolve o do contador automático — é ele que vale.
      codConvocacao = pk.split(";").pop() ?? ""
      await confirmarEfeito(chave, pk, { pks: [pk], codConvocacao })
    } catch (e) {
      const err = e as RmSoapError
      resultados.push({
        ...base,
        estado: "erro",
        erro: err?.message?.slice(0, 300) ?? String(e),
        indeterminado: err?.indeterminado === true,
      })
      continue
    }

    // A partir daqui o RM já tem o registro. Falha no Monday não desfaz nada — só deixa a tela
    // sem o código, e o ledger é quem impede a regravação.
    if (p.gravarNoMonday) {
      try {
        await p.gravarNoMonday(c.item, codConvocacao, pk)
      } catch (e) {
        resultados.push({
          ...base,
          estado: "gravado_monday_pendente",
          codConvocacao,
          pk,
          erro: `gravou no RM, falhou no Monday: ${(e as Error).message.slice(0, 200)}`,
        })
        continue
      }
    }
    resultados.push({ ...base, estado: "gravado", codConvocacao, pk })
  }

  const totais: Record<string, number> = {}
  for (const r of resultados) totais[r.estado] = (totais[r.estado] ?? 0) + 1
  for (const x of pool) totais[x.motivo] = (totais[x.motivo] ?? 0) + 1

  return {
    contrato: p.contrato,
    previa: p.previa,
    resultados,
    pulados: pool.map((x) => ({
      itemId: x.item.itemId,
      chapa: x.item.chapa,
      nome: x.item.nome,
      motivo: x.motivo,
      detalhe: x.detalhe,
    })),
    totais,
  }
}
