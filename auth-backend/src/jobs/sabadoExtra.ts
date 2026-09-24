// Job do SÁBADO EXTRA — crédito de VT na Caju, débito no Controle Caju, balãozinho no item do
// Plano e histórico no RM.
//
// Substitui o WF `3TAyDuKFkWGvXTHT` (+ WF6). Roda como JOB e não dentro do request do
// `/preencher` por dois motivos: o operador não pode ficar esperando a Caju, e função
// serverless que morre no meio de um pagamento não deixa retomada — a fila deixa.
//
// CRÉDITO, não boleto (pedido do DP em 14/09/2026, decisão do Isaac em 24/09): é só VT e só dos
// sábados, então sai inteiro do saldo da empresa na Caju — sem PIX, sem Solicitação de
// Pagamento e sem lançamento financeiro no RM (o mesmo "100% crédito" do pontual). E o crédito é
// CONFIRMADO aqui: Rascunho não chega na pessoa e não tem nota de débito.
//
// PASSOS, avançados um por tick. Cada um tem chave própria em `pi.efeitos_externos`, então
// retomar nunca repete o que já confirmou:
//
//   0  employee na Caju (leitura)
//   1  pedido de crédito VT + confirmar (EXISTING_BALANCE)   <- DINHEIRO
//   2  débito no Controle Caju (o board de controle do saldo)
//   3  balãozinho no item do Plano: houve sábado extra, quanto e qual pedido
//   4  histórico ZMDHSTBENFUNC (TPBEN=1)
//
// A ORDEM segue a lição do pontual (RAIMUNDA/NATALIA, 02/09): o que registra o dinheiro no
// Monday vem logo depois do dinheiro, e o RM por último — RM fora do ar não pode deixar um
// crédito pago sem rastro no board.
//
// SIMULADO x REAL é decidido UMA vez, no passo 0, e fica no cursor: mexer na flag no meio do
// job não mistura pedido simulado com efeito real. A simulação grava em chave própria
// (`sabado_extra-sim:<job>:<alvo>`, o mesmo desenho do `pontual-sim:`) e nunca toca a chave
// real. Até 24/09/2026 ela confirmava a chave REAL com "SIMULADO": o sábado registrado com a
// flag desligada ficava "já pago" no ledger e, depois de ligar, nunca mais pagava.
import { config } from "../config.js"
import { avancar, reservarEfeito, confirmarEfeito, detalheEfeito, type Job } from "./repo.js"
import {
  buscarEmployeeId,
  criarPedido,
  confirmarPedido,
  categoriaVT,
  centsCaju,
  summaryUrlCaju,
} from "../clients/caju.js"
import { saveRecordDireto, contextoDataServer, temRmSoap } from "../clients/rmSoap.js"
import { RM_DATA_SERVER_HISTORICO } from "../mensal/rmEfeitos.js"
import { garantirGrupoCaixa, registrarDebitoControleCaju } from "../mensal/mondayEfeitos.js"
import { criarUpdate } from "../monday.js"
import {
  montarHistoricoSabados,
  chaveEfeitoSabados,
  chaveEfeitoSabadosSimulado,
  type AlvoEfeitoSabados,
} from "../sabados/rmSabados.js"
import { montarNomeDebitoSabados, montarTextoBalaoSabados } from "../sabados/mondaySabados.js"
import type { PedidoSabados } from "../sabados/calculo.js"

export const TIPO_JOB_SABADO_EXTRA = "sabado_extra"

export interface PayloadSabadoExtra {
  pedido: PedidoSabados
  cpf: string
  codSecao: string
  dataImport: string
  /** Item da convocação no Plano — onde o balãozinho é escrito. Sem ele, o balão é pulado. */
  item_origem_id?: string | null
}

export interface DepsSabadoExtra {
  buscarEmployeeId: typeof buscarEmployeeId
  criarPedido: typeof criarPedido
  confirmarPedido: typeof confirmarPedido
  saveRecord: typeof saveRecordDireto
  /** Gaveta do mês de caixa no Controle Caju (acha por título, cria se faltar). */
  garantirGrupoControle: () => Promise<string>
  registrarDebitoControle: typeof registrarDebitoControleCaju
  criarUpdate: typeof criarUpdate
  habilitado: () => boolean
  temRm: () => boolean
  /** Fila e ledger. Injetáveis pra o teste percorrer os passos sem Postgres. */
  avancar: typeof avancar
  reservarEfeito: typeof reservarEfeito
  confirmarEfeito: typeof confirmarEfeito
  detalheEfeito: typeof detalheEfeito
}

const DEPS_PADRAO: DepsSabadoExtra = {
  buscarEmployeeId,
  criarPedido,
  confirmarPedido,
  saveRecord: saveRecordDireto,
  garantirGrupoControle: () => garantirGrupoCaixa("controle"),
  registrarDebitoControle: registrarDebitoControleCaju,
  criarUpdate,
  habilitado: () => config.sabadoExtraHabilitado,
  temRm: temRmSoap,
  avancar,
  reservarEfeito,
  confirmarEfeito,
  detalheEfeito,
}

/** Rótulo do mês do Controle Caju — o mesmo `MESES_LABEL` do pontual. */
const MESES_LABEL = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]

/**
 * Nome do pedido na Caju. Formato do WF (`INT-<nome>-SAB-<dd/mm/aaaa>`, cortado em 27), e não
 * o do pontual: o DP concilia o painel da Caju pelo nome, e trocar o padrão faria o sábado
 * extra sumir da busca dele.
 */
export function montarNomePedidoSabados(nome: string, hojeIso: string): string {
  const [aaaa, mm, dd] = String(hojeIso).slice(0, 10).split("-")
  return `INT-${String(nome).trim().toUpperCase()}-SAB-${dd}/${mm}/${aaaa}`.slice(0, 27)
}

/** Id do pedido gravado no ledger pelo passo 1 (`confirmarEfeito(chave, orderId)`). */
function orderIdDaRef(ref: string | null | undefined): string | null {
  const id = String(ref ?? "").trim()
  return id && id !== "SIMULADO" ? id : null
}

export function handlerSabadoExtra(deps: Partial<DepsSabadoExtra> = {}) {
  const d = { ...DEPS_PADRAO, ...deps }

  return async function handler(job: Job): Promise<void> {
    const p = job.payload as unknown as PayloadSabadoExtra
    const pedido = p?.pedido
    if (!pedido || !pedido.chapa || !(pedido.valorTotal > 0)) {
      await d.avancar(job.id, { estado: "falhou", erro: "payload_invalido: pedido/chapa/valorTotal" })
      return
    }
    const cursor = (job.cursor ?? {}) as Record<string, unknown>
    // Congelado no passo 0. Job sem a marca (enfileirado antes dela) cai na flag de agora.
    const simulado = typeof cursor.simulado === "boolean" ? cursor.simulado : !d.habilitado()
    const chave = (alvo: AlvoEfeitoSabados) =>
      simulado ? chaveEfeitoSabadosSimulado(job.id, alvo) : chaveEfeitoSabados(pedido, alvo)
    const hojeIso = String(p.dataImport || new Date().toISOString()).slice(0, 10)

    /**
     * Reserva do passo. Em modo REAL, `pendente` quer dizer que uma tentativa anterior reservou e
     * morreu antes de confirmar: o pedido na Caju (ou o registro no board/RM) pode já existir, e
     * refazer pagaria ou gravaria duas vezes. Para com erro nomeado e pede conciliação, como o
     * pontual.
     */
    async function reservar(
      alvo: AlvoEfeitoSabados,
      tipo: string,
      dados: Record<string, unknown>,
    ): Promise<"seguir" | "pular" | "parar"> {
      const reserva = await d.reservarEfeito(chave(alvo), tipo, { ...dados, simulado })
      if (reserva === "confirmado") return "pular"
      if (reserva === "pendente" && !simulado) {
        await d.avancar(job.id, { estado: "falhou", erro: `efeito_pendente_requer_conciliacao: ${chave(alvo)}` })
        return "parar"
      }
      return "seguir"
    }

    // ── passo 0: employeeId na Caju ────────────────────────────────────────
    if (job.passo <= 0) {
      if (!p.cpf) {
        await d.avancar(job.id, { estado: "falhou", erro: "cpf_ausente: sem CPF não há como achar o employee na Caju" })
        return
      }
      const employeeId = simulado ? "SIMULADO" : await d.buscarEmployeeId(p.cpf)
      if (!employeeId) {
        // Erro NOMEADO, não genérico: foi o padrão de falha que custou execuções no WF5.
        await d.avancar(job.id, {
          estado: "falhou",
          erro: `pessoa_nao_cadastrada_na_caju: chapa=${pedido.chapa} nome=${pedido.nome}`,
        })
        return
      }
      await d.avancar(job.id, { estado: "pendente", passo: 1, cursor: { ...cursor, employeeId, simulado } })
      return
    }

    // ── passo 1: pedido de crédito VT + confirmar — DINHEIRO ───────────────
    if (job.passo === 1) {
      const r = await reservar("caju", "caju_credito", {
        chapa: pedido.chapa, sabados: pedido.sabados, valor: pedido.valorTotal,
      })
      if (r === "parar") return
      if (r === "pular") {
        // Retomada depois de confirmar: o id do pedido só sobrevive no ledger.
        const det = await d.detalheEfeito(chave("caju"))
        const orderId = orderIdDaRef(det?.refExterna) ?? (cursor.orderId as string | undefined) ?? null
        await d.avancar(job.id, { estado: "pendente", passo: 2, cursor: { ...cursor, orderId } })
        return
      }
      if (simulado) {
        await d.confirmarEfeito(chave("caju"), "SIMULADO", { nota: "flag SABADO_EXTRA_HABILITADO desligada" })
        await d.avancar(job.id, { estado: "pendente", passo: 2, cursor: { ...cursor, orderId: null } })
        return
      }
      const centavos = centsCaju(pedido.valorTotal)
      const { orderId } = await d.criarPedido({
        sponsorId: config.caju.sponsorId,
        name: montarNomePedidoSabados(pedido.nome, hojeIso),
        allowances: [{
          employeeId: String(cursor.employeeId),
          // VT só. Sábado extra não paga VR — é o dia de transporte que ele não teria.
          amounts: [{ category: categoriaVT(pedido.contrato, pedido.interior ? "SIM" : "NAO"), amount: centavos }],
        }],
      })
      if (!orderId) throw new Error("caju_sem_order_id")
      // Confirmar é o que paga: crédito sai do saldo da empresa (`EXISTING_BALANCE`).
      await d.confirmarPedido(orderId, { paymentStrategies: [{ paymentType: "EXISTING_BALANCE", amount: centavos }] })
      await d.confirmarEfeito(chave("caju"), orderId)
      await d.avancar(job.id, { estado: "pendente", passo: 2, cursor: { ...cursor, orderId } })
      return
    }

    const orderId = (cursor.orderId as string | null | undefined) ?? null

    // ── passo 2: débito no Controle Caju ───────────────────────────────────
    if (job.passo === 2) {
      const r = await reservar("controle_caju", "monday_controle_caju", { chapa: pedido.chapa, valor: pedido.valorTotal })
      if (r === "parar") return
      if (r === "seguir") {
        if (simulado) {
          await d.confirmarEfeito(chave("controle_caju"), "SIMULADO", { nota: "flag desligada" })
        } else {
          const res = await d.registrarDebitoControle({
            grupoControleCaju: await d.garantirGrupoControle(),
            contrato: pedido.contrato,
            competenciaLabel: MESES_LABEL[Number(hojeIso.slice(5, 7)) - 1]!,
            anoComp: Number(hojeIso.slice(0, 4)),
            totalCredito: pedido.valorTotal,
            pedidoCreditoId: orderId,
            dataIso: hojeIso,
            nomeItem: montarNomeDebitoSabados(pedido.nome, hojeIso),
          })
          await d.confirmarEfeito(
            chave("controle_caju"),
            "id" in res ? `monday:controle_caju:${res.id}` : `monday:controle_caju:${res.motivo}`,
          )
        }
      }
      await d.avancar(job.id, { estado: "pendente", passo: 3, cursor })
      return
    }

    // ── passo 3: balãozinho no item do Plano ───────────────────────────────
    if (job.passo === 3) {
      const r = await reservar("balao", "monday_balao", { chapa: pedido.chapa, item: p.item_origem_id ?? null })
      if (r === "parar") return
      if (r === "seguir") {
        if (simulado) {
          await d.confirmarEfeito(chave("balao"), "SIMULADO", { nota: "flag desligada" })
        } else if (!p.item_origem_id) {
          // Sem o item não há onde escrever; o pagamento já está no Controle Caju.
          await d.confirmarEfeito(chave("balao"), "monday:balao:sem_item")
        } else {
          const texto = montarTextoBalaoSabados(pedido, { orderId, summaryUrl: summaryUrlCaju(orderId) })
          const updateId = await d.criarUpdate(String(p.item_origem_id), texto)
          await d.confirmarEfeito(chave("balao"), `monday:balao:${updateId ?? "sem-id"}`)
        }
      }
      await d.avancar(job.id, { estado: "pendente", passo: 4, cursor })
      return
    }

    // ── passo 4: histórico no RM (TPBEN=1) ─────────────────────────────────
    // RM sem SOAP com a flag LIGADA é erro de ambiente — nunca "feito" na chave real.
    if (!simulado && !d.temRm()) {
      await d.avancar(job.id, { estado: "falhou", erro: "rm_soap_nao_configurado: histórico do sábado não gravado" })
      return
    }
    const r = await reservar("rm_historico", "rm_soap", { chapa: pedido.chapa })
    if (r === "parar") return
    if (r === "seguir") {
      const h = montarHistoricoSabados(pedido, { codSecao: p.codSecao, dataImport: hojeIso })
      if (simulado) {
        await d.confirmarEfeito(chave("rm_historico"), "SIMULADO", { nota: "flag desligada" })
      } else {
        const res = await d.saveRecord(RM_DATA_SERVER_HISTORICO, h.dadosXml, contextoDataServer(3))
        await d.confirmarEfeito(chave("rm_historico"), res.chave)
      }
    }
    await d.avancar(job.id, { estado: "concluido" })
  }
}

export interface EstadoDreno {
  estado: string
  passo: number
  erro?: string | null
}

/**
 * Roda o job até o fim (ou até `limiteMs`), um passo depois do outro. Cada passo continua
 * gravando progresso na fila e no ledger, então morrer no meio retoma de onde parou — a mesma
 * garantia do tick, só que sem esperar o próximo.
 *
 * Existe porque o tick é DIÁRIO (conta Hobby da Vercel): um passo por tick faria o crédito do
 * sábado levar cinco dias. O finalize chama isto logo depois de enfileirar, e o tick usa o mesmo
 * — o que sobrar sai inteiro na próxima passada.
 *
 * Enquanto drena, o job fica `rodando` (reivindicado): devolver `pendente` entre um passo e outro
 * abriria a porta pra outro processo pegar o mesmo job. Parou antes do fim, volta a `pendente`.
 */
export function drenarSabadoExtra(deps: Partial<DepsSabadoExtra> = {}, limiteMs = 20_000) {
  const avancarReal = deps.avancar ?? DEPS_PADRAO.avancar
  return async function drenar(job: Job): Promise<EstadoDreno> {
    // O job chega reivindicado (`rodando`); aqui `pendente` quer dizer "ainda não terminou".
    let atual: Job & { erro?: string | null } = { ...job, estado: "pendente" }
    const passo = handlerSabadoExtra({
      ...deps,
      avancar: async (id, patch) => {
        const segue = patch.estado === "pendente"
        await avancarReal(id, segue ? { ...patch, estado: "rodando" } : patch)
        atual = {
          ...atual,
          ...(patch.estado !== undefined ? { estado: patch.estado } : {}),
          ...(patch.passo !== undefined ? { passo: patch.passo } : {}),
          ...("cursor" in patch ? { cursor: patch.cursor } : {}),
          ...("erro" in patch ? { erro: patch.erro } : {}),
        }
      },
    })
    const fim = Date.now() + limiteMs
    // 5 passos; o teto do laço é só rede contra passo que não anda.
    for (let i = 0; i < 8 && atual.estado === "pendente"; i++) {
      const antes = atual.passo
      await passo(atual)
      if (atual.estado !== "pendente" || atual.passo === antes || Date.now() >= fim) break
    }
    if (atual.estado === "pendente") await avancarReal(job.id, { estado: "pendente" })
    return { estado: atual.estado, passo: atual.passo, erro: atual.erro ?? null }
  }
}
