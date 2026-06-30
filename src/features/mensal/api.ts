import type {
  MensalContrato,
  MensalFechamento,
  MensalPayload,
  MensalPessoa,
  MensalPreview,
} from "./types"
import { comOperador } from "@/lib/http"

const BASE_URL = import.meta.env.VITE_N8N_BASE_URL ?? ""
const USE_MOCK = !BASE_URL

const MESES = [
  "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
]

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function mockPreview(payload: MensalPayload): MensalPreview {
  const [ano, mes] = payload.competencia.split("-").map(Number)
  const mkContrato = (nome: string, codSecao: string, qtd: number, vrDia: number): MensalContrato => {
    const detalhe: MensalPessoa[] = Array.from({ length: qtd }, (_, i) => {
      const liquidoVR = round2(vrDia * (10 + (i % 12)))
      const liquidoVT = round2(12 * (8 + (i % 10)))
      const credito = round2(vrDia * 3 + 36)
      const pix = round2(Math.max(0, liquidoVR + liquidoVT - credito))
      return {
        nome: `COLABORADOR ${nome} ${i + 1}`,
        chapa: `00${7000 + i}`,
        cpf: `0010813527${i % 10}`,
        liquidoVR, liquidoVT, credito, pix,
        descontoVR: i % 4 === 0 ? round2(vrDia) : 0,
        descontoVT: i % 4 === 0 ? 10 : 0,
        regra: `Board valores - ${nome}`,
      }
    })
    const agg = detalhe.reduce(
      (a, p) => ({ vr: a.vr + p.liquidoVR, vt: a.vt + p.liquidoVT, credito: a.credito + p.credito, pix: a.pix + p.pix }),
      { vr: 0, vt: 0, credito: 0, pix: 0 },
    )
    return { contrato: nome, codSecao, pessoas: qtd, vr: round2(agg.vr), vt: round2(agg.vt), credito: round2(agg.credito), pix: round2(agg.pix), detalhe }
  }
  const contratos = [
    mkContrato("SEMSA", "01.01.0085", 32, 24.5),
    mkContrato("SEDUC ESCOLA", "01.01.0011", 8, 24.5),
    mkContrato("DETRAN", "01.01.0004", 7, 19.6),
    mkContrato("CETAM", "01.01.0074", 11, 24.5),
    mkContrato("SEDUC INTERIOR", "01.01.0011", 2, 24.5),
  ]
  const tot = contratos.reduce(
    (a, c) => ({ pessoas: a.pessoas + c.pessoas, vr: a.vr + c.vr, vt: a.vt + c.vt, credito: a.credito + c.credito, pix: a.pix + c.pix }),
    { pessoas: 0, vr: 0, vt: 0, credito: 0, pix: 0 },
  )
  return {
    ok: true,
    competencia: `${MESES[mes - 1]}/${ano}`,
    competenciaLabel: MESES[mes - 1], anoComp: ano, mesComp: mes,
    totalContratos: contratos.length, totalPessoas: tot.pessoas,
    totalVR: round2(tot.vr), totalVT: round2(tot.vt), totalCredito: round2(tot.credito), totalPix: round2(tot.pix),
    descontosAtualizar: 19, ignorados: 0, contratos, aviso: null,
  }
}

function mapPessoa(raw: Record<string, unknown>): MensalPessoa {
  return {
    nome: String(raw.nome ?? ""),
    chapa: String(raw.chapa ?? ""),
    cpf: raw.cpf ? String(raw.cpf) : null,
    liquidoVR: Number(raw.liquidoVR ?? 0),
    liquidoVT: Number(raw.liquidoVT ?? 0),
    credito: Number(raw.credito ?? 0),
    pix: Number(raw.pix ?? 0),
    descontoVR: Number(raw.descontoVR ?? 0),
    descontoVT: Number(raw.descontoVT ?? 0),
    regra: raw.regra ? String(raw.regra) : null,
  }
}

function mapContrato(raw: Record<string, unknown>): MensalContrato {
  return {
    contrato: String(raw.contrato ?? ""),
    codSecao: String(raw.codSecao ?? ""),
    pessoas: Number(raw.pessoas ?? 0),
    vr: Number(raw.vr ?? 0),
    vt: Number(raw.vt ?? 0),
    credito: Number(raw.credito ?? 0),
    pix: Number(raw.pix ?? 0),
    detalhe: Array.isArray(raw.detalhe) ? raw.detalhe.map((p) => mapPessoa(p as Record<string, unknown>)) : [],
  }
}

function mapPreview(raw: Record<string, unknown>): MensalPreview {
  return {
    ok: raw.ok !== false,
    competencia: raw.competencia ? String(raw.competencia) : null,
    competenciaLabel: raw.competenciaLabel ? String(raw.competenciaLabel) : null,
    anoComp: raw.anoComp != null ? Number(raw.anoComp) : null,
    mesComp: raw.mesComp != null ? Number(raw.mesComp) : null,
    totalContratos: Number(raw.totalContratos ?? 0),
    totalPessoas: Number(raw.totalPessoas ?? 0),
    totalVR: Number(raw.totalVR ?? 0),
    totalVT: Number(raw.totalVT ?? 0),
    totalCredito: Number(raw.totalCredito ?? 0),
    totalPix: Number(raw.totalPix ?? 0),
    descontosAtualizar: Number(raw.descontosAtualizar ?? 0),
    ignorados: Number(raw.ignorados ?? 0),
    contratos: Array.isArray(raw.contratos) ? raw.contratos.map((c) => mapContrato(c as Record<string, unknown>)) : [],
    aviso: raw.aviso ? String(raw.aviso) : null,
  }
}

export async function previewMensal(payload: MensalPayload): Promise<MensalPreview> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 500))
    return mockPreview(payload)
  }
  const res = await fetch(`${BASE_URL}/intermitente-mensal-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as Record<string, unknown>).mensagem ? String((data as Record<string, unknown>).mensagem) : `Erro ${res.status}`)
  return mapPreview(data as Record<string, unknown>)
}

export async function confirmarFechamentoMensal(payload: MensalPayload): Promise<MensalFechamento> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 700))
    return { ok: true }
  }
  const res = await fetch(`${BASE_URL}/intermitente-mensal-fechamento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(comOperador(payload)),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as Record<string, unknown>).mensagem ? String((data as Record<string, unknown>).mensagem) : `Erro ${res.status}`)
  return { ok: true, mensagem: (data as Record<string, unknown>).mensagem ? String((data as Record<string, unknown>).mensagem) : undefined }
}
