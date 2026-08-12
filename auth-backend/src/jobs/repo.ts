// Fila de jobs + idempotência de efeitos externos (pi.jobs / pi.efeitos_externos).
import { query } from "../db.js"

export interface Job {
  id: string
  tipo: string
  estado: string
  passo: number
  payload: Record<string, unknown>
  cursor: unknown
  tentativas: number
}

/** Enfileira um job. */
export async function enfileirar(
  tipo: string,
  payload: Record<string, unknown>,
  /**
   * `passo` inicial. Existe pro caller que JÁ tentou e ficou com desfecho mudo: nesse caso o job
   * tem que entrar direto no passo de conciliação, porque começar do zero seria reenviar — e
   * reenviar um efeito que "pode ter acontecido" é exatamente como se duplica.
   */
  opts: { passo?: number } = {},
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO jobs (tipo, payload, passo) VALUES ($1, $2::jsonb, $3) RETURNING id`,
    [tipo, JSON.stringify(payload), opts.passo ?? 0],
  )
  return rows[0]!.id
}

/**
 * Pega até N jobs prontos (due) e marca como rodando (claim atômico via UPDATE...RETURNING).
 *
 * `tipo` filtra o despacho: jobs lentos (os que falam com o RM) rodam num tick próprio, senão um
 * deles sozinho consome a janela inteira e segura os rápidos atrás na fila.
 */
export async function pegarDevidos(limite = 5, tipo?: string): Promise<Job[]> {
  const { rows } = await query<Job>(
    `UPDATE jobs SET estado='rodando', atualizado_em=now()
       WHERE id IN (
         SELECT id FROM jobs
          WHERE estado IN ('pendente','aguardando_externo') AND proximo_em <= now()
            AND ($2::text IS NULL OR tipo = $2)
          ORDER BY proximo_em ASC LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
     RETURNING id, tipo, estado, passo, payload, cursor, tentativas`,
    [limite, tipo ?? null],
  )
  return rows
}

/**
 * Devolve à fila os jobs que ficaram presos em `rodando` — processo morto no meio, timeout da
 * função, deploy no meio do tick. `pegarDevidos` só enxerga `pendente`/`aguardando_externo`,
 * então sem isto o job fica invisível e nunca mais roda.
 *
 * `tentativas+1` é obrigatório: sem contar a tentativa, um job que sempre estoura o tempo é
 * retomado para sempre, num laço que ninguém vê.
 */
export async function retomarPresos(minutos = 10): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `UPDATE jobs
        SET estado = CASE WHEN tentativas+1 >= 5 THEN 'falhou' ELSE 'pendente' END,
            tentativas = tentativas+1,
            erro = 'retomado: preso em rodando',
            atualizado_em = now()
      WHERE estado='rodando' AND atualizado_em < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(minutos)],
  )
  return rows.length
}

export async function avancar(
  id: string,
  patch: { estado?: string; passo?: number; cursor?: unknown; proximoEmSeg?: number; erro?: string | null },
): Promise<void> {
  const sets: string[] = ["atualizado_em=now()"]
  const params: unknown[] = [id]
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col}=$${params.length}`) }
  if (patch.estado) add("estado", patch.estado)
  if (patch.passo != null) add("passo", patch.passo)
  if ("cursor" in patch) { params.push(JSON.stringify(patch.cursor)); sets.push(`cursor=$${params.length}::jsonb`) }
  if (patch.proximoEmSeg != null) { params.push(patch.proximoEmSeg); sets.push(`proximo_em=now() + ($${params.length} || ' seconds')::interval`) }
  if ("erro" in patch) add("erro", patch.erro ?? null)
  await query(`UPDATE jobs SET ${sets.join(", ")} WHERE id=$1`, params)
}

/**
 * Marca a falha de um job e, quando ele MORRE (esgotou as 5 tentativas), avisa.
 *
 * Antes disto um job morto era 100% silencioso: ficava `estado='falhou'` em pi.jobs e
 * ninguém sabia. E job é a rede de retry da convocação no RM — o caminho literal do
 * "o funcionário não recebeu o benefício".
 *
 * O alerta sai só no esgotamento porque o desenho de 5 tentativas com backoff de 30s
 * existe justamente porque blip da ponte AIONS se autocura; avisar na 1ª faria o grupo
 * virar ruído.
 */
export async function falhar(id: string, erro: string): Promise<void> {
  const { rows } = await query<{
    tipo: string; estado: string; tentativas: number; execucao_id: string | null
  }>(
    `UPDATE jobs SET tentativas=tentativas+1,
        estado = CASE WHEN tentativas+1 >= 5 THEN 'falhou' ELSE 'pendente' END,
        proximo_em = now() + ((tentativas+1)*30 || ' seconds')::interval,
        erro=$2, atualizado_em=now()
      WHERE id=$1
      RETURNING tipo, estado, tentativas, execucao_id`,
    [id, erro.slice(0, 500)],
  )
  const job = rows[0]
  if (!job || job.estado !== "falhou") return
  // Import dinâmico: jobs/repo.ts é importado por todo handler, e alertaFalha puxa
  // config + cliente HTTP. Carregar só no caminho de morte evita ciclo de import.
  try {
    const { alertarFalha } = await import("../services/alertaFalha.js")
    // Contexto da execução amarrada: sem isto a mensagem diz "falhou a fila" e não DE
    // QUEM — que é a primeira coisa que o DP precisa saber pra agir. É uma query num
    // caminho que só roda quando um job morre.
    let ctx: { acao: string; pessoa: string | null; contrato: string | null } | null = null
    if (job.execucao_id) {
      const { rows: ex } = await query<{ acao: string; pessoa_nome: string | null; contrato: string | null }>(
        `SELECT acao, pessoa_nome, contrato FROM audit_lancamentos WHERE id = $1`,
        [job.execucao_id],
      )
      if (ex[0]) ctx = { acao: ex[0].acao, pessoa: ex[0].pessoa_nome, contrato: ex[0].contrato }
    }
    await alertarFalha({
      execucaoId: job.execucao_id,
      origem: "job",
      acao: ctx?.acao ?? job.tipo,
      // O tipo do job É a fase, do ponto de vista de quem lê ("convocacao_rm_pontual").
      etapa: job.tipo,
      erro,
      pessoa: ctx?.pessoa ?? null,
      contrato: ctx?.contrato ?? null,
      tentativa: job.tentativas,
      maxTentativas: 5,
      // Job é sempre trabalho de negócio — não passa pelo filtro de relevância, que
      // existe pra descartar leitura que deu 502.
      sempre: true,
    })
  } catch (e) {
    console.warn("[jobs] alerta de job morto falhou:", (e as Error)?.message ?? e)
  }
}

// ---- Idempotência de efeitos externos ----

/**
 * Estado de uma chave de efeito SEM reservar — pra prévia poder mostrar "já feito" sem criar
 * linha. Reservar numa prévia envenenaria a chave: a execução real veria 'pendente' e travaria.
 */
export async function estadoEfeito(chave: string): Promise<"ausente" | "confirmado" | "pendente"> {
  const { rows } = await query<{ status: string }>(
    `SELECT status FROM efeitos_externos WHERE chave=$1`,
    [chave],
  )
  if (!rows.length) return "ausente"
  return rows[0]!.status === "confirmado" ? "confirmado" : "pendente"
}

/**
 * Como `estadoEfeito`, mas devolve `ref_externa` e `payload` junto.
 *
 * Existe porque quando uma execução recebe "já confirmado", o identificador do que foi gravado
 * lá fora (ex.: o `C03S######` da convocação) só sobrevive no ledger — sem lê-lo não há como
 * ecoar o resultado de volta pro board, e o operador fica sem o número.
 */
export async function detalheEfeito(chave: string): Promise<{
  status: "confirmado" | "pendente"
  refExterna: string | null
  payload: Record<string, unknown> | null
} | null> {
  const { rows } = await query<{
    status: string
    ref_externa: string | null
    payload: Record<string, unknown> | null
  }>(`SELECT status, ref_externa, payload FROM efeitos_externos WHERE chave=$1`, [chave])
  const r = rows[0]
  if (!r) return null
  return {
    status: r.status === "confirmado" ? "confirmado" : "pendente",
    refExterna: r.ref_externa,
    payload: r.payload,
  }
}

/**
 * Devolve a chave reservada quando ficou PROVADO que o efeito não aconteceu.
 *
 * Sem isso, um erro determinístico do serviço externo (o RM respondendo Fault, com rollback)
 * deixa a chave `pendente` PARA SEMPRE: toda execução seguinte lê "em curso", se recusa a
 * reenviar — corretamente, porque não sabe distinguir — e aquela pessoa nunca mais entra.
 * Falha silenciosa e permanente, disfarçada de proteção.
 *
 * `status <> 'confirmado'` é a trava que torna isto seguro: efeito confirmado nunca é liberado,
 * em nenhuma circunstância.
 */
export async function liberarEfeito(chave: string): Promise<boolean> {
  const { rows } = await query<{ chave: string }>(
    `DELETE FROM efeitos_externos WHERE chave=$1 AND status <> 'confirmado' RETURNING chave`,
    [chave],
  )
  return rows.length > 0
}

/**
 * Reserva uma chave de efeito externo. Retorna 'novo' (pode executar), 'confirmado'
 * (já feito — PULAR) ou 'pendente' (em curso/falhou antes — decidir retry).
 */
export async function reservarEfeito(
  chave: string,
  tipo: string,
  payload?: unknown,
): Promise<"novo" | "confirmado" | "pendente"> {
  const ins = await query<{ chave: string }>(
    `INSERT INTO efeitos_externos (chave, tipo, payload) VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (chave) DO NOTHING RETURNING chave`,
    [chave, tipo, payload != null ? JSON.stringify(payload) : null],
  )
  if (ins.rows.length) return "novo"
  const { rows } = await query<{ status: string }>(`SELECT status FROM efeitos_externos WHERE chave=$1`, [chave])
  return rows[0]?.status === "confirmado" ? "confirmado" : "pendente"
}

/**
 * Contratos com efeito JÁ CONFIRMADO numa competência do mensal — fonte de verdade NOSSA
 * (não depende do estado do Monday). Chave: `mensal:<competencia>:<CONTRATO>:<etapa>`.
 * Usado pela antifraude da prévia pra saber o que já rodou quando o pagamento é por contrato.
 *
 * A lista de etapas é chumbada, então ela CEGA a antifraude toda vez que uma etapa de dinheiro é
 * renomeada. `caju_credito`/`caju_pix` são os nomes de antes do split VR/VT (08/2026) e ficam para
 * que competências anteriores continuem casando; os quatro `caju_*_v[rt]` são os de hoje. Ao criar
 * etapa nova que grave dinheiro, acrescentar aqui — nunca substituir.
 */
export async function contratosMensalJaExecutados(competencia: string): Promise<string[]> {
  const { rows } = await query<{ contrato: string }>(
    `SELECT DISTINCT split_part(chave, ':', 3) AS contrato
       FROM efeitos_externos
      WHERE chave LIKE $1 AND status = 'confirmado'
        AND split_part(chave, ':', 4) IN (
              'monday_solicitacao','rm_integrar',
              'caju_credito','caju_pix',
              'caju_credito_vr','caju_credito_vt','caju_pix_vr','caju_pix_vt'
            )
        -- Simulação hoje grava em namespace próprio (mensal-homologacao:runId:...), então
        -- nem chega aqui. O filtro fica para as linhas LEGADAS de antes de 01/08, quando a
        -- simulação confirmava a chave de produção — foi o que fez o run e173b1ef pular tudo.
        AND coalesce(ref_externa, '') NOT LIKE 'homologacao:%'`,
    [`mensal:${competencia}:%`],
  )
  return rows.map((r) => r.contrato).filter(Boolean)
}

/**
 * Confirma o efeito. `detalhe` é MESCLADO no payload jsonb — é onde vivem as PKs do que
 * foi gravado lá fora (ex.: os IDs de cada SaveRecord do histórico RM).
 *
 * Sem isso não há caminho de volta: em 01/08 o run cce6e4df gravou 225 registros no RM e o
 * ledger só tinha a CONTAGEM do lote (`rm:hist:pix:l0:50`), então desfazer exigiu redescobrir
 * tudo por ReadView + janela de RECCREATEDON. `ref_externa` continua sendo o resumo curto
 * legível; o detalhe grande vai no payload.
 */
export async function confirmarEfeito(chave: string, refExterna?: string, detalhe?: unknown): Promise<void> {
  await query(
    `UPDATE efeitos_externos
        SET status='confirmado',
            ref_externa=$2,
            confirmado_em=now(),
            payload = CASE WHEN $3::jsonb IS NULL THEN payload
                           ELSE coalesce(payload, '{}'::jsonb) || $3::jsonb END
      WHERE chave=$1`,
    [chave, refExterna ?? null, detalhe != null ? JSON.stringify(detalhe) : null],
  )
}
