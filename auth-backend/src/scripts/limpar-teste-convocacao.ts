/**
 * Apaga TODO o rastro de uma convocação de teste. **DESTRUTIVO.**
 *
 *   npm run limpar:teste -- <item_id_monday> --confirmar
 *   npm run limpar:teste -- <item_id_monday>              # dry-run: só lista o que apagaria
 *
 * Existe porque testar o pré-pagamento de ponta a ponta exige criar convocação no board OFICIAL
 * (decisão do Isaac, 12/08) — e uma convocação de teste que sobra não é lixo inofensivo: ela entra
 * no fechamento mensal, prende dívida reservada no FIFO, deixa S-2260 vivo no eSocial e conta como
 * conflito na antifraude da próxima convocação real da mesma pessoa.
 *
 * Ordem: do efeito mais caro de reverter pro mais barato. Se o RM falhar, para antes de apagar o
 * item do Monday — sem o item ninguém descobre qual `C03S######` ficou órfão.
 *
 * O que NÃO é apagado, de propósito:
 * - `pi.audit_lancamentos` + eventos: o log de execução é o registro de que o teste aconteceu.
 *   Some com ele e a auditoria fica com uma criação de item sem explicação. Fica marcado.
 * - registros de RM já removidos antes (`removido_em` preenchido): histórico de saída é o que
 *   prova que a remoção aconteceu.
 */
import { pool, query } from "../db.js"
import { mondayGraphql } from "../monday.js"
import { pastaParaLixeira } from "../clients/drive.js"
import { removerConvocacoesDoItem } from "../services/convocacaoRemover.js"

const CONFIRMAR = process.argv.includes("--confirmar")

interface Achados {
  itemId: string
  prepagamentos: Array<{ id: string; estado: string; pasta: string | null; nome: string | null }>
  reservas: number
  rmVivos: Array<{ codigo: string | null; pk: string | null }>
  convocacoes: number
  itensPlano: number
  efeitos: string[]
  alteracoes: number
  jobs: string[]
  execucoes: Array<{ id: string; acao: string; estado: string | null }>
}

async function levantar(itemId: string): Promise<Achados> {
  const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[]): Promise<T[]> =>
    (await query<T>(sql, p)).rows

  const [prepag, res, rm, cv, plano, ef, alt, jb, ex] = await Promise.all([
    um<{ id: string; estado: string; pasta: string | null; nome: string | null }>(
      `SELECT id, estado, pasta_convocacao_drive_id pasta, pasta_convocacao_nome nome
         FROM pontual_prepagamento WHERE item_origem_id = $1 ORDER BY criado_em`,
      [itemId],
    ),
    um<{ n: number }>(
      `SELECT count(*)::int n FROM pontual_reserva_desconto r
         JOIN pontual_prepagamento p ON p.id = r.prepagamento_id
        WHERE p.item_origem_id = $1`,
      [itemId],
    ),
    um<{ codigo: string | null; pk: string | null }>(
      `SELECT codigo, pk_rm pk FROM convocacoes_rm
        WHERE item_origem_id = $1 AND removido_em IS NULL`,
      [itemId],
    ),
    um<{ n: number }>(`SELECT count(*)::int n FROM convocacoes WHERE item_origem_id = $1`, [itemId]),
    um<{ n: number }>(
      `SELECT count(*)::int n FROM convocacao_item_plano WHERE item_plano_id = $1`,
      [itemId],
    ),
    // Efeitos externos chegam por três caminhos, e os três precisam entrar:
    //  - `ref_externa = item` — a própria criação do item (`confirmarEfeito(chave, item.id)`);
    //  - chave contendo o item — variantes que carimbam o id na chave;
    //  - chave contendo o id do lançamento RM — `convocacao_rm:<lancamentoId>` e as chaves de
    //    remoção/edição. Estas NÃO citam o item em lugar nenhum, e era o furo: sobrava efeito
    //    confirmado apontando pra uma PK do RM que não existe mais, e a próxima tentativa de
    //    gravar aquele lançamento seria recusada como "já feito".
    um<{ chave: string }>(
      `SELECT e.chave FROM efeitos_externos e
        WHERE e.ref_externa = $1
           OR e.chave LIKE '%' || $1 || '%'
           OR EXISTS (
                SELECT 1 FROM convocacoes_rm r
                 WHERE r.item_origem_id::text = $1
                   AND (e.chave LIKE '%' || r.id || '%'
                        OR (r.pk_rm IS NOT NULL AND e.ref_externa = r.pk_rm))
              )`,
      [itemId],
    ),
    um<{ n: number }>(`SELECT count(*)::int n FROM board_alteracao WHERE item_id = $1`, [itemId]),
    um<{ id: string }>(`SELECT id FROM jobs WHERE payload::text LIKE '%' || $1 || '%'`, [itemId]),
    um<{ id: string; acao: string; estado: string | null }>(
      `SELECT id, acao, estado FROM audit_lancamentos WHERE uuid_alvo = $1 ORDER BY criado_em`,
      [itemId],
    ),
  ])

  return {
    itemId,
    prepagamentos: prepag,
    reservas: res[0]?.n ?? 0,
    rmVivos: rm,
    convocacoes: cv[0]?.n ?? 0,
    itensPlano: plano[0]?.n ?? 0,
    efeitos: ef.map((e) => e.chave),
    alteracoes: alt[0]?.n ?? 0,
    jobs: jb.map((j) => j.id),
    execucoes: ex,
  }
}

function relatar(a: Achados): void {
  console.log(`\n=== rastro do item ${a.itemId} ===`)
  console.log(`RM (convocações vivas) : ${a.rmVivos.length}${a.rmVivos.length ? " -> " + a.rmVivos.map((r) => r.codigo ?? r.pk).join(", ") : ""}`)
  console.log(`pré-pagamento          : ${a.prepagamentos.length}${a.prepagamentos.length ? " -> " + a.prepagamentos.map((p) => `${p.estado}${p.pasta ? " pasta:" + p.pasta : ""}`).join(" | ") : ""}`)
  console.log(`reservas de desconto   : ${a.reservas}`)
  console.log(`espelho convocações    : ${a.convocacoes}`)
  console.log(`itens de plano         : ${a.itensPlano}`)
  console.log(`efeitos externos       : ${a.efeitos.length}${a.efeitos.length ? " -> " + a.efeitos.join(", ") : ""}`)
  console.log(`alterações de board    : ${a.alteracoes}`)
  console.log(`jobs                   : ${a.jobs.length}`)
  console.log(`execuções (mantidas)   : ${a.execucoes.length}${a.execucoes.length ? " -> " + a.execucoes.map((e) => `${e.acao}/${e.estado ?? "?"}`).join(", ") : ""}`)
}

async function main(): Promise<void> {
  const itemId = process.argv[2]
  if (!itemId || !/^\d+$/.test(itemId)) {
    console.error("uso: npm run limpar:teste -- <item_id_monday> [--confirmar]")
    process.exit(1)
  }

  const achados = await levantar(itemId)
  relatar(achados)

  if (!CONFIRMAR) {
    console.log("\n(dry-run — nada foi apagado. Repita com --confirmar.)")
    return
  }

  // 1) RM primeiro: é o único efeito que some do nosso alcance quando o item do Monday morre.
  if (achados.rmVivos.length) {
    console.log("\n--- RM: removendo convocações vivas ---")
    const r = await removerConvocacoesDoItem(itemId, {
      motivo: "correcao_manual",
      removidoPor: "script:limpar-teste-convocacao",
    })
    for (const rem of r.removidos) {
      console.log(`  ${rem.estado.padEnd(14)} ${rem.codConvocacao ?? rem.pk ?? rem.lancamentoId}${rem.erro ? " — " + rem.erro : ""}`)
    }
    if (r.temPendencia) {
      console.error(
        "\n❌ Um lançamento não saiu do RM. PARANDO aqui — apagar o item do Monday agora deixaria o S-2260 órfão.\n" +
          "   Resolva na tela do RM (ou npm run rm:delete) e rode este script de novo.",
      )
      process.exitCode = 1
      return
    }
  }

  // 2) Drive: pasta pra lixeira (recuperável 30 dias).
  for (const p of achados.prepagamentos) {
    if (!p.pasta) continue
    const ok = await pastaParaLixeira(p.pasta)
    console.log(`\nDrive: pasta ${p.nome ?? p.pasta} -> ${ok ? "lixeira ✅" : "FALHOU (apague à mão) ⚠️"}`)
  }

  // 3) Monday: apaga o item (vai pra lixeira do board, recuperável).
  try {
    await mondayGraphql<{ delete_item: { id: string } | null }>(
      `mutation Apagar($id: ID!) { delete_item(item_id: $id) { id } }`,
      { id: itemId },
    )
    console.log(`\nMonday: item ${itemId} apagado ✅`)
  } catch (e) {
    console.error(`\nMonday: falhou apagar o item — ${(e as Error).message}`)
    console.error("   Apague à mão no board. O Postgres SEGUE sendo limpo (item vivo sem rastro é")
    console.error("   melhor que rastro sem item: a antifraude do Monday continua enxergando ele).")
  }

  // 4) Postgres, numa transação. A reserva sai via CASCADE do prepagamento.
  const c = await pool.connect()
  let apagados: Record<string, number>
  try {
    await c.query("BEGIN")
    const del = async (sql: string): Promise<number> =>
      (await c.query(sql, [itemId])).rowCount ?? 0
    apagados = {
      prepagamento: await del(`DELETE FROM pontual_prepagamento WHERE item_origem_id = $1`),
      convocacoes: await del(`DELETE FROM convocacoes WHERE item_origem_id = $1`),
      // ANTES de `convocacoes_rm`: a cláusula que acha os efeitos do RM depende dessas linhas
      // pra saber os ids de lançamento. Invertido, os efeitos do RM sobreviveriam calados.
      efeitos: await del(
        `DELETE FROM efeitos_externos e
          WHERE e.ref_externa = $1
             OR e.chave LIKE '%' || $1 || '%'
             OR EXISTS (
                  -- ::text obrigatório: na MESMA query o $1 também entra num LIKE, o que fixa
                  -- o parâmetro como text — e aí a comparação com a coluna bigint deixa de
                  -- existir pro planner (operator does not exist: bigint = text).
                  SELECT 1 FROM convocacoes_rm r
                   WHERE r.item_origem_id::text = $1
                     AND (e.chave LIKE '%' || r.id::text || '%'
                          OR (r.pk_rm IS NOT NULL AND e.ref_externa = r.pk_rm))
                )`,
      ),
      convocacoesRm: await del(`DELETE FROM convocacoes_rm WHERE item_origem_id = $1`),
      itensPlano: await del(`DELETE FROM convocacao_item_plano WHERE item_plano_id = $1`),
      // Alterações de board: sem isto o monitor manda WhatsApp sobre um item que não existe mais.
      alteracoes: await del(`DELETE FROM board_alteracao WHERE item_id = $1`),
      jobs: await del(`DELETE FROM jobs WHERE payload::text LIKE '%' || $1 || '%'`),
    }
    await c.query("COMMIT")
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    c.release()
  }
  console.log("\n--- Postgres ---")
  for (const [k, v] of Object.entries(apagados)) console.log(`  ${k.padEnd(16)} ${v}`)

  // 5) O log de execução FICA, marcado. É o registro de que o teste existiu.
  const marcadas = await query<{ id: string }>(
    `UPDATE audit_lancamentos
        SET payload_resumo = COALESCE(payload_resumo, '{}'::jsonb) || jsonb_build_object('teste_limpo', true)
      WHERE uuid_alvo = $1
      RETURNING id`,
    [itemId],
  )
  console.log(`\nexecuções marcadas como teste_limpo: ${marcadas.rows.length} (mantidas de propósito)`)

  const sobrou = await levantar(itemId)
  const limpo =
    !sobrou.prepagamentos.length && !sobrou.rmVivos.length && !sobrou.convocacoes &&
    !sobrou.itensPlano && !sobrou.efeitos.length && !sobrou.alteracoes && !sobrou.jobs.length
  console.log(limpo ? "\n✅ nada mais aponta pro item." : "\n⚠️ ainda sobrou rastro:")
  if (!limpo) relatar(sobrou)
  if (!limpo) process.exitCode = 1
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
