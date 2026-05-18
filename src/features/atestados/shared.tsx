import { parseISO } from "date-fns"

export const DOC_MAX_BYTES = 15 * 1024 * 1024
export const DOC_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,image/jpeg,image/png,image/heic,application/pdf"

export function formatarBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function listarDiasPeriodo(inicio: string, fim: string): string[] {
  const out: string[] = []
  const atual = new Date(inicio + "T00:00:00Z")
  const fimData = new Date(fim + "T00:00:00Z")
  while (atual <= fimData) {
    out.push(atual.toISOString().slice(0, 10))
    atual.setUTCDate(atual.getUTCDate() + 1)
  }
  return out
}

export function isDiaSemanaUtil(iso: string): boolean {
  const dow = parseISO(iso).getUTCDay()
  return dow >= 1 && dow <= 5
}

export function isSabadoIso(iso: string): boolean {
  return parseISO(iso).getUTCDay() === 6
}

export function isDomingoIso(iso: string): boolean {
  return parseISO(iso).getUTCDay() === 0
}

export function dataDentroPeriodo(
  data: string,
  inicio: string,
  fim: string,
): boolean {
  return data >= inicio && data <= fim
}

export function criarIdLocal(prefixo: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefixo}-${crypto.randomUUID()}`
  }
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function rotuloDocumento(
  tipo: "atestado" | "declaracao",
  periodos: ("manha" | "tarde")[],
): string {
  if (tipo === "atestado") return "Atestado médico"
  if (periodos.length === 2) return "Declaração integral"
  if (periodos[0] === "manha") return "Declaração matutina"
  if (periodos[0] === "tarde") return "Declaração vespertina"
  return "Declaração"
}

