// ============================================================
// GOWA webhook → Meta-shaped webhook entry.
//
// GOWA posts one event per request (`{ event, device_id, payload }`,
// see GOWA's docs/webhook-payload.md). The inbound pipeline
// (`inbound-webhook.ts`) speaks Meta's `{ entry: [{ changes }] }`
// shape, so this module translates instead of duplicating that
// pipeline. Pure — no I/O — so it's unit-testable against GOWA's
// documented payloads.
//
// Deliberately dropped: group chats, messages we sent ourselves
// (`is_from_me`, which also covers replies typed on the phone), status
// broadcasts, newsletters, and every non-message event.
// ============================================================

import { gowaJidToPhone, gowaMediaIdFor, gowaMessageMediaRef, mimeFromPath } from './gowa-api'
import type { WhatsAppMessage, WhatsAppWebhookEntry } from './inbound-webhook'

export interface GowaWebhookEvent {
  event?: string
  device_id?: string
  timestamp?: string
  payload?: GowaPayload
}

type GowaMedia =
  | string
  | { path?: string; url?: string; caption?: string; filename?: string; mime_type?: string }

export interface GowaPayload {
  id?: string
  ids?: string[]
  chat_id?: string
  from?: string
  from_lid?: string
  from_name?: string
  sender_display_name?: string
  timestamp?: string
  is_from_me?: boolean
  body?: string
  replied_to_id?: string
  reaction?: string
  reacted_message_id?: string
  receipt_type?: string
  image?: GowaMedia
  video?: GowaMedia
  video_note?: GowaMedia
  audio?: GowaMedia
  document?: GowaMedia
  sticker?: GowaMedia
  location?: {
    degreesLatitude?: number
    degreesLongitude?: number
    name?: string
    address?: string
  }
  selection?: { kind?: string; text?: string; description?: string; selected_id?: string }
  poll?: {
    type?: string
    poll_id?: string
    selected_options?: string[]
    resolution_status?: string
  }
  album?: unknown
  [key: string]: unknown
}

/** RFC3339 (GOWA) → unix-seconds string (what the pipeline expects from Meta). */
export function rfc3339ToUnixSeconds(ts: string | undefined, fallbackMs = Date.now()): string {
  const ms = ts ? Date.parse(ts) : NaN
  return String(Math.floor((Number.isFinite(ms) ? ms : fallbackMs) / 1000))
}

/** True for 1:1 chats with a person (not groups, broadcasts or newsletters). */
export function isDirectChat(chatId: string | undefined): boolean {
  if (!chatId) return true
  return chatId.endsWith('@s.whatsapp.net') || chatId.endsWith('@lid') || chatId.endsWith('@c.us')
}

function mediaRef(media: GowaMedia | undefined): {
  ref: string | null
  caption?: string
  filename?: string
  mime?: string
} {
  if (!media) return { ref: null }
  if (typeof media === 'string') return { ref: media }
  return {
    ref: media.path || media.url || null,
    caption: media.caption,
    filename: media.filename,
    mime: media.mime_type,
  }
}

const MEDIA_FIELDS = ['image', 'video', 'video_note', 'audio', 'document', 'sticker'] as const

/**
 * Translate one GOWA event. Returns null for anything the CRM ignores.
 *
 * `phoneNumberId` is the matched config's `phone_number_id` — the
 * pipeline re-resolves the account from it, exactly as for Meta.
 */
export function gowaEventToMetaEntry(
  evt: GowaWebhookEvent,
  phoneNumberId: string,
): WhatsAppWebhookEntry | null {
  const p = evt.payload
  if (!p || !evt.event) return null

  const wrap = (value: Record<string, unknown>): WhatsAppWebhookEntry => ({
    id: phoneNumberId,
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '', phone_number_id: phoneNumberId },
          ...value,
        } as WhatsAppWebhookEntry['changes'][number]['value'],
      },
    ],
  })

  if (evt.event === 'message.ack') {
    const status =
      p.receipt_type === 'delivered'
        ? 'delivered'
        : p.receipt_type === 'read' || p.receipt_type === 'played'
          ? 'read'
          : null
    // `read-self` etc. describe us reading *their* messages — not a status of ours.
    if (!status || !p.ids?.length || !isDirectChat(p.chat_id)) return null
    const recipient = gowaJidToPhone(p.chat_id) || gowaJidToPhone(p.from)
    const timestamp = rfc3339ToUnixSeconds(evt.timestamp ?? p.timestamp)
    return wrap({
      statuses: p.ids.map((id) => ({ id, status, timestamp, recipient_id: recipient })),
    })
  }

  if (evt.event !== 'message' && evt.event !== 'message.reaction') return null
  if (p.is_from_me) return null
  if (!isDirectChat(p.chat_id)) return null
  if (!p.id) return null
  // Album header — announces the items that follow, has no content.
  if (p.album) return null

  // The pipeline keys contacts by phone. GOWA resolves a LID sender to
  // its phone JID when it knows it; a LID-only sender has no phone yet
  // and is dropped (GOWA re-delivers under the phone once resolved).
  const phone = gowaJidToPhone(p.from) || gowaJidToPhone(p.chat_id)
  if (!phone) return null

  const name = (p.sender_display_name || p.from_name || '').trim()
  const contact = { profile: { name }, wa_id: phone }
  const base = {
    id: p.id,
    from: phone,
    timestamp: rfc3339ToUnixSeconds(p.timestamp),
    ...(p.replied_to_id ? { context: { id: p.replied_to_id } } : {}),
  }

  const message = buildMessage(evt.event, p, base)
  if (!message) return null
  return wrap({ contacts: [contact], messages: [message] })
}

function buildMessage(
  event: string,
  p: GowaPayload,
  base: Pick<WhatsAppMessage, 'id' | 'from' | 'timestamp' | 'context'>,
): WhatsAppMessage | null {
  if (event === 'message.reaction') {
    if (!p.reacted_message_id) return null
    return {
      ...base,
      type: 'reaction',
      reaction: { message_id: p.reacted_message_id, emoji: p.reaction ?? '' },
    }
  }

  for (const field of MEDIA_FIELDS) {
    const m = mediaRef(p[field] as GowaMedia | undefined)
    if (!m.ref) continue
    // A downloaded file is a path on the GOWA server. Anything else is
    // WhatsApp's encrypted CDN URL, which only GOWA can decrypt — refer
    // to the message so GOWA downloads it on demand.
    const onServer = !/^https?:\/\//i.test(m.ref)
    const id = gowaMediaIdFor(
      onServer ? m.ref : gowaMessageMediaRef(base.id, p.chat_id || `${base.from}@s.whatsapp.net`),
    )
    const mime = m.mime || mimeFromPath(m.ref)
    const caption = m.caption || p.body || undefined
    switch (field) {
      case 'image':
        return { ...base, type: 'image', image: { id, mime_type: mime, caption } }
      case 'video':
      case 'video_note':
        return { ...base, type: 'video', video: { id, mime_type: mime, caption } }
      case 'audio':
        return { ...base, type: 'audio', audio: { id, mime_type: mime } }
      case 'sticker':
        return { ...base, type: 'sticker', sticker: { id, mime_type: mime } }
      case 'document':
        return {
          ...base,
          type: 'document',
          document: {
            id,
            mime_type: mime,
            caption,
            filename: m.filename || m.ref.split('/').pop()?.split('?')[0],
          },
        }
    }
  }

  // Polls stand in for buttons over GOWA. A vote arrives as text holding
  // the chosen option's title; the route turns it into the button tap.
  // A cleared or undecryptable vote has nothing to act on.
  if (p.poll) {
    if (p.poll.type !== 'vote') return null
    const choice = p.poll.selected_options?.find((o) => o.trim())
    if (!choice) return null
    return { ...base, type: 'text', text: { body: choice } }
  }

  if (p.location && typeof p.location.degreesLatitude === 'number') {
    return {
      ...base,
      type: 'location',
      location: {
        latitude: p.location.degreesLatitude,
        longitude: p.location.degreesLongitude ?? 0,
        name: p.location.name,
        address: p.location.address,
      },
    }
  }

  // A tap on a list row / button — only possible when the customer's
  // client still renders them; usually replies arrive as numbered text.
  if (p.selection?.selected_id) {
    const title = p.selection.text || p.body || p.selection.selected_id
    return p.selection.kind === 'list'
      ? {
          ...base,
          type: 'interactive',
          interactive: {
            type: 'list_reply',
            list_reply: { id: p.selection.selected_id, title, description: p.selection.description },
          },
        }
      : {
          ...base,
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: p.selection.selected_id, title } },
        }
  }

  if (typeof p.body === 'string' && p.body.length > 0) {
    return { ...base, type: 'text', text: { body: p.body } }
  }
  return null
}

/**
 * Options of an interactive message we sent, flattened in the order
 * they were numbered by `renderInteractiveAsText`.
 */
export function interactivePayloadOptions(
  payload: unknown,
): { id: string; title: string; description?: string; list: boolean }[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as {
    kind?: string
    buttons?: { id: string; title: string }[]
    sections?: { rows?: { id: string; title: string; description?: string }[] }[]
  }
  if (p.kind === 'buttons' && Array.isArray(p.buttons)) {
    return p.buttons.map((b) => ({ ...b, list: false }))
  }
  if (p.kind === 'list' && Array.isArray(p.sections)) {
    return p.sections.flatMap((s) => (s.rows ?? []).map((r) => ({ ...r, list: true })))
  }
  return []
}
