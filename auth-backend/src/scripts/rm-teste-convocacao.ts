/**
 * Teste controlado de gravação da convocação no RM. **GRAVA E APAGA.**
 *
 * Responde duas coisas que só o RM pode responder:
 *   1. `CODCONVOCACAO` omitido -> o contador automático (`C03S######`) entra sozinho?
 *   2. Antecedência abaixo de 3 dias -> o RM grava direto ou devolve mensagem de confirmação?
 *      (importa porque o fluxo real é automação, sem ninguém pra clicar "Sim".)
 *
 * Blindagens:
 *   - período em **2099**, fora de qualquer competência real de folha (mesmo precedente do teste
 *     de 01/08 no ZMDHSTBENFUNC, que usou 2099/12);
 *   - exige `--confirmar` no argv: não roda por acidente;
 *   - `finally` tenta apagar TUDO que foi criado, mesmo se o meio falhar, e grita alto o que
 *     sobrou pra remoção manual.
 *
 * ⚠️ Convocação é evento eSocial S-2260. O contador automático do RM não retrocede: os números
 * consumidos ficam como gap na sequência.
 *
 *   npm run rm:teste-convocacao -- 007404 --confirmar
 */
import {
  montarConvocacaoRm,
  parseConvocacoesReadView,
  pkConvocacaoRm,
  RM_DATA_SERVER_CONVOCACAO,
} from "../domain/convocacaoRm.js"
import {
  contextoDataServer,
  deleteRecordByKeyDireto,
  desescaparXml,
  readRecordDireto,
  readViewDireto,
  saveRecordDireto,
  temRmSoap,
  type RmSoapError,
} from "../clients/rmSoap.js"

const COLIGADA = 3

interface Caso {
  nome: string
  dataInicio: string
  dataFim: string
  /** Override da data do ato — é assim que se força a antecedência curta. */
  dataConvocacao?: string
  codConvocacao?: string
  omitirCodigo?: boolean
  esperado: string
}

/**
 * Omitir a tag CODCONVOCACAO já foi descartado em 08/08/2026: o SaveRecord do RM lê a PK de volta
 * da linha enviada (`ReadRowPrimaryKey`) e estoura com
 * "Column 'CODCONVOCACAO' does not belong to table PFCONVOCACAO." antes de persistir.
 */
const CASOS: Caso[] = [
  {
    nome: "PADRÃO (tag vazia, antecedência 3 dias)",
    dataInicio: "2099-12-10",
    dataFim: "2099-12-12",
    esperado: "grava e o contador automático numera (C03S######)",
  },
  {
    nome: "ANTECEDÊNCIA ZERO (data do ato = início)",
    dataInicio: "2099-12-20",
    dataFim: "2099-12-22",
    dataConvocacao: "2099-12-20",
    esperado: "o RM grava direto? ou devolve a mensagem de confirmação?",
  },
]

function detalharErro(e: unknown): string {
  const err = e as RmSoapError
  const partes = [err?.message ?? String(e)]
  if (err?.fault) partes.push(`fault="${err.fault}"`)
  if (err?.status) partes.push(`status=${err.status}`)
  if (err?.indeterminado !== undefined) partes.push(`indeterminado=${err.indeterminado}`)
  if (err?.trecho) partes.push(`\n      trecho: ${err.trecho}`)
  return partes.join(" | ")
}

async function main(): Promise<void> {
  const chapa = process.argv[2]
  if (!chapa || !process.argv.includes("--confirmar")) {
    console.error("uso: npm run rm:teste-convocacao -- <chapa> --confirmar")
    console.error("GRAVA no RM de produção (período 2099) e apaga em seguida.")
    process.exit(1)
  }
  if (!temRmSoap()) {
    console.error("RM_DIRETO_URL/USER/PASS não configurados.")
    process.exit(1)
  }

  const contexto = contextoDataServer(COLIGADA)
  const criados: { caso: string; chave: string }[] = []

  try {
    for (const caso of CASOS) {
      console.log(`\n${"=".repeat(78)}\n${caso.nome}\n  esperado: ${caso.esperado}`)
      const m = montarConvocacaoRm(
        {
          chapa,
          dataInicio: caso.dataInicio,
          dataFim: caso.dataFim,
          dataConvocacao: caso.dataConvocacao,
          codConvocacao: caso.codConvocacao,
        },
        { omitirCodigo: caso.omitirCodigo },
      )
      console.log(
        `  antecedência=${m.antecedenciaDias}d  motivo=${m.motivoDataConvocacao}  ` +
          `exigeConfirmacaoRm=${m.exigeConfirmacaoRm}`,
      )
      console.log(m.dadosXml.replace(/^/gm, "    "))

      // PK que a gente JÁ conhece quando o código é nosso — a limpeza não fica na mão do RM.
      const pkPrevista = caso.codConvocacao
        ? pkConvocacaoRm({ coligada: COLIGADA, chapa, codConvocacao: caso.codConvocacao })
        : ""
      if (pkPrevista) {
        console.log(`  PK prevista: ${pkPrevista}`)
        criados.push({ caso: caso.nome, chave: pkPrevista })
      }

      let chave = ""
      try {
        const r = await saveRecordDireto(RM_DATA_SERVER_CONVOCACAO, m.dadosXml, contexto)
        chave = r.chave
        console.log(`  ✅ SaveRecord OK -> chave="${chave}"`)
        // SEMPRE registrar a chave devolvida, mesmo tendo PK prevista. O RM ignora o código
        // enviado e numera pelo contador automático (visto em 08/08: mandei
        // "ZZ-TESTE-AUTOMACAO-1" e ele gravou "C03S003755") — confiar só na PK prevista deixou
        // registro órfão em produção.
        if (!criados.some((c) => c.chave === chave)) criados.push({ caso: caso.nome, chave })
        if (pkPrevista && chave !== pkPrevista) {
          console.log(`  ⚠️ o RM IGNOROU o código enviado (previsto ${pkPrevista})`)
        }
      } catch (e) {
        console.log(`  ❌ SaveRecord não devolveu chave: ${detalharErro(e)}`)
        if ((e as RmSoapError)?.indeterminado) {
          console.log("  ⚠️ INDETERMINADO — pode ter gravado; a limpeza abaixo tenta a PK prevista.")
        }
        if (!pkPrevista) continue
      }

      // Prova que existe e mostra o que o RM preencheu sozinho (DTPREVPGTO? CODCONVOCACAO?).
      const pkLeitura = chave || pkPrevista
      try {
        const lido = desescaparXml(await readRecordDireto(RM_DATA_SERVER_CONVOCACAO, pkLeitura, contexto))
        console.log("  --- ReadRecord do que ficou gravado ---")
        console.log(lido.replace(/^/gm, "    "))
      } catch (e) {
        console.log(`  ⚠️ ReadRecord falhou: ${detalharErro(e)}`)
      }
      // Rede de segurança do caso sem PK conhecida: acha pelo período e mostra o código gerado.
      if (!pkPrevista) {
        try {
          const filtro =
            `CODCOLIGADA=${COLIGADA} AND CHAPA='${chapa}'` +
            ` AND DTINIPRESTSERV >= '${caso.dataInicio}' AND DTFIMPRESTSERV <= '${caso.dataFim}'`
          const achados = parseConvocacoesReadView(
            desescaparXml(await readViewDireto(RM_DATA_SERVER_CONVOCACAO, filtro, contexto)),
          )
          console.log(`  ReadView do período: ${achados.map((a) => a.codConvocacao).join(", ") || "(vazio)"}`)
          for (const a of achados) {
            const pk = pkConvocacaoRm({ coligada: COLIGADA, chapa, codConvocacao: a.codConvocacao })
            if (!criados.some((c) => c.chave === pk)) criados.push({ caso: caso.nome, chave: pk })
          }
        } catch (e) {
          console.log(`  ⚠️ ReadView de segurança falhou: ${detalharErro(e)}`)
        }
      }
    }
  } finally {
    console.log(`\n${"=".repeat(78)}\nLIMPEZA — apagando ${criados.length} registro(s)`)
    const sobrou: string[] = []
    /** Existe de verdade? ReadRecord que estoura NÃO prova remoção — PK inexistente também estoura. */
    const existe = async (chaveAlvo: string): Promise<boolean> => {
      try {
        const xml = desescaparXml(await readRecordDireto(RM_DATA_SERVER_CONVOCACAO, chaveAlvo, contexto))
        return /<CODCONVOCACAO>\s*\S/.test(xml)
      } catch {
        return false
      }
    }
    for (const c of criados) {
      // Confere ANTES: sem isso, "não existia" e "apaguei" ficam indistinguíveis — foi exatamente
      // assim que a PK prevista errada virou um "✅ removido" falso e deixou órfão em produção.
      if (!(await existe(c.chave))) {
        console.log(`  ⏭️ "${c.chave}" não existe no RM (nada a apagar)`)
        continue
      }
      try {
        const r = await deleteRecordByKeyDireto(RM_DATA_SERVER_CONVOCACAO, c.chave, contexto)
        console.log(`  🗑️ delete "${c.chave}" -> ${r.trim() || "(sem retorno)"}`)
      } catch (e) {
        console.log(`  ❌ delete falhou em "${c.chave}": ${detalharErro(e)}`)
      }
      if (await existe(c.chave)) {
        console.log(`  ❌ AINDA EXISTE após o delete: ${c.chave}`)
        sobrou.push(c.chave)
      } else {
        console.log(`  ✅ confirmado removido: ${c.chave}`)
      }
    }
    if (sobrou.length) {
      console.log(`\n🚨 APAGAR NA MÃO no RM: ${sobrou.join("  ")}`)
      process.exitCode = 1
    } else {
      console.log("\n✅ RM limpo — nenhum registro de teste sobrou.")
    }
  }
}

main().catch((e) => {
  console.error(detalharErro(e))
  process.exit(1)
})
