/**
 * Trava operacional do "Atestado retroativo" no fluxo /atestados.
 *
 * Senha universal hardcoded (`231375`) libera navegação pra meses
 * anteriores no calendário do WizardDocumento. Liberação persiste
 * em localStorage com TTL fim-do-dia local — recarregar a página
 * no mesmo dia mantém liberado; no dia seguinte expira e pede senha
 * de novo.
 *
 * NÃO é autenticação forte — só trava operacional pra evitar lançar
 * atestado retroativo por engano. Senha não vai no payload do n8n.
 */

const KEY = "atestados:retroativo:liberado"
const SENHA = "231375"

export type Liberacao = {
  liberadoEm: string // ISO timestamp
  expiraEm: string   // ISO end-of-day local
}

/** Fim-do-dia local em ISO (23:59:59.999 do dia atual no timezone do user). */
function fimDoDiaLocal(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export function senhaCorreta(input: string): boolean {
  return input.trim() === SENHA
}

export function liberarRetroativo(): Liberacao {
  const lib: Liberacao = {
    liberadoEm: new Date().toISOString(),
    expiraEm: fimDoDiaLocal(),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(lib))
  } catch {
    // Storage indisponível (modo privado, quota cheia). Liberação
    // funciona em memória da sessão atual mas não persiste — caller
    // ainda chama setRetroativoAtivo(true) baseado no retorno.
  }
  return lib
}

export function isRetroativoLiberado(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const lib = JSON.parse(raw) as Liberacao
    if (!lib?.expiraEm) return false
    if (new Date(lib.expiraEm).getTime() < Date.now()) {
      localStorage.removeItem(KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

export function revogarRetroativo(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignora — chamada idempotente
  }
}
