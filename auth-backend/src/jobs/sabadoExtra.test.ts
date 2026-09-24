// Máquina de estados do job do sábado extra, sem Postgres, Caju ou RM: fila e ledger entram
// por injeção. O que se prova é a regra de dinheiro — simular nunca confirma a chave REAL
// (senão o sábado registrado com a flag desligada nunca mais paga), e retomar em modo real
// nunca paga duas vezes.
// Roda: node --env-file=.env --import tsx --test src/jobs/sabadoExtra.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { handlerSabadoExtra, TIPO_JOB_SABADO_EXTRA, type DepsSabadoExtra } from "./sabadoExtra.js"
import type { Job } from "./repo.js"
import { montarPedidoSabados, ehErroSabados } from "../sabados/calculo.js"
import { chaveEfeitoSabados } from "../sabados/rmSabados.js"

const PEDIDO = (() => {
  const p = montarPedidoSabados(
    {
      uuid: "u-sab-1",
      nome: "MARIA AUGUSTA",
      chapa: "7406",
      contrato: "SEMSA",
      sabados: ["2026-09-19", "2026-09-26"],
      optanteVT: true,
      anoComp: 2026,
      mesComp: 9,
    },
    [{ contrato: "SEMSA", regra: "", vrDia: 24.5, vtDia: 11.6, ativo: true }],
  )
  if (ehErroSabados(p)) throw new Error("pedido de teste inválido")
  return p
})()

type StatusEfeito = "pendente" | "confirmado"

/** Fila + ledger em memória, e as chamadas externas que o job fez (em ordem). */
function criarMundo(opts: { habilitado: boolean; temRm?: boolean; efeitos?: Array<[string, StatusEfeito]> }) {
  const efeitos = new Map<string, { status: StatusEfeito; ref?: string }>(
    (opts.efeitos ?? []).map(([chave, status]) => [chave, { status }]),
  )
  const chamadas: string[] = []
  let habilitado = opts.habilitado
  let atual: Job & { erro?: string | null } = novoJob("vazio")

  const deps: Partial<DepsSabadoExtra> = {
    habilitado: () => habilitado,
    temRm: () => opts.temRm ?? true,
    buscarEmployeeId: async () => {
      chamadas.push("buscarEmployeeId")
      return "emp-1"
    },
    criarPedido: async () => {
      chamadas.push("criarPedido")
      return { orderId: "ord-1", raw: null }
    },
    confirmarPedido: async () => {
      chamadas.push("confirmarPedido")
      return null
    },
    saveRecord: (async () => {
      chamadas.push("saveRecord")
      return { chave: "3;007406;HIST" }
    }) as unknown as DepsSabadoExtra["saveRecord"],
    lancarFinanceiro: async () => {
      chamadas.push("lancarFinanceiro")
    },
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
    ligarFlag: () => {
      habilitado = true
    },
    iniciar: (id: string) => {
      atual = novoJob(id)
    },
    /** Um tick do runner: um passo. */
    tick: async () => handler({ ...atual }),
    /** Ticks até o job sair de `pendente`. */
    rodar: async (id?: string) => {
      if (id) atual = novoJob(id)
      for (let i = 0; i < 10 && atual.estado === "pendente"; i++) await handler({ ...atual })
      return atual
    },
    job: () => atual,
  }
}

function novoJob(id: string): Job & { erro?: string | null } {
  return {
    id,
    tipo: TIPO_JOB_SABADO_EXTRA,
    estado: "pendente",
    passo: 0,
    payload: { pedido: PEDIDO, cpf: "12345678901", codSecao: "01.01.0085", dataImport: "2026-09-24" },
    cursor: null,
    tentativas: 0,
  }
}

test("flag desligada: percorre os 4 passos sem Caju, sem RM e sem tocar chave real", async () => {
  const m = criarMundo({ habilitado: false })
  const fim = await m.rodar("job-sim")
  assert.equal(fim.estado, "concluido")
  assert.deepEqual(m.chamadas, [])
  const chaves = [...m.efeitos.keys()]
  assert.equal(chaves.length, 3)
  assert.ok(chaves.every((k) => k.startsWith("sabado_extra-sim:job-sim:")), chaves.join(" | "))
  for (const alvo of ["caju", "rm_historico", "rm_financeiro"] as const)
    assert.equal(m.efeitos.has(chaveEfeitoSabados(PEDIDO, alvo)), false)
})

test("a armadilha: sábado que passou simulado ainda paga depois de ligar a flag", async () => {
  const m = criarMundo({ habilitado: false })
  await m.rodar("job-sim")
  m.ligarFlag()
  // Mesma convocação, mesmos sábados, refinalizada: o job novo tem que pagar.
  const fim = await m.rodar("job-real")
  assert.equal(fim.estado, "concluido")
  assert.deepEqual(m.chamadas, ["buscarEmployeeId", "criarPedido", "confirmarPedido", "saveRecord", "lancarFinanceiro"])
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "caju"))?.ref, "ord-1")
})

test("modo congelado no passo 0: ligar a flag no meio não paga job que começou simulado", async () => {
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

test("modo real com reserva pendente: para pedindo conciliação, não cria pedido de novo", async () => {
  const m = criarMundo({ habilitado: true, efeitos: [[chaveEfeitoSabados(PEDIDO, "caju"), "pendente"]] })
  const fim = await m.rodar("job-retomada")
  assert.equal(fim.estado, "falhou")
  assert.match(fim.erro ?? "", /^efeito_pendente_requer_conciliacao: sabado_extra:caju:/)
  assert.equal(m.chamadas.includes("criarPedido"), false)
})

test("modo real sem RM configurado: falha no histórico em vez de marcá-lo feito", async () => {
  const m = criarMundo({ habilitado: true, temRm: false })
  const fim = await m.rodar("job-sem-rm")
  assert.equal(fim.estado, "falhou")
  assert.match(fim.erro ?? "", /^rm_soap_nao_configurado:/)
  assert.equal(m.efeitos.has(chaveEfeitoSabados(PEDIDO, "rm_historico")), false)
  // O pedido real já saiu e está confirmado — é o que a conciliação precisa enxergar.
  assert.equal(m.efeitos.get(chaveEfeitoSabados(PEDIDO, "caju"))?.status, "confirmado")
})
