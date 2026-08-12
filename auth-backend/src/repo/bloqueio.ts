// Acesso a pi.competencia_bloqueio / bloqueio_board / board_alteracao / board_notificacao.
//
// Regra central: o monitor GRAVA TUDO que passa pelo board — todo item, todo evento,
// inclusive o que não vira mensagem. O WhatsApp é um recorte (crítica + fora do motor
// + fora do DP); o RELATÓRIO lê a tabela inteira. Foi assim que o caso DETRAN ficou
// invisível: era edição do DP, que não gera alerta mas precisa aparecer no relatório.
import { query } from "../db.js"
import type { AlteracaoClassificada } from "../domain/alteracaoBoard.js"
import { nomeLimpo } from "../domain/mensagemAlteracao.js"

export interface Bloqueio {
  id: string
  competencia: string
  status: "aberto" | "fechado"
  motivo: string | null
  aberto_por_email: string | null
  aberto_em: string
  fechado_por_email: string | null
  fechado_em: string | null
  modo_notificacao: "imediato" | "digest"
  digest_min: number
  teto_msgs_hora: number
  destino_whatsapp: string | null
}

export interface BoardVigiado {
  monday_board_id: string
  cursor_ate: string | null
  webhook_id: string | null
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------

export async function abrirBloqueio(p: {
  competencia: string
  boards: number[]
  usuarioId: string | null
  email: string | null
  motivo?: string | null
  destino?: string | null
  modo?: "imediato" | "digest"
  digestMin?: number
  tetoMsgsHora?: number
}): Promise<Bloqueio> {
  const { rows } = await query<Bloqueio>(
    `INSERT INTO competencia_bloqueio
       (competencia, aberto_por_user_id, aberto_por_email, motivo, destino_whatsapp,
        modo_notificacao, digest_min, teto_msgs_hora)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6,'imediato'), COALESCE($7,15), COALESCE($8,20))
     RETURNING *`,
    [p.competencia, p.usuarioId, p.email, p.motivo ?? null, p.destino ?? null,
     p.modo ?? null, p.digestMin ?? null, p.tetoMsgsHora ?? null],
  )
  const b = rows[0]!
  await vigiarBoards(b.id, p.boards)
  return b
}

/** Idempotente: chamada de novo (ex.: virada trocou o board) só acrescenta o que faltava. */
export async function vigiarBoards(bloqueioId: string, boards: number[]): Promise<void> {
  if (!boards.length) return
  await query(
    `INSERT INTO bloqueio_board (bloqueio_id, monday_board_id)
     SELECT $1, x FROM UNNEST($2::bigint[]) AS x
     ON CONFLICT (bloqueio_id, monday_board_id) DO NOTHING`,
    [bloqueioId, boards],
  )
}

export async function fecharBloqueio(id: string, usuarioId: string | null, email: string | null): Promise<Bloqueio | null> {
  const { rows } = await query<Bloqueio>(
    `UPDATE competencia_bloqueio
        SET status='fechado', fechado_em=now(), fechado_por_user_id=$2, fechado_por_email=$3,
            atualizado_em=now()
      WHERE id=$1 AND status='aberto'
      RETURNING *`,
    [id, usuarioId, email],
  )
  return rows[0] ?? null
}

export async function lerBloqueio(id: string): Promise<Bloqueio | null> {
  const { rows } = await query<Bloqueio>(`SELECT * FROM competencia_bloqueio WHERE id=$1`, [id])
  return rows[0] ?? null
}

export async function listarBloqueios(status?: string): Promise<Bloqueio[]> {
  const { rows } = await query<Bloqueio>(
    `SELECT * FROM competencia_bloqueio
      ${status ? "WHERE status = $1" : ""}
      ORDER BY aberto_em DESC LIMIT 50`,
    status ? [status] : [],
  )
  return rows
}

/** Janelas abertas — é o que o sweep varre a cada tick. */
export async function bloqueiosAbertos(): Promise<Bloqueio[]> {
  return listarBloqueios("aberto")
}

export async function boardsDoBloqueio(bloqueioId: string): Promise<BoardVigiado[]> {
  const { rows } = await query<BoardVigiado>(
    `SELECT monday_board_id, cursor_ate, webhook_id FROM bloqueio_board
      WHERE bloqueio_id=$1 ORDER BY monday_board_id`,
    [bloqueioId],
  )
  return rows
}

/** Janela ABERTA que vigia este board — usado pelo receptor de webhook. */
export async function bloqueioAbertoDoBoard(boardId: number): Promise<Bloqueio | null> {
  const { rows } = await query<Bloqueio>(
    `SELECT cb.* FROM competencia_bloqueio cb
       JOIN bloqueio_board bb ON bb.bloqueio_id = cb.id
      WHERE cb.status = 'aberto' AND bb.monday_board_id = $1
      ORDER BY cb.aberto_em DESC LIMIT 1`,
    [boardId],
  )
  return rows[0] ?? null
}

export async function avancarCursor(bloqueioId: string, boardId: number, ate: Date): Promise<void> {
  // GREATEST evita retroceder o cursor se dois ticks correrem fora de ordem.
  await query(
    `UPDATE bloqueio_board SET cursor_ate = GREATEST(COALESCE(cursor_ate, $3), $3)
      WHERE bloqueio_id=$1 AND monday_board_id=$2`,
    [bloqueioId, boardId, ate],
  )
}

// ---------------------------------------------------------------------------
// Alterações
// ---------------------------------------------------------------------------

/**
 * Grava em lote. `ON CONFLICT (activity_log_id) DO NOTHING` é o guardrail entre as
 * duas camadas de captura — o webhook e o sweep veem o mesmo evento e só um entra.
 * Devolve quantas linhas eram novas (as demais já estavam gravadas).
 */
export async function gravarAlteracoes(
  bloqueioId: string,
  alteracoes: AlteracaoClassificada[],
  captura: "webhook" | "sweep",
): Promise<AlteracaoClassificada[]> {
  if (!alteracoes.length) return []
  const { rows } = await query<{ activity_log_id: string }>(
    `INSERT INTO board_alteracao (
       bloqueio_id, activity_log_id, captura, monday_board_id, item_id, item_nome, grupo_id,
       evento, coluna_id, coluna_titulo, coluna_tipo, valor_anterior, valor_novo,
       autor_id, autor_nome, origem, operador_nome, operador_email, audit_id,
       severidade, ocorrido_em)
     SELECT $1, x.activity_log_id, $2, x.board_id, x.item_id, x.item_nome, x.grupo_id,
            x.evento, x.coluna_id, x.coluna_titulo, x.coluna_tipo,
            x.valor_anterior::jsonb, x.valor_novo::jsonb,
            x.autor_id, x.autor_nome, x.origem, x.operador_nome, x.operador_email,
            NULLIF(x.audit_id,'')::uuid, x.severidade, x.ocorrido_em
       FROM jsonb_to_recordset($3::jsonb) AS x(
         activity_log_id text, board_id bigint, item_id bigint, item_nome text, grupo_id text,
         evento text, coluna_id text, coluna_titulo text, coluna_tipo text,
         valor_anterior text, valor_novo text, autor_id text, autor_nome text,
         origem text, operador_nome text, operador_email text, audit_id text,
         severidade text, ocorrido_em timestamptz)
     ON CONFLICT (activity_log_id) DO NOTHING
     RETURNING activity_log_id`,
    [
      bloqueioId,
      captura,
      JSON.stringify(
        alteracoes.map((a) => ({
          activity_log_id: a.activityLogId,
          board_id: a.boardId,
          item_id: a.itemId,
          item_nome: a.itemNome,
          grupo_id: a.grupoId,
          evento: a.evento,
          coluna_id: a.colunaId,
          coluna_titulo: a.colunaTitulo,
          coluna_tipo: a.colunaTipo,
          valor_anterior: a.valorAnterior === null ? null : JSON.stringify(a.valorAnterior),
          valor_novo: a.valorNovo === null ? null : JSON.stringify(a.valorNovo),
          autor_id: a.autorId,
          autor_nome: a.autorNome,
          origem: a.origem,
          operador_nome: a.operadorNome,
          operador_email: a.operadorEmail,
          audit_id: a.auditId ?? "",
          severidade: a.severidade,
          ocorrido_em: a.ocorridoEm.toISOString(),
        })),
      ),
    ],
  )
  const novos = new Set(rows.map((r) => r.activity_log_id))
  return alteracoes.filter((a) => novos.has(a.activityLogId))
}

export interface FiltroAlteracoes {
  origem?: string
  severidade?: string
  itemId?: number
  limite?: number
  offset?: number
}

export async function alteracoesDoBloqueio(bloqueioId: string, f: FiltroAlteracoes = {}) {
  const cond: string[] = ["bloqueio_id = $1"]
  const params: unknown[] = [bloqueioId]
  if (f.origem) { params.push(f.origem); cond.push(`origem = $${params.length}`) }
  if (f.severidade) { params.push(f.severidade); cond.push(`severidade = $${params.length}`) }
  if (f.itemId) { params.push(f.itemId); cond.push(`item_id = $${params.length}`) }
  params.push(Math.min(f.limite ?? 200, 1000))
  params.push(f.offset ?? 0)
  const { rows } = await query(
    `SELECT * FROM board_alteracao WHERE ${cond.join(" AND ")}
      ORDER BY ocorrido_em DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------

/** Quantas mensagens saíram na última hora — insumo do fusível `teto_msgs_hora`. */
export async function notificacoesUltimaHora(bloqueioId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text n FROM board_notificacao
      WHERE bloqueio_id = $1 AND criado_em > now() - interval '1 hour'`,
    [bloqueioId],
  )
  return Number(rows[0]?.n ?? 0)
}

/**
 * Cria a notificação e AMARRA as alterações a ela na mesma transação.
 * Amarrar é o que tira a alteração da fila (`notificacao_id IS NULL` no índice
 * parcial) — se a mensagem falhar no envio, ela não volta a ser notificada, mas fica
 * com `erro` preenchido para reenvio deliberado.
 */
export async function criarNotificacao(p: {
  bloqueioId: string
  destino: string
  corpo: string
  activityLogIds: string[]
  colapsada?: boolean
}): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO board_notificacao (bloqueio_id, destino, corpo, qtd_alteracoes, colapsada)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [p.bloqueioId, p.destino, p.corpo, p.activityLogIds.length, p.colapsada ?? false],
  )
  const id = Number(rows[0]!.id)
  if (p.activityLogIds.length) {
    await query(
      `UPDATE board_alteracao SET notificacao_id = $1 WHERE activity_log_id = ANY($2)`,
      [id, p.activityLogIds],
    )
  }
  return id
}

export async function marcarEnviada(id: number, erro?: string | null): Promise<void> {
  await query(
    `UPDATE board_notificacao
        SET enviado_em = CASE WHEN $2::text IS NULL THEN now() ELSE enviado_em END,
            erro = $2, tentativas = tentativas + 1
      WHERE id = $1`,
    [id, erro ?? null],
  )
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

/**
 * Agregados da janela. Sai da tabela INTEIRA — inclusive `dp_direto` e `motor`,
 * que não geram alerta. É o retrato de tudo que mexeu no board no período.
 */
export async function relatorio(bloqueioId: string) {
  const um = async <T extends Record<string, unknown>>(sql: string) =>
    (await query<T>(sql, [bloqueioId])).rows

  const [totais] = await um<{ total: string; itens: string; com_mudanca: string; notificadas: string; primeira: string | null; ultima: string | null }>(
    `SELECT count(*)::text total,
            count(DISTINCT item_id)::text itens,
            count(*) FILTER (WHERE coluna_titulo IS NOT NULL OR evento <> 'update_column_value')::text com_mudanca,
            count(notificacao_id)::text notificadas,
            min(ocorrido_em)::text primeira, max(ocorrido_em)::text ultima
       FROM board_alteracao WHERE bloqueio_id = $1`,
  )
  return {
    totais,
    porOrigem: await um(`SELECT origem, count(*)::int n FROM board_alteracao WHERE bloqueio_id=$1 GROUP BY origem ORDER BY n DESC`),
    porSeveridade: await um(`SELECT severidade, count(*)::int n FROM board_alteracao WHERE bloqueio_id=$1 GROUP BY severidade ORDER BY n DESC`),
    // `operador_nome` vem do cadastro com sobrenome repetido ("THALLISON GOMES SOUZA
    // SOUZA"). A mensagem já limpava; o relatório mostrava cru. Limpeza é de EXIBIÇÃO —
    // o dado gravado continua fiel à origem.
    porAutor: (await um<{ quem: string; origem: string; n: number }>(
      `SELECT COALESCE(operador_nome, autor_nome, autor_id) AS quem, origem, count(*)::int n
         FROM board_alteracao WHERE bloqueio_id=$1
        GROUP BY 1,2 ORDER BY n DESC LIMIT 30`)
    ).map((r) => ({ ...r, quem: nomeLimpo(r.quem) ?? r.quem })),
    porColuna: await um(
      `SELECT COALESCE(coluna_titulo, evento) AS o_que, severidade, count(*)::int n
         FROM board_alteracao WHERE bloqueio_id=$1
        GROUP BY 1,2 ORDER BY n DESC LIMIT 40`),
    porItem: await um(
      `SELECT item_id::text, max(item_nome) item_nome, count(*)::int n,
              count(*) FILTER (WHERE severidade='critica')::int criticas,
              max(ocorrido_em)::text ultima
         FROM board_alteracao WHERE bloqueio_id=$1 AND item_id IS NOT NULL
        GROUP BY item_id ORDER BY criticas DESC, n DESC LIMIT 100`),
    porDia: await um(
      `SELECT to_char(ocorrido_em AT TIME ZONE 'America/Manaus','YYYY-MM-DD') dia,
              count(*)::int n, count(*) FILTER (WHERE severidade='critica')::int criticas
         FROM board_alteracao WHERE bloqueio_id=$1 GROUP BY 1 ORDER BY 1`),
    notificacoes: await um(
      `SELECT count(*)::int enviadas, coalesce(sum(qtd_alteracoes),0)::int alteracoes,
              count(*) FILTER (WHERE colapsada)::int colapsadas,
              count(*) FILTER (WHERE enviado_em IS NULL)::int pendentes,
              count(*) FILTER (WHERE erro IS NOT NULL)::int com_erro
         FROM board_notificacao WHERE bloqueio_id=$1`),
  }
}

// ---------------------------------------------------------------------------
// Config de colunas críticas
// ---------------------------------------------------------------------------

export async function colunasCriticas(boardId?: number): Promise<string[]> {
  const { rows } = await query<{ coluna_titulo: string }>(
    `SELECT coluna_titulo FROM bloqueio_coluna_critica
      WHERE ativo AND (monday_board_id IS NULL OR monday_board_id = $1)`,
    [boardId ?? null],
  )
  return rows.map((r) => r.coluna_titulo)
}

/** Boards do registry que cobrem a competência (o board vivo daquele mês). */
export async function boardsDaCompetencia(competencia: string): Promise<number[]> {
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards
      WHERE competencia = $1 AND ativo = true AND papel <> 'teste'
      ORDER BY atualizado_em DESC`,
    [competencia],
  )
  return rows.map((r) => Number(r.monday_board_id))
}
