// Data que o financeiro vê na Solicitação de Pagamento (coluna `date_mkrer5tv`).
//
// O crédito Caju sai no mesmo instante, mas o que o financeiro paga no banco depende do
// expediente bancário dele: solicitação nascida à tarde, depois do corte, só é paga no dia
// seguinte. Gravar "hoje" nesses casos faz o board prometer um pagamento que não acontece.
//
// PURO e no fuso de MANAUS: a Vercel roda em UTC, e às 15h de Manaus já é o dia seguinte em
// nenhum lugar — mas às 21h de Manaus o UTC já virou. Usar `toISOString()` cru erraria o dia
// inteiro nas solicitações do fim da tarde.
import { isFeriadoNacional } from "./feriado.js"

const FUSO = "America/Manaus"

/** Hora de corte do expediente bancário do financeiro (pedido do DP, 09/2026). */
export const CORTE_PAGAMENTO_HORA = 14

const FMT_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// `hourCycle: "h23"` de propósito: com `hour12: false` o en-GB devolve "24" à meia-noite, e
// 24 >= 14 mandaria toda solicitação da madrugada pro dia seguinte.
const FMT_HORA = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  hour: "2-digit",
  hourCycle: "h23",
})

/** `YYYY-MM-DD` do instante, no fuso de Manaus. */
export function diaManaus(agora: Date): string {
  return FMT_DIA.format(agora)
}

/** Hora cheia (0–23) do instante, no fuso de Manaus. */
export function horaManaus(agora: Date): number {
  return Number(FMT_HORA.format(agora))
}

/** Dia em que o financeiro consegue pagar: nem fim de semana, nem feriado nacional. */
export function ehDiaUtilBancario(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return dow !== 0 && dow !== 6 && !isFeriadoNacional(iso)
}

/** Próximo dia útil bancário a partir de `iso`, inclusive. */
export function proximoDiaUtilBancario(iso: string): string {
  const cur = new Date(`${iso}T00:00:00Z`)
  // Teto de 15 dias: feriado emendado não passa disso, e laço infinito num #dinheiro-real
  // é pior que uma data errada — aqui ele nem pode acontecer.
  for (let i = 0; i < 15; i++) {
    const dia = cur.toISOString().slice(0, 10)
    if (ehDiaUtilBancario(dia)) return dia
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return cur.toISOString().slice(0, 10)
}

/**
 * Data de pagamento da Solicitação.
 *
 * Antes do corte, é hoje. A partir do corte (inclusive), o dia seguinte. Nos dois casos rola
 * pro próximo dia útil — solicitação criada sábado de manhã também não é paga no sábado.
 */
export function dataPagamentoSolicitacao(
  agora: Date,
  corteHora: number = CORTE_PAGAMENTO_HORA,
): string {
  const hoje = diaManaus(agora)
  if (horaManaus(agora) < corteHora) return proximoDiaUtilBancario(hoje)
  const amanha = new Date(`${hoje}T00:00:00Z`)
  amanha.setUTCDate(amanha.getUTCDate() + 1)
  return proximoDiaUtilBancario(amanha.toISOString().slice(0, 10))
}
