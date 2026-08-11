// Modo desenvolvedor do mensal: escolher POR FAMÍLIA o que um run de teste envia de verdade.
//
// Motivação (Isaac, 10/08/2026): o mensal dispara muitos efeitos reais — testar UMA função exige
// poder desligar as outras (ex.: convocação RM real com criar-Caju desligado). Homologação é
// tudo-ou-nada; isto aqui é o meio-termo.
//
// Segurança inegociável: run dev roda com modo 'homologacao', então a chave de idempotência é POR
// RUN. Um envio real de teste jamais marca a etapa como feita pra COMPETÊNCIA — senão o run
// oficial pularia a etapa em silêncio (incidente e173b1ef). O reverso é aceito e documentado: o
// que foi real num run dev será reenviado pelo run oficial; teste real = limpeza manual.
import { query } from "../db.js"

/**
 * Famílias selecionáveis. Nomes estáveis — vão pro banco e pro payload do front.
 *
 * caju_credito/caju_boleto estão FORA por enquanto: o gate do Caju é inline no step (região sob
 * edição de outra sessão — split VR/VT), e em run dev (modo homologacao) o Caju simula sempre.
 * É exatamente o caso de uso pedido ("desligar o criar caju"); ligar Caju REAL em dev entra
 * quando o split commitar.
 */
export const FAMILIAS_EFEITO = [
  "rm_historico", // ZMDHSTBENFUNC (rm_gerar)
  "rm_financeiro", // FopRotinas + IDFINANC + Integrar
  "rm_convocacao", // convocação S-2260 (etapa da fase F2)
  "monday_escritas", // Plano, Controle Caju, Solicitação, AUTOMAÇÃO-OK
  "drive", // arquivamento
] as const
export type FamiliaEfeito = (typeof FAMILIAS_EFEITO)[number]

/**
 * Etapa (nome no ledger) → família. Prefixo, porque etapas têm variantes
 * (rm_gerar tem sub-lotes, monday_* são quatro).
 */
const PREFIXO_FAMILIA: [string, FamiliaEfeito][] = [
  ["rm_gerar", "rm_historico"],
  ["rm_foprotinas", "rm_financeiro"],
  ["rm_aguardar", "rm_financeiro"],
  ["rm_integrar", "rm_financeiro"],
  ["convocacao_rm", "rm_convocacao"],
  ["monday_", "monday_escritas"],
  ["drive", "drive"],
]

export function familiaDaEtapa(etapa: string): FamiliaEfeito | null {
  for (const [prefixo, familia] of PREFIXO_FAMILIA) {
    if (etapa.startsWith(prefixo)) return familia
  }
  return null
}

export function familiasValidas(v: unknown): v is FamiliaEfeito[] {
  return Array.isArray(v) && v.length > 0 && v.every((f) => (FAMILIAS_EFEITO as readonly string[]).includes(f))
}

/** Marca o run como dev: força homologação (chave por run) e grava a whitelist. */
export async function marcarRunDev(runId: string, familiasReais: FamiliaEfeito[]): Promise<void> {
  await query(
    `UPDATE mensal_run
        SET modo='homologacao', dev_familias_reais=$2::jsonb, atualizado_em=now()
      WHERE run_id=$1`,
    [runId, JSON.stringify(familiasReais)],
  )
}

// Cache por run: a whitelist é imutável depois que o run começa, e o reservarOuPular roda uma vez
// por etapa — sem cache seria 1 SELECT extra por etapa (inócuo, mas desnecessário).
const cache = new Map<string, Set<string> | null>()

/** Whitelist do run, ou null se não é run dev. */
export async function familiasReaisDoRun(runId: string): Promise<Set<string> | null> {
  if (cache.has(runId)) return cache.get(runId)!
  const { rows } = await query<{ dev_familias_reais: string[] | null }>(
    `SELECT dev_familias_reais FROM mensal_run WHERE run_id=$1`,
    [runId],
  )
  const lista = rows[0]?.dev_familias_reais
  const r = Array.isArray(lista) && lista.length ? new Set(lista) : null
  cache.set(runId, r)
  return r
}

/**
 * A etapa deste run dev vai REAL? false = simula (default), e também false pra run normal —
 * quem chama já está no braço de homologação.
 */
export async function etapaRealNoRunDev(runId: string, etapa: string): Promise<boolean> {
  const familias = await familiasReaisDoRun(runId)
  if (!familias) return false
  const familia = familiaDaEtapa(etapa)
  return familia != null && familias.has(familia)
}

/**
 * A FAMÍLIA vai real neste run dev? Igual a `etapaRealNoRunDev`, mas perguntando direto pela
 * família — serve pra efeito que não é uma etapa do ledger, como o eco do código no board (que
 * acontece dentro do serviço de convocação, não num step).
 */
export async function familiaRealNoRunDev(runId: string, familia: FamiliaEfeito): Promise<boolean> {
  const familias = await familiasReaisDoRun(runId)
  return !!familias && familias.has(familia)
}

/** Só pra teste: limpa o cache entre casos. */
export function limparCacheDev(): void {
  cache.clear()
}
