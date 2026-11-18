import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadMedia,
  getMediaUrl,
  sendInteractiveButtons,
  sendMediaMessage,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
  submitMessageTemplate,
  verifyPhoneNumber,
} from './meta-api'
import { encodeGowaCredential, gowaMediaIdFor, gowaMessageMediaRef } from './gowa-api'
import type { MessageTemplate } from '@/types'

/**
 * A GOWA connection stores `gowa:<json>` as its (decrypted) access token;
 * every meta-api helper must route such a token to the GOWA server and
 * never to graph.facebook.com.
 */

const TOKEN = encodeGowaCredential({
  baseUrl: 'https://gowa.example.com/',
  username: 'admin',
  password: 's3cret',
  deviceId: '',
})
const BASE = { phoneNumberId: 'gowa:key123', accessToken: TOKEN } as const
const AUTH = 'Basic ' + Buffer.from('admin:s3cret').toString('base64')

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let nextBody: unknown = { code: 'SUCCESS', results: { message_id: 'GOWA-MSG-1' } }

beforeEach(() => {
  calls = []
  nextBody = { code: 'SUCCESS', results: { message_id: 'GOWA-MSG-1' } }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(nextBody), { status: 200 })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonBody = (c: Call) => JSON.parse(String(c.init.body))
const headers = (c: Call) => c.init.headers as Record<string, string>

describe('meta-api with a GOWA credential', () => {
  it('sends text through /send/message with basic auth and the reply id', async () => {
    const r = await sendTextMessage({ ...BASE, to: '37060000000', text: 'hi', contextMessageId: 'Q1' })
    expect(r.messageId).toBe('GOWA-MSG-1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://gowa.example.com/send/message')
    expect(headers(calls[0]).Authorization).toBe(AUTH)
    expect(jsonBody(calls[0])).toEqual({
      phone: '37060000000@s.whatsapp.net',
      message: 'hi',
      reply_message_id: 'Q1',
    })
  })

  it('sends media by URL to the matching endpoint (documents go to /send/file)', async () => {
    await sendMediaMessage({
      ...BASE,
      to: '37060000000',
      kind: 'document',
      link: 'https://files.example.com/a.pdf',
      caption: 'invoice',
    })
    expect(calls[0].url).toBe('https://gowa.example.com/send/file')
    const form = calls[0].init.body as FormData
    expect(form.get('file_url')).toBe('https://files.example.com/a.pdf')
    expect(form.get('caption')).toBe('invoice')
    expect(form.get('phone')).toBe('37060000000@s.whatsapp.net')
  })

  it('reacts through /message/:id/reaction', async () => {
    await sendReactionMessage({ ...BASE, to: '37060000000', targetMessageId: 'ABC', emoji: '👍' })
    expect(calls[0].url).toBe('https://gowa.example.com/message/ABC/reaction')
    expect(jsonBody(calls[0])).toEqual({ phone: '37060000000@s.whatsapp.net', emoji: '👍' })
  })

  it('renders interactive buttons as numbered text', async () => {
    await sendInteractiveButtons({
      ...BASE,
      to: '37060000000',
      headerText: 'Menu',
      bodyText: 'Pick one',
      buttons: [
        { id: 'a', title: 'Sales' },
        { id: 'b', title: 'Support' },
      ],
    })
    expect(jsonBody(calls[0]).message).toBe('*Menu*\n\nPick one\n\n1. Sales\n2. Support')
  })

  it('renders a template from its local row, substituting body params', async () => {
    const template = {
      name: 'welcome',
      body_text: 'Hi {{1}}, your order {{2}} shipped.',
      footer_text: 'Reply STOP to opt out',
      header_type: 'text',
      header_content: 'Order update',
    } as unknown as MessageTemplate
    await sendTemplateMessage({
      ...BASE,
      to: '37060000000',
      templateName: 'welcome',
      template,
      params: ['Ana', '#42'],
    })
    expect(calls[0].url).toBe('https://gowa.example.com/send/message')
    expect(jsonBody(calls[0]).message).toBe(
      '*Order update*\n\nHi Ana, your order #42 shipped.\n\n_Reply STOP to opt out_',
    )
  })

  it('refuses a template with no local row', async () => {
    await expect(
      sendTemplateMessage({ ...BASE, to: '1', templateName: 'missing' }),
    ).rejects.toThrow(/no local copy/)
    expect(calls).toHaveLength(0)
  })

  it('refuses Meta-only calls without touching the network', async () => {
    await expect(
      submitMessageTemplate({ wabaId: 'w', accessToken: TOKEN, payload: {} as never }),
    ).rejects.toThrow(/only available with the Meta/)
    expect(calls).toHaveLength(0)
  })

  it('verifies the connection through /app/status', async () => {
    nextBody = {
      results: { is_connected: true, is_logged_in: true, device_id: 'd1', jid: '37060000000:5@s.whatsapp.net' },
    }
    const info = await verifyPhoneNumber(BASE)
    expect(calls[0].url).toBe('https://gowa.example.com/app/status')
    expect(info.display_phone_number).toBe('+37060000000')
  })

  it('fails verification when the device is not logged in', async () => {
    nextBody = { results: { is_connected: true, is_logged_in: false } }
    await expect(verifyPhoneNumber(BASE)).rejects.toThrow(/not logged in/)
  })

  it('resolves a downloaded media path on the GOWA server and fetches it with basic auth', async () => {
    const id = gowaMediaIdFor('statics/media/123-abc.jpeg')
    const info = await getMediaUrl({ mediaId: id, accessToken: TOKEN })
    expect(info).toEqual({
      url: 'https://gowa.example.com/statics/media/123-abc.jpeg',
      mimeType: 'image/jpeg',
      fileSize: null,
    })
    expect(calls).toHaveLength(0)

    await downloadMedia({ downloadUrl: info.url, accessToken: TOKEN })
    expect(headers(calls[0]).Authorization).toBe(AUTH)
  })

  it('asks GOWA to download media it has not stored yet', async () => {
    nextBody = {
      results: {
        file_path: 'statics/media/37060000000/2026-11-18/voice.ogg',
        file_url: 'http://localhost:3000/statics/media/37060000000/2026-11-18/voice.ogg',
        file_size: 2048,
      },
    }
    const id = gowaMediaIdFor(gowaMessageMediaRef('MSG9', '37060000000@s.whatsapp.net'))
    const info = await getMediaUrl({ mediaId: id, accessToken: TOKEN })
    expect(calls[0].url).toBe(
      'https://gowa.example.com/message/MSG9/download?phone=37060000000%40s.whatsapp.net',
    )
    expect(info).toEqual({
      url: 'https://gowa.example.com/statics/media/37060000000/2026-11-18/voice.ogg',
      mimeType: 'audio/ogg',
      fileSize: 2048,
    })
  })

  it.each([
    ['an absolute URL elsewhere', 'https://evil.example.net/x'],
    ['a parent-directory path', 'statics/../../etc/passwd'],
    ['a backslash host', '\\\\evil.example.net\\x'],
  ])('never resolves a media id to %s off the GOWA server', async (_label, ref) => {
    const id = gowaMediaIdFor(ref)
    const result = await getMediaUrl({ mediaId: id, accessToken: TOKEN }).catch((e: Error) => e)
    if (result instanceof Error) return
    expect(new URL(result.url).origin).toBe('https://gowa.example.com')
  })
})
