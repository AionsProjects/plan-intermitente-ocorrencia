import type { ContratoColaboradorLabel } from "./opcoesAtestadoForm"

/**
 * Mapa determinístico do 3º octeto da seção RM (TBSECAO.CODIGO) para
 * o label do contrato no board Controle de Atestados.
 *
 * Derivado do dump de celetistas ativos (`todos.CSV`, 2026-05): 1132 funcionários,
 * todas as combinações `Codigo` × `Local/Unidade` analisadas.
 *
 * Formato do código de seção: `XX.XX.NNNN.XX.NNNN`
 *   - 3º octeto (`NNNN`) define o contrato base.
 *   - 5º octeto desambigua `0011` em ESCOLA (`01`) vs INTERIOR (`02`).
 *
 * Seções sem contrato cliente (0007 administrativo Aionscorp, 0015 BARCO,
 * 0057 licença maternidade, 0078 APRENDIZES, 0084 ESTAGIÁRIOS, 0087 transição,
 * 0089 afastado INSS, 0090 licença sem vencimento, 0091 rescisão indireta)
 * retornam `""` — operacional escolhe manualmente no select.
 */
const MAPA_TERCEIRO_OCTETO: Record<string, ContratoColaboradorLabel> = {
  "0004": "DETRAN",
  "0010": "SEDUC SEDE",
  "0074": "CETAM",
  "0079": "TRE PB",
  "0085": "SEMSA",
}

export function contratoDoCodigoSecao(
  codigo: string | undefined | null,
): ContratoColaboradorLabel | "" {
  if (!codigo) return ""
  const partes = codigo.split(".")
  if (partes.length < 3) return ""
  const terceiro = partes[2]
  const quinto = partes[4] ?? ""

  if (terceiro === "0011") {
    if (quinto === "01") return "SEDUC ESCOLA"
    if (quinto === "02") return "SEDUC INTERIOR"
    return ""
  }
  return MAPA_TERCEIRO_OCTETO[terceiro] ?? ""
}
