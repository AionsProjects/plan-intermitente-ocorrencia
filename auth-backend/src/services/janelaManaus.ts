// Janela de tempo no fuso de MANAUS (UTC-4 fixo, sem horário de verão) + nome de quem fez.
//
// Mora fora do script porque o script executa `main()` no import — quem quiser testar estas
// funções não pode carregar o arquivo inteiro sem disparar um relatório de verdade.
//
// A conversão é por sufixo de offset, não por `Intl`: somar "-04:00" à string é exato, não
// depende de tzdata do host e não muda com atualização de sistema. Manaus nunca teve DST desde
// 2008, e o RM/DP raciocinam nesse relógio.
const OFFSET = "-04:00"

/** Hoje em Manaus, no formato YYYY-MM-DD. */
export function hojeManaus(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Manaus" })
}

/**
 * "2026-08-31T14:00" ou "2026-08-31" -> instante absoluto, lendo a entrada como hora de Manaus.
 * Ler como UTC jogaria o corte 4 horas para trás e o relatório traria o que não foi pedido.
 */
export function instante(entrada: string, fimDoDia = false): Date {
  const s = String(entrada).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T${fimDoDia ? "23:59:59.999" : "00:00:00"}${OFFSET}`)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return new Date(`${s}:00${OFFSET}`)
  throw new Error(`data invalida: ${entrada} (use YYYY-MM-DD ou YYYY-MM-DDTHH:mm)`)
}

const fmt = (d: Date | null, o: Intl.DateTimeFormatOptions): string =>
  d ? d.toLocaleString("pt-BR", { ...o, timeZone: "America/Manaus" }) : "—"

export const hora = (d: Date | null): string => fmt(d, { hour: "2-digit", minute: "2-digit" })
export const dataHora = (d: Date | null): string =>
  fmt(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

/** YYYY-MM-DD (ou Date) -> DD/MM/YYYY. */
export const dia = (d: Date | string | null): string =>
  d ? (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)).split("-").reverse().join("/") : "—"

/**
 * Nome legível de quem fez: nome do operador, senão o usuário do e-mail, senão "automação".
 * Corta em 3 palavras porque o RM devolve nome completo com sobrenome repetido e a coluna do
 * PDF é estreita — truncar no meio de um sobrenome lê pior que parar num nome inteiro.
 */
export function quem(nome: string | null, email: string | null): string {
  const limpo = (nome ?? "").replace(/\s+/g, " ").trim()
  if (limpo) return limpo.split(" ").slice(0, 3).join(" ")
  if (email) return email.split("@")[0]!
  return "automação"
}
