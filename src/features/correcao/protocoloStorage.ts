const KEY = "plano-intermitentes:protocolos"

export type ProtocoloEntry = {
  protocolo: string
  uuid: string
  nome: string
  dataInicio: string
  dataFim: string
  concluidoEm: string
  editadoEm?: string | null
}

function readAll(): ProtocoloEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: ProtocoloEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 50)))
}

export function gerarProtocolo(): string {
  const alfa = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const seg = (n: number) =>
    Array.from(
      { length: n },
      () => alfa[Math.floor(Math.random() * alfa.length)],
    ).join("")
  return `PROT-${seg(4)}-${seg(4)}`
}

export function salvarProtocolo(entry: ProtocoloEntry) {
  const all = readAll().filter((e) => e.protocolo !== entry.protocolo)
  all.unshift(entry)
  writeAll(all)
}

export function listarProtocolos(): ProtocoloEntry[] {
  return readAll()
}

export function buscarUuidPorProtocoloLocal(
  protocolo: string,
): ProtocoloEntry | null {
  const limpo = protocolo.trim().toUpperCase()
  return readAll().find((e) => e.protocolo === limpo) ?? null
}

export function marcarComoEditadoLocal(protocolo: string, editadoEm: string) {
  const all = readAll()
  const idx = all.findIndex((e) => e.protocolo === protocolo)
  if (idx >= 0) {
    all[idx] = { ...all[idx], editadoEm }
    writeAll(all)
  }
}
