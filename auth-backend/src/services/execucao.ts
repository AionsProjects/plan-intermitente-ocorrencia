// Instrumentação do log de execução: quem abre uma ação, registra as fases dela e
// diz o que ela gerou.
//
// O problema que isto existe pra resolver: `registrarAtividade` era chamado no
// `onSuccess` dos hooks do front, então ação que FALHA não deixava rastro nenhum.
// Aqui a execução é aberta ANTES de qualquer efeito e fechada com desfecho — o log
// passa a existir justamente quando dá errado, que é quando alguém precisa dele.
//
// REGRA CENTRAL: o log NUNCA derruba o fluxo de negócio. Toda função abaixo engole a
// própria exceção. Um sistema de log capaz de travar uma convocação é pior que log
// faltando.
import { query } from "../db.js"
import { limparMetadados, limparTexto } from "../domain/sanitizar.js"

export type MotorExecucao = "app" | "backend" | "n8n" | "workflow" | "job"
export type EstadoEtapa = "rodando" | "ok" | "erro" | "pulado" | "aviso"
export type EstadoFinal = "ok" | "erro" | "parcial"

/** Espelha o CHECK de pi.atividade_artefato — mudar aqui exige migration. */
export type TipoArtefato =
  | "monday_item" | "monday_subitem" | "monday_asset"
  | "caju_pedido" | "caju_boleto"
  | "rm_idfinanc" | "rm_convocacao" | "rm_historico" | "rm_ausencia"
  | "drive_pasta" | "drive_arquivo"
  | "protocolo" | "convocacao_uuid" | "desconto_item" | "solicitacao" | "job"

export interface OperadorExecucao {
  userId?: string | null
  email?: string | null
  nome?: string | null
}

export interface AberturaExecucao {
  /**
   * Reabre/ataca a MESMA execução em vez de criar outra. É a chave anti-duplicação:
   * o id é cunhado UMA vez (pelo servidor, no open) e todo outro repórter — rota,
   * workflow, job, WF do n8n — se anexa a ele.
   */
  id?: string | null
  acao: string
  motor: MotorExecucao
  operador?: OperadorExecucao
  /**
   * `uuid_alvo`. ⚠️ Semântica INTOCADA: acao='convocacao' guarda o item_id do
   * Monday; 'registro'/'cancelamento' guardam o UUID da convocação. É a chave de
   * join da cascata resolverItemDoPlano() do monitor de alteração de board
   * (cobertura medida 101/101). Identificador NOVO vai em artefato, nunca aqui.
   */
  alvo?: string | null
  pessoa?: string | null
  contrato?: string | null
  resumo?: unknown
  /** {run_id, job_id, workflow_run_id} — amarra a execução ao motor. */
  correlacao?: Record<string, string | null | undefined>
}

export interface DetalheEtapa {
  mensagem?: unknown
  metadados?: Record<string, unknown>
  tentativa?: number
  duracaoMs?: number
}

export interface Artefato {
  tipo: TipoArtefato
  chave: string
  rotulo?: string | null
  url?: string | null
  /** Chave em pi.efeitos_externos — deixa a UI distinguir "criado agora" de "pulado por idempotência". */
  efeitoChave?: string | null
  eventoId?: number | null
}

export interface Execucao {
  /** Vazio quando o cabeçalho não gravou (ver §handle nulo). */
  readonly id: string
  /** Devolve o id do evento, ou 0 quando não gravou. Nunca lança. */
  etapa(etapa: string, estado: EstadoEtapa, det?: DetalheEtapa): Promise<number>
  artefato(a: Artefato): Promise<void>
  fechar(estado: EstadoFinal, det?: { erro?: unknown; etapaErro?: string; resumo?: unknown }): Promise<void>
}

/**
 * Teto de eventos por execução. Laço de retry incrementa `eventos_truncados` em vez
 * de escrever um milhão de linhas no log de uma convocação.
 */
const TETO_EVENTOS = 200

function aviso(e: unknown, onde: string): void {
  console.warn(`[execucao] ${onde} falhou (log é secundário):`, (e as Error)?.message ?? e)
}

/**
 * Handle no-op. Devolvido quando o INSERT do cabeçalho falha.
 *
 * É Null Object e não `null` de propósito: devolver `null` forçaria `?.` em toda
 * chamada e um `!` esquecido viraria 500 numa rota de dinheiro. Aqui o pior caso é
 * perder log, que é exatamente o que já acontecia antes.
 */
const EXECUCAO_MUDA: Execucao = {
  id: "",
  etapa: async () => 0,
  artefato: async () => {},
  fechar: async () => {},
}

function textoDeErro(e: unknown): string | null {
  if (e == null) return null
  if (e instanceof Error) return limparTexto(e.message, 500)
  return limparTexto(e, 500)
}

class ExecucaoViva implements Execucao {
  #eventos = 0
  #fechada = false
  readonly #inicio = Date.now()

  constructor(readonly id: string) {}

  async etapa(etapa: string, estado: EstadoEtapa, det: DetalheEtapa = {}): Promise<number> {
    try {
      if (this.#eventos >= TETO_EVENTOS) {
        // Conta o excedente no cabeçalho em vez de gravar. Quem lê o log precisa
        // saber que houve mais coisa — sumir calado seria pior que truncar.
        await query(
          `UPDATE audit_lancamentos SET eventos_truncados = eventos_truncados + 1 WHERE id = $1`,
          [this.id],
        )
        return 0
      }
      // INSERT do evento e UPDATE de `etapa_atual` num só statement (CTE): são duas
      // escritas, mas UMA ida ao banco. Como cada fase de cada execução passa por
      // aqui, separá-las dobrava o número de round trips do workflow inteiro.
      // `etapa_atual` é o que a linha fechada mostra numa execução em andamento.
      const { rows } = await query<{ id: string }>(
        `WITH ev AS (
           INSERT INTO atividade_evento
             (execucao_id, etapa, estado, tentativa, duracao_ms, mensagem, metadados)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
         ), _up AS (
           UPDATE audit_lancamentos SET etapa_atual = $2 WHERE id = $1
         )
         SELECT id FROM ev`,
        [
          this.id, etapa, estado,
          det.tentativa ?? 1,
          det.duracaoMs ?? null,
          limparTexto(det.mensagem, 500),
          JSON.stringify(limparMetadados(det.metadados)),
        ],
      )
      this.#eventos++
      return Number(rows[0]?.id ?? 0)
    } catch (e) {
      aviso(e, `etapa(${etapa})`)
      return 0
    }
  }

  async artefato(a: Artefato): Promise<void> {
    try {
      // ON CONFLICT: retry de step não duplica artefato (unique execucao+tipo+chave).
      await query(
        `INSERT INTO atividade_artefato
           (execucao_id, evento_id, tipo, chave, rotulo, url, efeito_chave)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (execucao_id, tipo, chave) DO UPDATE
           SET rotulo = COALESCE(EXCLUDED.rotulo, atividade_artefato.rotulo),
               url    = COALESCE(EXCLUDED.url,    atividade_artefato.url)`,
        [
          this.id, a.eventoId ?? null, a.tipo, String(a.chave).slice(0, 200),
          a.rotulo ? limparTexto(a.rotulo, 120) : null,
          a.url ?? null, a.efeitoChave ?? null,
        ],
      )
    } catch (e) {
      aviso(e, `artefato(${a.tipo})`)
    }
  }

  async fechar(
    estado: EstadoFinal,
    det: { erro?: unknown; etapaErro?: string; resumo?: unknown } = {},
  ): Promise<void> {
    // Idempotente: comExecucao fecha no caminho normal, e um `fechar` manual antes
    // dele não pode ser sobrescrito por um 'ok' automático depois.
    if (this.#fechada) return
    this.#fechada = true
    try {
      await query(
        `UPDATE audit_lancamentos
            SET estado = $2, erro_etapa = $3, erro_msg = $4,
                finalizado_em = now(), duracao_ms = $5,
                payload_resumo = COALESCE($6::jsonb, payload_resumo)
          WHERE id = $1`,
        [
          this.id, estado,
          det.etapaErro ?? null,
          textoDeErro(det.erro),
          Date.now() - this.#inicio,
          det.resumo != null ? JSON.stringify(det.resumo) : null,
        ],
      )
    } catch (e) {
      aviso(e, "fechar")
    }
  }
}

/**
 * Abre (ou reataca) uma execução. Nunca lança; nunca devolve null.
 *
 * ⚠️ O INSERT vai pelo pool (autocommit), NUNCA enlistado numa transação de negócio:
 * se fosse, um rollback do negócio apagaria o registro da falha — justamente a
 * evidência que se quer guardar.
 *
 * ⚠️ `await`, não fire-and-forget: em função serverless o processo pode ser congelado
 * logo depois da resposta, e promise solta se perde. É um INSERT.
 */
export async function abrirExecucao(inp: AberturaExecucao): Promise<Execucao> {
  try {
    const correlacao = Object.fromEntries(
      Object.entries(inp.correlacao ?? {}).filter(([, v]) => v != null),
    )
    const { rows } = await query<{ id: string }>(
      `INSERT INTO audit_lancamentos
         (id, user_id, operador_email, operador_nome, acao, uuid_alvo, pessoa_nome,
          contrato, payload_resumo, estado, motor, correlacao)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),
               $2,$3,$4,$5,$6,$7,$8,$9,'aberta',$10,$11)
       ON CONFLICT (id) DO UPDATE
         SET motor = EXCLUDED.motor,
             correlacao = audit_lancamentos.correlacao || EXCLUDED.correlacao
       RETURNING id`,
      [
        inp.id || null,
        inp.operador?.userId ?? null,
        inp.operador?.email ?? null,
        inp.operador?.nome ?? null,
        inp.acao,
        inp.alvo ?? null,
        inp.pessoa ?? null,
        inp.contrato ?? null,
        inp.resumo != null ? JSON.stringify(inp.resumo) : null,
        inp.motor,
        JSON.stringify(correlacao),
      ],
    )
    const id = rows[0]?.id
    return id ? new ExecucaoViva(id) : EXECUCAO_MUDA
  } catch (e) {
    aviso(e, "abrirExecucao")
    return EXECUCAO_MUDA
  }
}

/**
 * Envolve o corpo de uma ação: fecha 'ok' no retorno e 'erro' no throw.
 *
 * ⚠️ RE-LANÇA o erro de negócio. O `catch → req.log.error + reply.code(502)` que já
 * existe em ~12 rotas continua idêntico; a instrumentação é aditiva.
 */
export async function comExecucao<T>(
  inp: AberturaExecucao,
  fn: (ex: Execucao) => Promise<T>,
): Promise<T> {
  const ex = await abrirExecucao(inp)
  try {
    const r = await fn(ex)
    await ex.fechar("ok")
    return r
  } catch (e) {
    await ex.fechar("erro", { erro: e })
    throw e
  }
}

/**
 * Envolve uma fase: grava o par rodando→ok|erro e mede a duração.
 *
 * Re-lança, pelo mesmo motivo de `comExecucao`. O `rodando` é gravado antes pra que
 * uma execução que morra no meio (timeout de função, processo congelado) deixe
 * visível ONDE parou.
 */
export async function comEtapa<T>(
  ex: Execucao,
  etapa: string,
  fn: () => Promise<T>,
  det: { tentativa?: number; metadados?: Record<string, unknown> } = {},
): Promise<T> {
  const t0 = Date.now()
  await ex.etapa(etapa, "rodando", { tentativa: det.tentativa })
  try {
    const r = await fn()
    await ex.etapa(etapa, "ok", { ...det, duracaoMs: Date.now() - t0 })
    return r
  } catch (e) {
    await ex.etapa(etapa, "erro", {
      ...det,
      duracaoMs: Date.now() - t0,
      mensagem: e instanceof Error ? e.message : e,
    })
    throw e
  }
}
