// Job de reconciliação do CANCELAMENTO PARCIAL — tudo injetado, sem banco nem RM.
//
// O que isto trava: até 25/09/2026 o job removia TODO lançamento vivo do item, qualquer que fosse o
// motivo. Um parcial com o RM mudo no request virava, no tick seguinte, a exclusão da convocação
// inteira — os dias trabalhados antes do corte sumiam da folha. O job da KAREN (item 13044722514,
// enfileirado 25/09 15:04 sem `novo_fim`) é o caso real que o caminho de compatibilidade cobre.
// Roda: node --env-file=.env.example --env-file=.env.test --import tsx --test src/jobs/convocacaoRmRemover.parcial.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { handlerConvocacaoRmRemover, type DepsRemocaoRm } from "./convocacaoRmRemover.js"
import type { Job } from "./repo.js"

const job = (payload: Record<string, unknown>) =>
  ({ id: "job-1", tipo: "convocacao_rm_remover", estado: "rodando", passo: 0, payload, cursor: null, tentativas: 0 }) as unknown as Job

function deps(over: Partial<DepsRemocaoRm> = {}) {
  const log = {
    removeu: 0,
    encurtou: [] as { item: string; novoFim: string }[],
    avancos: [] as Record<string, unknown>[],
  }
  const d: Partial<DepsRemocaoRm> = {
    habilitado: () => true,
    listar: (async () => [{ id: "x" }]) as unknown as DepsRemocaoRm["listar"],
    remover: (async () => { log.removeu++; return { estado: "removido" } }) as unknown as DepsRemocaoRm["remover"],
    encurtar: (async (item: string | number, p: { novoFim: string }) => {
      log.encurtou.push({ item: String(item), novoFim: p.novoFim })
      return { edicoes: [{ estado: "editado", pk: "3;007355;C03S003983" }], remocoes: [], temPendencia: false }
    }) as unknown as DepsRemocaoRm["encurtar"],
    cancelamentoDoItem: async () => ({ corte: "2026-09-28", status: "Cancelada parcialmente" }),
    avancar: (async (_id: string, patch: Record<string, unknown>) => { log.avancos.push(patch) }) as DepsRemocaoRm["avancar"],
    ...over,
  }
  return { d, log }
}

test("parcial com novo_fim: ENCURTA até ele e nunca chama a remoção do item", async () => {
  const { d, log } = deps()
  await handlerConvocacaoRmRemover(job({ item_id: "13044722514", motivo: "cancelamento_parcial", novo_fim: "2026-09-27" }), d)
  assert.deepEqual(log.encurtou, [{ item: "13044722514", novoFim: "2026-09-27" }])
  assert.equal(log.removeu, 0, "remover o item inteiro apagaria do RM os dias antes do corte")
  assert.equal(log.avancos.at(-1)?.estado, "concluido")
})

test("job antigo sem novo_fim (o da KAREN): véspera do corte vem do espelho", async () => {
  const { d, log } = deps()
  await handlerConvocacaoRmRemover(job({ item_id: "13044722514", motivo: "cancelamento_parcial" }), d)
  assert.deepEqual(log.encurtou, [{ item: "13044722514", novoFim: "2026-09-27" }])
  assert.equal(log.removeu, 0)
})

test("parcial sem corte legível: não toca no RM e joga (o esgotamento alerta o DP)", async () => {
  const { d, log } = deps({ cancelamentoDoItem: async () => null })
  await assert.rejects(
    () => handlerConvocacaoRmRemover(job({ item_id: "1", motivo: "cancelamento_parcial" }), d),
    /sem data de corte/,
  )
  assert.equal(log.removeu, 0)
  assert.deepEqual(log.encurtou, [])
})

test("parcial que depois virou TOTAL: conclui sem encurtar — o job do total apaga tudo", async () => {
  const { d, log } = deps({ cancelamentoDoItem: async () => ({ corte: null, status: "Cancelada" }) })
  await handlerConvocacaoRmRemover(job({ item_id: "1", motivo: "cancelamento_parcial" }), d)
  assert.deepEqual(log.encurtou, [])
  assert.equal(log.removeu, 0)
  assert.equal((log.avancos.at(-1)?.cursor as { nota?: string })?.nota, "cancelamento_total_posterior")
})

test("parcial com pendência no encurtamento: joga pra retentar", async () => {
  const { d } = deps({
    encurtar: (async () => ({
      edicoes: [{ estado: "indeterminado", pk: "3;007355;C03S003983", erro: "timeout" }],
      remocoes: [],
      temPendencia: true,
    })) as unknown as DepsRemocaoRm["encurtar"],
  })
  await assert.rejects(
    () => handlerConvocacaoRmRemover(job({ item_id: "1", motivo: "cancelamento_parcial", novo_fim: "2026-09-27" }), d),
    /pendente/,
  )
})

test("pedaço ausente no RM (ja_ausente) conclui — nada a refazer", async () => {
  const { d, log } = deps({
    encurtar: (async () => ({
      edicoes: [{ estado: "ja_ausente", pk: "3;007355;C03S003983" }],
      remocoes: [],
      temPendencia: false,
    })) as unknown as DepsRemocaoRm["encurtar"],
  })
  await handlerConvocacaoRmRemover(job({ item_id: "13044722514", motivo: "cancelamento_parcial" }), d)
  assert.equal(log.avancos.at(-1)?.estado, "concluido")
})

test("total continua removendo tudo (inalterado)", async () => {
  const { d, log } = deps()
  await handlerConvocacaoRmRemover(job({ item_id: "1", motivo: "cancelamento_total" }), d)
  assert.equal(log.removeu, 1)
  assert.deepEqual(log.encurtou, [])
})
