// Resolve `pi.audit_lancamentos.uuid_alvo` -> item do board do PLANO.
//
// Por que existe: o app grava no Monday com o token do Isaac, então o `user_id` do
// activity_log não é quem clicou. Quem clicou está em pi.audit_lancamentos — mas só
// `acao='convocacao'` guarda o item_id direto; 'registro' e 'cancelamento' guardam o
// UUID da convocação. Sem esta cascata, falta/atraso lançados pelo app ficam sem autor.
//
// Cascata (cobertura medida em 08/08/2026, 30 dias):
//   1) uuid_alvo numérico            -> já é o item do Plano        259/260
//   2) pi.convocacoes.item_origem_id                                 58/101
//   3) Monday: Histórico, text_mm2xjend = uuid -> link_mm2x1rk0      8/8 dos órfãos
//   Combinado: 101/101.
//
// O nível 2 fura porque `pi.rotas_processo` está '* = n8n': finalizar/cancelar rodam
// no n8n e gravam no Monday sem popular o Postgres (pi.convocacoes tinha 148 linhas).
// Enquanto não flipar, o nível 3 é o caminho principal, não a contingência.
//
// ⚠️ É `item_origem_id` (board do PLANO), NUNCA `monday_item_id` (board do Histórico).
// Trocar os dois não dá erro: devolve zero match em silêncio.
import { query } from "../db.js"
import { buscarHistoricoPorUuid, parseItemOrigem } from "../repo/historico.js"

export type NivelResolucao = 1 | 2 | 3
export type FonteResolucao = "direto" | "cache" | "convocacoes" | "monday"

export interface ItemPlano {
  itemId: number
  boardId: number | null
  nivel: NivelResolucao
  fonte: FonteResolucao
}

/** Formato do `uuid_alvo`. `outro` = chave composta (ponto_facultativo, split). */
export type FormatoAlvo = "item" | "uuid" | "outro"

const RE_ITEM = /^\d+$/
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function formatoAlvo(alvo: string | null | undefined): FormatoAlvo {
  const s = String(alvo ?? "").trim()
  if (RE_ITEM.test(s)) return "item"
  if (RE_UUID.test(s)) return "uuid"
  return "outro"
}

// ---------------------------------------------------------------------------
// Fontes injetáveis — deixam a cascata testável sem banco nem rede.
// ---------------------------------------------------------------------------
export interface Fontes {
  cache(uuids: string[]): Promise<Map<string, { itemId: number; boardId: number | null; nivel: NivelResolucao }>>
  convocacoes(uuids: string[]): Promise<Map<string, { itemId: number; boardId: number | null }>>
  monday(uuid: string): Promise<{ itemId: number; boardId: number | null } | null>
  gravarCache(entradas: Array<{ uuid: string; itemId: number; boardId: number | null; nivel: NivelResolucao }>): Promise<void>
}

/**
 * Resolve vários alvos de uma vez. Em lote porque o sweep processa centenas de
 * activity_logs por ciclo — um-a-um viraria N+1 no Postgres e no Monday.
 *
 * Só o nível 3 vai à rede, e só para o que sobrou dos níveis 1 e 2.
 * Um alvo que falha no Monday vira `null` e NÃO derruba os outros: o monitor
 * prefere registrar a alteração sem operador a perder a alteração inteira.
 */
export async function resolverVarios(
  alvos: Array<string | null | undefined>,
  fontes: Fontes,
): Promise<Map<string, ItemPlano>> {
  const out = new Map<string, ItemPlano>()

  // dedupe: o mesmo uuid aparece em N logs do mesmo item (uma convocação escreve ~12 colunas)
  const unicos = [...new Set(alvos.map((a) => String(a ?? "").trim()).filter(Boolean))]

  const pendentes: string[] = []
  for (const alvo of unicos) {
    if (formatoAlvo(alvo) === "item") {
      out.set(alvo, { itemId: Number(alvo), boardId: null, nivel: 1, fonte: "direto" })
    } else if (formatoAlvo(alvo) === "uuid") {
      pendentes.push(alvo)
    }
    // 'outro' (chave composta) não resolve por item — fica de fora, o chamador
    // atribui por janela de tempo + operador.
  }
  if (!pendentes.length) return out

  const doCache = await fontes.cache(pendentes)
  const faltam: string[] = []
  for (const uuid of pendentes) {
    const c = doCache.get(uuid)
    if (c) out.set(uuid, { ...c, fonte: "cache" })
    else faltam.push(uuid)
  }
  if (!faltam.length) return out

  const novos: Array<{ uuid: string; itemId: number; boardId: number | null; nivel: NivelResolucao }> = []

  const doPg = await fontes.convocacoes(faltam)
  const semPg: string[] = []
  for (const uuid of faltam) {
    const c = doPg.get(uuid)
    if (c) {
      out.set(uuid, { ...c, nivel: 2, fonte: "convocacoes" })
      novos.push({ uuid, itemId: c.itemId, boardId: c.boardId, nivel: 2 })
    } else {
      semPg.push(uuid)
    }
  }

  for (const uuid of semPg) {
    try {
      const c = await fontes.monday(uuid)
      if (!c) continue
      out.set(uuid, { ...c, nivel: 3, fonte: "monday" })
      novos.push({ uuid, itemId: c.itemId, boardId: c.boardId, nivel: 3 })
    } catch (e) {
      console.warn(`[resolverItemPlano] Monday falhou para ${uuid}: ${(e as Error).message}`)
    }
  }

  if (novos.length) {
    // Cache é otimização: se gravar falhar, a resolução desta rodada continua válida.
    try {
      await fontes.gravarCache(novos)
    } catch (e) {
      console.warn(`[resolverItemPlano] cache não gravou: ${(e as Error).message}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Fontes reais (Postgres + Monday)
// ---------------------------------------------------------------------------
export const fontesReais: Fontes = {
  async cache(uuids) {
    const { rows } = await query<{ uuid: string; item_plano_id: string; monday_board_id: string | null; nivel: number }>(
      `SELECT uuid, item_plano_id, monday_board_id, nivel
         FROM convocacao_item_plano WHERE uuid = ANY($1)`,
      [uuids],
    )
    return new Map(
      rows.map((r) => [
        r.uuid,
        {
          itemId: Number(r.item_plano_id),
          boardId: r.monday_board_id === null ? null : Number(r.monday_board_id),
          nivel: r.nivel as NivelResolucao,
        },
      ]),
    )
  },

  async convocacoes(uuids) {
    // item_origem_id = board do PLANO. monday_item_id seria o Histórico — não serve.
    const { rows } = await query<{ uuid: string; item_origem_id: string | null }>(
      `SELECT uuid, item_origem_id FROM convocacoes
        WHERE uuid = ANY($1) AND item_origem_id IS NOT NULL`,
      [uuids],
    )
    return new Map(rows.map((r) => [r.uuid, { itemId: Number(r.item_origem_id), boardId: null }]))
  },

  async monday(uuid) {
    const item = await buscarHistoricoPorUuid(uuid)
    if (!item) return null
    const { itemId, boardId } = parseItemOrigem(item)
    if (!itemId) return null
    return { itemId: Number(itemId), boardId: boardId ? Number(boardId) : null }
  },

  async gravarCache(entradas) {
    if (!entradas.length) return
    await query(
      `INSERT INTO convocacao_item_plano (uuid, item_plano_id, monday_board_id, nivel)
       SELECT * FROM UNNEST($1::text[], $2::bigint[], $3::bigint[], $4::int[])
       ON CONFLICT (uuid) DO NOTHING`,
      [
        entradas.map((e) => e.uuid),
        entradas.map((e) => e.itemId),
        entradas.map((e) => e.boardId),
        entradas.map((e) => e.nivel),
      ],
    )
  },
}

/** Conveniência para um alvo só. Prefira `resolverVarios` em lote. */
export async function resolverItemDoPlano(
  alvo: string | null | undefined,
  fontes: Fontes = fontesReais,
): Promise<ItemPlano | null> {
  const mapa = await resolverVarios([alvo], fontes)
  return mapa.get(String(alvo ?? "").trim()) ?? null
}
