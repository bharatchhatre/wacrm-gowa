import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  GOWA_MENU_STYLES,
  GOWA_PHONE_NUMBER_ID_PREFIX,
  type GowaMenuStyle,
  GowaApiError,
  encodeGowaCredential,
  gowaGetStatus,
  gowaJidToPhone,
  gowaSetDeviceWebhook,
  isGowaCredential,
  normalizeGowaBaseUrl,
  parseGowaCredential,
  type GowaCredential,
} from '@/lib/whatsapp/gowa-api'

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Where GOWA should deliver events for this connection. */
function webhookUrlFor(request: Request, key: string): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, '')
  return `${origin}/api/whatsapp/gowa/webhook?key=${key}`
}

/**
 * Inbound messages, automations and flows all write with the service-
 * role key. When it's missing or wrong, the dashboard still works (it
 * uses the user's own session) and those features fail silently — so
 * say so on the settings screen.
 */
async function serviceRoleProblem(): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || key.startsWith('REPLACE_')) return 'missing'
  const { error } = await supabaseAdmin().from('whatsapp_config').select('id').limit(1)
  return error ? 'invalid' : null
}

function gowaErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const status =
    err instanceof GowaApiError && err.httpStatus >= 400 && err.httpStatus < 500 ? 400 : 502
  return NextResponse.json({ error: message }, { status })
}

/**
 * GET /api/whatsapp/gowa/config
 *
 * The saved GOWA connection, minus the password, for the settings form.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data: row } = await supabase
      .from('whatsapp_config')
      .select('provider, phone_number_id, access_token, gowa_jid')
      .eq('account_id', accountId)
      .maybeSingle()

    const service_role_problem = await serviceRoleProblem()
    if (!row || row.provider !== 'gowa') {
      return NextResponse.json({ configured: false, service_role_problem })
    }

    let cred: GowaCredential | null = null
    try {
      const token = decrypt(row.access_token)
      cred = isGowaCredential(token) ? parseGowaCredential(token) : null
    } catch {
      // Wrong ENCRYPTION_KEY — the general config GET reports that.
    }
    const key = String(row.phone_number_id).slice(GOWA_PHONE_NUMBER_ID_PREFIX.length)
    return NextResponse.json({
      configured: true,
      base_url: cred?.baseUrl ?? null,
      username: cred?.username ?? null,
      has_password: !!cred?.password,
      device_id: cred?.deviceId || null,
      menu_style: cred?.menuStyle ?? null,
      jid: row.gowa_jid,
      webhook_url: webhookUrlFor(request, key),
      service_role_problem,
    })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in GOWA config GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/gowa/config
 * Body: { base_url, username?, password?, device_id? }
 *
 * Connects (or reconnects) the account through a GOWA server:
 *   1. checks GOWA answers and the device is logged in to WhatsApp,
 *   2. saves the connection (replacing a Meta connection, if any),
 *   3. points the device's webhook at this CRM with a fresh secret.
 *
 * If step 3 fails (older GOWA, or a server without the device API),
 * the response carries `webhook_url` + `webhook_secret` so the admin can
 * set GOWA's WHATSAPP_WEBHOOK / WHATSAPP_WEBHOOK_SECRET by hand.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`whatsapp-admin:${userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => ({}))) as {
      base_url?: string
      username?: string
      password?: string
      device_id?: string
      menu_style?: string
    }

    const baseUrl = normalizeGowaBaseUrl(body.base_url ?? '')
    let parsedUrl: URL
    try {
      parsedUrl = new URL(baseUrl)
    } catch {
      return NextResponse.json(
        { error: 'Enter the GOWA server URL, e.g. https://gowa.example.com' },
        { status: 400 },
      )
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'The GOWA URL must start with http:// or https://' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, provider, phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    // A blank password on re-save keeps the stored one (the form never
    // shows it), the same way the Meta form treats the verify token.
    let previous: GowaCredential | null = null
    if (existing?.provider === 'gowa') {
      try {
        const token = decrypt(existing.access_token)
        if (isGowaCredential(token)) previous = parseGowaCredential(token)
      } catch {
        previous = null
      }
    }

    const cred: GowaCredential = {
      baseUrl,
      username: (body.username ?? '').trim(),
      password: body.password ? body.password : (previous?.password ?? ''),
      deviceId: (body.device_id ?? '').trim(),
      menuStyle: GOWA_MENU_STYLES.includes(body.menu_style as GowaMenuStyle)
        ? (body.menu_style as GowaMenuStyle)
        : (previous?.menuStyle ?? undefined),
    }

    let status
    try {
      status = await gowaGetStatus(cred)
    } catch (err) {
      return gowaErrorResponse(err)
    }
    if (!status.is_logged_in) {
      return NextResponse.json(
        {
          error:
            'GOWA is reachable, but the device is not logged in to WhatsApp. Open the GOWA dashboard, scan the QR code with WhatsApp on your phone (Linked devices → Link a device), then save again.',
        },
        { status: 400 },
      )
    }

    // Keep the webhook key across re-saves so the URL GOWA holds stays valid.
    const key =
      existing?.provider === 'gowa' && existing.phone_number_id?.startsWith(GOWA_PHONE_NUMBER_ID_PREFIX)
        ? existing.phone_number_id.slice(GOWA_PHONE_NUMBER_ID_PREFIX.length)
        : crypto.randomBytes(16).toString('base64url')
    const phoneNumberId = `${GOWA_PHONE_NUMBER_ID_PREFIX}${key}`
    const webhookSecret = crypto.randomBytes(32).toString('base64url')
    const webhookUrl = webhookUrlFor(request, key)

    // Another account already driving the same WhatsApp number through
    // GOWA would split its inbound traffic — refuse, as the Meta path does.
    const ownJid = status.jid
    if (ownJid) {
      const { data: others } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('account_id, gowa_jid')
        .eq('provider', 'gowa')
        .neq('account_id', accountId)
      const phone = gowaJidToPhone(ownJid)
      if (others?.some((o: { gowa_jid: string | null }) => gowaJidToPhone(o.gowa_jid) === phone && phone)) {
        return NextResponse.json(
          { error: 'This WhatsApp number is already connected to another account.' },
          { status: 409 },
        )
      }
    }

    const row = {
      provider: 'gowa',
      phone_number_id: phoneNumberId,
      waba_id: null,
      access_token: encrypt(encodeGowaCredential(cred)),
      verify_token: null,
      gowa_base_url: baseUrl,
      // The JID of the logged-in account — what the duplicate check
      // above compares, and what the settings screen shows.
      gowa_jid: status.jid || status.device_id || null,
      gowa_webhook_secret: encrypt(webhookSecret),
      status: 'connected',
      connected_at: new Date().toISOString(),
      registered_at: new Date().toISOString(),
      subscribed_apps_at: null,
      last_registration_error: null,
      updated_at: new Date().toISOString(),
    }

    const { error: saveError } = existing
      ? await supabase.from('whatsapp_config').update(row).eq('account_id', accountId)
      : await supabase.from('whatsapp_config').insert({ account_id: accountId, user_id: userId, ...row })
    if (saveError) {
      console.error('Error saving GOWA whatsapp_config:', saveError)
      return NextResponse.json({ error: 'Failed to save the GOWA connection' }, { status: 500 })
    }

    // Point GOWA at us. The device id GOWA's webhook API wants is the
    // session id (`status.device_id`), falling back to the one entered.
    const webhookDeviceId = status.device_id || cred.deviceId
    let webhookConfigured = false
    let webhookError: string | null = null
    if (webhookDeviceId) {
      try {
        await gowaSetDeviceWebhook(cred, webhookDeviceId, { url: webhookUrl, secret: webhookSecret })
        webhookConfigured = true
      } catch (err) {
        webhookError = err instanceof Error ? err.message : String(err)
      }
    } else {
      webhookError = 'GOWA did not report a device id to attach the webhook to.'
    }

    const phone = gowaJidToPhone(status.jid)
    return NextResponse.json({
      success: true,
      saved: true,
      phone_info: {
        id: status.device_id || status.jid,
        display_phone_number: phone ? `+${phone}` : status.jid,
        verified_name: 'GOWA',
      },
      webhook_configured: webhookConfigured,
      webhook_url: webhookUrl,
      // Only handed out when the admin has to paste it into GOWA themselves.
      ...(webhookConfigured ? {} : { webhook_secret: webhookSecret, webhook_error: webhookError }),
    })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in GOWA config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
