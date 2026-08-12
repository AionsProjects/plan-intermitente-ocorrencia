// BIFURCAÇÃO no RM: apaga o registro que cruza o corte e grava dois no lugar.
//
// ⚠️ REGISTRO DA OBJEÇÃO (12/08/2026). O `FopConvocacaoData` tem 9 campos e nenhum é contrato —
// leitura real do C03S003783: CODCOLIGADA, CHAPA, CODCONVOCACAO, DTCONVOCACAO, DTINIPRESTSERV,
// DTFIMPRESTSERV, INDLOCALPRESTACTRAB, ESTADOCONVOCACAO, DTRESPOSTA. Os 12 splits do board são
// todos CONTÍGUOS (só muda o contrato), então o S-2260 de 05→20 continua correto depois do split
// e apagá-lo pra transmitir dois é churn em evento do governo. Foi levantado e o Isaac decidiu
// implementar assim mesmo — isto é escolha registrada, não descuido. Ver
// `docs/rm/plano-bifurcacao.md`. A decisão se inverteria se o app passasse a mandar
// `INDLOCALPRESTACTRAB` real por contrato.
//
// ORDEM: apaga primeiro, cria depois. Se a criação falhar, a pessoa fica sem convocação e o job
// recria a partir das reservas que já estão no banco. O inverso (criar antes) deixaria três
// registros vivos caso o delete falhasse — S-2260 duplicado, que é pior e só sai na mão.
import { config } from "../config.js"
import {
  montarConvocacaoRm,
  paraDataIso,
  somarDias,
} from "../domain/convocacaoRm.js"
import {
  lancamentosDoItem,
  pecasDeBifurcacaoDoItem,
  planejarSubstituicaoRm,
  type LancamentoRm,
  type ReservaLancamentoRm,
} from "../repo/convocacoesRm.js"
import { executarGravacaoRm, type ResultadoGravacaoRm } from "./convocacaoRm.js"
import { removerLancamentoRm, type ResultadoRemocaoRm } from "./convocacaoRemover.js"

/** Kill switch do caminho destrutivo, independente da flag geral. Ligado por padrão. */
export function bifurcacaoRmHabilitada(): boolean {
  return config.convocacaoRmHabilitada && String(process.env.SPLIT_RM_HABILITADO ?? "1") !== "0"
}

export interface PedacoBifurcacao {
  dataInicio: string
  dataFim: string
  contrato: string
}

export interface ResultadoBifurcacao {
  /** Registros que o RM perdeu. */
  remocoes: ResultadoRemocaoRm[]
  /** Registros que o RM ganhou. */
  gravacoes: ResultadoGravacaoRm[]
  /** Vivos que NÃO cruzavam o corte — período deles não muda, então não se toca. */
  intactos: Array<{ lancamentoId: string; periodo: [string, string] }>
  temPendencia: boolean
  nota?: "desligado" | "nada_vivo" | "nenhum_cruza_o_corte"
}

const iso = (v: unknown): string => String(v).slice(0, 10)

/**
 * Alvos que uma bifurcação produz a partir de UM lançamento vivo.
 *
 * Pura de propósito: a regra de quem parte e quem fica intacto é a parte que erra em silêncio, e
 * silêncio aqui custa um S-2260 apagado à toa.
 *
 * `corte` = primeiro dia da parte 2. Um lançamento só é partido quando o corte cai DENTRO dele:
 *   - termina antes do corte  -> inteiro na parte 1, período inalterado -> intacto;
 *   - começa no corte ou depois -> inteiro na parte 2, período inalterado -> intacto.
 * Nos dois casos só muda a quem se cobra, e isso o RM não guarda.
 */
export function pedacosDaBifurcacao(
  l: { data_inicio: unknown; data_fim: unknown },
  p: { corte: string; contratoParte1: string; contratoParte2: string },
): [PedacoBifurcacao, PedacoBifurcacao] | null {
  const inicio = iso(l.data_inicio)
  const fim = iso(l.data_fim)
  if (!(inicio < p.corte && fim >= p.corte)) return null
  return [
    { dataInicio: inicio, dataFim: somarDias(p.corte, -1), contrato: p.contratoParte1 },
    { dataInicio: p.corte, dataFim: fim, contrato: p.contratoParte2 },
  ]
}

/**
 * Aplica a bifurcação nos lançamentos vivos do item.
 *
 * Só quem CRUZA o corte é substituído. Peça que já estava inteira de um lado fica como está —
 * apagar e recriar com o mesmo período seria destruir um registro correto por nada.
 */
export async function bifurcarConvocacoesDoItem(
  itemOrigemId: string | number,
  p: {
    corte: string
    contratoParte1: string
    contratoParte2: string
    operador?: string | null
    timeoutMs?: number
  },
): Promise<ResultadoBifurcacao> {
  const vazio: ResultadoBifurcacao = { remocoes: [], gravacoes: [], intactos: [], temPendencia: false }
  if (!bifurcacaoRmHabilitada()) return { ...vazio, nota: "desligado" }
  if (!paraDataIso(p.corte)) throw new Error("corte_invalido")

  const vivos = await lancamentosDoItem(itemOrigemId, { apenasVivos: true })
  if (!vivos.length) return { ...vazio, nota: "nada_vivo" }

  const remover: { id: string; motivo: "bifurcacao" }[] = []
  const criar: ReservaLancamentoRm[] = []
  const intactos: ResultadoBifurcacao["intactos"] = []
  // Guarda o que cada reserva vai virar no RM, na MESMA ordem em que entra em `criar` —
  // `planejarSubstituicaoRm` devolve `reservados` preservando a ordem do INSERT.
  const origens: LancamentoRm[] = []

  for (const l of vivos) {
    const pedacos = pedacosDaBifurcacao(l, p)
    if (!pedacos) {
      intactos.push({ lancamentoId: l.id, periodo: [iso(l.data_inicio), iso(l.data_fim)] })
      continue
    }
    remover.push({ id: l.id, motivo: "bifurcacao" })
    for (const ped of pedacos) {
      criar.push({
        itemOrigemId,
        mondayBoardId: l.monday_board_id,
        uuidConvocacao: l.uuid_convocacao,
        chapa: l.chapa,
        contrato: ped.contrato,
        dataInicio: ped.dataInicio,
        dataFim: ped.dataFim,
        // Herda o ATO do original: houve UM convite; o split é rateio posterior. Recalcular pela
        // regra dos 3 dias colocaria o ato da parte 2 dentro do período já convocado.
        dataConvocacao: l.data_convocacao ? iso(l.data_convocacao) : null,
        estadoConvocacao: l.estado_convocacao,
        coligada: l.coligada,
        origemAcao: "split",
        criadoPor: p.operador ?? null,
        origemLancamentoId: l.id,
      })
      origens.push(l)
    }
  }

  if (!remover.length) return { ...vazio, intactos, nota: "nenhum_cruza_o_corte" }

  // Transação: `a_remover` está fora do índice parcial justamente pra peça 1, que herda o início,
  // caber antes de o DeleteRecordByKey acontecer.
  const plano = await planejarSubstituicaoRm({ remover, criar, removidoPor: p.operador ?? null })

  const remocoes: ResultadoRemocaoRm[] = []
  for (const l of plano.aRemover) {
    remocoes.push(
      await removerLancamentoRm(l, { motivo: "bifurcacao", removidoPor: p.operador ?? null, timeoutMs: p.timeoutMs }),
    )
  }
  // Delete que não deu certo bloqueia a criação: gravar por cima de um registro vivo é
  // exatamente a duplicidade de S-2260 que este módulo existe pra impedir.
  const deleteFalhou = remocoes.some((r) => r.estado === "erro" || r.estado === "indeterminado")
  if (deleteFalhou) {
    return { remocoes, gravacoes: [], intactos, temPendencia: true }
  }

  const gravacoes: ResultadoGravacaoRm[] = []
  for (let i = 0; i < plano.reservados.length; i++) {
    const r = plano.reservados[i]!
    const origem = origens[i]
    try {
      const montada = montarConvocacaoRm({
        chapa: r.chapa,
        dataInicio: iso(r.data_inicio),
        dataFim: iso(r.data_fim),
        dataConvocacao: r.data_convocacao ? iso(r.data_convocacao) : undefined,
        coligada: r.coligada,
      })
      gravacoes.push(
        await executarGravacaoRm(r, montada, {
          contrato: r.contrato ?? origem?.contrato ?? "",
          itemOrigemId,
          coligada: r.coligada,
          timeoutMs: p.timeoutMs,
        }),
      )
    } catch (e) {
      gravacoes.push({
        estado: "erro",
        chapa: r.chapa,
        dataInicio: iso(r.data_inicio),
        dataFim: iso(r.data_fim),
        lancamentoId: r.id,
        erro: (e as Error).message.slice(0, 300),
      } as ResultadoGravacaoRm)
    }
  }

  return {
    remocoes,
    gravacoes,
    intactos,
    temPendencia: gravacoes.some(
      (g) => g.estado === "erro" || g.estado === "reserva_pendente" || g.indeterminado === true,
    ),
  }
}

/**
 * Desfaz a bifurcação: as peças vivas voltam a ser UM registro com o período do pai.
 *
 * Só mexe no que nasceu de split (`motivo_saida='bifurcacao'` no pai) — quebra por atestado usa a
 * mesma mecânica de substituição, e desfazer split não pode desfazer atestado.
 *
 * O período restaurado é a UNIÃO das peças, não o período do pai: entre o split e o revert pode
 * ter havido cancelamento parcial encurtando uma delas, e ressuscitar o período original
 * declararia ao governo dias que o DP já cancelou.
 */
export async function reverterBifurcacaoDoItem(
  itemOrigemId: string | number,
  p: { operador?: string | null; timeoutMs?: number } = {},
): Promise<ResultadoBifurcacao> {
  const vazio: ResultadoBifurcacao = { remocoes: [], gravacoes: [], intactos: [], temPendencia: false }
  if (!bifurcacaoRmHabilitada()) return { ...vazio, nota: "desligado" }

  const grupos = await pecasDeBifurcacaoDoItem(itemOrigemId)
  if (!grupos.size) return { ...vazio, nota: "nada_vivo" }

  const remover: { id: string; motivo: "bifurcacao" }[] = []
  const criar: ReservaLancamentoRm[] = []
  for (const { pai, pecas } of grupos.values()) {
    const inicio = pecas.map((x) => iso(x.data_inicio)).sort()[0]!
    const fim = pecas.map((x) => iso(x.data_fim)).sort().at(-1)!
    for (const x of pecas) remover.push({ id: x.id, motivo: "bifurcacao" })
    criar.push({
      itemOrigemId,
      mondayBoardId: pai.monday_board_id,
      uuidConvocacao: pai.uuid_convocacao,
      chapa: pai.chapa,
      contrato: pai.contrato,
      dataInicio: inicio,
      dataFim: fim,
      dataConvocacao: pai.data_convocacao ? iso(pai.data_convocacao) : null,
      estadoConvocacao: pai.estado_convocacao,
      coligada: pai.coligada,
      origemAcao: "split_reverter",
      criadoPor: p.operador ?? null,
      origemLancamentoId: pecas[0]!.id,
    })
  }

  const plano = await planejarSubstituicaoRm({ remover, criar, removidoPor: p.operador ?? null })

  const remocoes: ResultadoRemocaoRm[] = []
  for (const l of plano.aRemover) {
    remocoes.push(
      await removerLancamentoRm(l, { motivo: "bifurcacao", removidoPor: p.operador ?? null, timeoutMs: p.timeoutMs }),
    )
  }
  if (remocoes.some((r) => r.estado === "erro" || r.estado === "indeterminado")) {
    return { remocoes, gravacoes: [], intactos: [], temPendencia: true }
  }

  const gravacoes: ResultadoGravacaoRm[] = []
  for (const r of plano.reservados) {
    const montada = montarConvocacaoRm({
      chapa: r.chapa,
      dataInicio: iso(r.data_inicio),
      dataFim: iso(r.data_fim),
      dataConvocacao: r.data_convocacao ? iso(r.data_convocacao) : undefined,
      coligada: r.coligada,
    })
    gravacoes.push(
      await executarGravacaoRm(r, montada, {
        contrato: r.contrato ?? "",
        itemOrigemId,
        coligada: r.coligada,
        timeoutMs: p.timeoutMs,
      }),
    )
  }

  return {
    remocoes,
    gravacoes,
    intactos: [],
    temPendencia: gravacoes.some(
      (g) => g.estado === "erro" || g.estado === "reserva_pendente" || g.indeterminado === true,
    ),
  }
}
