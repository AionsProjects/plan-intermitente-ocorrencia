// Job da SUBSTITUIÇÃO no RM (bifurcação). Rede do que ficou pendente no request do split.
//
// ASSIMÉTRICO AO JOB DE REMOÇÃO, e a diferença é a razão de este arquivo existir. Lá, retry direto
// é seguro: apagar o que já não está lá é inofensivo, e a releitura de `removerLancamentoRm` já
// serve de conciliação. Aqui metade da operação é CRIAR — reenviar às cegas emite um segundo
// S-2260 pelo mesmo período.
//
// Por isso o retry aqui é sempre RELEITURA PRIMEIRO:
//   * o rastro diz o que já foi criado (`no_rm` com código) e o que ficou `reservado`;
//   * `bifurcarConvocacoesDoItem` só parte quem CRUZA o corte, e as peças já criadas não cruzam
//     mais — então re-executar não re-parte nada;
//   * peça que ficou `reservado` (SaveRecord mudo) NÃO é regravada por este job: pode ter gravado.
//     Ela vira pendência explícita pra conciliação por leitura, igual o passo 1 do pontual.
import { config } from "../config.js"
import { lancamentosDoItem } from "../repo/convocacoesRm.js"
import {
  bifurcacaoRmHabilitada,
  bifurcarConvocacoesDoItem,
  reverterBifurcacaoDoItem,
} from "../services/convocacaoBifurcar.js"
import { TIMEOUT_REMOCAO_MS } from "../services/convocacaoRemover.js"
import { avancar, type Job } from "./repo.js"

export const TIPO_JOB_CONVOCACAO_RM_SUBSTITUIR = "convocacao_rm_substituir"

export interface PayloadSubstituicaoRm {
  item_id: string
  tipo: "aplicar" | "reverter"
  corte?: string | null
  contrato_parte1?: string | null
  contrato_parte2?: string | null
  board_id?: string | null
  operador?: string | null
}

export interface DepsSubstituicaoRm {
  listar: typeof lancamentosDoItem
  bifurcar: typeof bifurcarConvocacoesDoItem
  reverter: typeof reverterBifurcacaoDoItem
  habilitado: () => boolean
}

const DEPS_PADRAO: DepsSubstituicaoRm = {
  listar: lancamentosDoItem,
  bifurcar: bifurcarConvocacoesDoItem,
  reverter: reverterBifurcacaoDoItem,
  habilitado: () => config.convocacaoRmHabilitada && bifurcacaoRmHabilitada(),
}

/** `throw` = retryável (o tick conta tentativa e reagenda). `avancar` = terminal. */
export async function handlerConvocacaoRmSubstituir(
  job: Job,
  deps: DepsSubstituicaoRm = DEPS_PADRAO,
): Promise<void> {
  const p = job.payload as unknown as PayloadSubstituicaoRm

  if (!deps.habilitado()) {
    await avancar(job.id, { estado: "concluido", cursor: { nota: "desligado" } })
    return
  }

  // 1) RELEITURA. Peça `reservado` = SaveRecord mudo: PODE ter gravado no RM. Regravar seria
  // duplicar o S-2260, então o job PARA e pede conferência humana em vez de insistir.
  const vivos = await deps.listar(p.item_id, { apenasVivos: true })
  const mudas = vivos.filter((l) => l.estado === "reservado")
  if (mudas.length) {
    await avancar(job.id, {
      estado: "aguardando_externo",
      cursor: {
        nota: "conciliar_leitura",
        reservados: mudas.map((l) => ({ id: l.id, periodo: [l.data_inicio, l.data_fim] })),
        instrucao: "ler o RM (rm:readview) e confirmar ou liberar cada reserva antes de repetir",
      },
    })
    return
  }

  // 2) Re-executa. É seguro porque a operação é idempotente por construção: peça já criada não
  // cruza mais o corte, então `bifurcarConvocacoesDoItem` a deixa intacta.
  const r =
    p.tipo === "reverter"
      ? await deps.reverter(p.item_id, { operador: p.operador ?? null, timeoutMs: TIMEOUT_REMOCAO_MS })
      : await deps.bifurcar(p.item_id, {
          corte: String(p.corte ?? ""),
          contratoParte1: String(p.contrato_parte1 ?? ""),
          contratoParte2: String(p.contrato_parte2 ?? ""),
          operador: p.operador ?? null,
          timeoutMs: TIMEOUT_REMOCAO_MS,
        })

  if (r.temPendencia) {
    const detalhe = [...r.remocoes, ...r.gravacoes]
      .filter((x) => x.erro)
      .map((x) => `${x.lancamentoId ?? "?"}: ${x.erro}`)
      .join(", ")
    throw new Error(`convocacao_rm_substituir: pendente — ${detalhe || "sem detalhe"}`)
  }

  await avancar(job.id, {
    estado: "concluido",
    cursor: {
      nota: r.nota ?? null,
      removidos: r.remocoes.length,
      criados: r.gravacoes.filter((g) => g.estado === "gravado").length,
      intactos: r.intactos.length,
    },
  })
}
