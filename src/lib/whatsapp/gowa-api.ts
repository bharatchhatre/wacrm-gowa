/**
 * GOWA (go-whatsapp-web-multidevice) REST client — the second WhatsApp
 * provider next to Meta's Cloud API.
 *
 * GOWA drives a regular WhatsApp account through the multi-device
 * protocol (the same link WhatsApp Web uses). There's no Meta app, no
 * templates and no 24-hour window: you pair a phone by QR code in
 * GOWA's own dashboard and the CRM talks to GOWA over HTTP.
 * Docs: https://github.com/aldinokemal/go-whatsapp-web-multidevice
 *
 * ## How a GOWA connection is stored
 *
 * `whatsapp_config` was built around Meta's `(phone_number_id,
 * access_token)` pair, and a dozen send paths read exactly those two
 * columns. Rather than teach every one of them about a second provider,
 * a GOWA row stores:
 *
 *   - `phone_number_id` = `gowa:<webhook key>` — unique per row (the
 *     column has a UNIQUE constraint) and the key the inbound webhook
 *     URL carries, so a GOWA event resolves to its account;
 *   - `access_token`    = encrypt(`gowa:` + JSON {@link GowaCredential}).
 *
 * Every `meta-api` helper checks the decrypted token with
 * {@link isGowaCredential} first and hands the call to this module, so
 * the inbox composer, Flows, automations, reactions, the AI auto-reply
 * and the media mirror all work unchanged on either provider.
 */

export const GOWA_CREDENTIAL_PREFIX = 'gowa:'
export const GOWA_PHONE_NUMBER_ID_PREFIX = 'gowa:'

export interface GowaCredential {
  /** Base URL of the GOWA server, no trailing slash. */
  baseUrl: string
  /** `APP_BASIC_AUTH` user; empty when GOWA runs without basic auth. */
  username: string
  password: string
  /** `X-Device-Id` for multi-device GOWA servers; empty = the default device. */
  deviceId: string
}

export class GowaApiError extends Error {
  readonly httpStatus: number
  readonly code: string | null
  constructor(message: string, httpStatus: number, code: string | null = null) {
    super(message)
    this.name = 'GowaApiError'
    this.httpStatus = httpStatus
    this.code = code
  }
}

export function isGowaCredential(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith(GOWA_CREDENTIAL_PREFIX)
}

export function isGowaPhoneNumberId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(GOWA_PHONE_NUMBER_ID_PREFIX)
}

export function normalizeGowaBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

export function encodeGowaCredential(cred: GowaCredential): string {
  return (
    GOWA_CREDENTIAL_PREFIX +
    JSON.stringify({
      baseUrl: normalizeGowaBaseUrl(cred.baseUrl),
      username: cred.username ?? '',
      password: cred.password ?? '',
      deviceId: cred.deviceId?.trim() ?? '',
    })
  )
}

export function parseGowaCredential(token: string): GowaCredential {
  if (!isGowaCredential(token)) {
    throw new Error('Not a GOWA credential')
  }
  const parsed = JSON.parse(token.slice(GOWA_CREDENTIAL_PREFIX.length)) as Partial<GowaCredential>
  if (!parsed.baseUrl) throw new Error('GOWA credential is missing baseUrl')
  return {
    baseUrl: normalizeGowaBaseUrl(parsed.baseUrl),
    username: parsed.username ?? '',
    password: parsed.password ?? '',
    deviceId: parsed.deviceId ?? '',
  }
}

// ------------------------------------------------------------
// Addressing
// ------------------------------------------------------------

/**
 * A contact's `to` (digits-only phone, as the send paths sanitize it) →
 * the JID GOWA wants. Anything already JID-shaped passes through, so a
 * caller that stored a full JID keeps working.
 */
export function toGowaJid(to: string): string {
  const trimmed = to.trim()
  if (trimmed.includes('@')) return trimmed
  return `${trimmed.replace(/\D/g, '')}@s.whatsapp.net`
}

/** `628123@s.whatsapp.net` / `628123:12@s.whatsapp.net` → `628123`. */
export function gowaJidToPhone(jid: string | null | undefined): string {
  if (!jid) return ''
  const [user, server] = jid.split('@')
  if (server && server !== 's.whatsapp.net' && server !== 'c.us') return ''
  return (user ?? '').split(':')[0].replace(/\D/g, '')
}

// ------------------------------------------------------------
// Media
// ------------------------------------------------------------

/**
 * GOWA media ids (built by the GOWA webhook route) are `gowa-` +
 * base64url of the file's path or URL. A path is relative to the GOWA
 * server, which serves its downloads under `/statics/`.
 */
export const GOWA_MEDIA_ID_PREFIX = 'gowa-'

export function gowaMediaIdFor(pathOrUrl: string): string {
  return GOWA_MEDIA_ID_PREFIX + Buffer.from(pathOrUrl).toString('base64url')
}

/**
 * Media GOWA hasn't downloaded (WHATSAPP_AUTO_DOWNLOAD_MEDIA=false) only
 * comes with WhatsApp's encrypted CDN URL, so the reference is the
 * message instead, and {@link gowaResolveMedia} asks GOWA to fetch it.
 */
export function gowaMessageMediaRef(messageId: string, chatJid: string): string {
  return `msg:${messageId}|${chatJid}`
}

/**
 * GOWA media id → a URL on the GOWA server plus a best-guess MIME type.
 *
 * The id is attacker-reachable (it ends up in `/api/whatsapp/media/<id>`),
 * and the URL is fetched with the GOWA credentials attached — so it can
 * only ever resolve to a file on the configured GOWA server.
 */
export async function gowaResolveMedia(
  cred: GowaCredential,
  mediaId: string,
): Promise<{ url: string; mimeType: string; fileSize: number | null }> {
  if (!mediaId.startsWith(GOWA_MEDIA_ID_PREFIX)) throw new Error('Not a GOWA media id')
  const ref = Buffer.from(mediaId.slice(GOWA_MEDIA_ID_PREFIX.length), 'base64url').toString('utf8')

  if (ref.startsWith('msg:')) {
    const [messageId, chatJid] = ref.slice(4).split('|')
    if (!messageId || !chatJid) throw new Error('Malformed GOWA media reference')
    const r = await gowaRequest<{ file_path?: string; file_url?: string; file_size?: number }>(
      cred,
      'GET',
      `/message/${encodeURIComponent(messageId)}/download?phone=${encodeURIComponent(chatJid)}`,
    )
    const located = r.file_path || r.file_url
    if (!located) throw new GowaApiError('GOWA could not download this media', 502)
    const resolved = resolveOnServer(cred.baseUrl, located)
    return {
      url: resolved,
      mimeType: mimeFromPath(located),
      fileSize: typeof r.file_size === 'number' ? r.file_size : null,
    }
  }

  return { url: resolveOnServer(cred.baseUrl, ref), mimeType: mimeFromPath(ref), fileSize: null }
}

function resolveOnServer(baseUrl: string, pathOrUrl: string): string {
  const base = new URL(baseUrl + '/')
  const isAbsolute = /^https?:\/\//i.test(pathOrUrl)
  if (!isAbsolute && pathOrUrl.split(/[\\/]/).includes('..')) {
    throw new Error('Refusing a GOWA media path outside the server')
  }
  const url = isAbsolute ? new URL(pathOrUrl) : new URL(pathOrUrl.replace(/^\/+/, ''), base)
  // GOWA may report its own URL with the host it thinks it has (often
  // localhost); keep the path, but always fetch from the configured server.
  if (url.origin !== base.origin) {
    if (!isAbsolute) throw new Error('Refusing a GOWA media path outside the server')
    return new URL(url.pathname.replace(/^\/+/, '') + url.search, base).toString()
  }
  return url.toString()
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}

export function mimeFromPath(path: string): string {
  const ext = path.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

function authHeaders(cred: GowaCredential): Record<string, string> {
  const headers: Record<string, string> = {}
  if (cred.username || cred.password) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${cred.username}:${cred.password}`).toString('base64')
  }
  if (cred.deviceId) headers['X-Device-Id'] = cred.deviceId
  return headers
}

/** Headers to fetch a file GOWA serves (e.g. `/statics/media/...`). */
export function gowaAuthHeaders(token: string): Record<string, string> {
  return authHeaders(parseGowaCredential(token))
}

interface GowaEnvelope<T> {
  code?: string
  message?: string
  results?: T
}

async function gowaRequest<T>(
  cred: GowaCredential,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown> | FormData,
): Promise<T> {
  const headers = authHeaders(cred)
  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(`${cred.baseUrl}${path}`, { method, headers, body: payload })
  } catch (err) {
    throw new GowaApiError(
      `Could not reach the GOWA server at ${cred.baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      0,
    )
  }

  let data: GowaEnvelope<T> | null = null
  try {
    data = (await response.json()) as GowaEnvelope<T>
  } catch {
    // Non-JSON (e.g. a proxy error page) — handled below.
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new GowaApiError('GOWA rejected the username or password (401).', 401, 'UNAUTHORIZED')
    }
    if (data?.code === 'DEVICE_ID_REQUIRED') {
      // No device yet, or several and none chosen.
      throw new GowaApiError(
        'GOWA needs a device: add one in the GOWA dashboard and scan its QR code, or — if the server has several — enter the Device ID.',
        response.status,
        data.code,
      )
    }
    throw new GowaApiError(
      data?.message || `GOWA API error: ${response.status}`,
      response.status,
      data?.code ?? null,
    )
  }
  return (data?.results ?? ({} as T)) as T
}

// ------------------------------------------------------------
// Connection
// ------------------------------------------------------------

export interface GowaStatus {
  is_connected: boolean
  is_logged_in: boolean
  device_id: string
  jid: string
}

export async function gowaGetStatus(cred: GowaCredential): Promise<GowaStatus> {
  const r = await gowaRequest<Partial<GowaStatus>>(cred, 'GET', '/app/status')
  return {
    is_connected: !!r.is_connected,
    is_logged_in: !!r.is_logged_in,
    device_id: r.device_id ?? '',
    jid: r.jid ?? '',
  }
}

/**
 * Point the device's webhook at this CRM. Device-level settings override
 * GOWA's global `WHATSAPP_WEBHOOK`, so this works on a shared GOWA
 * server without touching its environment.
 */
export async function gowaSetDeviceWebhook(
  cred: GowaCredential,
  deviceId: string,
  webhook: { url: string; secret: string; events?: string },
): Promise<void> {
  await gowaRequest(cred, 'PATCH', `/devices/${encodeURIComponent(deviceId)}/webhook`, {
    webhook_url: webhook.url,
    webhook_secret: webhook.secret,
    webhook_events: webhook.events ?? GOWA_WEBHOOK_EVENTS,
  })
}

/** The events the inbound route understands; GOWA drops the rest. */
export const GOWA_WEBHOOK_EVENTS = 'message,message.reaction,message.ack'

// ------------------------------------------------------------
// Sending
// ------------------------------------------------------------

interface GowaSendResults {
  message_id?: string
}

function sentId(r: GowaSendResults): { messageId: string } {
  if (!r.message_id) throw new GowaApiError('GOWA did not return a message id', 502)
  return { messageId: r.message_id }
}

export async function gowaSendText(
  cred: GowaCredential,
  args: { to: string; text: string; replyToMessageId?: string },
): Promise<{ messageId: string }> {
  const body: Record<string, unknown> = { phone: toGowaJid(args.to), message: args.text }
  if (args.replyToMessageId) body.reply_message_id = args.replyToMessageId
  return sentId(await gowaRequest<GowaSendResults>(cred, 'POST', '/send/message', body))
}

export type GowaMediaKind = 'image' | 'video' | 'document' | 'audio'

const MEDIA_ENDPOINT: Record<GowaMediaKind, { path: string; urlField: string }> = {
  image: { path: '/send/image', urlField: 'image_url' },
  video: { path: '/send/video', urlField: 'video_url' },
  document: { path: '/send/file', urlField: 'file_url' },
  audio: { path: '/send/audio', urlField: 'audio_url' },
}

/** GOWA fetches `link` itself, so it has to be reachable from the GOWA server. */
export async function gowaSendMedia(
  cred: GowaCredential,
  args: {
    to: string
    kind: GowaMediaKind
    link: string
    caption?: string
    replyToMessageId?: string
  },
): Promise<{ messageId: string }> {
  const endpoint = MEDIA_ENDPOINT[args.kind]
  const form = new FormData()
  form.set('phone', toGowaJid(args.to))
  form.set(endpoint.urlField, args.link)
  if (args.caption && args.kind !== 'audio') form.set('caption', args.caption)
  if (args.replyToMessageId) form.set('reply_message_id', args.replyToMessageId)
  return sentId(await gowaRequest<GowaSendResults>(cred, 'POST', endpoint.path, form))
}

export async function gowaSendReaction(
  cred: GowaCredential,
  args: { to: string; targetMessageId: string; emoji: string },
): Promise<{ messageId: string }> {
  const r = await gowaRequest<GowaSendResults>(
    cred,
    'POST',
    `/message/${encodeURIComponent(args.targetMessageId)}/reaction`,
    { phone: toGowaJid(args.to), emoji: args.emoji },
  )
  // A reaction id isn't used for anything downstream; don't fail on its absence.
  return { messageId: r.message_id ?? '' }
}

export async function gowaSendTyping(cred: GowaCredential, args: { to: string }): Promise<void> {
  await gowaRequest(cred, 'POST', '/send/chat-presence', {
    phone: toGowaJid(args.to),
    action: 'start',
  })
}

// ------------------------------------------------------------
// Stand-ins for Cloud-API-only message kinds
// ------------------------------------------------------------
//
// A linked-device account can't send Meta templates, and WhatsApp no
// longer renders reply buttons / list messages sent from one. Templates
// go out as text; buttons and lists go out as a single-choice WhatsApp
// poll, which every client renders as tappable options. The inbound
// route maps the vote — or a typed option number or title — back to the
// option id (`matchOptionReply`), so Flows and automations advance
// exactly as they would on a button tap.

export interface NumberedOption {
  id: string
  title: string
  description?: string
}

export function renderInteractiveAsText(args: {
  header?: string
  body: string
  footer?: string
  options: NumberedOption[]
}): string {
  const lines: string[] = []
  if (args.header) lines.push(`*${args.header}*`, '')
  lines.push(args.body, '')
  args.options.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)
  })
  if (args.footer) lines.push('', `_${args.footer}_`)
  return lines.join('\n').trim()
}

/** "2" / " 2. " → the second option; anything else → null. */
export function matchNumberedOption<T extends NumberedOption>(
  reply: string | null | undefined,
  options: T[],
): T | null {
  const m = reply?.trim().match(/^(\d{1,2})\.?$/)
  if (!m) return null
  return options[Number(m[1]) - 1] ?? null
}

/**
 * A customer's answer to one of our menus → the option it picks: a poll
 * vote or a typed title (case-insensitive), or its number.
 */
export function matchOptionReply<T extends NumberedOption>(
  reply: string | null | undefined,
  options: T[],
): T | null {
  const wanted = reply?.trim().toLowerCase()
  if (!wanted) return null
  return options.find((o) => o.title.trim().toLowerCase() === wanted) ?? matchNumberedOption(reply, options)
}

/** WhatsApp's poll limits. */
export const POLL_LIMITS = { question: 255, option: 100, minOptions: 2, maxOptions: 12 } as const

export async function gowaSendPoll(
  cred: GowaCredential,
  args: { to: string; question: string; options: string[] },
): Promise<{ messageId: string }> {
  return sentId(
    await gowaRequest<GowaSendResults>(cred, 'POST', '/send/poll', {
      phone: toGowaJid(args.to),
      question: args.question,
      options: args.options,
      max_answer: 1,
    }),
  )
}

/**
 * Send a button / list menu over GOWA as a single-choice poll. When the
 * text doesn't fit a poll question it goes first as a plain message and
 * the poll carries just the short label. Menus a poll can't represent
 * (one option, duplicate or over-long titles) fall back to numbered text.
 */
export async function gowaSendInteractive(
  cred: GowaCredential,
  args: {
    to: string
    header?: string
    body: string
    footer?: string
    options: NumberedOption[]
    /** Short prompt for the poll when the body is sent separately. */
    pollLabel?: string
    replyToMessageId?: string
  },
): Promise<{ messageId: string }> {
  const titles = args.options.map((o) => o.title.trim())
  const pollable =
    titles.length >= POLL_LIMITS.minOptions &&
    titles.length <= POLL_LIMITS.maxOptions &&
    new Set(titles.map((x) => x.toLowerCase())).size === titles.length &&
    titles.every((x) => x.length > 0 && x.length <= POLL_LIMITS.option)

  if (!pollable) {
    return gowaSendText(cred, {
      to: args.to,
      text: renderInteractiveAsText(args),
      replyToMessageId: args.replyToMessageId,
    })
  }

  const question = [args.header ? `*${args.header}*` : '', args.body, args.footer ? `_${args.footer}_` : '']
    .filter(Boolean)
    .join('\n\n')
  if (question.length <= POLL_LIMITS.question) {
    return gowaSendPoll(cred, { to: args.to, question, options: titles })
  }
  await gowaSendText(cred, {
    to: args.to,
    text: question,
    replyToMessageId: args.replyToMessageId,
  })
  return gowaSendPoll(cred, {
    to: args.to,
    question: (args.pollLabel || args.header || '👇').slice(0, POLL_LIMITS.question),
    options: titles,
  })
}
