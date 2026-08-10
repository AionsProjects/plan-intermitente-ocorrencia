// Ausências do RM (consulta registrada PI ATESTADOS) → cortes que partem uma convocação.
//
// Puro: nada de rede, nada de banco. Quem lê o RM é services/ausenciasRm.ts.
//
// A pergunta que este módulo responde é estreita de propósito: "que dias desta janela NÃO podem
// ser convocados?". Diagnóstico, CID, quem lançou — nada disso entra na decisão.
import { paraDataIso } from "./convocacaoRm.js"

/** Linha crua da consulta. Nomes = aliases da SQL registrada (ASCII, SCREAMING_SNAKE). */
export interface LinhaAtestadoRm {
  CHAPA?: unknown
  NOME?: unknown
  COD_SITUACAO?: unknown
  COD_CATEGORIA_ESOCIAL?: unknown
  COD_TIPO_ATESTADO?: unknown
  TIPO_ATESTADO?: unknown
  DT_INICIO?: unknown
  DT_FINAL?: unknown
  FIM_INFORMADO?: unknown
  HORA_INICIO_MIN?: unknown
  HORA_FINAL_MIN?: unknown
}

export interface Ausencia {
  chapa: string
  inicio: string
  fim: string
  codTipo: string
  tipo: string
  /** Minutos desde 00:00. `null` quando o RM não informou. */
  horaInicio: number | null
  horaFinal: number | null
  diaCheio: boolean
  situacao: string
  categoriaESocial: string
}

/** Linha que não virou ausência, com o motivo. Existe pra NÃO haver descarte silencioso. */
export interface DescarteAusencia {
  motivo: "sem_chapa" | "data_invalida" | "periodo_invertido"
  linha: LinhaAtestadoRm
}

export interface MapeamentoAusencias {
  ausencias: Ausencia[]
  descartadas: DescarteAusencia[]
}

const texto = (v: unknown): string => (v == null ? "" : String(v).trim())

/**
 * Minutos do RM. `HORAINICIO`/`HORAFINAL` são int (minutos desde 00:00); vazio/`null` = não
 * informado, que é diferente de zero — zero é meia-noite e conta como dia cheio.
 *
 * Aceita também `"HH:MM"`: não confirmamos o tipo da coluna no RM, e se ela vier como texto o
 * `Number()` daria `NaN` → `null` → "dia cheio" → atestado de meio período passaria a quebrar a
 * convocação. Custa duas linhas cobrir os dois formatos.
 */
function minutos(v: unknown): number | null {
  if (v == null || v === "") return null
  const s = String(v).trim()
  const hhmm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  const n = hhmm ? Number(hhmm[1]) * 60 + Number(hhmm[2]) : Number(s)
  if (!Number.isFinite(n) || n < 0 || n > 24 * 60) return null
  return Math.trunc(n)
}

/**
 * Dia cheio = o atestado não recorta um intervalo dentro do dia.
 *
 * Sem hora, é dia cheio: é assim que o RM registra o atestado comum de dias corridos, e tratar a
 * ausência de informação como "parcial" faria o caso mais frequente parar de quebrar convocação.
 * Com hora, só é cheio se cobre o dia inteiro (00:00 → 23:59/24:00).
 */
export function ehDiaCheio(horaInicio: number | null, horaFinal: number | null): boolean {
  if (horaInicio == null && horaFinal == null) return true
  if (horaInicio == null || horaFinal == null) return true // metade informada não descreve recorte
  if (horaInicio === 0 && horaFinal === 0) return true // 00:00–00:00 = dia todo, não intervalo nulo
  return horaInicio <= 0 && horaFinal >= 23 * 60 + 59
}

/** Uma linha crua → ausência. `null` quando a linha não descreve um período utilizável. */
export function mapearLinhaAtestado(linha: LinhaAtestadoRm): Ausencia | DescarteAusencia {
  const chapa = texto(linha.CHAPA)
  if (!chapa) return { motivo: "sem_chapa", linha }

  const inicio = paraDataIso(texto(linha.DT_INICIO))
  // DT_FINAL já vem com COALESCE na SQL, mas a consulta pode ser trocada no RM sem avisar —
  // cair pro início mantém o atestado de 1 dia funcionando em vez de sumir.
  const fim = paraDataIso(texto(linha.DT_FINAL)) || inicio
  if (!inicio || !fim) return { motivo: "data_invalida", linha }
  if (fim < inicio) return { motivo: "periodo_invertido", linha }

  const horaInicio = minutos(linha.HORA_INICIO_MIN)
  const horaFinal = minutos(linha.HORA_FINAL_MIN)
  return {
    chapa,
    inicio,
    fim,
    codTipo: texto(linha.COD_TIPO_ATESTADO),
    tipo: texto(linha.TIPO_ATESTADO),
    horaInicio,
    horaFinal,
    diaCheio: ehDiaCheio(horaInicio, horaFinal),
    situacao: texto(linha.COD_SITUACAO),
    categoriaESocial: texto(linha.COD_CATEGORIA_ESOCIAL),
  }
}

export function mapearAtestados(linhas: LinhaAtestadoRm[]): MapeamentoAusencias {
  const ausencias: Ausencia[] = []
  const descartadas: DescarteAusencia[] = []
  for (const l of linhas) {
    const r = mapearLinhaAtestado(l)
    if ("motivo" in r) descartadas.push(r)
    else ausencias.push(r)
  }
  return { ausencias, descartadas }
}

/**
 * Tipos que NÃO partem a convocação. Começa vazio de propósito.
 *
 * Tipo desconhecido QUEBRA. Os dois erros não são simétricos: quebrar à toa gera uma convocação a
 * menos, a pessoa reclama e o DP corrige; não quebrar gera S-2260 afirmando trabalho em dia
 * coberto por atestado — errado perante o eSocial e invisível. Erra-se pro lado que grita.
 */
export const TIPOS_QUE_NAO_QUEBRAM = new Set<string>()

export function ausenciaQuebraConvocacao(a: Ausencia): boolean {
  if (!a.diaCheio) return false // atestado de algumas horas não tira o dia
  return !TIPOS_QUE_NAO_QUEBRAM.has(a.codTipo)
}

/** Só as ausências desta chapa que quebram. Chapa comparada sem zeros à esquerda. */
export function cortesDaChapa(ausencias: Ausencia[], chapa: string): { inicio: string; fim: string }[] {
  const alvo = chapa.replace(/^0+/, "")
  return ausencias
    .filter((a) => a.chapa.replace(/^0+/, "") === alvo)
    .filter(ausenciaQuebraConvocacao)
    .map((a) => ({ inicio: a.inicio, fim: a.fim }))
}
