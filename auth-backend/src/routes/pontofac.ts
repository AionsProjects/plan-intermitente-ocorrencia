import type { FastifyInstance, FastifyRequest } from "fastify"
import { lerItens, texto, dataApenas, gql } from "../clients/monday.js"
import { boardAtual } from "../repo/boards.js"
import { lerValores } from "../repo/valores.js"
import { resolverValores, naoDesconta, norm } from "../domain/desconto.js"
import { isFeriadoNacional } from "../domain/feriado.js"
import { upsertDesconto } from "../repo/descontos.js"
import { reservarEfeito, confirmarEfeito } from "../jobs/repo.js"
import { unidadesRm, CONTRATOS_PF } from "./rmLookups.js"
import {
  BOARD_HISTORICO,
  COL_HIST,
  textoCol,
  jsonCol,
  atualizarHistorico,
} from "../repo/historico.js"
import { BOARD_DESCONTOS, GRUPO_DESCONTOS, COL_DESC } from "../repo/boardDescontos.js"
import type { Ledger } from "../domain/ledgerBeneficios.js"
import type { MondayItem } from "../clients/monday.parse.js"

// Ponto Facultativo (WFs Opcoes/Preview/Aplicar) — CÓDIGO-PRINCIPAL (03/07).
// Porta fiel: preview valida (contrato/domingo/feriado/mês corrente) e deduplica
// contra o LEDGER do Histórico; aplicar grava o ledger no board Histórico + o
// item no board Descontos (origem PONTO FACULTATIVO) + espelho PG idempotente.
// Sem o ledger no board, o finalizar/cancelar descontariam o mesmo dia de novo.

const COL = {
  chapa: "texto",
  contrato: "color_mktcnxwn",
  cpf: "dup__of_matr_cula",
  unidadeTexto: "texto75",
  unidadeDrop: "dropdown_mm3ts726",
  unidadeDropLegado: "dropdown_mm3mcnmn",
  dataInicio: "date_mktayxhb",
  dataFim: "date_mktasnwq",
  status: "color_mm3a8ana",
  cancelInicio: "date_mm3b88ta",
  optanteVt: "optante___vt",
  optanteVtAlt: "color_mm34ry47",
  trabalhaSabado: "color_mktaavmp",
  funcao: "texto0",
}

// Coluna "Origem" do board Descontos (marca PONTO FACULTATIVO).
const COL_DESC_ORIGEM = "color_mm3kqmjy"

interface Afetado {
  item_entrada_id: string
  item_historico_id: string | null
  uuid: string | null
  nome: string
  chapa: string
  cpf: string | null
  contrato: string
  unidade: string
  funcao: string | null
  periodo_inicio: string
  periodo_fim: string
  data: string
  optante_vt: boolean
  vt_meia_volta: boolean
  trabalha_sabado: boolean
  aplica_vr: boolean
  aplica_vt: boolean
  valor_vr: number
  valor_vt: number
  total: number
  avisos: string[]
  regra_valores?: string
  _ledger?: Ledger
}

const round2 = (v: number) => Math.round(Number(v || 0) * 100) / 100
const chapaNorm = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0"
const normUnidade = (s: unknown) =>
  norm(s as string).replace(/[.,;:/\\|_()[\]{}-]+/g, " ").replace(/\s+/g, " ").trim()

function parseLista(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  const s = String(v ?? "").trim()
  return s ? [s] : []
}

function beneficiosValidos(v: unknown): Array<"VR" | "VT"> {
  const lista = parseLista(v).map((b) => b.toUpperCase()).filter((b) => b === "VR" || b === "VT") as Array<"VR" | "VT">
  return [...new Set(lista)]
}

// Fuzzy match unidade item×oficial (porta do WF: tokens + inclusão + levenshtein).
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[m]![n]!
}

function unidadeItemBate(valorItem: string, oficialNorm: string): boolean {
  const itemNorm = normUnidade(valorItem)
  if (!itemNorm) return false
  if (itemNorm === oficialNorm) return true
  if (itemNorm.includes(oficialNorm) || oficialNorm.includes(itemNorm)) return true
  const itemTokens = itemNorm.split(" ").filter((t) => t.length > 2)
  const oficialTokens = oficialNorm.split(" ").filter((t) => t.length > 2)
  if (oficialTokens.length === 0) return false
  const common = oficialTokens.filter((t) => itemTokens.includes(t)).length
  if (common / oficialTokens.length >= 0.75) return true
  const max = Math.max(itemNorm.length, oficialNorm.length) || 1
  return 1 - levenshtein(itemNorm, oficialNorm) / max >= 0.82
}

// Percentual já descontado no ledger (aceita 0..1 ou 0..100 — o WF grava ambos).
function pctLedger(entry: Record<string, unknown> | undefined, key: "vr" | "vt"): number {
  const p = Number(entry?.[`${key}_percentual`] ?? 0)
  if (p > 0) return p <= 1 ? p * 100 : p
  return entry?.[key] === true ? 100 : 0
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface ValidacaoErr {
  status: number
  erro: string
  mensagem: string
}

function validarPedido(contrato: string, unidades: string[], data: string, beneficios: string[]): ValidacaoErr | null {
  if (!(CONTRATOS_PF as readonly string[]).includes(contrato))
    return { status: 400, erro: "contrato_invalido", mensagem: "Contrato invalido para ponto facultativo." }
  if (!unidades.length)
    return { status: 400, erro: "unidades_obrigatorias", mensagem: "Informe ao menos uma unidade." }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data))
    return { status: 400, erro: "data_invalida", mensagem: "Informe a data em YYYY-MM-DD." }
  const mesAtual = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7)
  if (data.slice(0, 7) !== mesAtual)
    return { status: 400, erro: "fora_mes_corrente", mensagem: "Ponto facultativo so pode ser aplicado no mes corrente." }
  if (new Date(data + "T00:00:00Z").getUTCDay() === 0)
    return { status: 400, erro: "domingo_bloqueado", mensagem: "Domingo nao recebe ponto facultativo." }
  if (isFeriadoNacional(data))
    return { status: 400, erro: "feriado_bloqueado", mensagem: "Feriado nacional ja e bloqueado." }
  if (!beneficios.length)
    return { status: 400, erro: "beneficios_obrigatorios", mensagem: "Selecione VR, VT ou ambos." }
  return null
}

const STATUS_IGNORAR = new Set(["CANCELADA", "CANCELADO", "BLOQUEADA - CONFLITO"])

async function selecionar(
  contrato: string,
  unidades: string[],
  data: string,
  beneficios: Array<"VR" | "VT">,
): Promise<Afetado[]> {
  const board = await boardAtual()
  if (!board) throw new Error("board_nao_resolvido")
  const [itens, historicos, linhas] = await Promise.all([
    lerItens(board),
    lerItens(BOARD_HISTORICO),
    lerValores(),
  ])
  const unidadesNorm = unidades.map(normUnidade).filter(Boolean)
  const querVR = beneficios.includes("VR")
  const querVT = beneficios.includes("VT")
  const isSab = new Date(data + "T00:00:00Z").getUTCDay() === 6

  // Histórico por chapa+dataInicio (mesmo índice do WF).
  const histMap = new Map<string, MondayItem>()
  for (const h of historicos) {
    histMap.set(`${chapaNorm(textoCol(h, COL_HIST.chapa))}|${textoCol(h, COL_HIST.dataInicio) ?? ""}`, h)
  }

  const out: Afetado[] = []
  for (const it of itens) {
    if (norm(texto(it.cv, COL.contrato)) !== norm(contrato)) continue
    const unidadeReal = texto(it.cv, COL.unidadeDrop) || texto(it.cv, COL.unidadeDropLegado) || texto(it.cv, COL.unidadeTexto) || ""
    const uMatch = unidadesNorm.find((u) => unidadeItemBate(unidadeReal, u))
    if (!uMatch) continue

    const di = dataApenas(texto(it.cv, COL.dataInicio))
    const df = dataApenas(texto(it.cv, COL.dataFim))
    if (!di || !df) continue
    const st = norm(texto(it.cv, COL.status))
    if (STATUS_IGNORAR.has(st)) continue
    // Cancelamento parcial: só vale até a véspera do início do cancelamento.
    let fimEf = df
    const canc = dataApenas(texto(it.cv, COL.cancelInicio))
    if (/PARCIAL/.test(st) && canc) fimEf = addDays(canc, -1)
    if (data < di || data > fimEf) continue

    const chapa = texto(it.cv, COL.chapa) ?? ""
    let hist = histMap.get(`${chapaNorm(chapa)}|${di}`) ?? null
    if (!hist) {
      hist =
        historicos.find((h) => {
          const hdi = textoCol(h, COL_HIST.dataInicio)
          return chapaNorm(textoCol(h, COL_HIST.chapa)) === chapaNorm(chapa) && !!hdi && hdi >= di && hdi <= df
        }) ?? null
    }
    const sabadosExtras = (hist ? textoCol(hist, COL_HIST.sabadosExtras) ?? "" : "")
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    const trabalhaSab =
      /SIM/.test(norm(texto(it.cv, COL.trabalhaSabado)) || (hist ? norm(textoCol(hist, COL_HIST.trabalhaSabado)) : "")) ||
      sabadosExtras.includes(data)
    if (isSab && !trabalhaSab) continue

    const optanteRaw = norm(texto(it.cv, COL.optanteVt) || texto(it.cv, COL.optanteVtAlt))
    const optanteVT = optanteRaw.includes("SIM")
    const vtMeiaVolta = optanteRaw.includes("SIM*")

    const ledger = hist ? jsonCol<Ledger>(hist, COL_HIST.ledgerBeneficios, {}) : {}
    const entry = ledger[data] as Record<string, unknown> | undefined
    const vrJa = pctLedger(entry, "vr") >= 100
    const vtJa = pctLedger(entry, "vt") >= 100

    const funcao = texto(it.cv, COL.funcao) ?? ""
    const valores = resolverValores(linhas, { contrato, funcao })
    const vrDia = "vrDia" in valores ? valores.vrDia : 0
    const vtDia = "vtDia" in valores ? valores.vtDia : 0

    const avisos: string[] = []
    let valorVR = 0
    let valorVT = 0
    let aplicaVR = false
    let aplicaVT = false
    if (querVR) {
      if (isSab) avisos.push("VR nao aplicado em sabado")
      else if (vrJa) avisos.push("VR ja descontado no ledger")
      else {
        aplicaVR = true
        valorVR = vrDia
      }
    }
    if (querVT) {
      if (!optanteVT) avisos.push("Nao optante VT")
      else if (vtJa) avisos.push("VT ja descontado no ledger")
      else {
        aplicaVT = true
        valorVT = vtMeiaVolta ? round2(vtDia / 2) : vtDia
      }
    }
    // Contratos que NUNCA descontam (DETRAN/TRE PB + SEDUC*): declara, desconto 0.
    if (naoDesconta(contrato)) {
      aplicaVR = false
      aplicaVT = false
      valorVR = 0
      valorVT = 0
      avisos.push("Contrato nao desconta beneficio")
    }

    out.push({
      item_entrada_id: it.id,
      item_historico_id: hist ? hist.id : null,
      uuid: hist ? textoCol(hist, COL_HIST.uuid) : null,
      nome: it.name,
      chapa,
      cpf: texto(it.cv, COL.cpf) || null,
      contrato,
      unidade: unidadeReal,
      funcao: funcao || null,
      periodo_inicio: di,
      periodo_fim: fimEf,
      data,
      optante_vt: optanteVT,
      vt_meia_volta: vtMeiaVolta,
      trabalha_sabado: trabalhaSab,
      aplica_vr: aplicaVR,
      aplica_vt: aplicaVT,
      valor_vr: round2(valorVR),
      valor_vt: round2(valorVT),
      total: round2(valorVR + valorVT),
      avisos,
      regra_valores: "regraAplicada" in valores ? valores.regraAplicada : undefined,
      _ledger: ledger,
    })
  }
  return out
}

function montarPreview(
  contrato: string,
  unidades: string[],
  data: string,
  beneficios: Array<"VR" | "VT">,
  itens: Afetado[],
) {
  const publicos = itens.map(({ _ledger, ...i }) => i)
  const totalVR = round2(publicos.reduce((s, a) => s + a.valor_vr, 0))
  const totalVT = round2(publicos.reduce((s, a) => s + a.valor_vt, 0))
  return {
    ok: true,
    contrato,
    unidades,
    data,
    beneficios,
    aviso: publicos.length === 0 ? "sem_intermitentes_unidade_data" : null,
    total_colaboradores: publicos.length,
    total_vr: totalVR,
    total_vt: totalVT,
    total: round2(totalVR + totalVT),
    itens: publicos,
  }
}

// Board Descontos: item PF existente (mesma chapa + data + origem PONTO FACULTATIVO).
async function buscarDescontoPfExistente(): Promise<MondayItem[]> {
  return lerItens(BOARD_DESCONTOS)
}

export async function rotasPontoFacultativo(app: FastifyInstance): Promise<void> {
  app.get("/api/ponto-facultativo-opcoes", async (req, reply) => {
    try {
      const board = await boardAtual()
      if (!board) return reply.code(502).send({ erro: "board_nao_resolvido" })

      const [rm, itens] = await Promise.all([unidadesRm(), lerItens(board)])
      const counts: Record<string, Map<string, number>> = {}
      for (const contrato of CONTRATOS_PF) counts[contrato] = new Map<string, number>()

      for (const it of itens) {
        const contrato = CONTRATOS_PF.find((c) => norm(c) === norm(texto(it.cv, COL.contrato)))
        if (!contrato) continue
        if (norm(texto(it.cv, COL.status)).includes("CANCELAD")) continue
        const unidade = texto(it.cv, COL.unidadeDrop) || texto(it.cv, COL.unidadeDropLegado) || texto(it.cv, COL.unidadeTexto) || ""
        if (!unidade) continue
        counts[contrato]!.set(unidade, (counts[contrato]!.get(unidade) ?? 0) + 1)
      }

      const unidades_por_contrato: Record<string, Array<{ label: string; qtd_intermitentes: number; _fora_rm?: boolean }>> = {}
      const contagens: Record<string, number> = {}
      for (const contrato of CONTRATOS_PF) {
        const oficiais = rm.unidades_por_contrato[contrato] ?? []
        const mapa = counts[contrato]!
        // agrega as contagens dos itens nas unidades OFICIAIS (fuzzy — WF opcoes)
        const porOficial = new Map<string, number>()
        const fora: Array<{ label: string; qtd_intermitentes: number; _fora_rm: true }> = []
        for (const [label, qtd] of mapa) {
          const oficial = oficiais.find((o) => unidadeItemBate(label, normUnidade(o)))
          if (oficial) porOficial.set(oficial, (porOficial.get(oficial) ?? 0) + qtd)
          else fora.push({ label, qtd_intermitentes: qtd, _fora_rm: true })
        }
        const lista: Array<{ label: string; qtd_intermitentes: number; _fora_rm?: boolean }> =
          oficiais.map((label) => ({ label, qtd_intermitentes: porOficial.get(label) ?? 0 }))
        lista.push(...fora)
        unidades_por_contrato[contrato] = lista
        contagens[contrato] = Array.from(mapa.values()).reduce((s, n) => s + n, 0)
      }

      return {
        ok: true,
        unidades_por_contrato,
        unidade_column_id: COL.unidadeDrop,
        contagens,
        mes_referencia: new Date().toISOString().slice(0, 7),
      }
    } catch (e) {
      req.log.error(e, "ponto-facultativo-opcoes falhou")
      return reply.code(502).send({ erro: "opcoes_falhou", mensagem: (e as Error).message })
    }
  })

  app.post(
    "/api/ponto-facultativo-preview",
    async (
      req: FastifyRequest<{ Body: { contrato?: string; unidade?: string; unidades?: string[]; data?: string; beneficios?: string[] } }>,
      reply,
    ) => {
      const contrato = String(req.body?.contrato ?? "").trim().toUpperCase()
      const unidades = parseLista(req.body?.unidades?.length ? req.body.unidades : req.body?.unidade)
      const beneficios = beneficiosValidos(req.body?.beneficios)
      const data = String(req.body?.data ?? "").trim()
      const err = validarPedido(contrato, unidades, data, beneficios)
      if (err) return reply.code(err.status).send({ ok: false, erro: err.erro, mensagem: err.mensagem })
      try {
        const afetados = await selecionar(contrato, unidades, data, beneficios)
        return montarPreview(contrato, unidades, data, beneficios, afetados)
      } catch (e) {
        return reply.code(502).send({ erro: "selecao_falhou", mensagem: (e as Error).message })
      }
    },
  )

  app.post(
    "/api/ponto-facultativo-aplicar",
    async (
      req: FastifyRequest<{ Body: { contrato?: string; unidade?: string; unidades?: string[]; data?: string; beneficios?: string[] } }>,
      reply,
    ) => {
      const contrato = String(req.body?.contrato ?? "").trim().toUpperCase()
      const unidades = parseLista(req.body?.unidades?.length ? req.body.unidades : req.body?.unidade)
      const beneficios = beneficiosValidos(req.body?.beneficios)
      const data = String(req.body?.data ?? "").trim()
      const err = validarPedido(contrato, unidades, data, beneficios)
      if (err) return reply.code(err.status).send({ ok: false, erro: err.erro, mensagem: err.mensagem })

      let afetados: Afetado[]
      try {
        afetados = await selecionar(contrato, unidades, data, beneficios)
      } catch (e) {
        return reply.code(502).send({ erro: "selecao_falhou", mensagem: (e as Error).message })
      }
      if (afetados.filter((a) => a.aplica_vr || a.aplica_vt).length === 0) {
        return reply.code(409).send({
          ...montarPreview(contrato, unidades, data, beneficios, afetados),
          ok: false,
          erro: "sem_intermitentes_para_aplicar",
          mensagem: "Nenhum intermitente convocado nesta unidade para esta data.",
          processados: 0,
          ignorados: afetados.length,
        })
      }

      // Descontos PF já existentes no board (chapa+data+origem PONTO FACULTATIVO).
      let descontosBoard: MondayItem[] = []
      try {
        descontosBoard = await buscarDescontoPfExistente()
      } catch (e) {
        req.log.warn(e, "pf: leitura board descontos falhou")
      }
      const achaDesconto = (a: Afetado) =>
        descontosBoard.find(
          (d) =>
            chapaNorm(d.cv[COL_DESC.matricula]?.text) === chapaNorm(a.chapa) &&
            (d.cv[COL_DESC.dataInicio]?.text || "") === a.data &&
            (d.cv[COL_DESC.dataFim]?.text || "") === a.data &&
            norm(d.cv[COL_DESC_ORIGEM]?.text ?? "").includes("PONTO FACULTATIVO"),
        )

      let processados = 0
      let ignorados = 0
      for (const a of afetados) {
        if (!a.aplica_vr && !a.aplica_vt) {
          ignorados++
          continue
        }
        // ── 1. Ledger no Histórico (dedupe cross-fluxo: finalizar/cancelar respeitam) ──
        const ledger = a._ledger ?? {}
        const atual = (ledger[a.data] ?? { vr: false, vt: false, origens: [] }) as Ledger[string]
        if (!Array.isArray(atual.origens)) atual.origens = []
        const origem = `ponto_facultativo:${contrato}:${normUnidade(a.unidade).replace(/\s+/g, "_") || "UNIDADE"}:${a.data}`
        if (a.aplica_vr) {
          atual.vr = true
          atual.vr_percentual = 100
        }
        if (a.aplica_vt) {
          atual.vt = true
          atual.vt_percentual = 100
        }
        if (!atual.origens.includes(origem)) atual.origens.push(origem)
        ledger[a.data] = atual
        if (a.item_historico_id) {
          await atualizarHistorico(a.item_historico_id, {
            [COL_HIST.ledgerBeneficios]: { text: JSON.stringify(ledger) },
          }).catch((e) => req.log.warn(e, `pf: ledger historico ${a.item_historico_id} falhou`))
        }

        // ── 2. Board Descontos (create ou incremento — fiel ao WF) ──
        const existente = a.item_historico_id ? achaDesconto(a) : undefined
        if (!a.item_historico_id && achaDesconto(a)) {
          // WF: sem histórico e desconto já existe → ignora (não duplica).
          ignorados++
          continue
        }
        try {
          if (existente) {
            const numTx = (col: string) => Number(String(existente.cv[col]?.text ?? "0").replace(",", ".")) || 0
            const values = {
              [COL_DESC.diasPerdeVR]: String((a.aplica_vr ? 1 : 0) + numTx(COL_DESC.diasPerdeVR)),
              [COL_DESC.diasPerdeVT]: String((a.aplica_vt ? 1 : 0) + numTx(COL_DESC.diasPerdeVT)),
              [COL_DESC.descontoVR]: String(round2(numTx(COL_DESC.descontoVR) + a.valor_vr)),
              [COL_DESC.descontoVT]: String(round2(numTx(COL_DESC.descontoVT) + a.valor_vt)),
              [COL_DESC.residualVR]: String(round2(numTx(COL_DESC.residualVR) + a.valor_vr)),
              [COL_DESC.residualVT]: String(round2(numTx(COL_DESC.residualVT) + a.valor_vt)),
              [COL_DESC.status]: { label: numTx(COL_DESC.descontadoVR) || numTx(COL_DESC.descontadoVT) ? "PARCIAL" : "PENDENTE" },
              [COL_DESC_ORIGEM]: { label: "PONTO FACULTATIVO" },
            }
            await gql(
              `mutation($b:ID!,$i:ID!,$v:JSON!){ change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true){ id } }`,
              { b: String(BOARD_DESCONTOS), i: existente.id, v: JSON.stringify(values) },
            )
          } else {
            const values: Record<string, unknown> = {
              [COL_DESC.nome]: { labels: [a.nome] },
              [COL_DESC.matricula]: String(a.chapa || ""),
              [COL_DESC.cpf]: String(a.cpf || ""),
              [COL_DESC.dataInicio]: { date: a.data },
              [COL_DESC.dataFim]: { date: a.data },
              [COL_DESC.diasPerdeVR]: String(a.aplica_vr ? 1 : 0),
              [COL_DESC.diasPerdeVT]: String(a.aplica_vt ? 1 : 0),
              [COL_DESC.qtdAtrasos]: "0",
              [COL_DESC.descontoVR]: String(a.valor_vr),
              [COL_DESC.descontoVT]: String(a.valor_vt),
              [COL_DESC.status]: { label: "PENDENTE" },
              [COL_DESC.residualVR]: String(a.valor_vr),
              [COL_DESC.residualVT]: String(a.valor_vt),
              [COL_DESC.descontadoVR]: "0",
              [COL_DESC.descontadoVT]: "0",
              [COL_DESC_ORIGEM]: { label: "PONTO FACULTATIVO" },
            }
            await gql(
              `mutation($b:ID!,$g:String!,$n:String!,$v:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true){ id } }`,
              { b: String(BOARD_DESCONTOS), g: GRUPO_DESCONTOS, n: "PONTO FACULTATIVO", v: JSON.stringify(values) },
            )
          }
        } catch (e) {
          req.log.error(e, `pf: board descontos ${a.chapa} falhou`)
          ignorados++
          continue
        }

        // ── 3. Espelho PG (idempotente via efeitos_externos) ──
        const chave = `${origem}:${a.chapa}`
        const reservado = await reservarEfeito(chave, "ponto_facultativo", { contrato, unidade: a.unidade, data, beneficios })
        if (reservado !== "confirmado") {
          await upsertDesconto({
            uuid_convocacao: a.uuid || `pf:${chave}`,
            origem,
            nome: a.nome,
            chapa: a.chapa,
            contrato,
            data_inicio: a.data,
            data_fim: a.data,
            dias_perde_vr: a.aplica_vr ? 1 : 0,
            dias_perde_vt: a.aplica_vt ? 1 : 0,
            desconto_vr: a.valor_vr,
            desconto_vt: a.valor_vt,
            status: "PENDENTE",
          }).catch((e) => req.log.warn(e, "pf: espelho PG falhou"))
          await confirmarEfeito(chave)
        }
        processados++
      }

      return {
        ...montarPreview(contrato, unidades, data, beneficios, afetados),
        processados,
        ignorados,
      }
    },
  )
}
