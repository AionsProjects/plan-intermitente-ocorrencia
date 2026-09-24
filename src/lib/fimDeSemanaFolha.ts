// Fim de semana só pra folha — espelho de auth-backend/src/domain/fimDeSemanaFolha.ts.
//
// O link oferece o sábado e o domingo LOGO DEPOIS do fim da convocação, no mesmo mês. Os de
// dentro do período o RM já cobre; o backend valida de novo e descarta o que não couber.

const ISO = /^\d{4}-\d{2}-\d{2}$/

function somar(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Sábado e domingo do primeiro fim de semana DEPOIS de `dataFim`, dentro do mesmo mês. */
export function finsDeSemanaDisponiveis(dataFim: string | null | undefined): string[] {
  const fim = String(dataFim ?? "").slice(0, 10)
  if (!ISO.test(fim)) return []
  const out: string[] = []
  for (let i = 1; i <= 7; i++) {
    const d = somar(fim, i)
    if (d.slice(0, 7) !== fim.slice(0, 7)) break
    const dia = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (dia === 6 || dia === 0) out.push(d)
    if (dia === 0) break
  }
  return out
}
