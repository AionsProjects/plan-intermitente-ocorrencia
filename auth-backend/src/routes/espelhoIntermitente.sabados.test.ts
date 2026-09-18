// Sábado extra marcado no link PRECISA sobreviver ao finalizar.
//
// O defeito que este arquivo trava: a rota aceitava `sabados_extras` no corpo, tipava o
// campo e nunca o usava — lia sempre a coluna do banco, que ninguém mais escreve desde que
// o WF3 saiu do ar. Resultado medido em produção: 0 convocação com sábado extra em 30 dias,
// 0 evento `sabado_extra` e 0 job. O dia sumia do ledger, do Histórico e do boleto de VT.
import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { construirApp } from "../app.js"
import { query } from "../db.js"

let app: Awaited<ReturnType<typeof construirApp>>

async function limpar(uuid: string): Promise<void> {
  await query("DELETE FROM descontos WHERE uuid_convocacao = $1", [uuid])
  await query("DELETE FROM convocacoes WHERE uuid = $1", [uuid])
}

/** Convocação de 03 a 14/08/2026, contrato SEM sábado — 08/08 é o sábado extra do período. */
async function semear(uuid: string, sabados: string[] | null, itemOrigem?: string): Promise<void> {
  await query(
    `INSERT INTO convocacoes (uuid, chapa, contrato, nome, data_inicio, data_fim, status,
                              optante_vt, trabalha_sabado, sabados_extras, item_origem_id)
     VALUES ($1,'007406','CETAM','MISSILENE ALENCAR','2026-08-03','2026-08-14','Aguardando',true,false,$2,$3)`,
    [uuid, sabados, itemOrigem ?? null],
  )
}

const sabadosDe = (uuid: string) =>
  query<{ sabados_extras: string[] | null }>(
    "SELECT sabados_extras FROM convocacoes WHERE uuid = $1", [uuid],
  ).then((r) => r.rows[0]?.sabados_extras ?? null)

const postar = (uuid: string, body: unknown) =>
  app.inject({
    method: "POST",
    url: `/api/intermitente-finalizar?uuid=${uuid}`,
    headers: { "content-type": "application/json" },
    payload: body,
  })

test("setup", async () => { app = await construirApp() })

test("sábado extra do corpo é PERSISTIDO na convocação", async () => {
  const uuid = randomUUID()
  try {
    await semear(uuid, null)
    const r = await postar(uuid, {
      protocolo: "PROT-SABA-1111",
      respostas: [{ data: "2026-08-03", tipo: "sem_ocorrencia" }],
      // 08/08/2026 é sábado.
      sabados_extras: ["2026-08-08"],
    })
    assert.equal(r.statusCode, 200, r.payload)
    assert.deepEqual(await sabadosDe(uuid), ["2026-08-08"])
  } finally {
    await limpar(uuid)
  }
})

test("a lista do corpo é autoritativa — remover sábado remove de verdade", async () => {
  const uuid = randomUUID()
  try {
    await semear(uuid, ["2026-08-08", "2026-08-15"])
    const r = await postar(uuid, {
      protocolo: "PROT-SABA-2222",
      respostas: [{ data: "2026-08-03", tipo: "sem_ocorrencia" }],
      sabados_extras: ["2026-08-08"],
      eh_correcao: true,
    })
    assert.equal(r.statusCode, 200, r.payload)
    assert.deepEqual(await sabadosDe(uuid), ["2026-08-08"])
  } finally {
    await limpar(uuid)
  }
})

test("corpo sem a chave preserva o que está gravado (cliente velho não apaga sábado pago)", async () => {
  const uuid = randomUUID()
  try {
    await semear(uuid, ["2026-08-08"])
    const r = await postar(uuid, {
      protocolo: "PROT-SABA-3333",
      respostas: [{ data: "2026-08-03", tipo: "sem_ocorrencia" }],
    })
    assert.equal(r.statusCode, 200, r.payload)
    assert.deepEqual(await sabadosDe(uuid), ["2026-08-08"])
  } finally {
    await limpar(uuid)
  }
})

test("sábado extra vira VALOR a pagar e job na fila, com o snapshot achado por item da Entrada", async () => {
  const uuid = randomUUID()
  const item = String(Date.now()).slice(-12)
  try {
    await semear(uuid, null, item)
    // Snapshot do pré-pagamento como o /convocar grava HOJE: com cpf e cod_secao, e com
    // `uuid_convocacao` NULL — que é o estado dos 155 snapshots de produção.
    await query(
      `INSERT INTO pontual_prepagamento (item_origem_id, chapa, cpf, nome, contrato, cod_secao,
                                         data_inicio, data_fim, estado)
       VALUES ($1,'007406','52998224725','MISSILENE ALENCAR','CETAM','01.01.0074.01.0001',
               '2026-08-03','2026-08-14','reservado')`,
      [item],
    )
    const r = await postar(uuid, {
      protocolo: "PROT-SABA-4444",
      respostas: [{ data: "2026-08-03", tipo: "sem_ocorrencia" }],
      sabados_extras: ["2026-08-08"],
    })
    assert.equal(r.statusCode, 200, r.payload)

    const { rows } = await query<{ estado: string; metadados: Record<string, unknown> }>(
      `SELECT e.estado, e.metadados FROM atividade_evento e
         JOIN audit_lancamentos a ON a.id = e.execucao_id
        WHERE a.uuid_alvo = $1 AND e.etapa = 'sabado_extra' ORDER BY e.criado_em DESC LIMIT 1`,
      [uuid],
    )
    const ev = rows[0]
    assert.ok(ev, "etapa sabado_extra nao foi registrada — o sabado morreu antes do boleto")
    // O defeito antigo aparecia exatamente aqui, como 'aviso' com "sem cpf/cod_secao".
    assert.equal(ev!.estado, "ok", JSON.stringify(ev!.metadados))
    assert.equal(ev!.metadados.qtd_sabados, 1)
    assert.ok(Number(ev!.metadados.valor_total) > 0, `valor_total=${ev!.metadados.valor_total}`)
    assert.ok(ev!.metadados.job, "job nao foi enfileirado")
  } finally {
    await query("DELETE FROM jobs WHERE payload->>'item_origem_id' = $1", [item])
    await query("DELETE FROM pontual_prepagamento WHERE item_origem_id = $1", [item])
    await limpar(uuid)
  }
})

test("teardown", async () => { await app.close() })
