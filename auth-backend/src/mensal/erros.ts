// Classificação de erro que atravessou a fronteira de um step do workflow.
//
// Do outro lado da fronteira o runtime SERIALIZA o erro: `e instanceof Error` é falso e o `catch`
// recebe um objeto solto. Foi por isso que os 5 contratos do run `b4a1f614` (31/08/2026) fecharam
// com `erro_desconhecido` — o RM estava fora do ar, o `rm_integrar` estourou, e a mensagem real
// morreu na travessia. Ninguém soube que era o RM sem abrir o Postgres.

/** Mensagem legível de um erro serializado (ou não). */
export function mensagemErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  const o = e as { message?: unknown; errorMessage?: unknown; name?: unknown } | null
  for (const v of [o?.message, o?.errorMessage, o?.name]) {
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  if (typeof e === "string" && e.trim()) return e.trim()
  try {
    const j = JSON.stringify(e)
    if (j && j !== "{}" && j !== "null") return j.slice(0, 300)
  } catch {
    /* objeto com ciclo — cai no genérico */
  }
  return "erro_desconhecido"
}

/**
 * Efeito que ficou reservado sem confirmação — o step morreu entre reservar e confirmar, e o
 * desfecho no sistema externo é DESCONHECIDO.
 *
 * A guarda que estoura isso continua certa e continua no lugar: ninguém re-chama o RM por cima de
 * um efeito pendente. O que mudou (decisão do Isaac, 31/08/2026) é o que o CONTRATO faz com ela:
 * antes derrubava o contrato inteiro e o board ficava vazio; agora vira pendência e as pernas que
 * não dependem do RM seguem. A conciliação continua sendo trabalho de gente — só deixou de levar
 * o resto do pagamento junto.
 */
export function ehPendenciaDeEfeito(e: unknown): boolean {
  return /efeito_pendente_requer_conciliacao/.test(mensagemErro(e))
}

/**
 * `FatalError` é o erro que EXIGE gente ANTES de qualquer outra escrita — hoje, convocação do RM
 * com pendência que o DP tem de resolver. Ele NÃO degrada: seguir gravando board e Drive por cima
 * de uma convocação irresolvida seria registrar um pagamento que talvez não devesse existir.
 *
 * Por nome, não por `instanceof`: a classe não sobrevive à serialização do step, mas o `name` sim
 * (é o que a Vercel mostra em `errorName`).
 *
 * Efeito pendente é a EXCEÇÃO explícita: também chega como FatalError, e desde 31/08 degrada.
 */
export function ehFatal(e: unknown): boolean {
  if (ehPendenciaDeEfeito(e)) return false
  const nome = (e as { name?: unknown } | null)?.name
  if (nome === "FatalError") return true
  // Rede/timeout do RM não é fatal — é exatamente o caso que deve virar pendência.
  return /requer_decisao/.test(mensagemErro(e))
}
