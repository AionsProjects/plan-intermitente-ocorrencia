// Sessão deslizante: cada uso empurra o vencimento pra `agora + ttl`, mas nunca além de
// `criada + teto`. O teto existe porque, sem ele, um cookie vazado nunca morreria enquanto
// alguém o usasse; com ele a pessoa volta ao login de tempos em tempos (o front trata isso
// com o diálogo de sessão expirada, sem perder o que estava preenchido).
//
// Puro de propósito (sem banco, sem relógio) pra testar sem tocar no Postgres de produção.

const DIA_MS = 24 * 60 * 60 * 1000

export interface EntradaRenovacao {
  agora: Date
  /** Vencimento atual da sessão. */
  expiraEm: Date
  criadaEm: Date
  ttlDias: number
  tetoDias: number
}

/**
 * Novo vencimento, ou `null` quando não há nada a gravar.
 *
 * Só renova quando o ganho passa de um dia: o front dispara dezenas de requisições por
 * tela e uma escrita em cada uma seria ruído (e uma ida a mais ao Postgres remoto). Com
 * TTL de 10 dias isso dá no máximo uma escrita por sessão por dia. Perto do teto o ganho
 * encolhe e a renovação para sozinha — a sessão vence no teto.
 */
export function proximaExpiracao(e: EntradaRenovacao): Date | null {
  const teto = e.criadaEm.getTime() + e.tetoDias * DIA_MS
  const alvo = Math.min(e.agora.getTime() + e.ttlDias * DIA_MS, teto)
  return alvo - e.expiraEm.getTime() >= DIA_MS ? new Date(alvo) : null
}
