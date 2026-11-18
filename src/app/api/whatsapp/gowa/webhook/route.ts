import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyHmacSha256Signature } from '@/lib/whatsapp/webhook-signature'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { processWebhook, type WhatsAppWebhookEntry } from '@/lib/whatsapp/inbound-webhook'
import {
  gowaEventToMetaEntry,
  interactivePayloadOptions,
  type GowaWebhookEvent,
} from '@/lib/whatsapp/gowa-webhook'
import { GOWA_PHONE_NUMBER_ID_PREFIX, matchNumberedOption } from '@/lib/whatsapp/gowa-api'

// Same headroom as the Meta webhook — processing runs in `after()`.
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * POST /api/whatsapp/gowa/webhook?key=<webhook key>
 *
 * Receives GOWA's webhook deliveries. The `key` picks the connection
 * (`phone_number_id = 'gowa:<key>'`); the signature, made with that
 * connection's own secret, is what authenticates the request — the key
 * alone grants nothing.
 */
export async function POST(request: Request) {
  const key = new URL(request.url).searchParams.get('key')?.trim()
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    return NextResponse.json({ error: 'Missing or malformed key' }, { status: 400 })
  }

  const rawBody = await readCappedBody(request)
  if (rawBody === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  const phoneNumberId = `${GOWA_PHONE_NUMBER_ID_PREFIX}${key}`
  const { data: config, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id, phone_number_id, gowa_webhook_secret')
    .eq('phone_number_id', phoneNumberId)
    .eq('provider', 'gowa')
    .maybeSingle()

  if (error) {
    console.error('[gowa webhook] config lookup failed:', error.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  let secret = ''
  try {
    secret = config?.gowa_webhook_secret ? decrypt(config.gowa_webhook_secret) : ''
  } catch {
    console.error('[gowa webhook] could not decrypt the webhook secret (ENCRYPTION_KEY changed?)')
  }

  // Unknown key and bad signature answer the same 401, so the endpoint
  // can't be used to probe which keys exist.
  if (
    !config ||
    !verifyHmacSha256Signature(rawBody, request.headers.get('x-hub-signature-256'), secret)
  ) {
    console.warn('[gowa webhook] rejected delivery: unknown key or invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: GowaWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const entry = gowaEventToMetaEntry(event, phoneNumberId)
  if (!entry) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  after(async () => {
    try {
      await mapNumberedReply(entry, config.account_id)
      await processWebhook({ entry: [entry] })
    } catch (err) {
      console.error('[gowa webhook] processing failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

/**
 * Over GOWA, buttons and lists go out as numbered text (see
 * `renderInteractiveAsText`). When the customer answers with a bare
 * number and the last thing we sent them was such a menu, turn the
 * reply into the button/list tap Meta would have delivered, so Flows
 * and automations advance exactly as on the Cloud API.
 */
async function mapNumberedReply(entry: WhatsAppWebhookEntry, accountId: string) {
  const message = entry.changes[0]?.value.messages?.[0]
  if (!message || message.type !== 'text' || !message.from) return
  const reply = message.text?.body
  if (!reply || !/^\s*\d{1,2}\.?\s*$/.test(reply)) return

  const db = supabaseAdmin()
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone', message.from)
    .limit(1)
    .maybeSingle()
  if (!contact) return

  const { data: conversation } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!conversation) return

  const { data: last } = await db
    .from('messages')
    .select('content_type, interactive_payload')
    .eq('conversation_id', conversation.id)
    .neq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last || last.content_type !== 'interactive') return

  const options = interactivePayloadOptions(last.interactive_payload)
  const picked = matchNumberedOption(reply, options)
  if (!picked) return

  message.type = 'interactive'
  message.interactive = picked.list
    ? {
        type: 'list_reply',
        list_reply: { id: picked.id, title: picked.title, description: picked.description },
      }
    : { type: 'button_reply', button_reply: { id: picked.id, title: picked.title } }
  delete message.text
}
