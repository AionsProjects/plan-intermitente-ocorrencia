// Cliente Caju — porta os nós n8n "Gerar Token / Buscar Pessoa / CRIAR PEDIDO / Confirmar / QR".
// Contrato da API validado 1:1 contra o WF MENSAL FIFO (krRj3mXCM3F1CCYN):
//   - endpoint singular /voucher/allowance_order
//   - payload { sponsorId, name, allowances:[{employeeId, amounts:[{category, amount(centavos)}]}] }
//   - confirm POST /voucher/allowance_order/{id} { paymentStrategies:[{paymentType, amount}] }
// ATENÇÃO: criarPedido + confirmarPedido = DINHEIRO REAL. GATED: só via ledger pi.efeitos_externos,
// e só no modo "producao" do workflow (hoje bloqueado). getToken/buscarEmployeeId/buscarPedido são READ-ONLY.
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

// ---------------------------------------------------------------------------
// Helpers puros (exportados p/ teste) — espelham os Code nodes do n8n.
// ---------------------------------------------------------------------------

export function centsCaju(v: unknown): number {
  return Math.round((Number(v) || 0) * 100)
}

export function normCaju(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
}

/** Categoria VT: mobilidade (TRANSPORTATION) p/ SEDUC INTERIOR/TRE PB/CETAM ou interior=SIM; senão vale (TRANSPORTATION_VOUCHER). */
export function categoriaVT(contrato: string, interior: string): "TRANSPORTATION" | "TRANSPORTATION_VOUCHER" {
  const mobilidade = ["SEDUC INTERIOR", "TRE PB", "CETAM"].includes(normCaju(contrato)) || normCaju(interior) === "SIM"
  return mobilidade ? "TRANSPORTATION" : "TRANSPORTATION_VOUCHER"
}

/** Nome do pedido: INTERMITENTE-MENSAL-<CONTRATO>-MM.YY <sufixo>, truncado em 100 chars (regra do n8n). */
export function montarNomePedido(contrato: string, mesComp: number | string, anoComp: number | string, sufixo: string): string {
  const c = normCaju(contrato).replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  const pre = "INTERMITENTE-MENSAL-"
  const dt = "-" + String(mesComp).padStart(2, "0") + "." + String(anoComp).slice(-2) + " "
  let n = pre + c + dt + sufixo
  if (n.length > 100) {
    const room = Math.max(1, 100 - (pre.length + dt.length + sufixo.length))
    n = pre + c.slice(0, room) + dt + sufixo
  }
  return n
}

export type PaymentTypeCaju = "EXISTING_BALANCE" | "PIX_CODE"
export type TipoPedidoCaju = "credito" | "boleto"

export interface PessoaPedidoCaju {
  employeeId?: string | null
  contrato: string
  interior: string
  creditoVR?: number
  creditoVT?: number
  pixVR?: number
  pixVT?: number
}

export interface AllowanceCaju {
  employeeId: string
  amounts: Array<{ category: string; amount: number }>
}

export interface PedidoMontadoCaju {
  tipoPedido: TipoPedidoCaju
  tem: boolean
  paymentType: PaymentTypeCaju
  totalCentavos: number
  name: string
  payload: { sponsorId: string; name: string; allowances: AllowanceCaju[] } | null
  confirmPayload: { paymentStrategies: Array<{ paymentType: PaymentTypeCaju; amount: number }> }
}

/** Monta o pedido em lote do contrato (credito ou boleto), idêntico aos nós "Montar Pedido CREDITO/BOLETO". */
export function montarPedidoCaju(
  pessoas: PessoaPedidoCaju[],
  tipo: TipoPedidoCaju,
  contrato: string,
  mesComp: number | string,
  anoComp: number | string,
): PedidoMontadoCaju {
  const allowances: AllowanceCaju[] = []
  for (const p of pessoas) {
    const eid = p.employeeId
    if (!eid) continue
    const vr = tipo === "credito" ? p.creditoVR : p.pixVR
    const vt = tipo === "credito" ? p.creditoVT : p.pixVT
    const amounts: Array<{ category: string; amount: number }> = []
    if (centsCaju(vr) > 0) amounts.push({ category: "FOOD_AID", amount: centsCaju(vr) })
    if (centsCaju(vt) > 0) amounts.push({ category: categoriaVT(p.contrato, p.interior), amount: centsCaju(vt) })
    if (amounts.length) allowances.push({ employeeId: eid, amounts })
  }
  const paymentType: PaymentTypeCaju = tipo === "credito" ? "EXISTING_BALANCE" : "PIX_CODE"
  const sufixo = tipo === "credito" ? "3 DIAS CREDITO" : "DEBITO"
  const name = montarNomePedido(contrato, mesComp, anoComp, sufixo)
  const totalCentavos = allowances.reduce((a, e) => a + e.amounts.reduce((b, x) => b + x.amount, 0), 0)
  const tem = allowances.length > 0
  return {
    tipoPedido: tipo,
    tem,
    paymentType,
    totalCentavos,
    name,
    payload: tem ? { sponsorId: config.caju.sponsorId, name, allowances } : null,
    confirmPayload: { paymentStrategies: [{ paymentType, amount: totalCentavos }] },
  }
}

/** Extrai o orderId da resposta do criarPedido (r.id | r.allowanceOrderId | r.data.id | r.order.id). */
export function extrairOrderId(resp: unknown): string | null {
  const r = resp as Record<string, unknown> | null
  if (!r) return null
  return (
    (r.id as string) ||
    (r.allowanceOrderId as string) ||
    ((r.data as Record<string, unknown>)?.id as string) ||
    ((r.order as Record<string, unknown>)?.id as string) ||
    null
  )
}

/** Extrai o QR base64 (pixCode.encodedImage) da resposta do buscarPedido. */
export function extrairQrBase64(resp: unknown): string {
  const r = resp as { pixCode?: { encodedImage?: string } } | null
  const qr = r?.pixCode?.encodedImage || ""
  return qr ? String(qr).replace(/^data:image\/[^;]+;base64,/, "") : ""
}

/** Parse do employeeId no retorno do GET /employee (items[0]/data[0]/content[0]/self). */
export function extrairEmployeeId(resp: unknown): string | null {
  const pega = (o: unknown): string | null => {
    const r = o as Record<string, unknown> | null
    return (r?.employeeId as string) || (r?.id as string) || (r?.personId as string) || null
  }
  const r = resp as Record<string, unknown> | null
  if (!r) return null
  if (Array.isArray(r.items)) return pega(r.items[0])
  if (Array.isArray(r.data)) return pega(r.data[0])
  if (Array.isArray(r.content)) return pega(r.content[0])
  return pega(r)
}

// ---------------------------------------------------------------------------
// Token (OAuth password grant). READ-ONLY. Cache por instância com margem.
// ---------------------------------------------------------------------------

let _tokenCache: { token: string; exp: number } | null = null

/** Descarta o token em cache. Chamar no início de cada contrato (token Caju expira rápido). */
export function resetTokenCaju(): void {
  _tokenCache = null
}

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

function headersCaju(token: string, comContentType = true): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "X-Sponsor-Id": config.caju.sponsorId,
    "X-Integration-Id": config.caju.integrationId,
  }
  if (comContentType) h["Content-Type"] = "application/json"
  return h
}

// ---------------------------------------------------------------------------
// Chamadas HTTP (espelham os nós HTTP do n8n).
// ---------------------------------------------------------------------------

/** GET /sponsor/{sponsorId}/employee?cpf=<11 dígitos> -> employeeId. READ-ONLY. */
export async function buscarEmployeeId(cpf: string): Promise<string | null> {
  const token = await getToken()
  const cpf11 = String(cpf || "").replace(/\D/g, "").padStart(11, "0")
  const url = `${config.caju.apiBase}/sponsor/${config.caju.sponsorId}/employee?cpf=${cpf11}`
  const r = await fetch(url, { headers: headersCaju(token, false) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju buscarEmployeeId HTTP ${r.status}`, r.status, j)
  return extrairEmployeeId(j)
}

/** POST /voucher/allowance_order. **DINHEIRO REAL — GATED.** Retorna { orderId, raw }. */
export async function criarPedido(payload: { sponsorId: string; name: string; allowances: AllowanceCaju[] }): Promise<{ orderId: string | null; raw: unknown }> {
  const token = await getToken()
  const r = await fetch(`${config.caju.apiBase}/voucher/allowance_order`, {
    method: "POST",
    headers: headersCaju(token),
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju criarPedido HTTP ${r.status}`, r.status, j)
  return { orderId: extrairOrderId(j), raw: j }
}

/** POST /voucher/allowance_order/{orderId} com paymentStrategies. **DINHEIRO REAL — GATED.** */
export async function confirmarPedido(
  orderId: string,
  confirmPayload: { paymentStrategies: Array<{ paymentType: PaymentTypeCaju; amount: number }> },
): Promise<unknown> {
  const token = await getToken()
  const r = await fetch(`${config.caju.apiBase}/voucher/allowance_order/${orderId}`, {
    method: "POST",
    headers: headersCaju(token),
    body: JSON.stringify(confirmPayload),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju confirmarPedido HTTP ${r.status}`, r.status, j)
  return j
}

/** GET /voucher/allowance_order/{orderId} (poll do boleto/QR). READ-ONLY. */
export async function buscarPedido(orderId: string): Promise<unknown> {
  const token = await getToken()
  const r = await fetch(`${config.caju.apiBase}/voucher/allowance_order/${orderId}`, {
    headers: headersCaju(token, false),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw erro(`Caju buscarPedido HTTP ${r.status}`, r.status, j)
  return j
}

export const summaryUrlCaju = (orderId: string | null): string =>
  orderId ? `https://empresa.caju.com.br/classic/#/order/${orderId}/summary` : ""
