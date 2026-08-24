import type { PoolClient } from "pg"
import { pool, query } from "../db.js"
// Redação de segredo/PII vive em domain/sanitizar.ts desde que o log detalhado deixou
// de ser exclusivo do mensal. A versão de lá é RECURSIVA — a que morava aqui limpava
// só string de primeiro nível, e `referencias` tem pessoas aninhadas.
import { limparMetadados, limparTexto } from "../domain/sanitizar.js"
import type { EventoMensalInput, SnapshotPreviaMensal, StatusRunMensal } from "./types.js"

const STATUS_ATIVOS = ["aguardando_aprovacao", "fila", "rodando", "recuperando"] as const
const CHAVE_LOCK_GLOBAL = 74839211

export async function criarRunPrevia(
  snapshot: SnapshotPreviaMensal,
  operadorEmail: string,
  modo: "homologacao" | "producao",
): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SET LOCAL search_path TO pi, public")
    await client.query("SELECT pg_advisory_xact_lock($1)", [CHAVE_LOCK_GLOBAL])
    await client.query(
      `UPDATE mensal_run
          SET status='cancelado', etapa_atual='previa_expirada', cancelado_em=now(),
              motivo_cancelamento='Prévia expirada após 30 minutos sem aprovação', atualizado_em=now()
        WHERE status='aguardando_aprovacao'
          AND atualizado_em < now() - interval '30 minutes'`,
    )
    const ativo = await client.query<{ run_id: string }>(
      `SELECT run_id FROM mensal_run WHERE status = ANY($1::text[]) ORDER BY criado_em DESC LIMIT 1`,
      [STATUS_ATIVOS],
    )
    if (ativo.rows.length) throw new Error(`mensal_run_ativo:${ativo.rows[0]!.run_id}`)
    const runId = crypto.randomUUID()
    await client.query(
      `INSERT INTO mensal_run
        (run_id,papel,competencia,operador_email,status,total_contratos,modo,etapa_atual,snapshot,alertas)
       VALUES ($1,$2,$3,$4,'aguardando_aprovacao',$5,$6,'previa',$7::jsonb,$8::jsonb)`,
      [runId, snapshot.papel, snapshot.competencia, operadorEmail, snapshot.contratos.length, modo,
        JSON.stringify(snapshot), JSON.stringify(snapshot.alertas)],
    )
    for (const c of snapshot.contratos) {
      await client.query(
        `INSERT INTO mensal_run_item
          (run_id,ordem,contrato,qtd,status,etapa_atual,snapshot,motivo_bloqueio)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [runId, c.ordem, c.contrato, c.pessoas.length, c.bloqueado ? "bloqueado" : "pendente",
          c.bloqueado ? "duplicidade" : "pendente", JSON.stringify(c), c.motivoBloqueio],
      )
    }
    await client.query(
      `INSERT INTO mensal_run_event (run_id,etapa,estado,mensagem,metadados)
       VALUES ($1,'previa','concluido','Prévia calculada',$2::jsonb)`,
      [runId, JSON.stringify({ contratos: snapshot.contratos.length, alertas: snapshot.alertas.length })],
    )
    await client.query("COMMIT")
    return runId
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

async function travarRun(client: PoolClient, runId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHAVE_LOCK_GLOBAL])
  const { rows } = await client.query<{ run_id: string }>(
    `SELECT run_id FROM mensal_run WHERE status = ANY($1::text[]) AND run_id <> $2 LIMIT 1`,
    [STATUS_ATIVOS, runId],
  )
  if (rows.length) throw new Error(`mensal_run_ativo:${rows[0]!.run_id}`)
}

/**
 * Aprova o run e o coloca na fila.
 *
 * `vencimentos` (contrato -> "YYYY-MM-DD") é gravado DENTRO do snapshot, na mesma transação
 * da aprovação: a data de vencimento do lançamento financeiro é escolhida aqui, e precisa
 * ficar registrada junto do que foi aprovado — a execução lê do snapshot, então não há como
 * rodar com uma data diferente da que o operador confirmou.
 */
export async function aprovarRun(
  runId: string,
  operadorEmail: string,
  vencimentos?: Record<string, string>,
): Promise<SnapshotPreviaMensal> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SET LOCAL search_path TO pi, public")
    await travarRun(client, runId)
    const { rows } = await client.query<{ status: string; snapshot: SnapshotPreviaMensal }>(
      `SELECT status,snapshot FROM mensal_run WHERE run_id=$1 FOR UPDATE`, [runId],
    )
    const run = rows[0]
    if (!run) throw new Error("run_nao_encontrado")
    if (run.status !== "aguardando_aprovacao") throw new Error(`run_nao_aprovavel:${run.status}`)
    await client.query(
      `UPDATE mensal_run SET status='fila', etapa_atual='fila', aprovado_por=$2, aprovado_em=now(), atualizado_em=now()
       WHERE run_id=$1`, [runId, operadorEmail],
    )
    // Vencimentos vão pro snapshot na MESMA transação — o que executa é o que foi aprovado.
    let snapshot = run.snapshot
    if (vencimentos && Object.keys(vencimentos).length) {
      const { rows: atualizado } = await client.query<{ snapshot: SnapshotPreviaMensal }>(
        `UPDATE mensal_run
            SET snapshot = jsonb_set(snapshot, '{apoio,vencimentos}', $2::jsonb, true)
          WHERE run_id = $1
        RETURNING snapshot`,
        [runId, JSON.stringify(vencimentos)],
      )
      snapshot = atualizado[0]?.snapshot ?? run.snapshot
    }
    await client.query(
      `INSERT INTO mensal_run_event (run_id,etapa,estado,mensagem,metadados)
       VALUES ($1,'aprovacao','concluido','Run aprovado',$2::jsonb)`,
      [runId, JSON.stringify({ operador: operadorEmail, vencimentos: vencimentos ?? null })],
    )
    await client.query("COMMIT")
    return snapshot
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

export async function vincularWorkflowRun(runId: string, workflowRunId: string): Promise<void> {
  await query(
    `UPDATE mensal_run SET workflow_run_id=$2,status='rodando',etapa_atual='validacao',atualizado_em=now()
     WHERE run_id=$1`, [runId, workflowRunId],
  )
}

/**
 * Estados que o log genérico (/atividade) recebe do mensal.
 *
 * ESPELHO FILTRADO, não integral, por dois motivos independentes. (1) O log genérico é a
 * visão humana "o que aconteceu"; `mensal_run_event` continua o microscópio, com a
 * timeline e o anel de progresso próprios. (2) Espelhar tudo acrescentaria ~500 INSERTs
 * no caminho crítico de um workflow de DINHEIRO, dentro de steps com retry — o filtro é
 * segurança, não otimização.
 */
const ESTADOS_ESPELHADOS = new Set(["erro", "bloqueado", "pulado_idempotencia"])
/** Abre/fecha de contrato: dá o esqueleto da execução sem o detalhe de cada passo. */
const ETAPAS_ESPELHADAS = new Set(["contrato", "finalizado"])

/**
 * Cache da amarra run -> execução, pra não consultar a cada evento.
 *
 * ⚠️ Só o positivo é cacheado. Os eventos da PRÉVIA rodam antes da aprovação, quando
 * `execucao_id` ainda é nulo — cachear o nulo faria o run nunca espelhar, mesmo depois
 * de amarrado. O custo é uma consulta por evento enquanto não há amarra, e são poucos.
 */
const execucaoPorRun = new Map<string, string>()

async function execucaoDoRun(runId: string): Promise<string | null> {
  const cacheado = execucaoPorRun.get(runId)
  if (cacheado) return cacheado
  const { rows } = await query<{ execucao_id: string | null }>(
    `SELECT execucao_id FROM mensal_run WHERE run_id=$1`, [runId],
  )
  const id = rows[0]?.execucao_id ?? null
  if (id) execucaoPorRun.set(runId, id)
  return id
}

/** Traduz estado do workflow pro vocabulário do log genérico. */
function estadoParaAtividade(estado: string): "erro" | "aviso" | "ok" | "pulado" {
  if (estado === "erro") return "erro"
  if (estado === "bloqueado") return "aviso"
  if (estado === "pulado_idempotencia") return "pulado"
  return "ok"
}

export async function registrarEvento(e: EventoMensalInput): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO mensal_run_event (run_id,contrato,etapa,estado,tentativa,mensagem,metadados)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [e.runId, e.contrato ?? null, e.etapa, e.estado, e.tentativa ?? 1,
      limparTexto(e.mensagem), JSON.stringify(limparMetadados(e.metadados))],
  )
  await query(`UPDATE mensal_run SET etapa_atual=$2, atualizado_em=now() WHERE run_id=$1`, [e.runId, e.etapa])
  if (e.contrato) {
    await query(
      `UPDATE mensal_run_item SET etapa_atual=$3,tentativas=GREATEST(tentativas,$4),atualizado_em=now()
       WHERE run_id=$1 AND contrato=$2`, [e.runId, e.contrato, e.etapa, e.tentativa ?? 1],
    )
  }
  // Espelho no log genérico. Fora do caminho de retorno e engolindo a própria exceção:
  // esta função roda dentro de steps de dinheiro, e log nunca pode derrubá-los.
  if (ESTADOS_ESPELHADOS.has(e.estado) || ETAPAS_ESPELHADAS.has(e.etapa)) {
    try {
      const execucaoId = await execucaoDoRun(e.runId)
      if (execucaoId) {
        const { abrirExecucao } = await import("../services/execucao.js")
        const ex = await abrirExecucao({ id: execucaoId, acao: "", motor: "workflow" })
        await ex.etapa(e.etapa, estadoParaAtividade(e.estado), {
          tentativa: e.tentativa,
          // O contrato entra na mensagem porque a fase é a mesma em todos eles — sem
          // isso a timeline do log viraria uma lista de etapas sem dono.
          mensagem: [e.contrato, e.mensagem].filter(Boolean).join(" — ") || null,
          metadados: e.metadados,
        })
      }
    } catch (err) {
      console.warn("[mensal] espelho no log de atividade falhou:", (err as Error)?.message ?? err)
    }
  }
  return Number(rows[0]!.id)
}

export async function atualizarContrato(
  runId: string,
  contrato: string,
  status: string,
  erro?: string | null,
  referencias?: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE mensal_run_item SET status=$3,erro_msg=$4,
       referencias_externas=referencias_externas || $5::jsonb,
       iniciado_em=COALESCE(iniciado_em,now()),
       finalizado_em=CASE WHEN $3 IN ('ok','erro','bloqueado','cancelado') THEN now() ELSE NULL END,
       atualizado_em=now() WHERE run_id=$1 AND contrato=$2`,
    [runId, contrato, status, limparTexto(erro), JSON.stringify(limparMetadados(referencias))],
  )
  // Artefatos do mensal saem de graça: `referencias` já traz os ids dos pedidos Caju, os
  // IDFINANC do RM e o item da Solicitação. Mapear aqui evita tocar em qualquer etapa de
  // dinheiro no workflow.
  if (referencias) await gravarArtefatosDoContrato(runId, contrato, referencias)
}

/** Chave de `referencias` -> tipo de artefato. O que não estiver aqui é ignorado. */
const ARTEFATO_POR_REFERENCIA: Record<string, { tipo: string; rotulo: string }> = {
  pedidoCreditoVR: { tipo: "caju_pedido", rotulo: "Pedido de crédito VR" },
  pedidoCreditoVT: { tipo: "caju_pedido", rotulo: "Pedido de crédito VT" },
  pedidoPixVR: { tipo: "caju_boleto", rotulo: "Boleto PIX VR" },
  pedidoPixVT: { tipo: "caju_boleto", rotulo: "Boleto PIX VT" },
  idVR: { tipo: "rm_idfinanc", rotulo: "IDFINANC VR" },
  idVT: { tipo: "rm_idfinanc", rotulo: "IDFINANC VT" },
  // Uma linha por benefício no board desde o split de 08/2026. `solicitacaoId` (sem sufixo) fica
  // para os runs anteriores à mudança continuarem legíveis.
  solicitacaoId: { tipo: "solicitacao", rotulo: "Solicitação de Pagamento" },
  solicitacaoIdVR: { tipo: "solicitacao", rotulo: "Solicitação de Pagamento VR" },
  solicitacaoIdVT: { tipo: "solicitacao", rotulo: "Solicitação de Pagamento VT" },
}

async function gravarArtefatosDoContrato(
  runId: string,
  contrato: string,
  referencias: Record<string, unknown>,
): Promise<void> {
  try {
    const execucaoId = await execucaoDoRun(runId)
    if (!execucaoId) return
    const { abrirExecucao } = await import("../services/execucao.js")
    const ex = await abrirExecucao({ id: execucaoId, acao: "", motor: "workflow" })
    for (const [chave, meta] of Object.entries(ARTEFATO_POR_REFERENCIA)) {
      const valor = referencias[chave]
      if (!valor) continue
      // O contrato entra no rótulo porque um run tem vários, e sem isso a lista de
      // artefatos viraria quatro "Boleto PIX VR" sem dono.
      await ex.artefato({
        tipo: meta.tipo as Parameters<typeof ex.artefato>[0]["tipo"],
        chave: String(valor),
        rotulo: `${meta.rotulo} — ${contrato}`,
      })
    }
  } catch (e) {
    console.warn("[mensal] artefatos do contrato falharam:", (e as Error)?.message ?? e)
  }
}

export async function finalizarRun(runId: string): Promise<StatusRunMensal> {
  const { rows } = await query<{ ok: string; erro: string }>(
    `SELECT count(*) FILTER (WHERE status='ok') ok,
            count(*) FILTER (WHERE status='erro') erro
       FROM mensal_run_item WHERE run_id=$1`, [runId],
  )
  const ok = Number(rows[0]?.ok ?? 0)
  const erro = Number(rows[0]?.erro ?? 0)
  const status: StatusRunMensal = erro > 0 ? "concluido_com_erro" : "concluido"
  await query(
    `UPDATE mensal_run SET status=$2,etapa_atual='finalizado',ok_contratos=$3,erro_contratos=$4,
       finalizado_em=now(),atualizado_em=now() WHERE run_id=$1`, [runId, status, ok, erro],
  )
  await registrarEvento({ runId, etapa: "finalizado", estado: status, metadados: { ok, erro } })
  return status
}

export async function cancelarRun(
  runId: string,
  operadorEmail: string,
  motivo: string,
): Promise<"cancelado" | "cancelado_com_pendencia"> {
  const { rows } = await query<{ efeito_irreversivel: boolean }>(
    `SELECT efeito_irreversivel FROM mensal_run WHERE run_id=$1`, [runId],
  )
  if (!rows.length) throw new Error("run_nao_encontrado")
  const status = rows[0]!.efeito_irreversivel ? "cancelado_com_pendencia" : "cancelado"
  await query(
    `UPDATE mensal_run SET status=$2,cancelado_por=$3,cancelado_em=now(),motivo_cancelamento=$4,
       finalizado_em=now(),atualizado_em=now() WHERE run_id=$1`,
    [runId, status, operadorEmail, limparTexto(motivo)],
  )
  await registrarEvento({ runId, etapa: "cancelamento", estado: status, mensagem: motivo })
  return status
}

/** true se o run está em qualquer estado cancelado — checado pelo workflow entre contratos. */
export async function runFoiCancelado(runId: string): Promise<boolean> {
  const { rows } = await query<{ status: string }>(
    `SELECT status FROM mensal_run WHERE run_id=$1`, [runId],
  )
  return rows[0]?.status === "cancelado" || rows[0]?.status === "cancelado_com_pendencia"
}

export async function prepararRetomada(runId: string, operadorEmail: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SET LOCAL search_path TO pi, public")
    await travarRun(client, runId)
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM mensal_run WHERE run_id=$1 FOR UPDATE`, [runId],
    )
    if (!rows.length) throw new Error("run_nao_encontrado")
    if (!["falhou", "concluido_com_erro"].includes(rows[0]!.status)) throw new Error("run_nao_retomavel")
    await client.query(
      `UPDATE mensal_run SET status='recuperando',etapa_atual='retomada',tentativas=tentativas+1,
       aprovado_por=$2,atualizado_em=now(),finalizado_em=NULL WHERE run_id=$1`, [runId, operadorEmail],
    )
    await client.query(
      `UPDATE mensal_run_item SET status='pendente',erro_msg=NULL,finalizado_em=NULL,atualizado_em=now()
       WHERE run_id=$1 AND status='erro'`, [runId],
    )
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
  await registrarEvento({ runId, etapa: "retomada", estado: "solicitada", metadados: { operador: operadorEmail } })
}

export async function marcarEfeitoIrreversivel(runId: string): Promise<void> {
  await query(`UPDATE mensal_run SET efeito_irreversivel=true,atualizado_em=now() WHERE run_id=$1`, [runId])
}

export async function obterSnapshotRun(runId: string): Promise<{
  snapshot: SnapshotPreviaMensal
  modo: "homologacao" | "producao"
  status: string
  workflowRunId: string | null
}> {
  const { rows } = await query<{
    snapshot: SnapshotPreviaMensal
    modo: "homologacao" | "producao"
    status: string
    workflow_run_id: string | null
  }>(`SELECT snapshot,modo,status,workflow_run_id FROM mensal_run WHERE run_id=$1`, [runId])
  if (!rows[0]?.snapshot) throw new Error("run_nao_encontrado")
  return {
    snapshot: rows[0].snapshot,
    modo: rows[0].modo,
    status: rows[0].status,
    workflowRunId: rows[0].workflow_run_id,
  }
}

export async function limparHistoricoMensal(): Promise<number> {
  const { rows } = await query<{ removidos: string }>(
    `WITH apagados AS (
       DELETE FROM mensal_run WHERE criado_em < now() - interval '24 months' RETURNING 1
     ) SELECT count(*) removidos FROM apagados`,
  )
  await query(`DELETE FROM efeitos_externos WHERE criado_em < now() - interval '24 months'`)
  return Number(rows[0]?.removidos ?? 0)
}
