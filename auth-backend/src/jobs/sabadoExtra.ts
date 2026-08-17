// Job do SÁBADO EXTRA — pedido VT na Caju (boleto PIX) + histórico e lançamento no RM.
//
// Substitui o WF `3TAyDuKFkWGvXTHT` (+ WF6). Roda como JOB e não dentro do request do
// `/preencher` por dois motivos: o operador não pode ficar esperando a Caju, e função
// serverless que morre no meio de um pagamento não deixa retomada — a fila deixa.
//
// PASSOS, avançados um por tick. Cada um tem chave própria em `pi.efeitos_externos`, então
// retomar nunca repete o que já confirmou:
//
//   0  employee na Caju (leitura)
//   1  pedido VT + confirmar PIX        <- DINHEIRO
//   2  histórico ZMDHSTBENFUNC (TPBEN=0)
//   3  lançamento financeiro evento 110
//
// A ORDEM importa e é a do WF: o histórico do boleto entra ANTES do FopRotinas, senão o
// lançamento não encontra o valor. Diferente do crédito no pontual, que entra DEPOIS.
import { config } from "../config.js"
import { avancar, reservarEfeito, confirmarEfeito, type Job } from "./repo.js"
import { buscarEmployeeId, criarPedido, confirmarPedido, categoriaVT, centsCaju } from "../clients/caju.js"
import { saveRecordDireto, contextoDataServer, temRmSoap } from "../clients/rmSoap.js"
import { RM_DATA_SERVER_HISTORICO } from "../mensal/rmEfeitos.js"
import { montarHistoricoSabados, montarLancamentoSabados, chaveEfeitoSabados } from "../sabados/rmSabados.js"
import type { PedidoSabados } from "../sabados/calculo.js"

export const TIPO_JOB_SABADO_EXTRA = "sabado_extra"

export interface PayloadSabadoExtra {
  pedido: PedidoSabados
  cpf: string
  codSecao: string
  dataImport: string
  /** Só pra log/artefato — o pagamento não depende dele. */
  item_origem_id?: string | null
}

export interface DepsSabadoExtra {
  buscarEmployeeId: typeof buscarEmployeeId
  criarPedido: typeof criarPedido
  confirmarPedido: typeof confirmarPedido
  saveRecord: typeof saveRecordDireto
  lancarFinanceiro: (p: ReturnType<typeof montarLancamentoSabados>) => Promise<unknown>
  habilitado: () => boolean
  temRm: () => boolean
}

const DEPS_PADRAO: DepsSabadoExtra = {
  buscarEmployeeId,
  criarPedido,
  confirmarPedido,
  saveRecord: saveRecordDireto,
  // O lançamento financeiro (FopRotinas + Integrar) é o mesmo do mensal/pontual. Fica como
  // dep injetável porque é o passo mais caro de simular em teste.
  lancarFinanceiro: async () => {
    throw new Error("lancamento_financeiro_nao_ligado")
  },
  habilitado: () => config.sabadoExtraHabilitado,
  temRm: temRmSoap,
}

/**
 * Nome do pedido na Caju. Formato do WF (`INT-<nome>-SAB-<dd/mm/aaaa>`, cortado em 27), e não
 * o do pontual: o DP concilia o painel da Caju pelo nome, e trocar o padrão faria o sábado
 * extra sumir da busca dele.
 */
export function montarNomePedidoSabados(nome: string, hojeIso: string): string {
  const [aaaa, mm, dd] = String(hojeIso).slice(0, 10).split("-")
  return `INT-${String(nome).trim().toUpperCase()}-SAB-${dd}/${mm}/${aaaa}`.slice(0, 27)
}

export function handlerSabadoExtra(deps: Partial<DepsSabadoExtra> = {}) {
  const d = { ...DEPS_PADRAO, ...deps }

  return async function handler(job: Job): Promise<void> {
    const p = job.payload as unknown as PayloadSabadoExtra
    const pedido = p?.pedido
    if (!pedido || !pedido.chapa || !(pedido.valorTotal > 0)) {
      await avancar(job.id, { estado: "falhou", erro: "payload_invalido: pedido/chapa/valorTotal" })
      return
    }
    const cursor = (job.cursor ?? {}) as Record<string, unknown>
    const simulado = !d.habilitado()

    // ── passo 0: employeeId na Caju ────────────────────────────────────────
    if (job.passo <= 0) {
      if (!p.cpf) {
        await avancar(job.id, { estado: "falhou", erro: "cpf_ausente: sem CPF não há como achar o employee na Caju" })
        return
      }
      const employeeId = simulado ? "SIMULADO" : await d.buscarEmployeeId(p.cpf)
      if (!employeeId) {
        // Erro NOMEADO, não genérico: foi o padrão de falha que custou execuções no WF5.
        await avancar(job.id, {
          estado: "falhou",
          erro: `pessoa_nao_cadastrada_na_caju: chapa=${pedido.chapa} nome=${pedido.nome}`,
        })
        return
      }
      await avancar(job.id, { estado: "pendente", passo: 1, cursor: { ...cursor, employeeId } })
      return
    }

    // ── passo 1: pedido VT + confirmar PIX — DINHEIRO ──────────────────────
    if (job.passo === 1) {
      const chave = chaveEfeitoSabados(pedido, "caju")
      const centavos = centsCaju(pedido.valorTotal)
      const reserva = await reservarEfeito(chave, "caju_pix", {
        chapa: pedido.chapa, sabados: pedido.sabados, valor: pedido.valorTotal, simulado,
      })
      if (reserva === "confirmado") {
        await avancar(job.id, { estado: "pendente", passo: 2, cursor })
        return
      }
      if (simulado) {
        await confirmarEfeito(chave, "SIMULADO", { nota: "flag SABADO_EXTRA_HABILITADO desligada" })
        await avancar(job.id, { estado: "pendente", passo: 2, cursor: { ...cursor, orderId: "SIMULADO" } })
        return
      }
      const name = montarNomePedidoSabados(pedido.nome, p.dataImport)
      const { orderId } = await d.criarPedido({
        sponsorId: config.caju.sponsorId,
        name,
        allowances: [{
          employeeId: String(cursor.employeeId),
          // VT só. Sábado extra não paga VR — é o dia de transporte que ele não teria.
          amounts: [{ category: categoriaVT(pedido.contrato, pedido.interior ? "SIM" : "NAO"), amount: centavos }],
        }],
      })
      if (!orderId) throw new Error("caju_sem_order_id")
      await d.confirmarPedido(orderId, { paymentStrategies: [{ paymentType: "PIX_CODE", amount: centavos }] })
      await confirmarEfeito(chave, orderId)
      await avancar(job.id, { estado: "pendente", passo: 2, cursor: { ...cursor, orderId } })
      return
    }

    // ── passo 2: histórico no RM (antes do FopRotinas) ─────────────────────
    if (job.passo === 2) {
      const chave = chaveEfeitoSabados(pedido, "rm_historico")
      const reserva = await reservarEfeito(chave, "rm_soap", { chapa: pedido.chapa, simulado })
      if (reserva === "confirmado") {
        await avancar(job.id, { estado: "pendente", passo: 3, cursor })
        return
      }
      const h = montarHistoricoSabados(pedido, { codSecao: p.codSecao, dataImport: p.dataImport })
      if (simulado || !d.temRm()) {
        await confirmarEfeito(chave, "SIMULADO", { nota: simulado ? "flag desligada" : "RM SOAP nao configurado" })
      } else {
        const r = await d.saveRecord(RM_DATA_SERVER_HISTORICO, h.dadosXml, contextoDataServer(3))
        await confirmarEfeito(chave, r.chave)
      }
      await avancar(job.id, { estado: "pendente", passo: 3, cursor })
      return
    }

    // ── passo 3: lançamento financeiro evento 110 ─────────────────────────
    const chave = chaveEfeitoSabados(pedido, "rm_financeiro")
    const reserva = await reservarEfeito(chave, "rm_soap", { chapa: pedido.chapa, evento: "110", simulado })
    if (reserva === "confirmado") {
      await avancar(job.id, { estado: "concluido" })
      return
    }
    if (simulado || !d.temRm()) {
      await confirmarEfeito(chave, "SIMULADO", { nota: simulado ? "flag desligada" : "RM SOAP nao configurado" })
      await avancar(job.id, { estado: "concluido" })
      return
    }
    await d.lancarFinanceiro(montarLancamentoSabados(pedido, { codSecao: p.codSecao }))
    await confirmarEfeito(chave)
    await avancar(job.id, { estado: "concluido" })
  }
}
