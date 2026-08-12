/**
 * Destino pós-login (`?next=`).
 *
 * Existe porque `RequireAuth` fazia `<Navigate to="/login" replace/>` e DESCARTAVA a
 * URL, e a LoginPage sempre ia pra `/`. Com o alerta de erro mandando link por
 * WhatsApp, isso significa: o Isaac abre no celular com sessão expirada e perde a
 * execução que ia investigar.
 */

/**
 * Só caminho relativo do próprio app.
 *
 * ⚠️ Sem esta validação o `?next=` é um OPEN REDIRECT em cima da tela de login: um link
 * `/login?next=https://phishing/` levaria o usuário pra fora depois de autenticar. As
 * recusas cobrem `//host` (protocol-relative), URL absoluta e qualquer esquema.
 */
export function proximaUrlSegura(bruto: string | null | undefined): string | null {
  const v = String(bruto ?? "")
  if (!v.startsWith("/")) return null
  if (v.startsWith("//")) return null
  // `\` porque alguns navegadores normalizam `/\host` como protocol-relative.
  if (v.startsWith("/\\")) return null
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(v)) return null
  return v
}

/** Monta `/login?next=…` preservando path + query + hash da tela que foi barrada. */
export function loginCom(destino: string): string {
  const seguro = proximaUrlSegura(destino)
  return seguro ? `/login?next=${encodeURIComponent(seguro)}` : "/login"
}
