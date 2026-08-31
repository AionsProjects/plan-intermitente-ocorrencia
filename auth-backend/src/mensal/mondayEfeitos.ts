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
import {
  BENEFICIOS_CAJU,
  idPedidoParaSolicitacao,
  idsPedidoParaSolicitacao,
  juntarIdsCaju,
  juntarSummariesCaju,
  summaryUrlCaju,
  type BeneficioCaju,
  type PedidosCajuIds,
} from "../clients/caju.js"
import { caixaEfetiva, gruposBeneficio, sufixoGrupo } from "../domain/splitBeneficio.js"
import type { DescontoUpdatePrevia, PessoaPreviaMensal, PlanUpdatePrevia } from "./types.js"

/**
 * Cria item com column_values num ÚNICO create_item (mesmo padrão dos WFs n8n
 * do pontual). O token precisa ter acesso de ESCRITA ao board — boards privados
 * (ex: Controle Saldo Caju) exigem que o usuário do MONDAY_TOKEN seja membro/owner;
 * caso contrário a API retorna 403 UserUnauthorized (visto em 11/07/2026 com token
 * de usuário não-membro). O pontual contorna usando o token de um owner do board.
 */
export async function criarItemComValores(
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
    const v = u[c.chave]
    // null/undefined LIMPA a célula (string vazia). Antes ia sempre por Number(), então um
    // campo ausente virava "NaN" no board — silenciosamente. Usado pelo VR - Unitário, que
    // fica vazio quando a regra do contrato é mensal.
    out[id] = v == null ? "" : String(r2(Number(v)))
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

export interface SolicitacaoMensalInput extends PedidosCajuIds {
  contrato: string
  nomePrefixo?: string // ex "TESTE - " (runs sandbox) — só afeta o NOME do item, não as colunas
  competenciaLabel: string // ex "JULHO"
  anoComp: number
  totais: { vr: number; vt: number; credito: number; pix: number }
  pessoas: PessoaPreviaMensal[]
  /** IDFINANC do RM, evento VR — vai em `text_mkrenhm` ("ID CAJU"), que é RM e não Caju. */
  idVR?: string | null
  /** IDFINANC do RM, evento VT — vai em `text_mkwhg4dn` ("ID CAJU VT"). Também RM. */
  idVT?: string | null
  planBoardId: string
  dataIso: string // hoje (passar de fora — workflow não pode usar new Date())
  /** Gaveta do pagamento (YYYY-MM). Decide o grupo do board E o formato (junto × separado por
   *  benefício, ver domain/splitBeneficio.ts). Ausente = mês de `dataIso`, igual ao grupo. */
  caixa?: string
}

export function montarResumoSolicitacao(inp: SolicitacaoMensalInput, linha: BeneficioCaju[]): string {
  const rotulo = sufixoGrupo(linha)
  const pessoasResumo = inp.pessoas.map((p, idx) => {
    const valorCredito = r2((p.creditoVR || 0) + (p.creditoVT || 0))
    const valorPix = r2((p.pixVR || 0) + (p.pixVT || 0))
    return `${String(idx + 1).padStart(2, "0")}. ${p.nome} | Chapa: ${p.chapa || "-"} | CPF: ${p.cpf || "-"}` +
      ` | VR: R$ ${r2(p.liquidoVR || 0)} | VT: R$ ${r2(p.liquidoVT || 0)}` +
      ` | Crédito: R$ ${valorCredito} | PIX: R$ ${valorPix}` +
      ` | Plan: ${(p.itemIds ?? [p.itemId]).join(", ") || "-"}`
  })
  return [
    // O benefício entra no título porque o board passou a ter DUAS linhas por contrato, e o resumo
    // é o que distingue uma da outra quando o DP abre o item. Na linha junta (até 08/2026) não há
    // o que distinguir e o título fica como sempre foi.
    `MENSAL AGRUPADO${rotulo ? ` ${rotulo}` : ""} - ${inp.contrato} - ${inp.competenciaLabel}/${inp.anoComp}`,
    `Colaboradores: ${inp.pessoas.length}`,
    `VR: R$ ${r2(inp.totais.vr)}`,
    `VT: R$ ${r2(inp.totais.vt)}`,
    `Crédito Caju: R$ ${r2(inp.totais.credito)}`,
    `PIX: R$ ${r2(inp.totais.pix)}`,
    // Pedido separado por benefício desde 08/2026 — os 4 ids ficam listados aqui porque a coluna
    // só carrega os de boleto.
    `Pedido Crédito VR: ${inp.pedidoCreditoVR || "-"} | VT: ${inp.pedidoCreditoVT || "-"}`,
    `Pedido PIX VR: ${inp.pedidoPixVR || "-"} | VT: ${inp.pedidoPixVT || "-"}`,
    `RM idVR: ${inp.idVR || "-"} | idVT: ${inp.idVT || "-"}`,
    "",
    "INTERMITENTES INCLUSOS:",
    ...(pessoasResumo.length ? pessoasResumo : ["Nenhum colaborador listado."]),
  ].join("\n")
}

/**
 * VALOR CAJU / VALOR CAJU VT são a perna Monday da conferência de três pernas, então têm que estar
 * na MESMA base do RM e do boleto: o PIX, ou seja, líquido JÁ DESCONTADO o crédito.
 *
 * `totais.vr`/`totais.vt` somam `liquidoVR`/`liquidoVT` — líquido do desconto FIFO mas ANTES do
 * crédito. Usá-los aqui fazia o Monday divergir do RM exatamente pelo valor do crédito, em todo
 * contrato e todo mês (DETRAN 08/2026: board 4.481,05 × IDFINANC 24096 = 4.032,70 = 448,35 de
 * crédito). O DP corrigia à mão. Confirmado pelo próprio board: SEDUC ESCOLA e SEDUC INTERIOR
 * estavam com o pixVR cravado.
 *
 * O crédito não some da escrituração — ele fica no board Controle Caju e no resumo.
 */
function pixPorBeneficio(inp: SolicitacaoMensalInput): { vr: number; vt: number } {
  return {
    vr: r2(inp.pessoas.reduce((t, p) => t + (p.pixVR || 0), 0)),
    vt: r2(inp.pessoas.reduce((t, p) => t + (p.pixVT || 0), 0)),
  }
}

/** Coluna e label de cada benefício no board de Solicitação. Uma linha só preenche as suas. */
const PERFIL_BENEFICIO = {
  VR: { labelPgto: "CAJU", colValor: "numeric_mkrek29b", colIdfinanc: "text_mkrenhm" },
  VT: { labelPgto: "CAJU VT", colValor: "numeric_mkwhk2xr", colIdfinanc: "text_mkwhg4dn" },
} as const satisfies Record<BeneficioCaju, { labelPgto: string; colValor: string; colIdfinanc: string }>

/** Benefício apurado (não o que sobrou pro boleto): contrato cujo VR coube inteiro no crédito tem
 *  VALOR CAJU 0,00 e ainda assim é um pagamento de VR — sumiria do board se o critério fosse o PIX. */
function apurado(inp: SolicitacaoMensalInput, b: BeneficioCaju): boolean {
  return ((b === "VR" ? inp.totais.vr : inp.totais.vt) || 0) > 0
}

/**
 * As LINHAS que este pagamento gera no board, cada uma com os benefícios que ela carrega.
 *
 * Da gaveta de 09/2026 em diante: uma linha por benefício apurado (`[["VR"],["VT"]]`), e contrato
 * só com VR gera uma linha só — nada de item zerado. Até 08/2026: UMA linha com os dois
 * (`[["VR","VT"]]`), formato em que agosto foi pago e conferido. Ver `domain/splitBeneficio.ts`.
 *
 * A linha junta sai mesmo sem benefício apurado — é o comportamento que o board tem hoje (label
 * cai pra "CAJU"), e o pagamento existir sem linha é pior que uma linha zerada.
 */
export function linhasDaSolicitacao(inp: SolicitacaoMensalInput): BeneficioCaju[][] {
  const grupos = gruposBeneficio(caixaEfetiva(inp.caixa, inp.dataIso))
  // Junto: uma linha só, sempre — é o item único que o board tem até agosto/2026.
  if (grupos.length === 1) return grupos
  return grupos.filter((grupo) => apurado(inp, grupo[0]!))
}

/**
 * Values de UMA linha do board de Solicitação — a do benefício pedido.
 *
 * Desde 08/2026 o pedido na Caju é separado (um de VR, um de VT) e o board acompanhou: UMA LINHA
 * POR BENEFÍCIO, em vez de um item com as duas colunas de valor, duas labels de tipo pgto e os
 * dois ids de pedido dividindo a mesma célula. Cada linha leva o seu id, o seu summary, o seu
 * IDFINANC e o seu valor; as colunas do outro benefício ficam de fora do payload.
 */
export function montarValuesSolicitacao(
  inp: SolicitacaoMensalInput,
  linha: BeneficioCaju[],
): Record<string, unknown> {
  if (linha.length !== 1) return montarValuesSolicitacaoJunta(inp)
  const beneficio = linha[0]!
  const pix = pixPorBeneficio(inp)
  const perfil = PERFIL_BENEFICIO[beneficio]
  const idPedido = idPedidoParaSolicitacao(inp, beneficio)
  return {
    dropdown_mkwhxxs2: { labels: [perfil.labelPgto] },
    dropdown_mkretdvv: { labels: [inp.contrato] },
    date_mkrer5tv: { date: inp.dataIso },
    status: { label: "NÃO INICIADO" },
    color_mkref5wt: { label: "MENSAL" },
    color_mks0yady: { label: inp.competenciaLabel },
    [perfil.colValor]: String(beneficio === "VR" ? pix.vr : pix.vt),
    // IDFINANC do RM: continua podendo ser lista ("24007; 24009") — o RM cria um PFINANCEIRO por
    // seção de funcionário. O que deixou de ser lista é o id do PEDIDO Caju.
    [perfil.colIdfinanc]: String((beneficio === "VR" ? inp.idVR : inp.idVT) || ""),
    text_mm1zyhcw: idPedido ?? "",
    text_mm395p8s: idPedido ? summaryUrlCaju(idPedido) : "",
    link_mkre40qn: { url: `https://contato-serv.monday.com/boards/${inp.planBoardId}`, text: "Plan Intermitentes" },
    long_text_mkre1qa0: { text: montarResumoSolicitacao(inp, [beneficio]) },
  }
}

/**
 * Formato ATÉ a gaveta de 08/2026: UM item com as duas colunas de valor, as duas labels de tipo
 * pgto e os dois ids de pedido dividindo a mesma célula por `"; "`.
 *
 * Preservado byte a byte de propósito — é como agosto foi pago e conferido, e retomada de item
 * antigo tem de reproduzir o formato do mês dele. Não estender: benefício novo entra no formato
 * separado, este aqui só envelhece.
 */
function montarValuesSolicitacaoJunta(inp: SolicitacaoMensalInput): Record<string, unknown> {
  const pix = pixPorBeneficio(inp)
  const labelsPgto: string[] = []
  if (apurado(inp, "VR")) labelsPgto.push(PERFIL_BENEFICIO.VR.labelPgto)
  if (apurado(inp, "VT")) labelsPgto.push(PERFIL_BENEFICIO.VT.labelPgto)
  const idsPedido = idsPedidoParaSolicitacao(inp)
  return {
    dropdown_mkwhxxs2: { labels: labelsPgto.length ? labelsPgto : [PERFIL_BENEFICIO.VR.labelPgto] },
    dropdown_mkretdvv: { labels: [inp.contrato] },
    date_mkrer5tv: { date: inp.dataIso },
    status: { label: "NÃO INICIADO" },
    color_mkref5wt: { label: "MENSAL" },
    color_mks0yady: { label: inp.competenciaLabel },
    numeric_mkrek29b: String(pix.vr),
    numeric_mkwhk2xr: String(pix.vt),
    text_mkrenhm: String(inp.idVR || ""),
    text_mkwhg4dn: String(inp.idVT || ""),
    text_mm1zyhcw: juntarIdsCaju(idsPedido),
    text_mm395p8s: juntarSummariesCaju(idsPedido),
    link_mkre40qn: { url: `https://contato-serv.monday.com/boards/${inp.planBoardId}`, text: "Plan Intermitentes" },
    long_text_mkre1qa0: { text: montarResumoSolicitacao(inp, BENEFICIOS_CAJU.slice()) },
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

/** "YYYY-MM" -> Date local no dia 1 (evita o shift de fuso do parse ISO). */
function dataDoCaixa(caixa?: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(caixa ?? "")
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date()
}

/** Título da gaveta de caixa de cada board (formatos diferentes, herdados do legado). */
export function tituloGrupoCaixa(board: "solicitacao" | "controle", caixa?: string): string {
  const data = dataDoCaixa(caixa)
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
  caixa?: string,
): Promise<string> {
  const boardId = board === "solicitacao" ? BOARD_SOLICITACAO : BOARD_CONTROLE_CAJU
  return garantirGrupoTitulo(boardId, tituloGrupoCaixa(board, caixa))
}

/** Acha o grupo por título (tolerante a acento/caixa/espaço) e cria se faltar. */
export async function garantirGrupoTitulo(boardId: string, titulo: string): Promise<string> {
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

/** Nome do item do mensal: contrato + benefício quando são duas linhas; só o contrato na linha
 *  junta (até 08/2026), onde o sufixo não distinguiria nada. */
export function montarNomeSolicitacaoMensal(inp: SolicitacaoMensalInput, linha: BeneficioCaju[]): string {
  const rotulo = sufixoGrupo(linha)
  return `${inp.nomePrefixo ?? ""}${inp.contrato}${rotulo ? ` - ${rotulo}` : ""}`
}

export interface LinhaSolicitacaoCriada {
  /** Benefícios que ESTA linha carrega: um só no formato separado, os dois na linha junta. */
  beneficios: BeneficioCaju[]
  id: string
  url: string
}

/** Rótulo da linha para ledger/artefato: "VR", "VT" ou "VR+VT" na linha junta. */
export function rotuloLinha(linha: BeneficioCaju[]): string {
  return linha.join("+") || "VR+VT"
}

/**
 * Cria UMA linha por benefício apurado. Contrato só com VR gera uma linha só — nada de item
 * zerado no board.
 *
 * Sequencial de propósito: são no máximo dois create_item, e o Monday responde 200 com `errors`
 * dentro em escrita concorrente. Perder a segunda linha em silêncio num fluxo #dinheiro-real
 * custa mais que os ~300ms economizados.
 */
export async function criarSolicitacaoMensal(
  inp: SolicitacaoMensalInput,
  grupoSolicitacao: string,
): Promise<LinhaSolicitacaoCriada[]> {
  const criadas: LinhaSolicitacaoCriada[] = []
  for (const linha of linhasDaSolicitacao(inp)) {
    const { id } = await criarItemComValores(
      BOARD_SOLICITACAO,
      grupoSolicitacao,
      montarNomeSolicitacaoMensal(inp, linha),
      montarValuesSolicitacao(inp, linha),
    )
    criadas.push({ beneficios: linha, id, url: `https://contato-serv.monday.com/boards/${BOARD_SOLICITACAO}/pulses/${id}` })
  }
  return criadas
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
  /** Nome COMPLETO do item — o pontual usa "INTERMITENTE - {nome} ({data})" (WF5-fiel). */
  nomeItem?: string
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
    inp.nomeItem ?? `${inp.nomePrefixo ?? ""}${montarNomeDebitoControle(inp.contrato, inp.competenciaLabel, inp.anoComp, inp.pedidoCreditoId)}`,
    montarValuesDebitoControle(inp.contrato, saldoAnterior, inp.totalCredito, inp.dataIso),
  )
  return { id: cr.id, saldoAnterior }
}
