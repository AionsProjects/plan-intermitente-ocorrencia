import { query } from "../db.js"
import { contratosMensalJaExecutados } from "../jobs/repo.js"
import { mondayGraphql } from "../monday.js"
import type {
  ContratoPreviaMensal,
  PapelMensal,
  PessoaPreviaMensal,
  SnapshotPreviaMensal,
} from "./types.js"
import { calcularMensal, normMensal, type ConvocacaoMensal, type DescontoMensal,
  type FeriadoMensal, type RegraBeneficioMensal } from "./calculo.js"
import { lerReservasVivas, type ReservasVivas } from "../pontual/repo.js"

const BOARD_SOLICITACOES = "18393673859"
const BOARD_PARAMETROS = "18413870370"
const BOARD_FERIADOS = "18415442661"
const BOARD_DESCONTOS = "18400981023"
const BOARD_CONTROLE_CAJU = "7833600425"

interface BoardRegistry { monday_board_id: string; competencia: string | null }
interface RawItem {
  id: string
  name: string
  column_values: Array<{ id: string; text: string | null; column?: { title: string } }>
}

function norm(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim()
}

function valor(item: RawItem, titulo: string): string {
  const alvo = norm(titulo)
  return item.column_values.find((c) => norm(c.column?.title ?? c.id) === alvo)?.text?.trim() ?? ""
}

function dataIso(v: string): string {
  return v.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? ""
}

async function resolverBoard(papel: PapelMensal): Promise<BoardRegistry> {
  const { rows } = await query<BoardRegistry>(
    `SELECT monday_board_id,competencia FROM boards
      WHERE papel=$1 AND ativo=true ORDER BY atualizado_em DESC LIMIT 1`, [papel],
  )
  const board = rows[0]
  if (!board?.competencia) throw new Error("board_mensal_nao_encontrado")
  return board
}

async function resolverGrupoMensal(boardId: string): Promise<string> {
  const { rows } = await query<{ group_id: string }>(
    `SELECT group_id FROM board_grupos
      WHERE monday_board_id=$1 AND upper(titulo)='MENSAL' LIMIT 1`, [boardId],
  )
  if (!rows[0]?.group_id) throw new Error("grupo_mensal_nao_encontrado")
  return rows[0].group_id
}

async function lerPlano(boardId: string, groupId: string): Promise<{
  items: RawItem[]
  colunas: Record<string, string>
}> {
  const d = await mondayGraphql<{ boards: Array<{
    columns: Array<{ id: string; title: string }>
    groups: Array<{ items_page: { items: RawItem[] } }>
  }> }>(
    `query($b:[ID!],$g:[String!]){
      boards(ids:$b){
        columns{ id title }
        groups(ids:$g){ items_page(limit:500){
          items{ id name column_values{ id text column{ title } } }
        } }
      }
    }`, { b: [boardId], g: [groupId] },
  )
  const colunas: Record<string, string> = {}
  for (const c of d.boards?.[0]?.columns ?? []) colunas[norm(c.title)] = c.id
  return { items: d.boards?.[0]?.groups?.[0]?.items_page?.items ?? [], colunas }
}

async function lerApoio(competencia: string, caixa: string): Promise<{
  solicitacoesProcessadas: string[]
  parametros: number
  feriados: number
  descontos: number
  grupoControle: string | null
  grupoSolicitacao: string | null
  valoresItems: RawItem[]
  feriadosItems: RawItem[]
  descontosItems: RawItem[]
  /** Reserva de FIFO prometida a pré-pagamentos pontuais vivos, por item de desconto. */
  reservasVivas: ReservasVivas
}> {
  // A competência em si não resolve gaveta nenhuma aqui — ela vive na COLUNA "Competência" do
  // item (gravada em mondayEfeitos) e na chave do ledger. Aqui só interessa o mês de CAIXA.
  const meses = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]
  // GAVETA (grupo) = mês de CAIXA, quando o pagamento sai — NÃO a competência.
  // Regra do DP (31/07/2026): competência AGOSTO paga em julho vai no grupo JULHO dos boards
  // Solicitação e Controle Caju. A competência em si fica na COLUNA "Competência" do item.
  // O caixa é ESCOLHIDO pelo operador (default = mês atual) — pagamento retroativo precisa cair
  // na gaveta do mês em que o dinheiro saiu, não na do dia em que a tela foi aberta.
  const [anoCaixa, mesCaixa] = caixa.split("-").map(Number)
  const labelCaixa = meses[(mesCaixa || 1) - 1]!
  const solicit = await mondayGraphql<{
    solicit: Array<{ groups: Array<{ id: string; title: string; items_page: { items: RawItem[] } }> }>
    parametros: Array<{ items_page: { items: RawItem[] } }>
    feriados: Array<{ items_page: { items: RawItem[] } }>
    descontos: Array<{ groups: Array<{ items_page: { items: RawItem[] } }> }>
    controle: Array<{ groups: Array<{ id: string; title: string }> }>
  }>(
    `query ApoioMensal {
      solicit: boards(ids:[${BOARD_SOLICITACOES}]) { groups { id title items_page(limit:500) {
        items { id name column_values { id text column { title } } }
      } } }
      parametros: boards(ids:[${BOARD_PARAMETROS}]) { items_page(limit:500) { items { id name column_values { id text column { title } } } } }
      feriados: boards(ids:[${BOARD_FERIADOS}]) { items_page(limit:200) { items { id name column_values { id text column { title } } } } }
      descontos: boards(ids:[${BOARD_DESCONTOS}]) { groups(ids:["group_mm0rmjs3"]) {
        items_page(limit:500) { items { id name column_values { id text column { title } } } }
      } }
      controle: boards(ids:[${BOARD_CONTROLE_CAJU}]) { groups { id title } }
    }`,
  )
  const grupoSolic = solicit.solicit?.[0]?.groups?.find(
    (g) => norm(g.title) === norm(`${labelCaixa}/${String(anoCaixa).slice(-2)}`),
  )
  // ANTIFRAUDE: "esse contrato já foi pago nessa competência?" é respondido pela COLUNA
  // "Competência" do item, em QUALQUER grupo — não por onde o item foi arquivado. Sem isso,
  // trocar a gaveta pra caixa cegaria a proteção e abriria porta pra pagamento duplicado
  // (ex.: pagar SEMSA numa rodada e o resto na outra). O board é anual
  // ("SOLICITAÇÃO DE PAGAMENTO - BENEFICIO - 2026"), então o label de mês é inequívoco.
  // ANTIFRAUDE — fonte de verdade = NOSSO ledger `pi.efeitos_externos`, chave
  // `mensal:<competencia>:<CONTRATO>:<etapa>`. Responde exatamente "esse contrato já foi
  // processado nesta competência?", por contrato — é o que sustenta pagar em rodadas.
  //
  // Por que NÃO varremos o board Solicitação (como antes): o mensal CELETISTA grava no mesmo
  // board, com o mesmo `REFERÊNCIA PGTO = MENSAL`, a mesma coluna Competência e os MESMOS nomes
  // de contrato (verificado 31/07/2026: 13 itens MENSAL+AGOSTO no grupo JULHO/26, ex.
  // `M-08-2026-85-SEMSA`). Filtrar por lá bloqueava TODOS os contratos do intermitente —
  // falso positivo que inviabiliza a rodada. Enquanto o intermitente não tiver marcador próprio
  // no board (ver pendência: usar REFERÊNCIA PGTO = INTERMITENTE, como o pontual já faz),
  // pagamento feito 100% à mão no Monday não é detectável aqui.
  const processadas = new Set<string>()
  for (const contrato of await contratosMensalJaExecutados(competencia)) {
    processadas.add(norm(contrato))
  }
  // Reserva prometida a pré-pagamentos pontuais que ainda não pagaram. Subtraída do
  // residual em `desconto()` — é o que impede a mesma dívida de ser abatida duas vezes,
  // uma pelo mensal e outra pela felipeta de uma convocação já calculada.
  const reservasVivas = await lerReservasVivas()
  const descontos = (solicit.descontos?.[0]?.groups?.[0]?.items_page.items ?? []).filter((it) => {
    const status = norm(valor(it, "Status do Desconto"))
    return status === "PENDENTE" || status === "PARCIAL"
  }).length
  // Controle Caju: também gaveta de CAIXA ("JULHO - 2026"), igual ao legado n8n.
  const grupoControle = solicit.controle?.[0]?.groups?.find((g) => {
    const t = norm(g.title)
    return t.includes(norm(labelCaixa)) && (t.includes(String(anoCaixa)) || t.includes(String(anoCaixa).slice(-2)))
  })?.id ?? null
  return {
    solicitacoesProcessadas: [...processadas],
    parametros: solicit.parametros?.[0]?.items_page.items.length ?? 0,
    feriados: solicit.feriados?.[0]?.items_page.items.length ?? 0,
    descontos,
    grupoControle,
    grupoSolicitacao: grupoSolic?.id ?? null,
    valoresItems: solicit.parametros?.[0]?.items_page.items ?? [],
    feriadosItems: solicit.feriados?.[0]?.items_page.items ?? [],
    descontosItems: solicit.descontos?.[0]?.groups?.[0]?.items_page.items ?? [],
    reservasVivas,
  }
}

const numero = (v: string): number => {
  const s = v.replace(/[R$\s]/g, "")
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0
}
const r2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100
const sim = (v: string): boolean => ["SIM", "SIM*"].includes(norm(v))
function regraBeneficio(item: RawItem): RegraBeneficioMensal {
  const nome = norm(item.name)
  return { id: item.id, contrato: valor(item, "Contrato"), regra: valor(item, "Regra/Função") || valor(item, "Regra"),
    vrDia: numero(valor(item, "VR")), vtDia: numero(valor(item, "VT")), vrMensal: numero(valor(item, "VR Mensal")),
    vtMensal: numero(valor(item, "VT Mensal")), prioridade: numero(valor(item, "Prioridade")),
    escala12x36: nome.includes("12X36") || nome.includes("12 X 36") }
}
function feriado(item: RawItem): FeriadoMensal | null {
  const data = dataIso(valor(item, "Data") || valor(item, "date_mm3t5bgd"))
  if (!data) return null
  return { data, tipo: valor(item, "Tipo") || valor(item, "color_mm3t72h3"),
    contratos: (valor(item, "Contratos") || valor(item, "dropdown_mm3t4wjp")).split(",").map((x) => x.trim()).filter(Boolean) }
}
/**
 * Item do board de Desconto → `DescontoMensal`, com o residual LÍQUIDO DE RESERVA.
 *
 * `reservas` é a soma do que já está prometido a pré-pagamentos pontuais vivos, por item
 * (ver `pontual/repo.ts`). Subtrair aqui é o que faz a reserva existir de verdade: sem
 * isso, o mensal (e a próxima convocação) leem o residual cru do board e abatem uma dívida
 * que já foi prometida a uma convocação esperando a felipeta — a dívida seria consumida
 * duas vezes, e um dos dois pagamentos sairia menor do que devia.
 *
 * `Math.max(0, ...)`: reserva maior que o residual não deveria acontecer (o CHECK da 019
 * barra o espelho), mas se acontecer o certo é "não há nada a abater", nunca residual
 * negativo — que viraria um desconto NEGATIVO, ou seja, dinheiro a mais.
 */
export function desconto(item: RawItem, reservas?: ReservasVivas): DescontoMensal | null {
  const cpf = valor(item, "CPF").replace(/\D/g, ""), chapa = valor(item, "Matrícula") || valor(item, "Matricula")
  if (!cpf && !chapa) return null
  const reservado = reservas?.get(item.id)
  const bruto = {
    vr: numero(valor(item, "VR - Valor Residual")),
    vt: numero(valor(item, "VT - Valor Residual")),
  }
  return { id: item.id, pessoaKey: cpf || chapa.trim(), inicio: dataIso(valor(item, "Data Início") || valor(item, "Dt Inicio")) || "9999-12-31",
    residualVR: r2(Math.max(0, bruto.vr - (reservado?.vr ?? 0))),
    residualVT: r2(Math.max(0, bruto.vt - (reservado?.vt ?? 0))),
    descontadoVR: numero(valor(item, "VR - Valor Descontado")), descontadoVT: numero(valor(item, "VT - Valor Descontado")) }
}

function mapearPessoas(items: RawItem[]): PessoaPreviaMensal[] {
  return items.map((item) => ({
    itemId: item.id,
    nome: valor(item, "Nome do Empregado") || item.name,
    chapa: valor(item, "Funcionário"),
    cpf: valor(item, "CPF").replace(/\D/g, ""),
    contrato: valor(item, "Op - Contrato"),
    funcao: valor(item, "Função"),
    unidade: valor(item, "OP - Local/Unidade") || valor(item, "Local/Unidade"),
    interior: valor(item, "OP - Interior?"),
    dataInicio: dataIso(valor(item, "OP - Data/Inicio")),
    dataFim: dataIso(valor(item, "OP - Data/Fim")),
  })).filter((p) => p.nome && p.contrato && p.dataInicio && p.dataFim && (p.cpf || p.chapa))
}

/** Mês corrente em "YYYY-MM" — default do caixa. */
export function caixaAtual(hoje = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Marca no snapshot que a antifraude foi desligada nesta prévia.
 *
 * É constante (e não string solta) porque virou TRAVA: a rota de aprovação recusa aprovar uma
 * prévia com esta marca fora de homologação, a menos que o run seja de desenvolvedor. Sem isso,
 * um bypass feito "pra testar" poderia virar um pagamento real em contrato já pago.
 */
export const ALERTA_ANTIFRAUDE_OFF = "antifraude_desabilitada_teste_homologacao"

export async function calcularPreviaMensal(
  papel: PapelMensal,
  opts: { bypassAntifraude?: boolean; caixa?: string } = {},
): Promise<SnapshotPreviaMensal> {
  const caixa = /^\d{4}-\d{2}$/.test(opts.caixa ?? "") ? opts.caixa! : caixaAtual()
  const board = await resolverBoard(papel)
  const grupo = await resolverGrupoMensal(board.monday_board_id)
  const [plano, apoio] = await Promise.all([
    lerPlano(board.monday_board_id, grupo),
    lerApoio(board.competencia!, caixa),
  ])
  const planItems = plano.items
  const pessoas = mapearPessoas(planItems)
  const rawPorId = new Map(planItems.map((item) => [item.id, item]))
  const convocacoes: ConvocacaoMensal[] = pessoas.map((p) => {
    const raw = rawPorId.get(p.itemId)!
    const escala = norm(valor(raw, "12x36 par/impar?"))
    return { itemId: p.itemId, nome: p.nome, chapa: p.chapa, cpf: p.cpf, contrato: p.contrato, funcao: p.funcao,
      interior: p.interior, inicio: p.dataInicio, fim: p.dataFim, trabalhaSabado: sim(valor(raw, "OP - Sábado?")),
      optanteVT: sim(valor(raw, "Vale Transporte")) || sim(valor(raw, "OP - VT só volta?")),
      vtSoVolta: norm(valor(raw, "Vale Transporte")) === "SIM*" || sim(valor(raw, "OP - VT só volta?")),
      escala12x36: escala.startsWith("IMPAR") ? "IMPAR" : escala.startsWith("PAR") ? "PAR" : null }
  })
  const calculo = calcularMensal(convocacoes, apoio.valoresItems.map(regraBeneficio),
    apoio.feriadosItems.map(feriado).filter((x): x is FeriadoMensal => !!x),
    // Residual LÍQUIDO de reserva: dívida prometida a um pré-pagamento pontual vivo não
    // pode ser abatida aqui também. `.map(desconto)` sem o 2º argumento voltaria a ler o
    // residual cru — foi por isso que virou parâmetro explícito e não default.
    apoio.descontosItems.map((it) => desconto(it, apoio.reservasVivas)).filter((x): x is DescontoMensal => !!x))
  const contratos: ContratoPreviaMensal[] = calculo.contratos.map((calc, index) => {
    const chave = normMensal(calc.contrato)
    const bloqueado = !opts.bypassAntifraude && apoio.solicitacoesProcessadas.includes(chave)
    return {
      contrato: calc.contrato,
      ordem: index + 1,
      pessoas: calc.pessoas.map((p) => ({ itemId: p.itemId, itemIds: p.itemIds, nome: p.nome, chapa: p.chapa, cpf: p.cpf,
        contrato: p.contrato, funcao: p.funcao, unidade: pessoas.find((x) => x.itemId === p.itemId)?.unidade ?? "",
        interior: p.interior, dataInicio: p.inicio, dataFim: p.fim, diasVR: p.diasVR, diasVT: p.diasVT,
        vrDia: p.vrDia, vtDia: p.vtDia, brutoVR: p.brutoVR, brutoVT: p.brutoVT, descontoVR: p.descontoVR,
        descontoVT: p.descontoVT, liquidoVR: p.liquidoVR, liquidoVT: p.liquidoVT, creditoVR: p.creditoVR,
        creditoVT: p.creditoVT, pixVR: p.pixVR, pixVT: p.pixVT, regraAplicada: p.regraAplicada })),
      bloqueado,
      motivoBloqueio: bloqueado ? "contrato_ja_processado_na_competencia" : null,
      totais: calc.totais,
      efeitosPrevistos: bloqueado ? [] : ["caju_credito", "caju_pix", "rm", "monday", "drive"],
      planUpdates: calc.planUpdates,
      descontoUpdates: calc.descontoUpdates,
    }
  })
  const alertas: string[] = []
  // Gaveta de caixa ausente NÃO é erro: a execução cria o grupo do mês antes de escrever.
  if (!apoio.grupoControle) alertas.push("grupo_caixa_controle_caju_sera_criado_na_execucao")
  if (!apoio.grupoSolicitacao) alertas.push("grupo_caixa_solicitacao_sera_criado_na_execucao")
  if (!apoio.parametros) alertas.push("parametros_beneficios_vazio")
  if (!contratos.length) alertas.push("nenhum_contrato_elegivel")
  if (opts.bypassAntifraude) alertas.push(ALERTA_ANTIFRAUDE_OFF)
  alertas.push("totais_financeiros_calculados_em_codigo_aguardando_paridade_aprovada")
  return {
    versao: 1,
    papel,
    competencia: board.competencia!,
    boardId: board.monday_board_id,
    criadoEm: new Date().toISOString(),
    contratos,
    alertas,
    apoio: {
      solicitacoesProcessadas: apoio.solicitacoesProcessadas,
      parametrosBeneficios: apoio.parametros,
      feriados: apoio.feriados,
      descontosPendentes: apoio.descontos,
      grupoControleCaju: apoio.grupoControle,
      grupoSolicitacao: apoio.grupoSolicitacao,
      caixa,
      colunasPlano: plano.colunas,
    },
  }
}
