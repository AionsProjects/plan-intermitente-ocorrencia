// Cliente Caju — porta os nós n8n "Gerar Token / Buscar Pessoa / CRIAR PEDIDO / Confirmar / QR".
// Contrato da API validado 1:1 contra o WF MENSAL FIFO (krRj3mXCM3F1CCYN):
//   - endpoint singular /voucher/allowance_order
//   - payload { sponsorId, name, allowances:[{employeeId, amounts:[{category, amount(centavos)}]}] }
//   - confirm POST /voucher/allowance_order/{id} { paymentStrategies:[{paymentType, amount}] }
// MUDANÇA 08/2026: o pedido é SEPARADO por benefício — um pedido de VR e outro de VT por contrato,
// cada um com seu boleto. Antes VR e VT compartilhavam o `amounts[]` da mesma allowance do mesmo
// pedido, e um PIX só pagava os dois. Ver `BeneficioCaju` e `montarPedidoCaju`.
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

/**
 * Categoria VT: mobilidade (TRANSPORTATION) ou vale (TRANSPORTATION_VOUCHER).
 *
 * SEDUC INTERIOR e TRE PB são mobilidade por definição do contrato.
 * CETAM NÃO é — decide pela coluna "OP - Interior?" (`color__1`) caso a caso:
 * Interior=SIM -> mobilidade; qualquer outro valor -> vale. Nem todo CETAM é
 * interior (ex. chapa 007386, CETAM/Interior=NÃO, pagava mobilidade errado
 * até 21/08/2026).
 */
export function categoriaVT(contrato: string, interior: string): "TRANSPORTATION" | "TRANSPORTATION_VOUCHER" {
  const mobilidade = ["SEDUC INTERIOR", "TRE PB"].includes(normCaju(contrato)) || normCaju(interior) === "SIM"
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
/**
 * Benefício do pedido. Desde 08/2026 o pedido é SEPARADO por benefício: cada contrato gera um
 * pedido de VR e outro de VT, para que cada um tenha boleto e rastro financeiro próprios.
 * Antes VR e VT iam no mesmo `amounts[]` da mesma allowance.
 *
 * Cruza com `TipoPedidoCaju` (a natureza do pagamento): credito×VR, credito×VT, boleto×VR,
 * boleto×VT. Com `tetoVT = 0` no crédito (ver mensal/calculo.ts), credito×VT nasce vazio e é
 * descartado pelo `tem === false` — sem chamada à Caju.
 */
export type BeneficioCaju = "VR" | "VT"

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
  beneficio: BeneficioCaju
  tem: boolean
  paymentType: PaymentTypeCaju
  totalCentavos: number
  name: string
  payload: { sponsorId: string; name: string; allowances: AllowanceCaju[] } | null
  confirmPayload: { paymentStrategies: Array<{ paymentType: PaymentTypeCaju; amount: number }> }
}

/**
 * Monta o pedido em lote do contrato para UM benefício e UMA natureza de pagamento.
 *
 * O pedido de VR leva só `FOOD_AID`; o de VT leva só a categoria de transporte. Um pedido de VT
 * pode legitimamente carregar as DUAS categorias de transporte (`TRANSPORTATION` para quem é
 * interior/mobilidade e `TRANSPORTATION_VOUCHER` para o resto) quando o contrato mistura os dois —
 * isso continua sendo um pedido de VT e não se subdivide mais.
 */
export function montarPedidoCaju(
  pessoas: PessoaPedidoCaju[],
  tipo: TipoPedidoCaju,
  beneficio: BeneficioCaju,
  contrato: string,
  mesComp: number | string,
  anoComp: number | string,
): PedidoMontadoCaju {
  const allowances: AllowanceCaju[] = []
  for (const p of pessoas) {
    const eid = p.employeeId
    if (!eid) continue
    const valor = tipo === "credito"
      ? (beneficio === "VR" ? p.creditoVR : p.creditoVT)
      : (beneficio === "VR" ? p.pixVR : p.pixVT)
    const centavos = centsCaju(valor)
    if (centavos <= 0) continue
    const category = beneficio === "VR" ? "FOOD_AID" : categoriaVT(p.contrato, p.interior)
    allowances.push({ employeeId: eid, amounts: [{ category, amount: centavos }] })
  }
  const paymentType: PaymentTypeCaju = tipo === "credito" ? "EXISTING_BALANCE" : "PIX_CODE"
  const sufixo = (tipo === "credito" ? "3 DIAS CREDITO" : "DEBITO") + " " + beneficio
  const name = montarNomePedido(contrato, mesComp, anoComp, sufixo)
  const totalCentavos = allowances.reduce((a, e) => a + e.amounts.reduce((b, x) => b + x.amount, 0), 0)
  const tem = allowances.length > 0
  return {
    tipoPedido: tipo,
    beneficio,
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

/**
 * PIX copia-e-cola do boleto. O WF5 sondava três nomes possíveis (`emv`/`payload`/`copyPaste`)
 * porque a Caju não documenta qual devolve; nosso código só extraía a IMAGEM do QR, então quem
 * paga pelo celular não tinha o que colar. Vazio quando não vier — é opcional.
 */
export function extrairPixCopiaECola(resp: unknown): string {
  const p = (resp as { pixCode?: Record<string, unknown> } | null)?.pixCode
  if (!p) return ""
  for (const k of ["emv", "payload", "copyPaste", "qrCode", "code"]) {
    const v = p[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
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

/**
 * Link de download da NOTA DE DÉBITO do pedido, montado do template em env
 * (`CAJU_NOTA_URL`, com `{orderId}`).
 *
 * Montado, não buscado: a API não expõe o documento, e o pedido de CRÉDITO do pontual só é
 * confirmado à mão no painel — a nota nasce depois que a automação já terminou. Gravar o link na
 * hora resolve isso sem varredura: ele fica de pé assim que o DP confirma.
 *
 * Sem template configurado devolve "" — coluna vazia é honesta, link quebrado não.
 */
export function notaDebitoUrl(orderId: string | null | undefined): string {
  const tpl = config.caju.notaUrlTemplate
  const id = String(orderId ?? "").trim()
  if (!tpl || !id) return ""
  const url = tpl.replace(/\{orderId\}/gi, id).replace(/\{id\}/gi, id)
  // Template sem placeholder viraria a MESMA url pra todo pedido — pior que vazio.
  return url === tpl ? "" : url
}

/**
 * Ids dos pedidos de um contrato numa competência: natureza × benefício.
 * Nomes iguais em Monday e Drive para o mesmo objeto ser repassado inteiro.
 */
export interface PedidosCajuIds {
  pedidoCreditoVR?: string | null
  pedidoCreditoVT?: string | null
  pedidoPixVR?: string | null
  pedidoPixVT?: string | null
}

/**
 * Separador de múltiplos ids numa mesma célula do Monday. É o `"; "` que o DP já usa à mão nas
 * colunas de IDFINANC (ex.: `"24007; 24009"`) — não inventar formato novo.
 */
export const SEP_IDS_CAJU = "; "

/** Junta ids de pedido numa célula, na ordem recebida, descartando vazios. */
export function juntarIdsCaju(ids: Array<string | null | undefined>): string {
  return ids.filter((x): x is string => Boolean(x)).join(SEP_IDS_CAJU)
}

/** Junta as URLs de summary dos mesmos ids, no mesmo formato e na mesma ordem. */
export function juntarSummariesCaju(ids: Array<string | null | undefined>): string {
  return ids.filter((x): x is string => Boolean(x)).map((id) => summaryUrlCaju(id)).join(SEP_IDS_CAJU)
}

/**
 * Ids que vão para a coluna de pedido Caju do board de Solicitação: os de BOLETO (VR e VT).
 * São os que o DP efetivamente paga. O pedido de crédito nasce Rascunho e não é confirmado — o id
 * dele vive no board Controle Caju e no texto da DESCRIÇÃO, como antes do split.
 */
export function idsPedidoParaSolicitacao(p: PedidosCajuIds): string[] {
  return [p.pedidoPixVR, p.pedidoPixVT].filter((x): x is string => Boolean(x))
}

export const BENEFICIOS_CAJU: readonly BeneficioCaju[] = ["VR", "VT"] as const

/**
 * Id do pedido de BOLETO de UM benefício.
 *
 * Desde 08/2026 o board de Solicitação tem uma LINHA POR BENEFÍCIO, então a célula de pedido
 * carrega um id só — o `"; "` de `juntarIdsCaju` continua valendo para os IDFINANC do RM (uma
 * pessoa pode gerar vários PFINANCEIRO), não mais para o pedido Caju.
 */
export function idPedidoParaSolicitacao(p: PedidosCajuIds, beneficio: BeneficioCaju): string | null {
  return (beneficio === "VR" ? p.pedidoPixVR : p.pedidoPixVT) ?? null
}
