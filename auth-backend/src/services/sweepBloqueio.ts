// Varredura periódica do board durante a janela de fechamento.
//
// É a rede de segurança do monitor: o webhook do Monday dá latência baixa, mas não
// cobre board sem webhook registrado (competência passada, cópia recém-duplicada pela
// Virada) nem sobrevive a uma queda. O sweep relê a janela e reconcilia — o guardrail
// `activity_log_id UNIQUE` garante que rever não duplica.
//
// Observa o BOARD INTEIRO: todo item, todo evento. Tudo é gravado; o recorte que vira
// WhatsApp sai de `deveNotificar()`.
import { config } from "../config.js"
import { query } from "../db.js"
import { lerActivityLogs, lerUsuarios } from "../clients/monday.js"
import {
  parseLog, classificar, deveNotificar, normalizar,
  type AlteracaoClassificada, type AuditMatch, type ConfigClassificacao,
} from "../domain/alteracaoBoard.js"
import { resolverVarios, fontesReais } from "./resolverItemPlano.js"
import {
  bloqueiosAbertos, boardsDoBloqueio, gravarAlteracoes, avancarCursor, colunasCriticas,
  type Bloqueio,
} from "../repo/bloqueio.js"

/**
 * Colunas que o motor (mensal / virada / WFs) escreve sozinho. Medido em 30 dias:
 * são as que sobram quando um log do token da automação NÃO casa em audit_lancamentos.
 * Estar aqui só impede o alerta — a alteração continua indo pro relatório.
 */
export const COLUNAS_MOTOR = new Set(
  [
    "VR - MENSAL", "VR - Unitário", "VT - Diário", "CREDITO CAJU", "CREDITO VT",
    "DESCONTO - VR", "DESCONTO - VT", "Dias Úteis/Mês - VR", "Dias Úteis/Mês - VT",
    "Pasta Pessoa Drive", "Pasta Pessoa Drive ID",
    "Pasta Convocacao Drive", "Pasta Convocacao Drive ID",
    "PROTOCOLO", "Link", "Nome do Empregado",
    // Convocação no RM (FopConvocacaoData) — automação nova, achada na homologação.
    "Lançar no RM", "Código Convocação RM",
  ].map(normalizar),
)

/** Grupos cujo conteúdo é criado por automação (1 item por contrato). */
export const GRUPOS_MOTOR = new Set(["LANÇAR NO RM (por contrato)"].map(normalizar))

/**
 * Onde a varredura começa. `aberto_em` é PISO DURO: a janela só observa o que acontece
 * depois que o DP a ativou — alteração anterior é histórico, não "lançada fora de hora".
 * Puro para ser testável sem rede.
 */
export function inicioDaVarredura(abertoEm: Date, cursorAte: Date | string | null): Date {
  if (!cursorAte) return abertoEm
  const c = new Date(cursorAte)
  return c > abertoEm ? c : abertoEm
}

/** Fatia da varredura. 12h mantém cada página bem abaixo do teto do activity_logs. */
const HORAS_POR_FATIA = 12

export interface ResultadoVarredura {
  bloqueio: Bloqueio
  bloqueioId: string
  competencia: string
  boards: Array<{
    boardId: number
    de: string
    ate: string
    logs: number
    gravadas: number
    aNotificar: number
    truncado: boolean
  }>
  novasParaNotificar: AlteracaoClassificada[]
}

/**
 * Índice item -> ações do app na janela. É o que devolve o operador REAL por trás de
 * uma escrita feita com o token da automação.
 */
async function indiceAudit(de: Date, ate: Date) {
  const { rows } = await query<{
    id: string; uuid_alvo: string; operador_nome: string | null; operador_email: string | null; criado_em: Date
  }>(
    // Folga de 10 min pra trás: a ação pode ter sido registrada logo antes da fatia
    // e as escritas no Monday caírem já dentro dela.
    `SELECT id, uuid_alvo, operador_nome, operador_email, criado_em
       FROM audit_lancamentos
      WHERE criado_em BETWEEN $1 AND $2`,
    [new Date(de.getTime() - 10 * 60_000), ate],
  )
  const itens = await resolverVarios(rows.map((r) => r.uuid_alvo), fontesReais)
  const porItem = new Map<number, Array<{ t: number; m: AuditMatch }>>()
  for (const r of rows) {
    const alvo = itens.get(r.uuid_alvo)
    if (!alvo) continue
    if (!porItem.has(alvo.itemId)) porItem.set(alvo.itemId, [])
    porItem.get(alvo.itemId)!.push({
      t: new Date(r.criado_em).getTime(),
      m: { operadorNome: r.operador_nome, operadorEmail: r.operador_email, auditId: r.id },
    })
  }
  // Janela de casamento medida: audit 19:23:59 x activity_log 19:24:11 = 12,5 s.
  // -1min/+5min cobre a escrita em lote de uma convocação inteira.
  return (itemId: number | null, quando: Date): AuditMatch | null => {
    if (!itemId) return null
    const t = quando.getTime()
    return (porItem.get(itemId) ?? []).find((x) => t >= x.t - 60_000 && t <= x.t + 5 * 60_000)?.m ?? null
  }
}

async function configClassificacao(): Promise<ConfigClassificacao> {
  return {
    autorAutomacao: config.monitor.autorAutomacao,
    autoresDp: new Set(config.monitor.autoresDp),
    colunasMotor: COLUNAS_MOTOR,
    gruposMotor: GRUPOS_MOTOR,
    colunasCriticas: new Set((await colunasCriticas()).map(normalizar)),
  }
}

export async function varrerBloqueio(
  b: Bloqueio,
  agora = new Date(),
): Promise<ResultadoVarredura> {
  const cfg = await configClassificacao()
  const nomes = await lerUsuarios()
  const out: ResultadoVarredura = {
    bloqueio: b, bloqueioId: b.id, competencia: b.competencia, boards: [], novasParaNotificar: [],
  }

  const abertoEm = new Date(b.aberto_em)

  for (const bv of await boardsDoBloqueio(b.id)) {
    const boardId = Number(bv.monday_board_id)
    let de = inicioDaVarredura(abertoEm, bv.cursor_ate)
    // Teto de janela: uma janela esquecida aberta há semanas pediria milhares de
    // páginas num tick só. O resto fica pro próximo tick.
    const limite = new Date(de.getTime() + config.monitor.maxDiasPorVarredura * 86_400_000)
    const fim = agora < limite ? agora : limite

    while (de < fim) {
      const ate = new Date(Math.min(de.getTime() + HORAS_POR_FATIA * 3_600_000, fim.getTime()))
      const { logs, truncado } = await lerActivityLogs(boardId, de, ate)

      const casar = await indiceAudit(de, ate)
      const classificadas = logs.map((l) => {
        const alt = parseLog(l, nomes)
        return classificar(alt, casar(alt.itemId, alt.ocorridoEm), cfg)
      })

      // Grava TUDO (inclusive informativa/motor/dp_direto) — o relatório lê a tabela
      // inteira. Só as linhas novas voltam, e delas sai o que vira mensagem.
      const novas = await gravarAlteracoes(b.id, classificadas, "sweep")
      const aNotificar = novas.filter(deveNotificar)
      out.novasParaNotificar.push(...aNotificar)
      out.boards.push({
        boardId, de: de.toISOString(), ate: ate.toISOString(),
        logs: logs.length, gravadas: novas.length, aNotificar: aNotificar.length, truncado,
      })

      if (truncado) {
        // Os logs vêm do mais novo pro mais antigo, então truncar perde a parte ANTIGA
        // da fatia. Avançar o cursor aqui apagaria esse buraco em silêncio.
        console.warn(
          `[sweep] board ${boardId} truncou em ${de.toISOString()}..${ate.toISOString()} — ` +
          `cursor NÃO avançou. Reduza HORAS_POR_FATIA.`,
        )
        break
      }
      await avancarCursor(b.id, boardId, ate)
      de = ate
    }
  }
  return out
}

/** Um tick: varre todas as janelas abertas. No-op quando não há nenhuma. */
export async function varrerTodos(agora = new Date()): Promise<ResultadoVarredura[]> {
  const abertos = await bloqueiosAbertos()
  const out: ResultadoVarredura[] = []
  for (const b of abertos) {
    try {
      out.push(await varrerBloqueio(b, agora))
    } catch (e) {
      // Uma janela quebrada não pode derrubar as outras nem o cron.
      console.error(`[sweep] bloqueio ${b.id} falhou: ${(e as Error).message}`)
    }
  }
  return out
}
