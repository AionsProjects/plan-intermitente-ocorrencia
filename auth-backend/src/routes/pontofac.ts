import type { FastifyInstance, FastifyRequest } from "fastify"
import { lerItens, texto, dataApenas } from "../clients/monday.js"
import { boardAtual } from "../repo/boards.js"
import { lerValores } from "../repo/valores.js"
import { resolverValores, naoDesconta, norm } from "../domain/desconto.js"
import { upsertDesconto } from "../repo/descontos.js"
import { reservarEfeito, confirmarEfeito } from "../jobs/repo.js"

// Ponto Facultativo (WFs Preview/Aplicar) — desconto em massa por contrato/unidade/data.
// Seleciona convocados no board Entrada que cobrem a data; DETRAN/TRE NÃO descontam (valor 0).
// Aplicar grava ledger pi.descontos (origem ponto_facultativo:...) idempotente via efeitos_externos.

const COL = {
  chapa: "texto",
  contrato: "color_mktcnxwn",
  unidadeTexto: "texto75",
  unidadeDrop: "dropdown_mm3mcnmn",
  dataInicio: "date_mktayxhb",
  dataFim: "date_mktasnwq",
  status: "color_mm3a8ana",
  optanteVt: "optante___vt",
  funcao: "texto0",
}

interface Afetado {
  item_id: string
  nome: string
  chapa: string
  contrato: string
  unidade: string
  vr: number
  vt: number
}

async function selecionar(contrato: string, unidade: string, data: string): Promise<Afetado[]> {
  const board = await boardAtual()
  if (!board) throw new Error("board_nao_resolvido")
  const itens = await lerItens(board)
  const linhas = await lerValores()
  const cN = norm(contrato)
  const uN = norm(unidade)
  const out: Afetado[] = []
  for (const it of itens) {
    if (norm(texto(it.cv, COL.contrato)) !== cN) continue
    const uni = texto(it.cv, COL.unidadeDrop) || texto(it.cv, COL.unidadeTexto) || ""
    if (uN && norm(uni) !== uN) continue
    const di = dataApenas(texto(it.cv, COL.dataInicio))
    const df = dataApenas(texto(it.cv, COL.dataFim))
    if (!di || !df || data < di || data > df) continue
    if (norm(texto(it.cv, COL.status)).includes("CANCELAD")) continue
    const v = resolverValores(linhas, { contrato, funcao: texto(it.cv, COL.funcao) ?? "" })
    let vr = "vrDia" in v ? v.vrDia : 0
    let vt = "vtDia" in v ? v.vtDia : 0
    const optante = norm(texto(it.cv, COL.optanteVt)).startsWith("SIM")
    if (!optante) vt = 0
    if (naoDesconta(contrato)) { vr = 0; vt = 0 } // DETRAN/TRE não descontam no ponto facultativo
    out.push({ item_id: it.id, nome: it.name, chapa: texto(it.cv, COL.chapa) ?? "", contrato, unidade: uni, vr, vt })
  }
  return out
}

export async function rotasPontoFacultativo(app: FastifyInstance): Promise<void> {
  // Preview — POST /api/ponto-facultativo-preview {contrato, unidade, data}
  app.post(
    "/api/ponto-facultativo-preview",
    async (req: FastifyRequest<{ Body: { contrato?: string; unidade?: string; data?: string } }>, reply) => {
      const { contrato = "", unidade = "", data = "" } = req.body ?? {}
      if (!contrato || !/^\d{4}-\d{2}-\d{2}$/.test(data))
        return reply.code(400).send({ erro: "parametros_invalidos" })
      let afetados: Afetado[]
      try {
        afetados = await selecionar(contrato, unidade, data)
      } catch (e) {
        return reply.code(502).send({ erro: "selecao_falhou", mensagem: (e as Error).message })
      }
      const total_vr = Math.round(afetados.reduce((s, a) => s + a.vr, 0) * 100) / 100
      const total_vt = Math.round(afetados.reduce((s, a) => s + a.vt, 0) * 100) / 100
      return { afetados, qtd: afetados.length, total_vr, total_vt }
    },
  )

  // Aplicar — POST /api/ponto-facultativo-aplicar {contrato, unidade, data}
  app.post(
    "/api/ponto-facultativo-aplicar",
    async (req: FastifyRequest<{ Body: { contrato?: string; unidade?: string; data?: string } }>, reply) => {
      const { contrato = "", unidade = "", data = "" } = req.body ?? {}
      if (!contrato || !/^\d{4}-\d{2}-\d{2}$/.test(data))
        return reply.code(400).send({ erro: "parametros_invalidos" })
      let afetados: Afetado[]
      try {
        afetados = await selecionar(contrato, unidade, data)
      } catch (e) {
        return reply.code(502).send({ erro: "selecao_falhou", mensagem: (e as Error).message })
      }
      const origem = `ponto_facultativo:${norm(contrato)}:${norm(unidade)}:${data}`
      let aplicados = 0
      let pulados = 0
      for (const a of afetados) {
        if (a.vr === 0 && a.vt === 0) { pulados++; continue }
        const chave = `${origem}:${a.chapa}`
        const r = await reservarEfeito(chave, "ponto_facultativo", { contrato, unidade, data })
        if (r === "confirmado") { pulados++; continue } // idempotente
        await upsertDesconto({
          uuid_convocacao: `pf:${chave}`, origem, nome: a.nome, chapa: a.chapa, contrato,
          data_inicio: data, data_fim: data, dias_perde_vr: a.vr > 0 ? 1 : 0, dias_perde_vt: a.vt > 0 ? 1 : 0,
          desconto_vr: a.vr, desconto_vt: a.vt, status: "PENDENTE",
        })
        await confirmarEfeito(chave)
        aplicados++
      }
      return { ok: true, origem, qtd: afetados.length, aplicados, pulados }
    },
  )
}
