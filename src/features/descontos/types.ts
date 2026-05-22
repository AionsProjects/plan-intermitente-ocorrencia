/**
 * Tipos da feature /descontos/:uuid — registro de retirada manual da conta
 * Caju contra item do board Desconto (Monday 18400981023).
 *
 * Fluxo:
 *  - DP olha conta Caju do intermitente, retira valores manualmente fora do
 *    app, depois abre o link único `/descontos/<uuid>` e registra quanto
 *    retirou de VR + VT. Backend atualiza item Monday com Status=Registrado.
 */

export type StatusDescontoManual = "pendente" | "registrado"

export type RetiradaAnterior = {
  vrRetirado: number
  vtRetirado: number
  /** ISO timestamp. */
  registradoEm: string
}

export type DescontoDados = {
  uuid: string
  itemId: string
  empregadoNome: string
  chapa: string
  contrato: string | null
  periodoInicio: string
  periodoFim: string
  vrDevido: number
  vtDevido: number
  retiradaAnterior?: RetiradaAnterior | null
  status: StatusDescontoManual
}

export type PayloadRegistrarRetirada = {
  vrRetirado: number
  vtRetirado: number
}

export type ResultadoRegistrarRetirada = {
  ok: boolean
  uuid: string
  vrRetirado: number
  vtRetirado: number
  vrRestante: number
  vtRestante: number
}
