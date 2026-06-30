// Abatimento FIFO de dívidas no benefício bruto — PURO. Porta fiel do Pontual
// (E1XAdrEbPy5lZhNS, nodes 9/10). Dívidas PENDENTE/PARCIAL ordenadas por dataInicio
// (mais antiga primeiro); abate min(saldo, residual) em VR e VT; status novo =
// FINALIZADO (zerou ambos) ou PARCIAL. Não muta a entrada (clona as dívidas).

const round = (n: number): number => Math.round(n * 100) / 100

export interface Divida {
  itemId: string
  dataInicio?: string // p/ ordenar FIFO
  status?: string // PENDENTE | PARCIAL (outras são ignoradas pelo chamador)
  residualVR: number
  residualVT: number
  descontadoVR?: number
  descontadoVT?: number
}

export interface UpdateDivida {
  itemId: string
  descontadoVR: number
  descontadoVT: number
  residualVR: number
  residualVT: number
  novoStatus: "FINALIZADO" | "PARCIAL"
  aplicadoVR: number
  aplicadoVT: number
}

export interface ResultadoFifo {
  liquidoVR: number // sobra do benefício após abater dívidas
  liquidoVT: number
  totalAplicadoVR: number
  totalAplicadoVT: number
  updates: UpdateDivida[] // só as dívidas que sofreram abatimento
}

/** Filtra dívidas elegíveis (PENDENTE/PARCIAL) e ordena FIFO por dataInicio asc. */
export function ordenarDividasFifo(dividas: Divida[]): Divida[] {
  return dividas
    .filter((d) => {
      const s = String(d.status ?? "PENDENTE").toUpperCase()
      return s === "PENDENTE" || s === "PARCIAL"
    })
    .slice()
    .sort((a, b) => (a.dataInicio || "").localeCompare(b.dataInicio || ""))
}

/**
 * Abate o benefício bruto (VR/VT) contra as dívidas, FIFO. `dividas` já deve estar
 * ordenada (use ordenarDividasFifo). Retorna líquido + updates idempotentes.
 */
export function aplicarFifo(
  brutoVR: number,
  brutoVT: number,
  dividas: Divida[],
): ResultadoFifo {
  let saldoVR = brutoVR
  let saldoVT = brutoVT
  const updates: UpdateDivida[] = []

  for (const orig of dividas) {
    const d = {
      ...orig,
      descontadoVR: orig.descontadoVR || 0,
      descontadoVT: orig.descontadoVT || 0,
    }
    let aplicadoVR = 0
    let aplicadoVT = 0
    if (saldoVR > 0 && d.residualVR > 0) {
      aplicadoVR = Math.min(saldoVR, d.residualVR)
      saldoVR = round(saldoVR - aplicadoVR)
      d.residualVR = round(d.residualVR - aplicadoVR)
      d.descontadoVR = round(d.descontadoVR + aplicadoVR)
    }
    if (saldoVT > 0 && d.residualVT > 0) {
      aplicadoVT = Math.min(saldoVT, d.residualVT)
      saldoVT = round(saldoVT - aplicadoVT)
      d.residualVT = round(d.residualVT - aplicadoVT)
      d.descontadoVT = round(d.descontadoVT + aplicadoVT)
    }
    if (aplicadoVR > 0 || aplicadoVT > 0) {
      const novoStatus = d.residualVR === 0 && d.residualVT === 0 ? "FINALIZADO" : "PARCIAL"
      updates.push({
        itemId: d.itemId,
        descontadoVR: d.descontadoVR,
        descontadoVT: d.descontadoVT,
        residualVR: d.residualVR,
        residualVT: d.residualVT,
        novoStatus,
        aplicadoVR,
        aplicadoVT,
      })
    }
    if (saldoVR === 0 && saldoVT === 0) break
  }

  const liquidoVR = round(saldoVR)
  const liquidoVT = round(saldoVT)
  return {
    liquidoVR,
    liquidoVT,
    totalAplicadoVR: round(brutoVR - liquidoVR),
    totalAplicadoVT: round(brutoVT - liquidoVT),
    updates,
  }
}
