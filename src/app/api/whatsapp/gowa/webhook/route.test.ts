import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    afterCallbacks: [] as (() => Promise<void> | void)[],
    config: null as null | { account_id: string; phone_number_id: string; gowa_webhook_secret: string },
    lookups: [] as unknown[][],
    inFilters: [] as unknown[][],
    /** Last outbound message in the conversation, for numbered-reply mapping. */
    lastOutbound: null as null | { content_type: string; interactive_payload: unknown },
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}))

// Minimal chainable query builder: every filter returns the builder,
// `maybeSingle` resolves with the table's canned row.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const filters: unknown[] = []
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => (filters.push([col, val]), builder),
        neq: () => builder,
        in: (col: string, vals: unknown[]) => (filters.push([col, vals]), h.state.inFilters.push([table, col, vals]), builder),
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === 'whatsapp_config') {
            h.state.lookups.push(filters)
            return { data: h.state.config, error: null }
          }
          if (table === 'contacts') return { data: { id: 'contact-1' }, error: null }
          if (table === 'conversations') return { data: { id: 'conv-1' }, error: null }
          if (table === 'messages') return { data: h.state.lastOutbound, error: null }
          return { data: null, error: null }
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

const processWebhook = vi.fn<(body: unknown) => Promise<void>>(async () => {})
vi.mock('@/lib/whatsapp/inbound-webhook', () => ({
  processWebhook: (body: unknown) => processWebhook(body),
}))

import { POST } from './route'

const SECRET = 'webhook-secret-xyz'
const KEY = 'AbCdEf0123456789'

function sign(body: string, secret = SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function request(body: unknown, opts: { key?: string; signature?: string | null } = {}) {
  const raw = JSON.stringify(body)
  const headers = new Headers({ 'content-type': 'application/json' })
  const sig = opts.signature === undefined ? sign(raw) : opts.signature
  if (sig) headers.set('x-hub-signature-256', sig)
  return new Request(
    `https://crm.example.com/api/whatsapp/gowa/webhook?key=${opts.key ?? KEY}`,
    { method: 'POST', headers, body: raw },
  )
}

const textEvent = (body: string) => ({
  event: 'message',
  device_id: '628987654321@s.whatsapp.net',
  payload: {
    id: 'IN-1',
    chat_id: '628123456789@s.whatsapp.net',
    from: '628123456789@s.whatsapp.net',
    from_name: 'John',
    timestamp: '2026-11-18T10:00:00Z',
    body,
  },
})

async function runAfter() {
  for (const cb of h.state.afterCallbacks.splice(0)) await cb()
}

beforeEach(() => {
  h.state.afterCallbacks = []
  h.state.lookups = []
  h.state.inFilters = []
  h.state.lastOutbound = null
  h.state.config = {
    account_id: 'acc-1',
    phone_number_id: `gowa:${KEY}`,
    gowa_webhook_secret: `enc:${SECRET}`,
  }
  processWebhook.mockClear()
})

describe('POST /api/whatsapp/gowa/webhook', () => {
  it('verifies the signature, translates and processes the event', async () => {
    const res = (await POST(request(textEvent('hello')))) as unknown as { status: number }
    expect(res.status).toBe(200)
    expect(h.state.lookups[0]).toEqual([
      ['phone_number_id', `gowa:${KEY}`],
      ['provider', 'gowa'],
    ])
    await runAfter()
    expect(processWebhook).toHaveBeenCalledTimes(1)
    const body = processWebhook.mock.calls[0][0] as unknown as {
      entry: { changes: { value: { metadata: { phone_number_id: string }; messages: unknown[] } }[] }[]
    }
    const v = body.entry[0].changes[0].value
    expect(v.metadata.phone_number_id).toBe(`gowa:${KEY}`)
    expect(v.messages[0]).toMatchObject({ type: 'text', from: '628123456789', text: { body: 'hello' } })
  })

  it('rejects a bad signature with 401 and processes nothing', async () => {
    const res = (await POST(request(textEvent('x'), { signature: sign('other', SECRET) }))) as unknown as {
      status: number
    }
    expect(res.status).toBe(401)
    expect(h.state.afterCallbacks).toHaveLength(0)
  })

  it('rejects a missing signature', async () => {
    const res = (await POST(request(textEvent('x'), { signature: null }))) as unknown as { status: number }
    expect(res.status).toBe(401)
  })

  it('answers an unknown key exactly like a bad signature', async () => {
    h.state.config = null
    const res = (await POST(request(textEvent('x')))) as unknown as { status: number }
    expect(res.status).toBe(401)
  })

  it('400s a malformed key without a lookup', async () => {
    const res = (await POST(request(textEvent('x'), { key: 'bad key!' }))) as unknown as { status: number }
    expect(res.status).toBe(400)
    expect(h.state.lookups).toHaveLength(0)
  })

  it('acks ignored events (e.g. group messages) without processing', async () => {
    const evt = textEvent('x')
    evt.payload.chat_id = '120363012345678901@g.us'
    const res = (await POST(request(evt))) as unknown as { status: number; body: { status: string } }
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ignored')
    expect(h.state.afterCallbacks).toHaveLength(0)
  })

  it('turns a bare-number reply to our last menu into a button tap', async () => {
    h.state.lastOutbound = {
      content_type: 'interactive',
      interactive_payload: {
        kind: 'buttons',
        body: 'Pick',
        buttons: [
          { id: 'sales', title: 'Sales' },
          { id: 'support', title: 'Support' },
        ],
      },
    }
    await POST(request(textEvent('2')))
    await runAfter()
    const body = processWebhook.mock.calls[0][0] as unknown as {
      entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[]
    }
    expect(body.entry[0].changes[0].value.messages[0]).toMatchObject({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'support', title: 'Support' } },
    })
  })

  it('turns a poll vote (the chosen title) into a button tap', async () => {
    h.state.lastOutbound = {
      content_type: 'interactive',
      interactive_payload: {
        kind: 'buttons',
        body: 'Pick',
        buttons: [
          { id: 'existing', title: 'Existing customer' },
          { id: 'new', title: 'New customer' },
        ],
      },
    }
    const evt = textEvent('')
    ;(evt.payload as Record<string, unknown>).poll = {
      type: 'vote',
      selected_options: ['New customer'],
      resolution_status: 'resolved',
    }
    await POST(request(evt))
    await runAfter()
    const body = processWebhook.mock.calls[0][0] as unknown as {
      entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[]
    }
    expect(body.entry[0].changes[0].value.messages[0]).toMatchObject({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'new', title: 'New customer' } },
    })
  })

  it('finds the contact whether its phone was stored with or without "+"', async () => {
    h.state.lastOutbound = { content_type: 'text', interactive_payload: null }
    await POST(request(textEvent('2')))
    await runAfter()
    expect(h.state.inFilters).toContainEqual(['contacts', 'phone', ['628123456789', '+628123456789']])
  })

  it('leaves a number alone when the last outbound was not a menu', async () => {
    h.state.lastOutbound = { content_type: 'text', interactive_payload: null }
    await POST(request(textEvent('2')))
    await runAfter()
    const body = processWebhook.mock.calls[0][0] as unknown as {
      entry: { changes: { value: { messages: Record<string, unknown>[] } }[] }[]
    }
    expect(body.entry[0].changes[0].value.messages[0]).toMatchObject({ type: 'text', text: { body: '2' } })
  })
})
