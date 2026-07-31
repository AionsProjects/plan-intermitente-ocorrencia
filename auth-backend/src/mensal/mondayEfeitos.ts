// Efeitos Monday do mensal — porta dos nós do WF n8n (krRj3mXCM3F1CCYN):
//   "Mensal Executar Update Plan Contrato" / "Executar Updates Desconto" /
//   "Preparar+Criar Solicitação" / "Preparar Status OK" / "Preparar+Registrar Debito Controle Caju".
// Builders puros exportados p/ teste; executores usam mondayGraphql (token só no backend).
// ATENÇÃO: executores ESCREVEM em produção Monday. Só chamar via workflow gated (producao+ledger).
// Gaveta (grupo) dos boards Solicitação e Controle Caju = mês de CAIXA (quando o pagamento sai),
// não a competência — regra do DP confirmada em 31/07/2026. Ex.: competência AGOSTO paga em julho
// vai no grupo JULHO. A competência fica na COLUNA "Competência" (color_mks0yady) do item, e é ela
// que a antifraude consulta. Isso reverte o "fix" anterior (que usava a competência como gaveta):
// o comportamento do legado n8n (new Date()) estava certo.
import { mondayGraphql } from "../monday.js"
import type { DescontoUpdatePrevia, PessoaPreviaMensal, PlanUpdatePrevia } from "./types.js"

/**
 * Cria item com column_values num ÚNICO create_item (mesmo padrão dos WFs n8n
 * do pontual). O token precisa ter acesso de ESCRITA ao board — boards privados
 * (ex: Controle Saldo Caju) exigem que o usuário do MONDAY_TOKEN seja membro/owner;
 * caso contrário a API retorna 403 UserUnauthorized (visto em 11/07/2026 com token
 * de usuário não-membro). O pontual contorna usando o token de um owner do board.
 */
async function criarItemComValores(
  boardId: string,
  groupId: string,
  itemName: string,
  values: Record<string, unknown>,
): Promise<{ id: string }> {
  const criado = await mondayGraphql<{ create_item: { id: string } }>(
    `mutation($board:ID!,$group:String,$name:String!,$cols:JSON!){
       create_item(board_id:$board, group_id:$group, item_name:$name, column_values:$cols, create_labels_if_missing:true){ id }
     }`,
    { board: boardId, group: groupId, name: itemName, cols: JSON.stringify(values) },
  )
  return { id: criado.create_item.id }
}

export const BOARD_SOLICITACAO = "18393673859"
export const BOARD_DESCONTO = "18400981023"
export const BOARD_CONTROLE_CAJU = "7833600425"

const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100
const norm = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

// ---------------------------------------------------------------------------
// Plano — updates por item (linha). Colunas resolvidas por TÍTULO (registry do
// board da competência, snapshot.apoio.colunasPlano) com fallback nos ids legados.
// ---------------------------------------------------------------------------

const PLAN_COLS: Array<{ chave: keyof PlanUpdatePrevia; titulo: string; fallback: string }> = [
  { chave: "vtDia", titulo: "VT - Diário", fallback: "n_meros0" },
  { chave: "vrDia", titulo: "VR - Unitário", fallback: "vr___saldo" },
  { chave: "vrMensal", titulo: "VR - MENSAL", fallback: "numeric_mktdzme6" },
  { chave: "diasVT", titulo: "Dias Úteis/Mês - VT", fallback: "numeric2" },
  { chave: "diasVR", titulo: "Dias Úteis/Mês - VR", fallback: "numeric21" },
  { chave: "creditoVR", titulo: "CREDITO CAJU", fallback: "numeric_mm0346q0" },
  { chave: "creditoVT", titulo: "CREDITO VT", fallback: "numeric_mm031cg7" },
]

export function montarValuesPlanUpdate(
  u: PlanUpdatePrevia,
  colunasPlano: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of PLAN_COLS) {
    const id = colunasPlano?.[norm(c.titulo)] ?? c.fallback
    out[id] = String(r2(Number(u[c.chave])))
  }
  return out
}

/** Mutation em lote (aliases) — mesmo formato do n8n. */
export function montarMutationPlanUpdates(
  boardId: string,
  updates: PlanUpdatePrevia[],
  colunasPlano: Record<string, string> | undefined,
): string | null {
  if (!updates.length) return null
  const aliases = updates.map((u, i) =>
    `p${i}: change_multiple_column_values(board_id: ${boardId}, item_id: ${u.itemId}, ` +
    `column_values: ${JSON.stringify(JSON.stringify(montarValuesPlanUpdate(u, colunasPlano)))}, create_labels_if_missing: true) { id }`,
  ).join("\n")
  return `mutation AtualizarPlanMensal {\n${aliases}\n}`
}

// ---------------------------------------------------------------------------
// Desconto FIFO — ids de coluna FIXOS do board 18400981023 (iguais ao n8n).
// ---------------------------------------------------------------------------

const D_COLS = {
  residualVR: "numeric_mm0r1691",
  residualVT: "numeric_mm0rtwwg",
  descontadoVR: "numeric_mm0rqy6z",
  descontadoVT: "numeric_mm0r6cn0",
  status: "color_mm0r8mjr",
} as const

export function montarValuesDesconto(u: DescontoUpdatePrevia): Record<string, unknown> {
  return {
    [D_COLS.residualVR]: String(r2(u.residualVR)),
    [D_COLS.residualVT]: String(r2(u.residualVT)),
    [D_COLS.descontadoVR]: String(r2(u.descontadoVR)),
    [D_COLS.descontadoVT]: String(r2(u.descontadoVT)),
    [D_COLS.status]: { label: u.status },
  }
}

export function montarMutationDescontos(updates: DescontoUpdatePrevia[]): string | null {
  if (!updates.length) return null
  const aliases = updates.map((u, i) =>
    `u${i}: change_multiple_column_values(board_id: ${BOARD_DESCONTO}, item_id: ${u.id}, ` +
    `column_values: ${JSON.stringify(JSON.stringify(montarValuesDesconto(u)))}, create_labels_if_missing: true) { id }`,
  ).join("\n")
  return `mutation AtualizarDescontosMensal {\n${aliases}\n}`
}

// ---------------------------------------------------------------------------
// Solicitação de Pagamento — porta do "Mensal Preparar Solicitação".
// ---------------------------------------------------------------------------

export interface SolicitacaoMensalInput {
  contrato: string
  nomePrefixo?: string // ex "TESTE - " (runs sandbox) — só afeta o NOME do item, não as colunas
  competenciaLabel: string // ex "JULHO"
  anoComp: number
  totais: { vr: number; vt: number; credito: number; pix: number }
  pessoas: PessoaPreviaMensal[]
  idVR?: string | null
  idVT?: string | null
  pedidoCreditoId?: string | null
  pedidoPixId?: string | null
  summaryCredito?: string
  summaryPix?: string
  planBoardId: string
  dataIso: string // hoje (passar de fora — workflow não pode usar new Date())
}

export function montarResumoSolicitacao(inp: SolicitacaoMensalInput): string {
  const pessoasResumo = inp.pessoas.map((p, idx) => {
    const valorCredito = r2((p.creditoVR || 0) + (p.creditoVT || 0))
    const valorPix = r2((p.pixVR || 0) + (p.pixVT || 0))
    return `${String(idx + 1).padStart(2, "0")}. ${p.nome} | Chapa: ${p.chapa || "-"} | CPF: ${p.cpf || "-"}` +
      ` | VR: R$ ${r2(p.liquidoVR || 0)} | VT: R$ ${r2(p.liquidoVT || 0)}` +
      ` | Crédito: R$ ${valorCredito} | PIX: R$ ${valorPix}` +
      ` | Plan: ${(p.itemIds ?? [p.itemId]).join(", ") || "-"}`
  })
  return [
    `MENSAL AGRUPADO - ${inp.contrato} - ${inp.competenciaLabel}/${inp.anoComp}`,
    `Colaboradores: ${inp.pessoas.length}`,
    `VR: R$ ${r2(inp.totais.vr)}`,
    `VT: R$ ${r2(inp.totais.vt)}`,
    `Crédito Caju: R$ ${r2(inp.totais.credito)}`,
    `PIX: R$ ${r2(inp.totais.pix)}`,
    `Pedido Crédito: ${inp.pedidoCreditoId || "-"}`,
    `Pedido PIX: ${inp.pedidoPixId || "-"}`,
    `RM idVR: ${inp.idVR || "-"} | idVT: ${inp.idVT || "-"}`,
    "",
    "INTERMITENTES INCLUSOS:",
    ...(pessoasResumo.length ? pessoasResumo : ["Nenhum colaborador listado."]),
  ].join("\n")
}

export function montarValuesSolicitacao(inp: SolicitacaoMensalInput): Record<string, unknown> {
  const labelsPgto: string[] = []
  if ((inp.totais.vr || 0) > 0) labelsPgto.push("CAJU")
  if ((inp.totais.vt || 0) > 0) labelsPgto.push("CAJU VT")
  return {
    dropdown_mkwhxxs2: { labels: labelsPgto.length ? labelsPgto : ["CAJU"] },
    dropdown_mkretdvv: { labels: [inp.contrato] },
    date_mkrer5tv: { date: inp.dataIso },
    status: { label: "NÃO INICIADO" },
    color_mkref5wt: { label: "MENSAL" },
    color_mks0yady: { label: inp.competenciaLabel },
    numeric_mkrek29b: String(r2(inp.totais.vr)),
    numeric_mkwhk2xr: String(r2(inp.totais.vt)),
    text_mkrenhm: String(inp.idVR || ""),
    text_mkwhg4dn: String(inp.idVT || ""),
    text_mm1zyhcw: String(inp.pedidoPixId || inp.pedidoCreditoId || ""),
    text_mm395p8s: String(inp.summaryPix || inp.summaryCredito || ""),
    link_mkre40qn: { url: `https://contato-serv.monday.com/boards/${inp.planBoardId}`, text: "Plan Intermitentes" },
    long_text_mkre1qa0: { text: montarResumoSolicitacao(inp) },
  }
}

// ---------------------------------------------------------------------------
// Controle Caju — porta do "Preparar Debito Controle Caju" (grupo via snapshot).
// ---------------------------------------------------------------------------

const CAJU_SALDO_COLS = ["n_meros__1", "n_meros5__1", "n_meros9__1"] as const

function pnum(v: unknown): number {
  if (v == null || v === "") return 0
  const s = String(v).replace(/[R$\s]/g, "").trim()
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", ".")) || 0
  return Number(s) || 0
}

export interface ItemSaldoCaju {
  column_values: Array<{ id: string; text: string | null }>
}

/** Saldo final do último item preenchido do grupo: entrada(n_meros__1)+aporte(n_meros5__1)-débito(n_meros9__1). */
export function saldoAnteriorControleCaju(items: ItemSaldoCaju[]): number {
  const col = (it: ItemSaldoCaju, id: string) => it.column_values.find((c) => c.id === id)?.text ?? ""
  const preenchido = [...items].reverse().find((it) => CAJU_SALDO_COLS.some((id) => col(it, id)))
  if (!preenchido) return 0
  return r2(pnum(col(preenchido, "n_meros__1")) + pnum(col(preenchido, "n_meros5__1")) - pnum(col(preenchido, "n_meros9__1")))
}

export function montarNomeDebitoControle(
  contrato: string,
  competenciaLabel: string,
  anoComp: number,
  pedidoCreditoId?: string | null,
): string {
  return `MENSAL - ${contrato} - ${competenciaLabel}/${anoComp}${pedidoCreditoId ? ` - ${pedidoCreditoId}` : ""}`
}

export function montarValuesDebitoControle(
  contrato: string,
  saldoAnterior: number,
  totalCredito: number,
  dataIso: string,
): Record<string, unknown> {
  return {
    color_mkpef3mp: { label: contrato },
    n_meros__1: String(r2(saldoAnterior)),
    n_meros9__1: String(r2(totalCredito)),
    dup__of_data_do_cr_dito__1: { date: dataIso },
    status3__1: { label: "INTERMITENTE" },
  }
}

// ---------------------------------------------------------------------------
// Executores (ESCRITA REAL — só via workflow gated).
// ---------------------------------------------------------------------------

export async function executarUpdatesPlano(
  boardId: string,
  updates: PlanUpdatePrevia[],
  colunasPlano: Record<string, string> | undefined,
): Promise<number> {
  const mutation = montarMutationPlanUpdates(boardId, updates, colunasPlano)
  if (!mutation) return 0
  await mondayGraphql(mutation)
  return updates.length
}

export async function executarUpdatesDescontos(updates: DescontoUpdatePrevia[]): Promise<number> {
  const mutation = montarMutationDescontos(updates)
  if (!mutation) return 0
  await mondayGraphql(mutation)
  return updates.length
}

const MESES_CAIXA = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"] as const

const normTitulo = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

/** Título da gaveta de caixa de cada board (formatos diferentes, herdados do legado). */
export function tituloGrupoCaixa(board: "solicitacao" | "controle", data = new Date()): string {
  const mes = MESES_CAIXA[data.getMonth()]!
  const ano = data.getFullYear()
  return board === "solicitacao" ? `${mes}/${String(ano).slice(-2)}` : `${mes} - ${ano}`
}

/**
 * Garante a gaveta do mês de CAIXA e devolve o group_id — acha por título (tolerante a
 * acento/caixa/espaço) e cria se faltar, como o legado n8n fazia. A prévia é read-only, então
 * quem cria é a execução; sem isso, virar o mês derrubava o run com grupo_ausente_no_snapshot.
 */
export async function garantirGrupoCaixa(
  board: "solicitacao" | "controle",
  data = new Date(),
): Promise<string> {
  const boardId = board === "solicitacao" ? BOARD_SOLICITACAO : BOARD_CONTROLE_CAJU
  const titulo = tituloGrupoCaixa(board, data)
  const d = await mondayGraphql<{ boards: Array<{ groups: Array<{ id: string; title: string }> }> }>(
    `query($b:[ID!]){ boards(ids:$b){ groups{ id title } } }`,
    { b: [boardId] },
  )
  const achado = d.boards?.[0]?.groups?.find((g) => normTitulo(g.title) === normTitulo(titulo))
  if (achado) return achado.id
  const criado = await mondayGraphql<{ create_group: { id: string } }>(
    `mutation($b:ID!,$t:String!){ create_group(board_id:$b, group_name:$t){ id } }`,
    { b: boardId, t: titulo },
  )
  return criado.create_group.id
}

export async function criarSolicitacaoMensal(
  inp: SolicitacaoMensalInput,
  grupoSolicitacao: string,
): Promise<{ id: string; url: string }> {
  const { id } = await criarItemComValores(
    BOARD_SOLICITACAO, grupoSolicitacao, `${inp.nomePrefixo ?? ""}${inp.contrato}`, montarValuesSolicitacao(inp),
  )
  return { id, url: `https://contato-serv.monday.com/boards/${BOARD_SOLICITACAO}/pulses/${id}` }
}

export async function setarStatusAutomacaoOk(solicitacaoId: string): Promise<void> {
  await mondayGraphql(
    `mutation($item:ID!){
       change_simple_column_value(board_id: ${BOARD_SOLICITACAO}, item_id: $item, column_id: "status", value: "AUTOMAÇÃO - OK") { id }
     }`,
    { item: solicitacaoId },
  )
}

export async function registrarDebitoControleCaju(inp: {
  grupoControleCaju: string
  contrato: string
  nomePrefixo?: string // "TESTE - " nos runs sandbox — só o nome do item
  competenciaLabel: string
  anoComp: number
  totalCredito: number
  pedidoCreditoId?: string | null
  dataIso: string
}): Promise<{ id: string; saldoAnterior: number } | { pulado: true; motivo: string }> {
  if (r2(inp.totalCredito) <= 0) return { pulado: true, motivo: "sem_credito_contrato" }
  const d = await mondayGraphql<{ boards: Array<{ groups: Array<{ items_page: { items: ItemSaldoCaju[] } }> }> }>(
    `query($b:[ID!],$g:[String!]){
       boards(ids:$b){ groups(ids:$g){ items_page(limit:500){ items{ column_values(ids:${JSON.stringify([...CAJU_SALDO_COLS])}){ id text } } } } }
     }`,
    { b: [BOARD_CONTROLE_CAJU], g: [inp.grupoControleCaju] },
  )
  const items = d.boards?.[0]?.groups?.[0]?.items_page?.items ?? []
  const saldoAnterior = saldoAnteriorControleCaju(items)
  const cr = await criarItemComValores(
    BOARD_CONTROLE_CAJU,
    inp.grupoControleCaju,
    `${inp.nomePrefixo ?? ""}${montarNomeDebitoControle(inp.contrato, inp.competenciaLabel, inp.anoComp, inp.pedidoCreditoId)}`,
    montarValuesDebitoControle(inp.contrato, saldoAnterior, inp.totalCredito, inp.dataIso),
  )
  return { id: cr.id, saldoAnterior }
}
