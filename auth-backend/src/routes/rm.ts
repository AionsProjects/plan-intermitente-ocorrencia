import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { config } from "../config.js"
import { consultarSql } from "../clients/rm.js"
import { checkServiceActivity, contextoDataServer, readRecordDireto, temRmSoap } from "../clients/rmSoap.js"
import { paraDataIso } from "../domain/convocacaoRm.js"
import { parseCodigoContrato } from "../domain/mobilidade.js"
import { RM_DATA_SERVER_HISTORICO } from "../mensal/rmEfeitos.js"
import { usuarioDaAutorizacao } from "../session.js"

// Rotas RM-backed (leitura) — substituem WF8 Buscar Empregado, Unidades RM, Celetista.
// Servidas sob /api/* com os mesmos nomes de path dos webhooks (cutover = trocar base).
// PÚBLICAS (autocomplete; mesmo padrão dos webhooks atuais).

function s(v: unknown): string {
  return v == null ? "" : String(v).trim()
}

/**
 * Uma linha da `BEN 2` no formato que o front consome.
 *
 * Função pura e exportada porque foi exatamente aqui que um valor passou CRU: a `Data de Admissão`
 * do RM vem como dateTime com fuso (`2026-08-06T00:00:00-03:00`) e ia inteira até a coluna
 * `Admissão` do board, que é text — metade das linhas em `06/08/2026` (legado, à mão) e metade com
 * o carimbo. Mapeamento dentro do handler não tem teste; separado, tem.
 */
export function mapearEmpregadoBen2(r: Record<string, unknown>): Record<string, unknown> {
  const secao = s(r["Seção"])
  const { nomeContrato } = parseCodigoContrato(secao)
  return {
    nome: s(r["Nome do Intermitente"]),
    chapa: s(r["Matrícula/Chapa"]),
    cpf: s(r["CPF"]),
    funcao: s(r["Função"]),
    // Corte por STRING, nunca `new Date()`: converter meia-noite -03:00 pro fuso da máquina troca
    // o dia — e a admissão é o piso do cálculo da data do ato no S-2260.
    admissao: paraDataIso(r["Data de Admissão"]),
    secao,
    secaoDescricao: s(r["Descrição Seção"]),
    // Mesma descrição sob a chave que o front lê (`localUnidade`/`local_unidade`).
    // Só `secaoDescricao` nunca casava: `/atestados` pré-seleciona a unidade
    // comparando `localUnidade ?? secao`, e `secao` é o CÓDIGO da seção.
    localUnidade: s(r["Descrição Seção"]),
    contrato: nomeContrato,
    // Contrato do WF8: a chave é `optante_vt` (snake) com o label do RM ("SIM"/"NÃO"/"SIM*").
    // O front testa `o.optante_vt`; mandar só `optanteVT` como string fazia todo mundo virar
    // não-optante (o teste lá é `optanteVT === true`, boolean) e zerava o VT no WF5.
    optante_vt: s(r["Vale Transporte"]),
    optanteVT: s(r["Vale Transporte"]),
    codcoligada: 3,
  }
}

export async function rotasRm(app: FastifyInstance): Promise<void> {
  // WF8 — GET /api/convocar-buscar-empregado?nome=  (min 3 chars, BEN 2)
  app.get(
    "/api/convocar-buscar-empregado",
    async (req: FastifyRequest<{ Querystring: { nome?: string } }>, reply) => {
      const nome = (req.query.nome ?? "").trim()
      if (nome.length < 3) return reply.code(400).send({ erro: "nome_curto", resultados: [] })
      let linhas: Record<string, unknown>[]
      try {
        linhas = await consultarSql<Record<string, unknown>>({
          codigoSql: "BEN 2",
          parametros: { NOME: "%" + nome + "%" },
        })
      } catch (e) {
        return reply.code(502).send({ erro: "rm_indisponivel", mensagem: (e as Error).message, resultados: [] })
      }
      return { resultados: linhas.map(mapearEmpregadoBen2) }
    },
  )

  /**
   * Diagnóstico do RM DIRETO a partir do runtime da Vercel — READ-ONLY, só admin.
   * Existe porque provar o caminho da máquina do dev não prova nada sobre o egress da Vercel:
   * a leitura REST já estava confirmada por log, mas o SOAP (SaveRecord/processos) nunca tinha
   * sido exercitado de lá. Roda CheckServiceActivity nos dois serviços + ReadRecord de um
   * registro existente. Não grava nada.
   */
  app.get(
    "/api/rm/diagnostico",
    async (req: FastifyRequest<{ Querystring: { chave?: string } }>, reply: FastifyReply) => {
      // Cookie (admin no navegador) OU Bearer de serviço — mesmo padrão das rotas de integração.
      const u = await usuarioDaAutorizacao(req)
      if (!u) return reply.code(401).send({ erro: "nao_autenticado" })
      if (u.papel !== "admin") return reply.code(403).send({ erro: "sem_permissao" })

      const cronometrar = async <T>(fn: () => Promise<T>) => {
        const t0 = Date.now()
        try {
          return { ok: true as const, ms: Date.now() - t0, valor: await fn() }
        } catch (e) {
          return { ok: false as const, ms: Date.now() - t0, erro: (e as Error).message.slice(0, 200) }
        }
      }
      const desescapar = (s: string) =>
        s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#xD;/g, "")

      const chave = (req.query.chave ?? "").trim()
      const [dataserver, processo, leitura, sql] = await Promise.all([
        cronometrar(() => checkServiceActivity("dataserver")),
        cronometrar(() => checkServiceActivity("process")),
        chave
          ? cronometrar(async () => {
              // ReadRecord devolve o XML HTML-escapado — desescapar antes de afirmar qualquer coisa.
              // RM_DATA_SERVER não é setado em lugar nenhum (o caller do histórico passa o dele
              // explicitamente) — usar a constante do histórico, que é o DataServer real.
              const xml = desescapar(await readRecordDireto(RM_DATA_SERVER_HISTORICO, chave, contextoDataServer(3)))
              return { encontrado: /<ID>\s*\d+/.test(xml), id: /<ID>(\d+)<\/ID>/.exec(xml)?.[1] ?? null, tamanho: xml.length }
            })
          : Promise.resolve({ ok: true as const, ms: 0, valor: { pulado: "informe ?chave=<id>" } }),
        cronometrar(() => consultarSql({ codigoSql: "BEN 2", parametros: { NOME: "%silvana%" } }).then((r) => r.length)),
      ])

      return {
        configurado: {
          soap: temRmSoap(),
          escritaDireta: config.rmEscritaDireta,
          dataServer: RM_DATA_SERVER_HISTORICO,
          // Estado do corte financeiro do mensal — confere ANTES de aprovar um run.
          // Só paga de verdade com modo=producao E producaoLiberada=true (gate duplo).
          mensalModo: config.mensalModo,
          mensalProducaoLiberada: config.mensalProductionEnabled,
          mensalWorkflowLigado: config.mensalWorkflowEnabled,
        },
        soap_dataserver: dataserver,
        soap_processo: processo,
        soap_readrecord: leitura,
        rest_consulta_sql: sql,
      }
    },
  )
}
