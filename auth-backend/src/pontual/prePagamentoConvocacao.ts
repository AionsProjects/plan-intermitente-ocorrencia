// Pré-pagamento na criação da convocação: lê o apoio, calcula, e devolve os valores prontos
// pra entrarem no `column_values` do próprio `createItem`.
//
// Escrever os 9 valores DENTRO do create (em vez de numa mutation depois) tem dois motivos:
// não existe janela em que o item nasce sem valores — que é literalmente o pedido, "já deve
// vir calculado para o 2 só pagar" — e as colunas de valor estão em
// `pi.bloqueio_coluna_critica`, então escrevê-las na MESMA execução faz o monitor de
// alteração casar o audit → `app` e agrupar tudo num único WhatsApp. Uma mutation separada
// (ou pior, um job) viraria `api_inexplicada` e mensagem extra por convocação — foi o que a
// Convocação no RM já causou (11 alarmes falsos na homologação).
import { mondayGraphql } from "../monday.js"
import { montarValuesPlanUpdate } from "../mensal/mondayEfeitos.js"
import type { DescontoMensal, FeriadoMensal, PessoaCalculadaMensal } from "../mensal/calculo.js"
import { desconto, feriado, regraBeneficio, type RawItem } from "../mensal/previa.js"
import { calcularPontual, ErroCalculoPontual, type EntradaCalculoPontual, type ReservaCalculada } from "./calculo.js"
import { lerReservasVivas } from "./repo.js"

const BOARD_PARAMETROS = "18413870370"
const BOARD_FERIADOS = "18415442661"
const BOARD_DESCONTOS = "18400981023"
const GRUPO_DESCONTOS_PENDENTES = "group_mm0rmjs3"

const norm = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()

export interface ResultadoPrePagamento {
  /** `column_values` das 9 colunas de valor (7 de benefício + DESCONTO VR/VT), pronto pra
   *  fundir no `createItem`. */
  valoresColunas: Record<string, string>
  pessoa?: PessoaCalculadaMensal
  reservas: ReservaCalculada[]
  semSaldo: boolean
  calculo: Record<string, unknown>
  /** Preenchido quando o cálculo falhou — o snapshot nasce `invalido` com este motivo. */
  motivoInvalido?: string
}

/**
 * Apoio do pontual: os 3 boards que o cálculo precisa, líquidos de reserva.
 *
 * Query própria e enxuta — NÃO reusa `lerApoio()` do mensal, que puxa 500 solicitações + os
 * grupos do Controle Caju pra responder antifraude de contrato/competência. Nada disso
 * importa numa convocação, e são centenas de itens no caminho crítico de um request que o
 * operador está esperando. Os CONVERSORES são reusados (`regraBeneficio`, `feriado`,
 * `desconto`), que é onde vive a lógica de parsing.
 */
async function lerApoioPontual(): Promise<{
  regras: ReturnType<typeof regraBeneficio>[]
  feriados: FeriadoMensal[]
  descontos: DescontoMensal[]
}> {
  const [d, reservas] = await Promise.all([
    mondayGraphql<{
      parametros: Array<{ items_page: { items: RawItem[] } }>
      feriados: Array<{ items_page: { items: RawItem[] } }>
      descontos: Array<{ groups: Array<{ items_page: { items: RawItem[] } }> }>
    }>(
      `query ApoioPontual {
        parametros: boards(ids:[${BOARD_PARAMETROS}]) { items_page(limit:500) { items { id name column_values { id text column { title } } } } }
        feriados: boards(ids:[${BOARD_FERIADOS}]) { items_page(limit:200) { items { id name column_values { id text column { title } } } } }
        descontos: boards(ids:[${BOARD_DESCONTOS}]) { groups(ids:["${GRUPO_DESCONTOS_PENDENTES}"]) {
          items_page(limit:500) { items { id name column_values { id text column { title } } } }
        } }
      }`,
    ),
    lerReservasVivas(),
  ])
  const itensDesconto = d.descontos?.[0]?.groups?.[0]?.items_page.items ?? []
  return {
    regras: (d.parametros?.[0]?.items_page.items ?? []).map(regraBeneficio),
    feriados: (d.feriados?.[0]?.items_page.items ?? []).map(feriado).filter((x): x is FeriadoMensal => !!x),
    // Residual LÍQUIDO de reserva — mesma função que o mensal usa, mesma fonte. Ler de fonte
    // diferente do outro consumidor é como o número da tela volta a divergir do pago.
    descontos: itensDesconto
      .filter((it) => ["PENDENTE", "PARCIAL"].includes(norm(valorColuna(it, "Status do Desconto"))))
      .map((it) => desconto(it, reservas))
      .filter((x): x is DescontoMensal => !!x),
  }
}

function valorColuna(item: RawItem, titulo: string): string {
  const alvo = norm(titulo)
  return item.column_values.find((c) => norm(c.column?.title ?? c.id) === alvo)?.text?.trim() ?? ""
}

/** Títulos e ids legados de `DESCONTO - VR/VT` no Plan — os mesmos do step do pagamento. */
const COL_DESCONTO_PLANO = [
  { chave: "descontoVR", titulo: "DESCONTO - VR", fallback: "numeric_mkrz4ye5" },
  { chave: "descontoVT", titulo: "DESCONTO - VT", fallback: "numeric_mkrz9c4e" },
] as const

/**
 * `DESCONTO - VR/VT` na CRIAÇÃO, com o que o FIFO acabou de reservar do board de Desconto.
 *
 * Por que faltava: até a felipeta, o pontual disparava no `create_item` e pagava na hora — o
 * step `monday_plano` do pagamento escrevia as duas colunas no mesmo instante em que o item
 * nascia. Com o pagamento adiado para o "Compareceu? SIM", a escrita foi junto: convocação
 * criada hoje fica com as células VAZIAS até alguém marcar a felipeta, mesmo com o desconto já
 * calculado e reservado. Medido em 18/09/2026 — LINCON (196/80) e GLAUCIENE (0/10,90) tinham o
 * valor no snapshot e nada no board.
 *
 * O valor daqui é o RESERVADO; o do pagamento é o CONSUMIDO. Mesma coluna, sobrescrita — é a
 * regra que o step do pagamento já seguia ("sobrescreve com o total calculado, nunca incrementa").
 *
 * Vai junto do `createItem` de propósito: as duas são `bloqueio_coluna_critica`, e uma mutation
 * separada viraria `api_inexplicada` no monitor de alteração — um WhatsApp falso por convocação.
 */
export function montarValuesDescontoPlano(
  pessoa: PessoaCalculadaMensal | undefined,
  colunas: Record<string, string>,
): Record<string, string> {
  if (!pessoa) return {}
  const out: Record<string, string> = {}
  for (const c of COL_DESCONTO_PLANO) {
    const id = colunas[norm(c.titulo)] ?? c.fallback
    out[id] = String(Number(pessoa[c.chave]) || 0)
  }
  return out
}

/**
 * Calcula o pré-pagamento de uma convocação que está sendo criada.
 *
 * NUNCA lança: falha de cálculo volta em `motivoInvalido` e `valoresColunas` vazio. Convocar
 * é ato operacional e não pode ser bloqueado por regra de valor ausente no board — quem
 * recusa é a felipeta, com o motivo nomeado em mão.
 *
 * `colunasPlano` vem do `idPorNome` do registry (Map por título CRU); aqui é normalizado,
 * porque `montarValuesPlanUpdate` indexa por título normalizado e cai no fallback de id
 * legado quando não acha — silenciosamente escrevendo na coluna errada de um board novo.
 */
export async function calcularPrePagamentoConvocacao(
  entrada: EntradaCalculoPontual,
  colunasPlano: Map<string, string>,
): Promise<ResultadoPrePagamento> {
  const vazio: ResultadoPrePagamento = {
    valoresColunas: {}, reservas: [], semSaldo: false, calculo: {},
  }
  let apoio
  try {
    apoio = await lerApoioPontual()
  } catch (e) {
    // Board de apoio fora do ar. A convocação segue sem valores; a felipeta recalcula.
    return { ...vazio, motivoInvalido: `apoio_indisponivel: ${(e as Error).message}`.slice(0, 200) }
  }

  try {
    const r = calcularPontual(entrada, apoio.regras, apoio.feriados, apoio.descontos)
    const colunas = Object.fromEntries([...colunasPlano].map(([nome, id]) => [norm(nome), id]))
    return {
      valoresColunas: {
        ...montarValuesPlanUpdate(r.planUpdate, colunas),
        ...montarValuesDescontoPlano(r.pessoa, colunas),
      },
      pessoa: r.pessoa,
      reservas: r.reservas,
      semSaldo: r.semSaldo,
      calculo: r.auditoria,
    }
  } catch (e) {
    const motivo = e instanceof ErroCalculoPontual ? e.motivo : "erro_calculo"
    const detalhe = e instanceof Error ? e.message : String(e)
    return { ...vazio, motivoInvalido: `${motivo}: ${detalhe}`.slice(0, 200) }
  }
}
