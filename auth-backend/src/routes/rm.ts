import type { FastifyInstance, FastifyRequest } from "fastify"
import { consultarSql } from "../clients/rm.js"
import { parseCodigoContrato } from "../domain/mobilidade.js"

// Rotas RM-backed (leitura) — substituem WF8 Buscar Empregado, Unidades RM, Celetista.
// Servidas sob /api/* com os mesmos nomes de path dos webhooks (cutover = trocar base).
// PÚBLICAS (autocomplete; mesmo padrão dos webhooks atuais).

function s(v: unknown): string {
  return v == null ? "" : String(v).trim()
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
      const resultados = linhas.map((r) => {
        const secao = s(r["Seção"])
        const { nomeContrato } = parseCodigoContrato(secao)
        return {
          nome: s(r["Nome do Intermitente"]),
          chapa: s(r["Matrícula/Chapa"]),
          cpf: s(r["CPF"]),
          funcao: s(r["Função"]),
          admissao: s(r["Data de Admissão"]),
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
      })
      return { resultados }
    },
  )
}
