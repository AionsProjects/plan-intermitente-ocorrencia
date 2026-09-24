// Máquina de estados do job do sábado extra, sem Postgres, Caju, Monday ou RM: fila, ledger e
// clientes entram por injeção. O que se prova é a regra de dinheiro — o sábado é CRÉDITO
// confirmado (saldo da empresa), simular nunca confirma a chave REAL (senão o sábado
// registrado com a flag desligada nunca mais paga), retomar em modo real nunca paga duas
// vezes, e o pagamento fica registrado no Monday antes do RM.
// Roda: node --env-file=.env --import tsx --test src/jobs/sabadoExtra.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { handlerSabadoExtra, TIPO_JOB_SABADO_EXTRA, type DepsSabadoExtra } from "./sabadoExtra.js"
import type { Job } from "./repo.js"
import { montarPedidoSabados, ehErroSabados, type PedidoSabados } from "../sabados/calculo.js"
import { chaveEfeitoSabados, type AlvoEfeitoSabados } from "../sabados/rmSabados.js"

function pedidoDe(extra: { contrato?: string; interior?: boolean } = {}): PedidoSabados {
  const contrato = extra.contrato ?? "SEMSA"
  const p = montarPedidoSabados(
    {
      uuid: "u-sab-1",
      nome: "MARIA AUGUSTA",
      chapa: "7406",
      contrato,
      sabados: ["2026-09-19", "2026-09-26"],
      optanteVT: true,
      interior: extra.interior,
      anoComp: 2026,
      mesComp: 9,
    },
    [{ contrato, regra: "", vrDia: 24.5, vtDia: 11.6, ativo: true }],
  )
  if (ehErroSabados(p)) throw new Error("pedido de teste inválido")
  return p
}

const PEDIDO = pedidoDe()
const ALVOS: AlvoEfeitoSabados[] = ["caju", "controle_caju", "balao", "rm_historico"]

type StatusEfeito = "pendente" | "confirmado"

interface Opcoes {
  habilitado: boolean
  temRm?: boolean
  efeitos?: Array<[string, StatusEfeito, string?]>
  pedido?: PedidoSabados
  itemOrigem?: string | null
}

/** Fila + ledger em memória, e as chamadas externas que o job fez (em ordem). */
function criarMundo(opts: Opcoes) {
  const efeitos = new Map<string, { status: StatusEfeito; ref?: string }>(
    (opts.efeitos ?? []).map(([chave, status, ref]) => [chave, { status, ref }]),
  )
  const chamadas: string[] = []
  const pedidosCriados: Array<Parameters<DepsSabadoExtra["criarPedido"]>[0]> = []
  const confirmacoes: Array<Parameters<DepsSabadoExtra["confirmarPedido"]>[1]> = []
  const debitos: Array<Parameters<DepsSabadoExtra["registrarDebitoControle"]>[0]> = []
  const updates: Array<{ item: string; texto: string }> = []
  let habilitado = opts.habilitado
  const pedido = opts.pedido ?? PEDIDO
  const itemOrigem = opts.itemOrigem === undefined ? "13000000001" : opts.itemOrigem
  let atual: Job & { erro?: string | null } = novoJob("vazio", pedido, itemOrigem)

  const deps: Partial<DepsSabadoExtra> = {
    habilitado: () => habilitado,
    temRm: () => opts.temRm ?? true,
    buscarEmployeeId: async () => {
      chamadas.push("buscarEmployeeId")
      return "emp-1"
    },
    criarPedido: async (payload) => {
      chamadas.push("criarPedido")
      pedidosCriados.push(payload)
      return { orderId: "ord-1", raw: null }
    },
    confirmarPedido: async (_orderId, payload) => {
      chamadas.push("confirmarPedido")
      confirmacoes.push(payload)
      return null
    },
    garantirGrupoControle: async () => {
      chamadas.push("garantirGrupoControle")
      return "grupo-setembro"
    },
    registrarDebitoControle: async (inp) => {
      chamadas.push("registrarDebitoControle")
      debitos.push(inp)
      return { id: "ctl-1", saldoAnterior: 1000 }
    },
    criarUpdate: async (item, texto) => {
      chamadas.push("criarUpdate")
      updates.push({ item, texto })
      return "upd-1"
    },
    saveRecord: (async () => {
      chamadas.push("saveRecord")
      return { chave: "3;007406;HIST" }
    }) as unknown as DepsSabadoExtra["saveRecord"],
    reservarEfeito: async (chave) => {
      const e = efeitos.get(chave)
      if (!e) {
        efeitos.set(chave, { status: "pendente" })
        return "novo"
      }
      return e.status
    },
    confirmarEfeito: async (chave, ref) => {
      efeitos.set(chave, { status: "confirmado", ref })
    },
    detalheEfeito: async (chave) => {
      const e = efeitos.get(chave)
      return e ? { status: e.status, refExterna: e.ref ?? null, payload: null, criadoEm: null } : null
    },
    avancar: async (_id, patch) => {
      atual = {
        ...atual,
        ...(patch.estado !== undefined ? { estado: patch.estado } : {}),
        ...(patch.passo !== undefined ? { passo: patch.passo } : {}),
        ...(patch.cursor !== undefined ? { cursor: patch.cursor } : {}),
        ...(patch.erro !== undefined ? { erro: patch.erro } : {}),
      }
    },
  }
  const handler = handlerSabadoExtra(deps)

  return {
    efeitos,
    chamadas,
    pedidosCriados,
    confirmacoes,
    debitos,
    updates,
    ligarFlag: () => {
      habilitado = true
    },
    iniciar: (id: string) => {
      atual = novoJob(id, pedido, itemOrigem)
    },
    /** Um tick do runner: um passo. */
    tick: async () => handler({ ...atual }),
    /** Ticks até o job sair de `pendente`. */
    rodar: async (id?: string) => {
      if (id) atual = novoJob(id, pedido, itemOrigem)
      for (let i = 0; i < 10 && atual.estado === "pendente"; i++) await handler({ ...atual })
      return atual
    },
    job: () => atual,
  }
}

function novoJob(id: string, pedido: PedidoSabados, itemOrigem: string | null): Job & { erro?: string | null } {
  return {
    id,
    tipo: TIPO_JOB_SABADO_EXTRA,
    estado: "pendente",
    passo: 0,
    payload: {
      pedido, cpf: "12345678901", codSecao: "01.01.0085", dataImport: "2026-09-24", item_origem_id: itemOrigem,
    },
    cursor: null,
    tentativas: 0,
  }
}

test("flag desligada: percorre os passos sem Caju, Monday ou RM e sem tocar chave real", async () => {
  const m = criarMundo({ habilitado: false })
  const fim = await m.rodar("job-sim")
  assert.equal(fim.estado, "concluido")
  assert.deepEqual(m.chamadas, [])
  const chaves = [...m.efeitos.keys()]
  assert.equal(chaves.length, ALVOS.length)
  assert.ok(chaves.every((k) => k.startsWith("sabado_extra-sim:job-sim:")), chaves.join(" | "))
  for (const alvo of ALVOS) assert.equal(m.efeitos.has(chaveEfeitoSabados(PEDIDO, alvo)), false)
})

test("flag ligada: credito confirmado do saldo, debito no Controle Caju, balao no Plano e RM por ultimo", async () => {
  const m = criarMundo({ habilitado: true })
  const fim = await m.rodar("job-real")
  assert.equal(fim.estado, "concluido")
  assert.deepEqual(m.chamadas, [
    "buscarEmployeeId", "criarPedido", "confirmarPedido",
    "garantirGrupoControle", "registrarDebitoControle", "criarUpdate", "saveRecord",
  ])
  // Pedido de VT só, no nome que o DP busca no painel.
  const criado = m.pedidosCriados[0]!
  assert.equal(criado.name, "INT-MARIA AUGUSTA-SAB-24/09") // cortado em 27, como o WF
  assert.deepEqual(criado.allowances, [{ employeeId: "emp-1", amounts: [{ category: "TRANSPORTATION_VOUCHER", amount: 2320 }] }])
  // CRÉDITO: sai do saldo da empresa, não gera PIX.
  assert.deepEqual(m.confirmacoes, [{ paymentStrategies: [{ paymentType: "EXISTING_BALANCE", amount: 2320 }] }])
  // Débito do mesmo valor, com o pedido e nome próprio.
  const deb = m.debitos[0]!
  assert.equal(deb.totalCredito, 23.2)
  assert.equal(deb.pedidoCreditoId, "ord-1")
  assert.equal(deb.grupoControleCaju, "grupo-setembro")
  assert.equal(deb.competenciaLabel, "SETEMBRO")
  assert.equal(deb.nomeItem, "INTERMITENTE - MARIA AUGUSTA - SÁBADO EXTRA (2026-09-24)")
  // Balão no item da convocação, dizendo o que houve e qual pedido pagou.
  assert.equal(m.updates.length, 1)
  assert.equal(m.updates[0]!.item, "13000000001")
  assert.match(m.updates[0]!.texto, /19\/09\/2026 e 26\/09\/2026 \(2 sábados\)/)
  assert.match(m.updates[0]!.texto, /pago em crédito Caju/)
  assert.match(m.updates[0]!.texto, /Pedido Caju ord-1 \(confirmado\)/)
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "caju"))?.ref, "ord-1")
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "controle_caju"))?.ref, "monday:controle_caju:ctl-1")
})

test("interior (ou contrato de mobilidade) paga o VT na carteira de mobilidade", async () => {
  const cetam = criarMundo({ habilitado: true, pedido: pedidoDe({ contrato: "CETAM", interior: true }) })
  await cetam.rodar("job-cetam")
  assert.equal(cetam.pedidosCriados[0]!.allowances[0]!.amounts[0]!.category, "TRANSPORTATION")
  const tre = criarMundo({ habilitado: true, pedido: pedidoDe({ contrato: "TRE PB" }) })
  await tre.rodar("job-tre")
  assert.equal(tre.pedidosCriados[0]!.allowances[0]!.amounts[0]!.category, "TRANSPORTATION")
})

test("a armadilha: sabado que passou simulado ainda paga depois de ligar a flag", async () => {
  const m = criarMundo({ habilitado: false })
  await m.rodar("job-sim")
  m.ligarFlag()
  // Mesma convocação, mesmos sábados, refinalizada: o job novo tem que pagar.
  const fim = await m.rodar("job-real")
  assert.equal(fim.estado, "concluido")
  assert.equal(m.chamadas.filter((c) => c === "confirmarPedido").length, 1)
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "caju"))?.ref, "ord-1")
})

test("modo congelado no passo 0: ligar a flag no meio nao paga job que comecou simulado", async () => {
  const m = criarMundo({ habilitado: false })
  m.iniciar("job-meio")
  await m.tick() // passo 0 decide simulado e grava no cursor
  assert.equal((m.job().cursor as { simulado?: boolean }).simulado, true)
  m.ligarFlag()
  const fim = await m.rodar()
  assert.equal(fim.estado, "concluido")
  assert.deepEqual(m.chamadas, [])
  assert.equal(m.efeitos.has(chaveEfeitoSabados(PEDIDO, "caju")), false)
})

test("modo real com reserva pendente: para pedindo conciliacao, nao cria pedido de novo", async () => {
  const m = criarMundo({ habilitado: true, efeitos: [[chaveEfeitoSabados(PEDIDO, "caju"), "pendente"]] })
  const fim = await m.rodar("job-retomada")
  assert.equal(fim.estado, "falhou")
  assert.match(fim.erro ?? "", /^efeito_pendente_requer_conciliacao: sabado_extra:caju:/)
  assert.equal(m.chamadas.includes("criarPedido"), false)
  assert.equal(m.chamadas.includes("confirmarPedido"), false)
})

test("retomada depois do credito confirmado: o id do pedido vem do ledger ate o balao", async () => {
  // O passo 1 confirmou o efeito e morreu antes de gravar o cursor.
  const m = criarMundo({ habilitado: true, efeitos: [[chaveEfeitoSabados(PEDIDO, "caju"), "confirmado", "ord-antigo"]] })
  const fim = await m.rodar("job-depois")
  assert.equal(fim.estado, "concluido")
  assert.equal(m.chamadas.includes("criarPedido"), false)
  assert.equal(m.debitos[0]!.pedidoCreditoId, "ord-antigo")
  assert.match(m.updates[0]!.texto, /Pedido Caju ord-antigo \(confirmado\)/)
})

test("sem item do Plano: pula o balao e conclui — o pagamento ja esta no Controle Caju", async () => {
  const m = criarMundo({ habilitado: true, itemOrigem: null })
  const fim = await m.rodar("job-sem-item")
  assert.equal(fim.estado, "concluido")
  assert.equal(m.chamadas.includes("criarUpdate"), false)
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "balao"))?.ref, "monday:balao:sem_item")
})

test("modo real sem RM configurado: falha no historico, com o credito ja registrado no Monday", async () => {
  const m = criarMundo({ habilitado: true, temRm: false })
  const fim = await m.rodar("job-sem-rm")
  assert.equal(fim.estado, "falhou")
  assert.match(fim.erro ?? "", /^rm_soap_nao_configurado:/)
  assert.equal(m.efeitos.has(chaveEfeitoSabados(PEDIDO, "rm_historico")), false)
  // O dinheiro saiu e está rastreado: é o que a conciliação precisa enxergar.
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "caju"))?.status, "confirmado")
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "controle_caju"))?.status, "confirmado")
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "balao"))?.status, "confirmado")
})
