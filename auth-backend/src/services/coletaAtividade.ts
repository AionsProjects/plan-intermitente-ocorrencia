// Coleta de atividade — o que mudou no board e quem mudou DE VERDADE.
//
// Mora num serviço, não no script, porque o script executa `main()` no import: quem quisesse
// reusar ou testar estas funções disparava um relatório inteiro. Extraído sem mudança de
// comportamento em 31/08/2026.
import { query } from "../db.js"
import { mondayGraphql } from "../monday.js"
import { rotuloAcao } from "../domain/rotulosAtividade.js"
import { quem } from "./janelaManaus.js"

// ── Log de alterações do Monday ─────────────────────────────────────────────
// A fonte da verdade de "o que mudou no board" é o activity_log do próprio Monday, não as
// nossas tabelas: ele registra TAMBÉM a edição feita à mão, que não passa por lugar nenhum
// do nosso sistema. `created_at` vem em décimos de microssegundo — dividir por 10.000 dá ms.
// SÓ o board do Plano do mês (decisão do Isaac, 31/08): o Histórico de Ocorrências não é mais
// usado pela operação, e a Base de Desconto não conta como alteração de lançamento — as duas
// enchiam o relatório de linha que ninguém lê. O que interessa do lançamento aparece aqui
// mesmo: falta, minutos de atraso, status da convocação e início do cancelamento.
export const BOARDS_LOG = [{ id: "", papel: "atual", rotulo: "Plano de Intermitentes" }]

/** Colunas que carregam LANÇAMENTO de ocorrência — o que o Isaac pediu para ver primeiro. */
export const COLUNAS_OCORRENCIA = new Set([
  "numeric",           // Faltas registradas / OP - Falta
  "texto5",            // Minutos de atraso registrados
  "color_mm3a8ana",    // Status Convocação (cancelada / cancelada parcialmente)
  "date_mm3b88ta",     // Cancelamento Início
  "color_mkta71ex",    // OP - Tipo Convocação
  "color_mktarrgs",    // OP - Justificativa
])

/**
 * uid do Monday que o app usa para escrever. Toda escrita da automação sai com ele, então
 * autor DIFERENTE deste (e não-negativo) é prova de que alguém digitou na interface.
 *
 * Fixo aqui porque é o dono do token de serviço, não uma preferência: mudar o token muda este
 * número, e é isso que o env permite corrigir sem deploy.
 */
export const UID_TOKEN = Number(process.env.MONDAY_TOKEN_UID ?? 98663994)

export interface AlteracaoBoard {
  quando: Date
  board: string
  pulseId: string
  pessoa: string
  coluna: string
  colunaId: string
  de: string
  para: string
  /** Quem o Monday registra — na escrita da automação, é o dono do TOKEN, não quem clicou. */
  gravadoPor: string
  /** uid do autor no Monday. Negativo = automação do próprio Monday. */
  gravadoPorId: number
  /** Quem clicou de verdade, quando dá para cruzar com uma execução do app. */
  autorReal: string | null
  via: string
  ocorrencia: boolean
}

/**
 * Execução do app candidata a explicar uma alteração do board.
 *
 * Existe porque o log do Monday atribui TODA escrita da automação ao usuário do token (a conta
 * de serviço). Sem este cruzamento o relatório diz "Isaac Raylen" em lançamento que a Karine
 * fez pelo app — foi o que a versão anterior fez, e é justamente a pergunta que o relatório
 * precisa responder: quem alterou DE VERDADE.
 */
export interface ExecucaoApp {
  quem: string
  acao: string
  pessoa: string | null
  inicio: Date
  fim: Date
  itens: Set<string>
}

export const norm = (v: string | null | undefined): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim()

/** Execuções do app na janela (com folga), já com os ids de item do Monday que cada uma tocou. */
export async function lerExecucoesApp(de: Date, ate: Date): Promise<ExecucaoApp[]> {
  const folga = 5 * 60_000
  const { rows } = await query<{
    id: string; acao: string; pessoa_nome: string | null; quem: string | null
    criado_em: Date; finalizado_em: Date | null; itens: string[] | null
  }>(
    `SELECT l.id, l.acao, l.pessoa_nome,
            COALESCE(l.operador_nome, l.operador_email) quem,
            l.criado_em, l.finalizado_em,
            ARRAY(SELECT a.chave FROM atividade_artefato a
                   WHERE a.execucao_id = l.id AND a.chave ~ '^[0-9]{6,}$') itens
       FROM audit_lancamentos l
      WHERE l.criado_em >= $1 AND l.criado_em <= $2
      ORDER BY l.criado_em`,
    [new Date(de.getTime() - folga).toISOString(), new Date(ate.getTime() + folga).toISOString()],
  )
  return rows.map((r) => ({
    quem: quem(r.quem, null),
    acao: r.acao,
    pessoa: r.pessoa_nome,
    inicio: r.criado_em,
    // Execução sem fim registrado: dá 3 minutos de janela, que cobre o mais lento que já vimos.
    fim: r.finalizado_em ?? new Date(r.criado_em.getTime() + 180_000),
    itens: new Set(r.itens ?? []),
  }))
}

/**
 * Casa uma alteração do board com a execução que a causou. Três chaves, da mais forte pra mais
 * fraca — e quando nenhuma casa, o relatório NÃO inventa: fica com o autor do Monday.
 */
export function casarExecucao(a: AlteracaoBoard, execs: ExecucaoApp[]): ExecucaoApp | null {
  const dentro = (e: ExecucaoApp, folgaAntes = 60_000, folgaDepois = 180_000): boolean =>
    a.quando.getTime() >= e.inicio.getTime() - folgaAntes &&
    a.quando.getTime() <= e.fim.getTime() + folgaDepois
  // 1) id do item registrado como artefato da execução — chave exata.
  const porItem = execs.find((e) => e.itens.has(a.pulseId) && dentro(e))
  if (porItem) return porItem
  // 2) mesma pessoa, dentro da janela da execução.
  const alvo = norm(a.pessoa)
  const porPessoa = execs.find((e) => {
    const p = norm(e.pessoa)
    return p && alvo && (alvo.includes(p) || p.includes(alvo)) && dentro(e)
  })
  if (porPessoa) return porPessoa
  // 3) uma ÚNICA execução cobrindo o instante — sem ambiguidade, vale; com duas, não.
  const noTempo = execs.filter((e) => dentro(e, 5_000, 30_000))
  return noTempo.length === 1 ? noTempo[0]! : null
}

/**
 * Texto legível de um valor do log, que vem cru e em formato diferente por tipo de coluna.
 *
 * Status é o caso que obriga o `rotulos`: o log guarda só o ÍNDICE do rótulo
 * (`{"index":2,...}`), e sem o mapa de labels da coluna o relatório imprimiria
 * "[object Object]" — foi o que a primeira versão fez.
 */
/**
 * Índice de status -> rótulo. Índice FORA do mapa de labels = célula limpa: o Monday reporta o
 * status apagado com um índice que não existe nos `labels` da coluna (visto em 31/08, quando a
 * Thifany desconvocou gente e o Status foi para o índice 5, que a coluna não tem). Chamar isso de
 * "índice 5" no relatório não diz nada a quem lê.
 */
function rotuloDoIndice(i: number, rotulos?: Map<number, string>): string {
  const r = rotulos?.get(i)
  return r && r.trim() ? r : `vazio (índice ${i})`
}

export function valorLegivel(v: unknown, rotulos?: Map<number, string>): string {
  if (v == null) return "vazio"
  if (typeof v === "string") return v.slice(0, 120)
  if (typeof v === "number") return String(v)
  const o = v as Record<string, unknown>
  // Status: {label:{index,text}} no valor novo, {index} no anterior.
  const lab = o.label as Record<string, unknown> | string | undefined
  if (typeof lab === "string" && lab.trim()) return lab.slice(0, 120)
  if (lab && typeof lab === "object") {
    if (typeof lab.text === "string" && lab.text.trim()) return lab.text.slice(0, 120)
    if (typeof lab.index === "number") return rotuloDoIndice(lab.index, rotulos)
  }
  if (typeof o.index === "number") return rotuloDoIndice(o.index, rotulos)
  for (const k of ["text", "name", "value"]) {
    const x = o[k]
    if (typeof x === "string" && x.trim()) return x.slice(0, 120)
    if (typeof x === "number") return String(x)
  }
  if (typeof o.date === "string") return o.date
  const j = JSON.stringify(v)
  return j.length > 120 ? `${j.slice(0, 117)}…` : j
}

/** index -> rótulo das colunas de status, lido do `settings_str` do board. */
export function rotulosDeStatus(colunas: Array<{ id: string; settings_str?: string | null }>, boardId: string): Map<string, Map<number, string>> {
  const fora = new Map<string, Map<number, string>>()
  for (const c of colunas) {
    if (!c.settings_str) continue
    try {
      const s = JSON.parse(c.settings_str) as { labels?: Record<string, string> }
      if (!s.labels) continue
      fora.set(`${boardId}:${c.id}`, new Map(Object.entries(s.labels).map(([i, t]) => [Number(i), t])))
    } catch {
      /* coluna sem settings utilizável */
    }
  }
  return fora
}

export async function lerAlteracoesBoard(de: Date, ate: Date): Promise<AlteracaoBoard[]> {
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards WHERE papel = 'atual' AND ativo ORDER BY atualizado_em DESC LIMIT 1`,
  )
  const boards = BOARDS_LOG.map((b) => ({ ...b, id: b.id || rows[0]?.monday_board_id || "" })).filter((b) => b.id)

  // Título das colunas por board: sem isso o relatório diria "color_mm3a8ana" ao DP.
  const titulos = new Map<string, string>()
  const nomes = new Map<number, string>()
  const saida: AlteracaoBoard[] = []
  for (const b of boards) {
    const d = await mondayGraphql<{
      boards: Array<{
        columns: Array<{ id: string; title: string; settings_str: string | null }>
        activity_logs: Array<{ event: string; created_at: string; data: string; user_id: number }>
      }>
    }>(
      `query($b:[ID!],$de:ISO8601DateTime!,$ate:ISO8601DateTime!){
         boards(ids:$b){ columns{ id title settings_str }
           activity_logs(from:$de, to:$ate, limit:500){ event created_at data user_id } } }`,
      { b: [b.id], de: de.toISOString(), ate: ate.toISOString() },
    )
    const board = d.boards?.[0]
    if (!board) continue
    for (const c of board.columns) titulos.set(`${b.id}:${c.id}`, c.title)
    const rotulos = rotulosDeStatus(board.columns, b.id)
    for (const l of board.activity_logs) {
      if (l.event !== "update_column_value") continue
      let j: Record<string, unknown>
      try {
        j = JSON.parse(l.data) as Record<string, unknown>
      } catch {
        continue
      }
      const colunaId = String(j.column_id ?? "")
      saida.push({
        quando: new Date(Number(l.created_at) / 10_000),
        board: b.rotulo,
        pulseId: String(j.pulse_id ?? ""),
        pessoa: String(j.pulse_name ?? "—"),
        coluna: titulos.get(`${b.id}:${colunaId}`) ?? colunaId,
        colunaId,
        de: valorLegivel(j.previous_value, rotulos.get(`${b.id}:${colunaId}`)),
        para: valorLegivel(j.value, rotulos.get(`${b.id}:${colunaId}`)),
        gravadoPor: String(l.user_id),
        gravadoPorId: Number(l.user_id),
        autorReal: null,
        via: "",
        ocorrencia: COLUNAS_OCORRENCIA.has(colunaId),
      })
      nomes.set(l.user_id, "")
    }
  }

  // user_id -> nome. Ids negativos são a automação do próprio Monday, e a API recusa consultá-los.
  const ids = [...nomes.keys()].filter((i) => i > 0)
  if (ids.length) {
    const u = await mondayGraphql<{ users: Array<{ id: string; name: string }> }>(
      `query($ids:[ID!]){ users(ids:$ids){ id name } }`,
      { ids: ids.map(String) },
    )
    for (const x of u.users) nomes.set(Number(x.id), x.name)
  }
  for (const a of saida) {
    const n = nomes.get(Number(a.gravadoPor))
    a.gravadoPor = Number(a.gravadoPor) < 0 ? "automação do Monday" : (n || `usuário ${a.gravadoPor}`)
  }

  // O cruzamento com o app: sem ele o relatório credita à conta de serviço o que a operação fez.
  //
  // Só se aplica à escrita da AUTOMAÇÃO. Alteração com autor humano no log já é, por definição,
  // digitada na interface — casá-la com uma execução que rodava no mesmo minuto trocaria "fulano
  // editou à mão" por "fulano usou o app", que é o oposto do que aconteceu. Era esse o defeito da
  // primeira versão: sumia com as manuais de quem estivesse operando ao mesmo tempo.
  const execs = await lerExecucoesApp(de, ate)
  for (const a of saida) {
    const daAutomacao = a.gravadoPorId === UID_TOKEN || a.gravadoPorId < 0
    const e = daAutomacao ? casarExecucao(a, execs) : null
    if (e) {
      a.autorReal = e.quem
      a.via = `app · ${rotuloAcao(e.acao)}`
    } else if (daAutomacao) {
      a.via = "automação (sem execução casada)"
    } else {
      a.via = "à mão no board"
    }
  }
  return saida.sort((x, y) => x.quando.getTime() - y.quando.getTime())
}


/**
 * Atraso de uma convocação, em dias: distância entre o INÍCIO do período e o dia em que ela foi
 * criada (régua definida pelo Isaac em 31/08). Zero = criada no dia em que o período começa;
 * negativo = criada antes, que não é atraso.
 *
 * Vive aqui, e não no script, porque o script executa `main()` no import — o teste do relatório
 * anterior disparou um PDF de verdade por causa disso.
 */
export function atrasoEmDias(dataInicio: string | Date, diaCriacao: string): number {
  const ini = typeof dataInicio === "string" ? dataInicio.slice(0, 10) : dataInicio.toISOString().slice(0, 10)
  return Math.round((Date.parse(`${diaCriacao}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`)) / 86_400_000)
}
