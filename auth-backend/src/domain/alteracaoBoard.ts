// Parsing e classificação de um `activity_log` do board do Plano.
// Puro: sem banco, sem rede — a resolução de autoria entra pronta via `AuditMatch`.
//
// Formas de `value`/`previous_value` conferidas contra o board 18418191275 em 08/08/2026;
// cada `case` do formatador corresponde a um shape observado, não a suposição.

export type Origem = "app" | "motor" | "api_inexplicada" | "monday_direto" | "dp_direto" | "desconhecida"
export type Severidade = "critica" | "informativa"

/** O que a resolução de autoria (pi.audit_lancamentos) devolveu para este item. */
export interface AuditMatch {
  operadorNome: string | null
  operadorEmail: string | null
  auditId: string | null
}

export interface ConfigClassificacao {
  /** user_id do Monday por trás do token que o app e os WFs usam (hoje o Isaac). */
  autorAutomacao: string
  /** Títulos de coluna que o motor (mensal/virada/WF) escreve sozinho. Normalizados. */
  colunasMotor: Set<string>
  /** Títulos de coluna críticos vindos de pi.bloqueio_coluna_critica. Normalizados. */
  colunasCriticas: Set<string>
  /**
   * Títulos de grupo cujo conteúdo é produzido por automação. Nasceu da homologação de
   * 08/08/2026: a automação de Convocação no RM cria 1 item por contrato no grupo
   * "LANÇAR NO RM (por contrato)" — 9 de 11 `api_inexplicada` numa janela de 24 h eram
   * isso. Alarme falso por desconhecer uma automação nova, não por defeito da regra.
   */
  gruposMotor?: Set<string>
  /**
   * user_ids do Monday que são do DP. O DP é o DESTINATÁRIO do alerta — avisá-lo do
   * que ele mesmo acabou de fazer é ruído. Medido em 5 dias: tirar a auto-notificação
   * derrubou a fila de 402 para 199.
   */
  autoresDp?: Set<string>
}

export interface LogBruto {
  id: string
  event: string
  user_id: string
  created_at: string
  data: Record<string, unknown>
}

export interface Alteracao {
  activityLogId: string
  evento: string
  boardId: number | null
  itemId: number | null
  itemNome: string | null
  grupoId: string | null
  grupoNome: string | null
  colunaId: string | null
  colunaTitulo: string | null
  colunaTipo: string | null
  valorAnterior: unknown
  valorNovo: unknown
  /** Texto pronto para a mensagem: "210,00 -> 218,50", "PONTUAL -> CANCELADOS", etc. */
  resumo: string | null
  /** false = o Monday emitiu o log mas nada mudou de fato (ver mudouDeFato). */
  mudou: boolean
  /** Quantos itens o evento atingiu (batch_change_pulses_column_value > 1). */
  qtdItens: number
  autorId: string
  /** O activity_log só devolve `user_id`; o nome vem do mapa de usuários do Monday. */
  autorNome: string | null
  ocorridoEm: Date
}

// ---------------------------------------------------------------------------
// created_at
// ---------------------------------------------------------------------------

/**
 * O `created_at` do activity_log é um inteiro de 17 dígitos em **ticks de 100 ns**
 * — não ISO e NÃO microssegundos. Dividir por 1000 erra por 4 ordens de grandeza.
 * Conferido: 17861306519147374 -> 2026-08-07T19:24:11.914Z.
 */
export function dataDoLog(raw: string): Date {
  return new Date(Number(BigInt(raw) / 10000n))
}

// ---------------------------------------------------------------------------
// Formatação de valor
// ---------------------------------------------------------------------------

const num = (v: unknown): string =>
  typeof v === "number" ? v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(v)

/** Converte o valor cru de uma coluna em texto curto. `null` = vazio/limpo. */
export function formatarValor(tipo: string | null, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object") return String(raw)
  const o = raw as Record<string, unknown>
  if (Object.keys(o).length === 0) return null // {} = coluna limpa

  switch (tipo) {
    case "numeric":
      return o.value === null || o.value === undefined ? null : num(o.value)
    case "text":
    case "long-text":
      return (o.value as string) || null
    case "color": // status
      return ((o.label as Record<string, unknown>)?.text as string) ?? null
    case "date": {
      const d = o.date as string | null
      if (!d) return null
      const [a, m, dia] = d.split("-")
      return o.time ? `${dia}/${m}/${a} ${String(o.time).slice(0, 5)}` : `${dia}/${m}/${a}`
    }
    case "name":
      return (o.name as string) || null
    case "link":
      return (o.url as string) || (o.text as string) || null
    case "button":
      return o.clicks ? `${o.clicks} clique(s)` : null
    case "dropdown": {
      // ⚠️ O dropdown devolve a lista INTEIRA de labels do board (193+ no Nome do
      // Empregado). Mandar cru estoura a mensagem — quem interessa é o diff, feito
      // em resumirMudanca(). Aqui só a contagem, como fallback.
      const l = (o.labels as string[]) ?? []
      return l.length ? `${l.length} opção(ões)` : null
    }
    default: {
      const s = JSON.stringify(o)
      return s.length > 120 ? s.slice(0, 117) + "..." : s
    }
  }
}

/** Rótulo legível de um label de dropdown: "12__FULANO" -> "FULANO". */
function limparLabel(s: string): string {
  return s.replace(/^\d+__/, "")
}

/**
 * Diff de dropdown: o que entrou e o que saiu. Sem isso, uma troca de 1 nome
 * viraria uma mensagem com a lista inteira do board dos dois lados.
 */
export function diffDropdown(anterior: unknown, novo: unknown): string | null {
  const labels = (v: unknown): string[] =>
    (((v as Record<string, unknown>)?.labels as string[]) ?? []).map(limparLabel)
  const a = new Set(labels(anterior))
  const b = new Set(labels(novo))
  const entrou = [...b].filter((x) => !a.has(x))
  const saiu = [...a].filter((x) => !b.has(x))
  if (!entrou.length && !saiu.length) return null
  const partes: string[] = []
  if (entrou.length) partes.push(`+ ${entrou.join(", ")}`)
  if (saiu.length) partes.push(`- ${saiu.join(", ")}`)
  return partes.join(" | ")
}

// ---------------------------------------------------------------------------
// Parsing do log
// ---------------------------------------------------------------------------

const nOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function parseLog(log: LogBruto, nomesPorAutor?: Map<string, string>): Alteracao {
  const d = log.data ?? {}
  const tipo = (d.column_type as string) ?? null
  const anterior = d.previous_value
  const novo = d.value

  let resumo: string | null = null
  let mudou = true
  let itemNome = (d.pulse_name as string) ?? null
  let qtdItens = 1

  switch (log.event) {
    case "create_pulse":
      resumo = d.group_name ? `criado no grupo ${d.group_name}` : "item criado"
      break
    case "delete_pulse":
      resumo = "item excluído"
      break
    case "archive_pulse":
      resumo = "item arquivado"
      break
    case "move_pulse_from_group":
      resumo = `grupo: ${d.source_group ?? "?"} -> ${d.dest_group ?? "?"}`
      itemNome = itemNome ?? ((d.pulse as Record<string, unknown>)?.name as string) ?? null
      break
    case "batch_change_pulses_column_value": {
      // Um evento para N itens: NÃO tem previous_value por item.
      const ids = (d.pulse_ids as unknown[]) ?? []
      qtdItens = ids.length || 1
      const dep = tipo === "dropdown" ? null : formatarValor(tipo, novo)
      resumo = `${qtdItens} item(ns) -> ${dep ?? "(vazio)"}`
      break
    }
    case "subscribe":
    case "add_owner":
      resumo = "assinante/responsável alterado"
      itemNome = itemNome ?? ((d.item_name as string) ?? null)
      break
    default: {
      // update_column_value, update_name, change_column_settings
      if (tipo === "dropdown") {
        resumo = diffDropdown(anterior, novo)
        mudou = resumo !== null
      } else {
        const de = formatarValor(tipo, anterior)
        const para = formatarValor(tipo, novo)
        // O Monday emite log quando só metadado mudou (ex.: `post_id` num status
        // com o mesmo label). Isso não é alteração de dado — não pode virar alerta.
        mudou = de !== para
        resumo = mudou ? `${de ?? "(vazio)"} -> ${para ?? "(vazio)"}` : null
      }
    }
  }

  return {
    activityLogId: log.id,
    evento: log.event,
    boardId: nOuNull(d.board_id),
    itemId: nOuNull(d.pulse_id),
    itemNome,
    grupoId: (d.group_id as string) ?? null,
    grupoNome: (d.group_name as string) ?? null,
    colunaId: (d.column_id as string) ?? null,
    colunaTitulo: (d.column_title as string) ?? null,
    colunaTipo: tipo,
    valorAnterior: anterior ?? null,
    valorNovo: novo ?? null,
    resumo,
    mudou,
    qtdItens,
    autorId: String(log.user_id),
    autorNome: nomesPorAutor?.get(String(log.user_id)) ?? null,
    ocorridoEm: dataDoLog(log.created_at),
  }
}

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

/** NFD sem acento, espaços colapsados, maiúsculo — mesma normalização do Code node do WF. */
export function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

/** Pseudo-usuário do Monday para automação nativa (recipes). */
export const AUTOR_APP_MONDAY = "-4"

const EVENTOS_CRITICOS = new Set([
  "create_pulse",
  "delete_pulse",
  "archive_pulse",
  "move_pulse_from_group",
  "batch_change_pulses_column_value",
])

/** Campos do operacional: o próprio board os prefixa com "OP -" / "Op -". */
export function ehColunaOperacional(titulo: string | null): boolean {
  return /^OP\s*-/.test(normalizar(titulo))
}

/**
 * As 4 origens. A distinção que importa: `monday_direto` é quem editou por fora
 * do app — contorna o rastro de pi.audit_lancamentos e por isso pesa mais que a
 * mesma mudança feita pela tela.
 */
export function classificarOrigem(
  alt: Pick<Alteracao, "autorId" | "colunaTitulo" | "itemId" | "evento"> & { grupoNome?: string | null },
  audit: AuditMatch | null,
  cfg: ConfigClassificacao,
): Origem {
  if (alt.autorId === AUTOR_APP_MONDAY) return "motor"
  if (alt.autorId !== cfg.autorAutomacao) {
    return cfg.autoresDp?.has(alt.autorId) ? "dp_direto" : "monday_direto"
  }
  if (audit) return "app"
  // Evento de BOARD (change_column_settings) não tem pulse_id, então nunca casa no
  // audit — chamar de "inexplicada" seria alarme falso por construção. Na prática é
  // o app criando label de dropdown (`create_labels_if_missing`) ao convocar.
  if (!alt.itemId) return "motor"
  if (alt.grupoNome && cfg.gruposMotor?.has(normalizar(alt.grupoNome))) return "motor"
  return cfg.colunasMotor.has(normalizar(alt.colunaTitulo)) ? "motor" : "api_inexplicada"
}

export function classificarSeveridade(
  alt: Pick<Alteracao, "evento" | "colunaTitulo" | "mudou">,
  origem: Origem,
  cfg: ConfigClassificacao,
): Severidade {
  if (!alt.mudou) return "informativa"
  if (origem === "motor") return "informativa"
  // Escrita de API sem rastro no app é sempre digna de olhar, seja qual for a coluna.
  if (origem === "api_inexplicada") return "critica"
  if (EVENTOS_CRITICOS.has(alt.evento)) return "critica"
  if (ehColunaOperacional(alt.colunaTitulo)) return "critica"
  return cfg.colunasCriticas.has(normalizar(alt.colunaTitulo)) ? "critica" : "informativa"
}

export interface AlteracaoClassificada extends Alteracao {
  origem: Origem
  severidade: Severidade
  operadorNome: string | null
  operadorEmail: string | null
  auditId: string | null
}

export function classificar(
  alt: Alteracao,
  audit: AuditMatch | null,
  cfg: ConfigClassificacao,
): AlteracaoClassificada {
  const origem = classificarOrigem(alt, audit, cfg)
  return {
    ...alt,
    origem,
    severidade: classificarSeveridade(alt, origem, cfg),
    operadorNome: origem === "app" ? (audit?.operadorNome ?? null) : null,
    operadorEmail: origem === "app" ? (audit?.operadorEmail ?? null) : null,
    auditId: origem === "app" ? (audit?.auditId ?? null) : null,
  }
}

/**
 * Entra na fila do WhatsApp? Espelha o índice parcial de pi.board_alteracao.
 * `dp_direto` fica de fora: o DP é quem recebe o alerta — o que ele mesmo fez vai
 * pro RELATÓRIO (é lá que mora o confronto do caso DETRAN), não pro WhatsApp dele.
 */
export function deveNotificar(a: AlteracaoClassificada): boolean {
  return a.mudou && a.severidade === "critica" && a.origem !== "motor" && a.origem !== "dp_direto"
}

/**
 * Agrupa alterações em AÇÕES DE NEGÓCIO. Uma convocação feita pelo app escreve ~12
 * colunas = 12 activity_logs = 1 linha em pi.audit_lancamentos. Sem isso, "1 mensagem
 * por alteração" manda 12 mensagens para um único clique do operador.
 *
 * Medido em 5 dias: 199 alterações notificáveis -> 50 mensagens (10/dia).
 * Alteração sem audit (edição direta no Monday) é sua própria ação — 1:1.
 */
export function agruparPorAcao(alteracoes: AlteracaoClassificada[]): AlteracaoClassificada[][] {
  const grupos = new Map<string, AlteracaoClassificada[]>()
  for (const a of alteracoes) {
    const chave = a.auditId ? `audit:${a.auditId}` : `log:${a.activityLogId}`
    if (!grupos.has(chave)) grupos.set(chave, [])
    grupos.get(chave)!.push(a)
  }
  return [...grupos.values()]
}
