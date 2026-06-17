import type {
  ConvocacaoConflito,
  ConvocacaoPayload,
  ConvocacaoOpcoes,
  ConvocacaoResposta,
  EmpregadoRM,
} from "./types"
import { OPCOES_CONVOCACAO_FALLBACK } from "./types"
import { unidadesParaContrato } from "@/lib/unidadesContrato"
import { anexarOperador } from "@/lib/http"

const BASE_URL = import.meta.env.VITE_N8N_ANTIGO_BASE_URL || import.meta.env.VITE_N8N_BASE_URL || ""
const USE_MOCK = !BASE_URL

export class ConvocacaoApiError extends Error {
  status?: number
  erro?: string
  conflito?: ConvocacaoConflito

  constructor(
    message: string,
    options: {
      status?: number
      erro?: string
      conflito?: ConvocacaoConflito
    } = {},
  ) {
    super(message)
    this.name = "ConvocacaoApiError"
    this.status = options.status
    this.erro = options.erro
    this.conflito = options.conflito
  }
}

const MOCK_EMPREGADOS: EmpregadoRM[] = [
  {
    nome: "FULANO DE TAL",
    chapa: "999001",
    cpf: "00000000001",
    funcao: "AUXILIAR DE SERVIÇOS GERAIS",
    admissao: "2024-01-15",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
  {
    nome: "BELTRANO DA SILVA",
    chapa: "999002",
    cpf: "00000000002",
    funcao: "PORTARIA",
    admissao: "2023-06-01",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
  {
    nome: "CICRANO DOS SANTOS",
    chapa: "999003",
    cpf: "00000000003",
    funcao: "MOTORISTA",
    admissao: "2022-11-20",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
  {
    nome: "ISAAC RAYLEN GOMES",
    chapa: "999004",
    cpf: "00000000004",
    funcao: "DESENVOLVEDOR",
    admissao: "2025-08-01",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
  {
    nome: "FULANA DEMO PEREIRA",
    chapa: "999005",
    cpf: "00000000005",
    funcao: "AUXILIAR ADMINISTRATIVO",
    admissao: "2024-05-10",
    secao: "01.01.0001.01.0001",
    codcoligada: 3,
  },
]

function normaliza(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
}

function uniqueOrdered(values: unknown, fallback: readonly string[]): string[] {
  const origem = Array.isArray(values) ? values : []
  const normalizadas = origem
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
  const unicas = [...new Set(normalizadas)]
  return unicas.length > 0 ? unicas : [...fallback]
}

function normalizarUnidadesPorContrato(raw: unknown): Record<string, string[]> {
  const origem = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const contratos = uniqueOrdered(
    Object.keys(origem).length > 0 ? Object.keys(origem) : [],
    OPCOES_CONVOCACAO_FALLBACK.contratos,
  )
  const out: Record<string, string[]> = {}
  for (const contrato of contratos) {
    const remotas = Array.isArray(origem[contrato]) ? origem[contrato] : []
    out[contrato] = uniqueOrdered(remotas, unidadesParaContrato(contrato))
  }
  for (const contrato of OPCOES_CONVOCACAO_FALLBACK.contratos) {
    if (!out[contrato]) out[contrato] = [...unidadesParaContrato(contrato)]
  }
  return out
}

function normalizarOpcoes(raw: unknown): ConvocacaoOpcoes {
  const data = (raw ?? {}) as Record<string, unknown>
  const opcoes = (data.opcoes ?? data) as Record<string, unknown>

  const unidadesRaw = opcoes.unidades_por_contrato ?? opcoes.unidadesPorContrato

  return {
    solicitantes: uniqueOrdered(
      opcoes.solicitantes ?? opcoes.solicitante,
      OPCOES_CONVOCACAO_FALLBACK.solicitantes,
    ),
    contratos: uniqueOrdered(
      opcoes.contratos ?? opcoes.contrato,
      OPCOES_CONVOCACAO_FALLBACK.contratos,
    ),
    sabados: uniqueOrdered(
      opcoes.sabados ?? opcoes.sabado,
      OPCOES_CONVOCACAO_FALLBACK.sabados,
    ),
    insalubridades: uniqueOrdered(
      opcoes.insalubridades ?? opcoes.insalubridade,
      OPCOES_CONVOCACAO_FALLBACK.insalubridades,
    ),
    interiores: uniqueOrdered(
      opcoes.interiores ?? opcoes.interior,
      OPCOES_CONVOCACAO_FALLBACK.interiores,
    ),
    justificativas: uniqueOrdered(
      opcoes.justificativas ?? opcoes.justificativa,
      OPCOES_CONVOCACAO_FALLBACK.justificativas,
    ),
    unidadesPorContrato: normalizarUnidadesPorContrato(unidadesRaw),
    unidadeColumnId: opcoes.unidade_column_id || opcoes.unidadeColumnId
      ? String(opcoes.unidade_column_id ?? opcoes.unidadeColumnId)
      : null,
  }
}

export async function buscarOpcoesConvocacao(): Promise<ConvocacaoOpcoes> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 200))
    return normalizarOpcoes(OPCOES_CONVOCACAO_FALLBACK)
  }

  const res = await fetch(`${BASE_URL}/intermitente-convocar-opcoes`)
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return normalizarOpcoes(await res.json())
}

export async function buscarEmpregado(
  nome: string,
): Promise<EmpregadoRM[]> {
  const query = nome.trim()
  if (query.length < 3) return []

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 250))
    const q = normaliza(query)
    return MOCK_EMPREGADOS.filter((e) => normaliza(e.nome).includes(q))
  }

  const res = await fetch(
    `${BASE_URL}/convocar-buscar-empregado?nome=${encodeURIComponent(query)}`,
  )
  if (!res.ok) {
    const err = new Error(`Erro ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const raw = await res.json()
  const lista: unknown[] = raw.resultados ?? []
  return lista.map((r) => {
    const o = r as Record<string, unknown>
    return {
      nome: String(o.nome ?? ""),
      chapa: String(o.chapa ?? ""),
      cpf: String(o.cpf ?? ""),
      funcao: String(o.funcao ?? ""),
      admissao: String(o.admissao ?? ""),
      secao: String(o.secao ?? ""),
      codcoligada: Number(o.codcoligada ?? 3),
      codigo: o.codigo ? String(o.codigo) : undefined,
      secaoCodigo: o.secaoCodigo || o.secao_codigo
        ? String(o.secaoCodigo ?? o.secao_codigo)
        : undefined,
      localUnidade: o.localUnidade || o.local_unidade
        ? String(o.localUnidade ?? o.local_unidade)
        : undefined,
      contrato: o.contrato ? String(o.contrato) : undefined,
      optanteVT:
        o.optante_vt === true ||
        o.optante_vt === "SIM" ||
        o.optante_vt === "SIM*" ||
        o.optanteVT === true,
      optanteVtLabel: String(o.optante_vt ?? o.optanteVtLabel ?? ""),
    }
  })
}

export async function criarConvocacao(
  payload: ConvocacaoPayload,
): Promise<ConvocacaoResposta> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 700))
    return {
      ok: true,
      itemId: `mock-${Date.now()}`,
      itemUrl: "#mock",
    }
  }

  const fd = new FormData()
  fd.append("name", payload.name)
  fd.append("empregado_nome", payload.empregado.nome)
  fd.append("empregado_chapa", payload.empregado.chapa)
  fd.append("empregado_cpf", payload.empregado.cpf)
  fd.append("empregado_funcao", payload.empregado.funcao)
  fd.append("empregado_admissao", payload.empregado.admissao)
  fd.append("empregado_secao", payload.empregado.secao)
  fd.append("empregado_codcoligada", String(payload.empregado.codcoligada))
  fd.append("optante_vt", payload.optanteVT)
  fd.append("escala", payload.escala)
  fd.append("solicitante", payload.solicitante)
  fd.append("contrato", payload.contrato)
  fd.append("local_unidade", payload.localUnidade)
  fd.append("sabado", payload.sabado)
  fd.append("insalubridade", payload.insalubridade)
  fd.append("interior", payload.interior)
  fd.append("data_inicio", payload.dataInicio)
  fd.append("data_fim", payload.dataFim)
  fd.append("justificativa", payload.justificativa)
  fd.append("empregado_substituido", payload.empregadoSubstituido)
  if (payload.termoConvocacao) {
    fd.append("termo_convocacao", payload.termoConvocacao)
  }
  if (payload.termoInsalubridade) {
    fd.append("termo_insalubridade", payload.termoInsalubridade)
  }
  anexarOperador(fd)

  const res = await fetch(`${BASE_URL}/intermitente-convocar`, {
    method: "POST",
    body: fd,
  })
  if (!res.ok) {
    let mensagem = `Erro ${res.status}`
    let erro: string | undefined
    let conflito: ConvocacaoConflito | undefined
    try {
      const data = await res.json()
      if (data?.mensagem) mensagem = String(data.mensagem)
      if (data?.erro) erro = String(data.erro)
      if (data?.conflito) conflito = data.conflito as ConvocacaoConflito
    } catch {
      // ignore
    }
    throw new ConvocacaoApiError(mensagem, {
      status: res.status,
      erro,
      conflito,
    })
  }
  const data = await res.json()
  return {
    ok: true,
    itemId: String(data.item_id ?? ""),
    itemUrl: String(data.item_url ?? ""),
  }
}
