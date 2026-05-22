/**
 * Helpers compartilhados da feature /descontos.
 *
 * Máscara R$: input recebe string com dígitos só, exibe formatado
 * "R$ 0,00". Internamente armazena valor como string (preserva controle
 * do user) e converte pra number na hora de enviar.
 */

import { parseISO, format } from "date-fns"
import { ptBR } from "date-fns/locale"

/** Converte input do user (string com dígitos) em número decimal R$.
 *  Ex: "12345" -> 123.45. "0" -> 0. "" -> 0. */
export function digitosParaReal(digitos: string): number {
  const limpo = digitos.replace(/\D/g, "")
  if (!limpo) return 0
  return Number(limpo) / 100
}

/** Formata número em R$ brasileiro. Ex: 123.45 -> "R$ 123,45". */
export function formatarReal(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Converte input string com dígitos em formato de exibição "123,45".
 *  Para uso direto no value do input. */
export function digitosParaDisplay(digitos: string): string {
  const limpo = digitos.replace(/\D/g, "")
  if (!limpo) return ""
  const numero = Number(limpo) / 100
  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Formata período de datas pra display no header (ex: "01/05 – 20/05/2026"). */
export function formatarPeriodoCurto(inicio: string, fim: string): string {
  try {
    const i = parseISO(inicio)
    const f = parseISO(fim)
    const mesmoAno = format(i, "yyyy") === format(f, "yyyy")
    if (mesmoAno) {
      return `${format(i, "dd/MM", { locale: ptBR })} – ${format(f, "dd/MM/yyyy", { locale: ptBR })}`
    }
    return `${format(i, "dd/MM/yyyy", { locale: ptBR })} – ${format(f, "dd/MM/yyyy", { locale: ptBR })}`
  } catch {
    return `${inicio} – ${fim}`
  }
}
