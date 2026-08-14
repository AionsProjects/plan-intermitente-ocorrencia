// Board "Notas e Relatórios Caju" — UMA linha por pedido de CRÉDITO na Caju.
//
// Escopo (decisão do Isaac, 13/08): **só o crédito entra aqui**. O boleto continua onde já está,
// na Solicitação de Pagamento — é de lá que o DP paga, e duplicar o boleto num segundo board
// criaria duas listas de "pague isto".
//
// Por que o crédito precisou de board próprio: a Solicitação só é criada quando há BOLETO, e a
// maioria dos pontuais é só crédito — o pedido de crédito não tinha registro em lugar nenhum.
//
// O layout, porém, é o COMPLETO (incluindo `IDFINANC` e `Solicitação`, que só um boleto preenche),
// e `linhasNotaDeRelatorio` aceita as naturezas por parâmetro. Quando a parte do boleto for feita,
// ela reusa este mesmo builder e o mesmo desenho de colunas — sem um segundo formato pra manter.
//
// Uma linha por pedido porque é o que bate com o extrato da Caju.
//
// TODAS as colunas resolvidas por NOME pelo registry (`board_colunas`, que também guarda o TIPO),
// e o valor é formatado conforme o tipo real da coluna. Coluna que não existir no board é
// PULADA, não derruba a criação — o board é do Isaac, e um nome diferente do combinado não pode
// custar o registro do pagamento. Quem chama recebe `faltando[]` pra reportar.
import { query } from "../db.js"
import { criarItemComValores, garantirGrupoTitulo } from "../mensal/mondayEfeitos.js"
import { fmtDataIso, type DadosRelatorioPagamento } from "./relatorioPagamento.js"

/** Papel do board no registry — resolvido por papel, nunca por id chumbado (virada troca ids). */
export const PAPEL_BOARD_NOTAS = "notas_caju"

const norm = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

const r2 = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100

export interface LinhaNotaCaju {
  natureza: "CRÉDITO" | "BOLETO"
  /** "VR", "VT" ou "VR + VT" — no pontual um pedido carrega os dois. */
  beneficio: string
  orderId: string
  valor: number
  origem: "PONTUAL" | "MENSAL"
  contrato: string
  /** Vazio no mensal: lá o pedido é do CONTRATO, não de uma pessoa. */
  colaborador?: string | null
  chapa?: string | null
  dataInicio: string
  dataFim: string
  resumoUrl?: string | null
  notaUrl?: string | null
  relatorioUrl?: string | null
  pastaDriveUrl?: string | null
  idfinanc?: string | null
  solicitacaoUrl?: string | null
}

export interface ColunaRegistro {
  nome: string
  columnId: string
  tipo: string
}

/**
 * Nome do item: o que se lê na lista do board sem abrir nada.
 *
 * O BENEFÍCIO entra no nome porque um pagamento pode ter DOIS pedidos de crédito (o formato até
 * 13/08, e o mensal, separam VR de VT). Sem ele, as duas linhas do mesmo pagamento ficam
 * indistinguíveis na lista — foi o que aconteceu com o LUAN quando as colunas `Benefício` e
 * `Valor` saíram: dois itens com o mesmo nome, apontando para pedidos diferentes.
 */
export function montarNomeItemNota(l: LinhaNotaCaju): string {
  const quem = (l.colaborador ?? "").trim() || l.contrato
  const ben = l.beneficio.replace(/\s*\+\s*/g, "+")
  return `${l.natureza} ${ben} - ${quem.toUpperCase()} - ${fmtDataIso(l.dataInicio)}`
}

/** Título da gaveta: mês de CAIXA (quando o pagamento saiu), formato "AGOSTO/26" da Solicitação. */
const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]

export function tituloGrupoNotas(dataIso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(dataIso ?? ""))
  if (!m) return "SEM DATA"
  return `${MESES[Number(m[2]) - 1] ?? "?"}/${m[1]!.slice(-2)}`
}

/**
 * Nome da coluna no board -> valor da linha. A ordem é a de leitura do item.
 *
 * ENXUTO de propósito (decisão do Isaac, 14/08). O board tem UM trabalho: ele abre a linha, baixa
 * o PDF da nota e anexa na pasta do Drive. Tudo que não serve a isso saiu — o board nasceu com 17
 * colunas e virou 6.
 *
 * O que saiu e por quê:
 *  - `IDFINANC` e `Solicitação` só existem em BOLETO, e o board leva só CRÉDITO: nasciam vazias;
 *  - `Natureza` e `Origem` eram constantes na prática (CRÉDITO, e a origem se lê no nome);
 *  - `Pedido Caju`, `Valor`, `Benefício`, `Chapa`, `Data Fim` são conferência, não o trabalho —
 *    seguem no `/atividade`, no PDF do relatório e no `payload_resumo`;
 *  - `Status` sairia como controle manual, mas o Isaac filtra por DATA e pega as do dia;
 *  - `Relatório` (o PDF da automação) já está DENTRO da pasta que a linha aponta.
 *
 * `Data Início` fica porque é o que torna "pegar as do dia" possível — sem coluna de data, o
 * filtro por dia não existe (o grupo é por mês).
 */
function camposDaLinha(l: LinhaNotaCaju): Array<[string, unknown]> {
  return [
    ["Colaborador", l.colaborador],
    ["Contrato", l.contrato],
    ["Data Início", l.dataInicio],
    ["Nota de Débito", l.notaUrl],
    ["Resumo Caju", l.resumoUrl],
    ["Pasta Drive", l.pastaDriveUrl],
  ]
}

// Texto do link por coluna — link sem rótulo no Monday mostra a URL crua, ilegível na tabela.
const ROTULO_LINK: Record<string, string> = {
  "RESUMO CAJU": "Resumo",
  "NOTA DE DEBITO": "Nota de débito",
  "RELATORIO": "Relatório",
  "PASTA DRIVE": "Pasta",
  "SOLICITACAO": "Solicitação",
}

/**
 * Formata um valor conforme o TIPO real da coluna no board.
 *
 * O tipo vem do registry, não de palpite: se o Isaac criar "Natureza" como texto em vez de
 * status, o valor sai como texto e o item nasce igual — em vez de a API recusar o JSON inteiro
 * e o pagamento ficar sem registro.
 */
function formatarValor(nome: string, tipo: string, valor: unknown): unknown | undefined {
  if (valor == null || valor === "" || (typeof valor === "number" && !Number.isFinite(valor))) return undefined
  const s = String(valor)
  switch (tipo) {
    case "status":
    case "color":
      return { label: s }
    case "dropdown":
      // "VR + VT" em dropdown são DUAS labels, não uma — é o que permite filtrar por benefício.
      return { labels: s.split(" + ").map((x) => x.trim()).filter(Boolean) }
    case "link":
      return { url: s, text: ROTULO_LINK[norm(nome)] ?? "Abrir" }
    case "date":
      return { date: s.slice(0, 10) }
    case "numbers":
    case "numeric":
      return String(r2(valor))
    default:
      return s
  }
}

export interface ValoresItemNota {
  values: Record<string, unknown>
  /** Colunas do contrato que não existem no board — o que reportar pro dono do board. */
  faltando: string[]
}

export function montarValuesItemNota(l: LinhaNotaCaju, colunas: ColunaRegistro[]): ValoresItemNota {
  const porNome = new Map(colunas.map((c) => [norm(c.nome), c]))
  const values: Record<string, unknown> = {}
  const faltando: string[] = []
  for (const [nome, bruto] of camposDaLinha(l)) {
    const col = porNome.get(norm(nome))
    if (!col) {
      // Só reclama de coluna que TERIA conteúdo: campo vazio (ex.: Colaborador no mensal)
      // não é ausência de coluna que importe.
      if (bruto != null && bruto !== "") faltando.push(nome)
      continue
    }
    const v = formatarValor(nome, col.tipo, bruto)
    if (v !== undefined) values[col.columnId] = v
  }
  return { values, faltando }
}

/**
 * Naturezas que entram no board. Hoje só o CRÉDITO — o boleto vive na Solicitação de Pagamento.
 *
 * Existe como constante e não como `filter` chumbado porque a parte do boleto vai ser feita
 * depois, com este mesmo builder e o mesmo layout: ligar é trocar esta lista.
 */
export const NATUREZAS_NO_BOARD: Array<LinhaNotaCaju["natureza"]> = ["CRÉDITO"]

/**
 * Linhas do board a partir dos dados do relatório — fonte única: o PDF e as linhas do board
 * contam a MESMA história, com os mesmos valores por pedido.
 */
export function linhasNotaDeRelatorio(
  d: DadosRelatorioPagamento,
  extras: { relatorioUrl?: string | null; naturezas?: Array<LinhaNotaCaju["natureza"]> } = {},
): LinhaNotaCaju[] {
  const pessoa = d.pessoas.length === 1 ? d.pessoas[0] : null
  const querer = new Set(extras.naturezas ?? NATUREZAS_NO_BOARD)
  return d.pedidos.filter((p) => querer.has(p.natureza)).map((p) => ({
    natureza: p.natureza,
    beneficio: p.beneficio,
    orderId: p.orderId,
    valor: p.valor,
    origem: d.origem,
    contrato: d.contrato,
    colaborador: pessoa?.nome ?? null,
    chapa: pessoa?.chapa ?? null,
    dataInicio: d.dataInicio,
    dataFim: d.dataFim,
    resumoUrl: p.resumoUrl,
    notaUrl: p.notaUrl ?? null,
    relatorioUrl: extras.relatorioUrl ?? null,
    pastaDriveUrl: d.pastaDriveUrl ?? null,
    // IDFINANC é do lançamento financeiro, que só existe pro BOLETO.
    idfinanc: p.natureza === "BOLETO"
      ? [d.idfinancVR ? `VR ${d.idfinancVR}` : null, d.idfinancVT ? `VT ${d.idfinancVT}` : null]
          .filter(Boolean).join("; ") || null
      : null,
    solicitacaoUrl: p.natureza === "BOLETO" ? (d.solicitacaoUrl ?? null) : null,
  }))
}

export interface BoardNotas {
  boardId: string
  colunas: ColunaRegistro[]
}

/** Board + colunas do registry. `null` = board ainda não registrado (feature dorme, não quebra). */
export async function resolverBoardNotas(): Promise<BoardNotas | null> {
  const { rows } = await query<{ monday_board_id: string }>(
    `SELECT monday_board_id FROM boards
      WHERE papel = $1 AND ativo = true ORDER BY atualizado_em DESC LIMIT 1`,
    [PAPEL_BOARD_NOTAS],
  )
  const boardId = rows[0]?.monday_board_id
  if (!boardId) return null
  const { rows: cols } = await query<{ nome: string; column_id: string; tipo: string }>(
    `SELECT nome, column_id, tipo FROM board_colunas WHERE monday_board_id = $1`,
    [boardId],
  )
  return { boardId, colunas: cols.map((c) => ({ nome: c.nome, columnId: c.column_id, tipo: c.tipo })) }
}

export interface ResultadoNotas {
  criados: Array<{ orderId: string; itemId: string }>
  pulado?: "board_nao_registrado" | "sem_pedido"
  faltando: string[]
}

/**
 * Cria as linhas no board (ESCRITA REAL — chamar só de step gated).
 *
 * Board não registrado NÃO é erro: a automação segue pagando e a linha entra quando o board
 * existir (back-fill). Derrubar um pagamento por causa de um board de consulta seria trocar um
 * problema de registro por um problema de dinheiro.
 */
export async function registrarNotasCaju(linhas: LinhaNotaCaju[]): Promise<ResultadoNotas> {
  if (!linhas.length) return { criados: [], pulado: "sem_pedido", faltando: [] }
  const board = await resolverBoardNotas()
  if (!board) return { criados: [], pulado: "board_nao_registrado", faltando: [] }

  const criados: ResultadoNotas["criados"] = []
  const faltando = new Set<string>()
  // Gaveta por mês de caixa, uma vez por chamada (as linhas de um pagamento são do mesmo mês).
  const grupo = await garantirGrupoTitulo(board.boardId, tituloGrupoNotas(linhas[0]!.dataInicio))
  for (const l of linhas) {
    const { values, faltando: f } = montarValuesItemNota(l, board.colunas)
    for (const x of f) faltando.add(x)
    const { id } = await criarItemComValores(board.boardId, grupo, montarNomeItemNota(l), values)
    criados.push({ orderId: l.orderId, itemId: id })
  }
  return { criados, faltando: [...faltando] }
}

/** URL do item criado — pro artefato da execução. */
export function urlItemNota(boardId: string, itemId: string): string {
  return `https://contato-serv.monday.com/boards/${boardId}/pulses/${itemId}`
}
