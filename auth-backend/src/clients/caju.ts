// Cliente Caju — substitui os nós "Gerar Token / CRIAR PEDIDO / Confirmar PIX / pix pegar".
// OAuth password grant -> Bearer. Headers X-Sponsor-Id / X-Integration-Id.
// ATENÇÃO: criar pedido + confirmar PIX = DINHEIRO REAL. Essas funções são GATED:
// só rode com idempotência (pi.efeitos_externos) e avise o usuário pra apagar no teste.
import { config } from "../config.js"

export interface CajuError extends Error {
  caju: true
  status?: number
  detalhe?: unknown
}
function erro(msg: string, status?: number, detalhe?: unknown): CajuError {
  const e = new Error(msg) as CajuError
  e.caju = true
  e.status = status
  e.detalhe = detalhe
  return e
}

let _tokenCache: { token: string; exp: number } | null = null

/** OAuth password grant -> access_token (cacheado por ~50s de margem). READ-ONLY (não move dinheiro). */
export async function getToken(): Promise<string> {
  const c = config.caju
  if (!c.authUrl || !c.clientId) throw erro("Caju não configurado no .env")
  const agora = Date.now()
  if (_tokenCache && _tokenCache.exp > agora + 5000) return _tokenCache.token
  const form = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: c.grantType,
    username: c.username,
    password: c.password,
  })
  const r = await fetch(c.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  })
  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  if (!r.ok || !j?.access_token) throw erro(`Caju token HTTP ${r.status}`, r.status, j)
  _tokenCache = { token: j.access_token, exp: agora + (j.expires_in ?? 300) * 1000 }
  return j.access_token
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Sponsor-Id": config.caju.sponsorId,
    "X-Integration-Id": config.caju.integrationId,
  }
}

export interface AmountCaju {
  category: string
  amount: number
}

export interface PedidoCaju {
  employeeId: string
  amounts: AmountCaju[]
  descricao?: string
  competencia?: string
  paymentMethod?: string // ex PIX
}

/**
 * Cria pedido (allowance order) no Caju. **DINHEIRO REAL — GATED.**
 * O caller DEVE checar idempotência (pi.efeitos_externos) antes e avisar p/ apagar em teste.
 */
export async function criarPedido(p: PedidoCaju): Promise<unknown> {
  const token = await getToken()
  const r = await fetch(`${config.caju.apiBase}/voucher/allowance_orders`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      employee_id: p.employeeId,
      amounts: p.amounts,
      description: p.descricao,
      competence: p.competencia,
      payment_method: p.paymentMethod ?? "PIX",
    }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju criarPedido HTTP ${r.status}`, r.status, j)
  return j
}

/** Confirma o pagamento PIX de um pedido. **DINHEIRO REAL — GATED.** */
export async function confirmarPix(orderId: string): Promise<unknown> {
  const token = await getToken()
  const r = await fetch(`${config.caju.apiBase}/voucher/allowance_orders/${orderId}/confirm`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({}),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju confirmarPix HTTP ${r.status}`, r.status, j)
  return j
}

/** Busca o pedido (p/ pegar boleto/pixCode.encodedImage — async, requer polling). READ-ONLY. */
export async function buscarPedido(orderId: string): Promise<unknown> {
  const token = await getToken()
  const r = await fetch(`${config.caju.apiBase}/voucher/allowance_orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-Sponsor-Id": config.caju.sponsorId, "X-Integration-Id": config.caju.integrationId },
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju buscarPedido HTTP ${r.status}`, r.status, j)
  return j
}
