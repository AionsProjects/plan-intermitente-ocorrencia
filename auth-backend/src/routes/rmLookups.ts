// Lookups RM — CÓDIGO-PRINCIPAL (03/07). Portas fiéis dos WFs de leitura:
//  - intermitente-unidades-rm  (OggzTr5x — SQL 231375, unidades por contrato)
//  - celetista-buscar-empregado (0ljExfCN — SQL 2313, autocomplete CLT p/ atestados)
// (convocar-buscar-empregado já vive em convocar.ts — SQL BEN 2.)
// Read-only na ponte AIONS; nenhum write RM aqui.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { consultarSql } from "../clients/rm.js"

export const CONTRATOS_PF = [
  "SEMSA",
  "SEDUC ESCOLA",
  "SEDUC SEDE",
  "SEDUC INTERIOR",
  "DETRAN",
  "TRE PB",
  "CETAM",
] as const

// Contratos com unidades oficiais no RM. ADMINISTRATIVO só existe pra
// convocação (unidades no /convocar) — ponto facultativo segue em CONTRATOS_PF.
const CONTRATOS_RM = [...CONTRATOS_PF, "ADMINISTRATIVO"] as const

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
const normKey = (v: unknown) => norm(v).replace(/[^A-Z0-9]/g, "")

function field(row: Record<string, unknown>, candidatos: string[]): string {
  const alvo = candidatos.map(normKey)
  for (const [k, v] of Object.entries(row || {})) {
    if (alvo.includes(normKey(k))) return String(v ?? "")
  }
  return ""
}

function contratoPorCodigo(codigo: string): string | null {
  const c = String(codigo || "").trim()
  if (c.startsWith("01.01.0004")) return "DETRAN"
  if (c.startsWith("01.01.0007.04")) return "ADMINISTRATIVO"
  if (c.startsWith("01.01.0010")) return "SEDUC SEDE"
  if (c.startsWith("01.01.0011.01")) return "SEDUC ESCOLA"
  if (c.startsWith("01.01.0011.02")) return "SEDUC INTERIOR"
  if (c.startsWith("01.01.0074")) return "CETAM"
  if (c.startsWith("01.01.0079")) return "TRE PB"
  if (c.startsWith("01.01.0085")) return "SEMSA"
  return null
}

export interface UnidadesRm {
  ok: boolean
  unidades_por_contrato: Record<string, string[]>
  unidades: Array<{ codigo: string; contrato: string; unidade: string }>
  unidade_column_id: string
  contagens: Record<string, number>
}

/** Consulta as unidades oficiais do RM (SQL 231375) — usado pelo PF/opções. */
export async function unidadesRm(): Promise<UnidadesRm> {
  const rows = await consultarSql({ codigoSql: "231375", solicitante: "backend-intermitente-unidades-rm" })
  const porContrato: Record<string, string[]> = Object.fromEntries(CONTRATOS_RM.map((c) => [c, []]))
  const vistos: Record<string, Set<string>> = Object.fromEntries(CONTRATOS_RM.map((c) => [c, new Set()]))
  const unidades: Array<{ codigo: string; contrato: string; unidade: string }> = []
  for (const r of rows) {
    const codigo = field(r, ["Código", "Codigo", "CODIGO"]).trim()
    const unidade = field(r, ["Local/Unidade", "LOCAL/UNIDADE", "Local Unidade", "Unidade"]).trim()
    if (!codigo || !unidade) continue
    const contrato = contratoPorCodigo(codigo)
    if (!contrato) continue
    const key = norm(unidade)
    if (!vistos[contrato].has(key)) {
      vistos[contrato].add(key)
      porContrato[contrato].push(unidade)
      unidades.push({ codigo, contrato, unidade })
    }
  }
  for (const c of CONTRATOS_RM) porContrato[c].sort((a, b) => a.localeCompare(b, "pt-BR"))
  unidades.sort((a, b) => a.contrato.localeCompare(b.contrato, "pt-BR") || a.unidade.localeCompare(b.unidade, "pt-BR"))
  return {
    ok: true,
    unidades_por_contrato: porContrato,
    unidades,
    unidade_column_id: "dropdown_mm3mcnmn",
    contagens: Object.fromEntries(CONTRATOS_RM.map((c) => [c, porContrato[c].length])),
  }
}

function normalizaAdmissao(v: unknown): string {
  if (!v) return ""
  const s = String(v).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]!
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  return s
}

function inferirContrato(localUnidade: string, codigoSecao: string): string {
  const codigo = String(codigoSecao || "").trim()
  if (/(^|\.)0004(\.|$)/.test(codigo)) return "DETRAN"
  if (/(^|\.)0010(\.|$)/.test(codigo)) return "SEDUC SEDE"
  if (/(^|\.)0011\.01(\.|$)/.test(codigo)) return "SEDUC ESCOLA"
  if (/(^|\.)0011\.02(\.|$)/.test(codigo)) return "SEDUC INTERIOR"
  if (/(^|\.)0074(\.|$)/.test(codigo)) return "CETAM"
  if (/(^|\.)0079(\.|$)/.test(codigo)) return "TRE PB"
  if (/(^|\.)0085(\.|$)/.test(codigo)) return "SEMSA"
  const s = norm(localUnidade)
  if (!s) return ""
  if (s.includes("DETRAN")) return "DETRAN"
  if (s.includes("TRE")) return "TRE PB"
  if (s.includes("SEMSA")) return "SEMSA"
  if (s.includes("CETAM")) return "CETAM"
  if (s.includes("SEDUC INTERIOR")) return "SEDUC INTERIOR"
  if (s.includes("COORDENADORIA")) return "SEDUC COORDENADORIAS"
  if (s.includes("SEDUC ESCOLA") || s.includes("ESCOLA")) return "SEDUC ESCOLA"
  if (s.includes("SEDUC")) return "SEDUC SEDE"
  return String(localUnidade || "").split("-")[0]!.trim().toUpperCase()
}

const pick = (r: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = r[k]
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v)
  }
  return ""
}

export async function rotasRmLookups(app: FastifyInstance): Promise<void> {
  // Unidades oficiais do RM por contrato — GET /api/intermitente-unidades-rm
  app.get("/api/intermitente-unidades-rm", async (req, reply: FastifyReply) => {
    try {
      return await unidadesRm()
    } catch (e) {
      req.log.error(e, "unidades-rm falhou")
      return reply.code(503).send({ ok: false, erro: "rm_indisponivel", mensagem: (e as Error).message })
    }
  })

  // Autocomplete CLT (atestados) — GET /api/celetista-buscar-empregado?nome=
  app.get(
    "/api/celetista-buscar-empregado",
    async (req: FastifyRequest<{ Querystring: { nome?: string; ambiente?: string } }>, reply: FastifyReply) => {
      const nome = String(req.query.nome ?? "").trim()
      if (nome.length < 3) return { resultados: [] }
      try {
        const rows = await consultarSql({
          codigoSql: "2313",
          solicitante: "backend-celetista-buscar",
          ambiente: req.query.ambiente || "producao",
          parametros: { NOME: nome },
        })
        const resultados = rows
          .map((r) => {
            const codigo = pick(r, ["Código", "Codigo", "codigo"]).trim()
            const localUnidade = pick(r, ["Local/Unidade", "Seção", "Secao", "secao"]).trim()
            return {
              codigo,
              secaoCodigo: codigo,
              nome: pick(r, ["Nome do Funcionário", "Nome", "nome"]).trim(),
              chapa: pick(r, ["Funcionário", "Chapa", "chapa"]).trim(),
              cpf: pick(r, ["CPF", "cpf"]).trim(),
              funcao: pick(r, ["Função", "Funcao", "funcao"]).trim(),
              admissao: normalizaAdmissao(pick(r, ["Admissão", "Admissao", "admissao"])),
              secao: localUnidade,
              localUnidade,
              contrato: inferirContrato(localUnidade, codigo),
              codcoligada: 3,
            }
          })
          .filter((e) => e.nome.length > 0)
        const vistos = new Set<string>()
        const dedup = resultados.filter((r) => {
          const k = r.chapa || r.nome
          if (vistos.has(k)) return false
          vistos.add(k)
          return true
        })
        return { resultados: dedup }
      } catch (e) {
        req.log.error(e, "celetista-buscar falhou")
        return reply.code(503).send({ erro: "rm_indisponivel", mensagem: (e as Error).message, resultados: [] })
      }
    },
  )
}
