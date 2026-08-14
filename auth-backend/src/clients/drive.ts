import { JWT } from "google-auth-library"
import { config } from "../config.js"

const DRIVE = "https://www.googleapis.com/drive/v3"
const UPLOAD = "https://www.googleapis.com/upload/drive/v3"
const FOLDER_MIME = "application/vnd.google-apps.folder"

export class ErroDrive extends Error {
  constructor(message: string, public status?: number, public detalhe?: unknown) {
    super(message)
    this.name = "ErroDrive"
  }
}

interface ServiceAccount {
  client_email: string
  private_key: string
}

function serviceAccount(): ServiceAccount {
  const raw = config.googleDrive.serviceAccountJson ||
    (config.googleDrive.serviceAccountJsonBase64
      ? Buffer.from(config.googleDrive.serviceAccountJsonBase64, "base64").toString("utf8")
      : "")
  if (!raw) throw new ErroDrive("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON ausente")
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>
  if (!parsed.client_email || !parsed.private_key)
    throw new ErroDrive("Service account Drive invalida")
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

let jwt: JWT | null = null
let oauthAccess: { token: string; exp: number } | null = null

/** OAuth de usuário (refresh token) — age como a conta real; funciona em Shared Drive
 *  sem a SA precisar ser membro. Cacheia o access_token por ~55min. */
async function oauthToken(): Promise<string | null> {
  const g = config.googleDrive
  if (!g.oauthRefreshToken || !g.oauthClientId || !g.oauthClientSecret) return null
  const agora = Date.now()
  if (oauthAccess && oauthAccess.exp > agora + 60_000) return oauthAccess.token
  const form = new URLSearchParams({
    client_id: g.oauthClientId,
    client_secret: g.oauthClientSecret,
    refresh_token: g.oauthRefreshToken,
    grant_type: "refresh_token",
  })
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })
  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  if (!r.ok || !j?.access_token) throw new ErroDrive("Falha ao renovar token OAuth Drive", r.status, j)
  oauthAccess = { token: j.access_token, exp: agora + (j.expires_in ?? 3600) * 1000 }
  return j.access_token
}

async function token(): Promise<string> {
  // Prioriza OAuth de usuário; cai na service account se não configurado.
  const oauth = await oauthToken()
  if (oauth) return oauth
  if (!jwt) {
    const sa = serviceAccount()
    jwt = new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    })
  }
  const t = await jwt.getAccessToken()
  if (!t.token) throw new ErroDrive("Falha ao obter token Google Drive")
  return t.token
}

/**
 * Teto por chamada ao Drive.
 *
 * `arquivarDrive` faz de 10 a 20 chamadas sequenciais (`ensurePath` resolve um segmento por
 * vez). Sem teto, um Drive lento come o request inteiro do `/convocar` — e agora que o
 * pré-pagamento grava ANTES do Drive, come também a janela em que o snapshot seria escrito
 * se a ordem invertesse. Cada chamada é curta por natureza; 12s é folga generosa.
 */
const TIMEOUT_DRIVE_MS = 12_000

async function driveFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(TIMEOUT_DRIVE_MS),
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ErroDrive(`Google Drive HTTP ${res.status}`, res.status, json)
  return json as T
}

function q(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export interface DriveFile {
  id: string
  name: string
  webViewLink?: string
}

export function rootFolderId(): string {
  if (!config.googleDrive.rootFolderId) throw new ErroDrive("GOOGLE_DRIVE_ROOT_FOLDER_ID ausente")
  return config.googleDrive.rootFolderId
}

/**
 * Variantes do nome que contam como A MESMA pasta.
 *
 * O Drive casa por nome EXATO, e boa parte da árvore foi criada pelo n8n com ESPAÇO no fim
 * (`07 - JULHO `, `INTERMITENTE - MENSAL `, `3 DIAS CREDITO `). O nosso `sanitizeName` faz trim,
 * então procurar só o nome limpo não achava a pasta e criava uma SEGUNDA — foi o que aconteceu em
 * 22/06 com julho, que hoje tem duas árvores paralelas, cada uma com seu `CONTATO`.
 */
export function variantesNome(name: string): string[] {
  const limpo = name.trim()
  return [...new Set([limpo, `${limpo} `, ` ${limpo}`])]
}

/**
 * Qual das pastas achadas vence. Pura, pra ter teste — é a regra que decide onde o arquivo cai.
 *
 * `achados` deve vir ordenado por `createdTime` (a query pede `orderBy: createdTime`), então o
 * primeiro de cada grupo é o mais antigo.
 */
export function escolherPasta<T extends { name: string }>(achados: T[], name: string): T | null {
  for (const v of variantesNome(name)) {
    const g = achados.filter((f) => f.name === v)
    if (g.length > 0) return g[0]!
  }
  return achados[0] ?? null
}

/**
 * Acha a pasta pelo nome, tolerando as variantes com espaço, e DETERMINÍSTICA quando há repetidas.
 *
 * Dois cuidados que a versão anterior não tinha:
 *
 *  - `pageSize: 1` + nome exato devolvia "o primeiro que a API quiser". Existem irmãos de mesmo
 *    nome em produção (dois `04 - DETRAN` dentro de `07 - JULHO/CONTATO`), então o destino do
 *    arquivo era efetivamente sorteado a cada chamada. Agora vence a MAIS ANTIGA — a original,
 *    onde o histórico está — e a duplicata sai no log em vez de passar calada.
 *  - o nome limpo tem prioridade sobre a variante com espaço; a variante só é usada quando o nome
 *    limpo não existe, pra não migrar sozinho o que já está certo.
 */
export async function findFolder(parentId: string, name: string): Promise<DriveFile | null> {
  const variantes = variantesNome(name)
  const ou = variantes.map((v) => `name='${q(v)}'`).join(" or ")
  const params = new URLSearchParams({
    q: `'${q(parentId)}' in parents and (${ou}) and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: "files(id,name,webViewLink,createdTime)",
    pageSize: "20",
    orderBy: "createdTime",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  })
  const r = await driveFetch<{ files?: Array<DriveFile & { createdTime?: string }> }>(`${DRIVE}/files?${params}`)
  const achados = r.files ?? []
  const escolhida = escolherPasta(achados, name)
  if (!escolhida) return null
  if (achados.length > 1) {
    console.warn(
      "[drive] pastas com o mesmo nome no mesmo pai — usando a mais antiga:",
      JSON.stringify({
        pai: parentId,
        procurado: name,
        escolhida: { id: escolhida.id, nome: escolhida.name },
        outras: achados.filter((f) => f.id !== escolhida.id).map((f) => ({ id: f.id, nome: f.name })),
      }),
    )
  }
  return { id: escolhida.id, name: escolhida.name, ...(escolhida.webViewLink ? { webViewLink: escolhida.webViewLink } : {}) }
}

export interface ItemDrive extends DriveFile {
  mimeType: string
  /** Ausente em pasta. */
  size?: string
  modifiedTime?: string
  get ehPasta(): boolean
}

/**
 * Lista o conteúdo de uma pasta — pastas E arquivos, paginado.
 *
 * `findFolder` filtra `mimeType='folder'` e `pageSize=1`: serve pra resolver caminho, não pra
 * conferir o que foi arquivado. Sem isto, "o relatório subiu na pasta certa?" só se responde
 * abrindo o Drive no navegador.
 */
export async function listarPasta(parentId: string): Promise<ItemDrive[]> {
  const out: ItemDrive[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `'${q(parentId)}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,webViewLink,mimeType,size,modifiedTime)",
      pageSize: "200",
      orderBy: "folder,name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    })
    const r = await driveFetch<{ files?: Array<Omit<ItemDrive, "ehPasta">>; nextPageToken?: string }>(
      `${DRIVE}/files?${params}`,
    )
    for (const f of r.files ?? []) {
      out.push({ ...f, get ehPasta() { return this.mimeType === FOLDER_MIME } })
    }
    pageToken = r.nextPageToken
  } while (pageToken)
  return out
}

export async function createFolder(parentId: string, name: string): Promise<DriveFile> {
  return driveFetch<DriveFile>(`${DRIVE}/files?fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
}

export async function ensureFolder(parentId: string, name: string): Promise<DriveFile> {
  return (await findFolder(parentId, name)) ?? createFolder(parentId, name)
}

export async function ensurePath(rootId: string, parts: string[]): Promise<DriveFile> {
  let cur: DriveFile = { id: rootId, name: "root" }
  for (const p of parts.map(sanitizeName).filter(Boolean)) {
    cur = await ensureFolder(cur.id, p)
  }
  return cur
}

/**
 * Renomeia (e opcionalmente MOVE) uma pasta pelo id.
 *
 * Existe pro recálculo do pré-pagamento pontual: quando o período muda (cancelamento
 * parcial), a pasta `01 A 05/08/2026` tem que virar `01 A 03/08/2026`. O identificador é o
 * ID; o nome é dado derivado. Renomear preserva id, url, os termos já subidos e o link já
 * gravado no item do Monday — recriar deixaria uma pasta órfã com arquivos dentro, e
 * `findFolder` usa `pageSize: 1`, então a próxima busca pegaria uma das duas homônimas ao
 * acaso. Corrupção silenciosa.
 *
 * `novoPaiId` cobre o caso de a data de início mudar de mês/ano: o caminho tem `<ano>/<mês>`
 * derivados do início, então a pasta precisa MOVER, não ser copiada. Uma chamada faz as
 * duas coisas.
 */
export async function renomearPasta(
  id: string,
  novoNome: string,
  mover?: { novoPaiId: string; paiAtualId: string },
): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: "id,name,webViewLink", supportsAllDrives: "true" })
  if (mover && mover.novoPaiId !== mover.paiAtualId) {
    params.set("addParents", mover.novoPaiId)
    params.set("removeParents", mover.paiAtualId)
  }
  return driveFetch<DriveFile>(`${DRIVE}/files/${encodeURIComponent(id)}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: sanitizeName(novoNome) }),
  })
}

/** Metadados de uma pasta — usado pra conferir nome/pai antes de renomear. */
export async function lerPasta(id: string): Promise<(DriveFile & { parents?: string[] }) | null> {
  try {
    return await driveFetch<DriveFile & { parents?: string[] }>(
      `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name,webViewLink,parents&supportsAllDrives=true`,
    )
  } catch {
    // Pasta apagada à mão ou id inválido: quem chama trata como "resolver de novo".
    return null
  }
}

/**
 * Manda a pasta (e o que tem dentro) pra lixeira do Drive.
 *
 * Lixeira, não `DELETE`: fica 30 dias recuperável. Só existe pra limpar sobra de teste
 * controlado — nenhum fluxo automático chama isto, porque apagar pasta de convocação real é
 * perder o único registro dos termos assinados.
 */
export async function pastaParaLixeira(id: string): Promise<boolean> {
  try {
    await driveFetch<DriveFile>(
      `${DRIVE}/files/${encodeURIComponent(id)}?fields=id&supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    )
    return true
  } catch {
    return false
  }
}

export function sanitizeName(s: unknown): string {
  return String(s ?? "")
    // eslint-disable-next-line no-control-regex -- chars de controle ilegais em nome de arquivo
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
}

export function webViewUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

export async function uploadBuffer(
  parentId: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<DriveFile> {
  const boundary = `pi_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const metadata = JSON.stringify({ name: sanitizeName(filename), parents: [parentId] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return driveFetch<DriveFile>(
    `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  )
}
