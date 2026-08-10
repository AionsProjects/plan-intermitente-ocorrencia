// Lê os atestados do RM (consulta registrada PI ATESTADOS) e devolve os cortes de uma chapa.
//
// FALHA FECHADO. Se o RM não responde, a resposta NÃO é "sem atestado" — é erro, e a gravação da
// convocação não acontece. "Sem atestado" por indisponibilidade gera S-2260 afirmando trabalho em
// dia coberto por atestado; o custo do outro lado é a convocação atrasar até o RM voltar. E não é
// dependência nova: gravar já exige o RM de pé.
import { config } from "../config.js"
import { consultarSql } from "../clients/rm.js"
import {
  cortesDaChapa,
  mapearAtestados,
  type Ausencia,
  type DescarteAusencia,
  type LinhaAtestadoRm,
} from "../domain/ausencias.js"
import { chapaAceitavelNoFiltro } from "../domain/convocacaoRm.js"

export interface ConsultaAtestados {
  (p: { chapa: string; dataInicial: string; dataFinal: string }): Promise<LinhaAtestadoRm[]>
}

export interface AusenciasDaChapa {
  cortes: { inicio: string; fim: string }[]
  ausencias: Ausencia[]
  descartadas: DescarteAusencia[]
  linhas: number
}

/**
 * Consulta padrão: SQL registrada no RM. Injetável pra teste não depender de rede.
 *
 * ⚠️ A ORDEM DAS CHAVES AQUI É SIGNIFICATIVA — não é estilo. Medido em 10/08/2026: o RM casa os
 * parâmetros por POSIÇÃO na querystring, não por nome. Com a sentença pedindo `:DATA_FINAL` antes
 * de `:DATA_INICIAL`, a mesma janela devolveu 6 linhas em vez de 24 — silenciosamente, sem erro
 * nenhum, porque a janela virava o seu complemento ("atestados que cobrem o mês inteiro").
 *
 * Esta ordem tem que bater com a ordem de aparição na sentença registrada:
 *   :$CODCOLIGADA (injetado por consultarSql), :CHAPA, :DATA_INICIAL, :DATA_FINAL
 * Ver docs/rm/sql-pi-atestados.sql. Há teste travando esta ordem.
 */
export const consultaPadrao: ConsultaAtestados = async ({ chapa, dataInicial, dataFinal }) =>
  consultarSql<LinhaAtestadoRm>({
    codigoSql: config.rmSqlAtestados,
    parametros: { CHAPA: chapa, DATA_INICIAL: dataInicial, DATA_FINAL: dataFinal },
  })

/** Ordem esperada dos parâmetros. Exportada só pro teste — ver o aviso acima. */
export const ORDEM_PARAMETROS_ATESTADOS = ["CHAPA", "DATA_INICIAL", "DATA_FINAL"] as const

/**
 * Ausências que partem a convocação desta chapa no período.
 *
 * A janela consultada é o próprio período: a SQL usa INTERSEÇÃO, então atestado que começou antes
 * e invade o começo do período vem junto — é o caso que a consulta base perdia.
 */
export async function ausenciasDaConvocacao(
  chapa: string,
  inicio: string,
  fim: string,
  consulta: ConsultaAtestados = consultaPadrao,
): Promise<AusenciasDaChapa> {
  // Mesma trava do pré-voo: chapa não-numérica vira filtro que não casa nada, e "nada" aqui
  // significaria "sem atestado" — o resultado perigoso.
  if (!chapaAceitavelNoFiltro(chapa)) throw new Error(`ausencias_rm: chapa invalida (${chapa})`)

  const linhas = await consulta({ chapa, dataInicial: inicio, dataFinal: fim })
  const { ausencias, descartadas } = mapearAtestados(linhas)

  // Guarda contra parâmetro trocado/sentença alterada no RM. Se algo NÃO cruza a janela pedida, a
  // consulta não está filtrando o que achamos — e aí o silêncio é o perigo: dá pra perder atestado
  // e gravar convocação por cima de dia coberto. Falha alto em vez de aceitar resultado suspeito.
  const forasteiras = ausencias.filter((a) => a.fim < inicio || a.inicio > fim)
  if (forasteiras.length) {
    throw new Error(
      `ausencias_rm: ${forasteiras.length} de ${ausencias.length} fora da janela ${inicio}..${fim} ` +
        `(ex: ${forasteiras[0]!.inicio}..${forasteiras[0]!.fim}) — confira a ORDEM dos parametros ` +
        `na consulta ${config.rmSqlAtestados} (o RM casa por posicao, nao por nome)`,
    )
  }

  if (descartadas.length) {
    // Log, não exceção: uma linha ilegível não pode impedir as legíveis de cortar o período.
    console.warn(
      `[ausencias] chapa ${chapa}: ${descartadas.length} linha(s) descartada(s) —`,
      descartadas.map((d) => d.motivo).join(", "),
    )
  }
  return { cortes: cortesDaChapa(ausencias, chapa), ausencias, descartadas, linhas: linhas.length }
}
