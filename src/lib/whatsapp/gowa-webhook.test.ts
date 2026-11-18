import { describe, expect, it } from 'vitest'
import { gowaEventToMetaEntry, interactivePayloadOptions, rfc3339ToUnixSeconds } from './gowa-webhook'
import { GOWA_MEDIA_ID_PREFIX, matchNumberedOption } from './gowa-api'

// Payloads below follow GOWA's docs/webhook-payload.md.

const PNID = 'gowa:key123'
const value = (evt: Parameters<typeof gowaEventToMetaEntry>[0]) =>
  gowaEventToMetaEntry(evt, PNID)?.changes[0].value

const decodeMediaRef = (id: string) =>
  Buffer.from(id.slice(GOWA_MEDIA_ID_PREFIX.length), 'base64url').toString('utf8')

describe('gowaEventToMetaEntry', () => {
  it('maps a text message to Meta shape, phone from the sender JID', () => {
    const v = value({
      event: 'message',
      device_id: '628987654321@s.whatsapp.net',
      payload: {
        id: '3EB0C127D7BACC83D6A1',
        chat_id: '628123456789@s.whatsapp.net',
        from: '628123456789@s.whatsapp.net',
        from_lid: '251556368777322@lid',
        sender_display_name: 'Saved Contact',
        from_name: 'John Doe',
        timestamp: '2023-10-15T10:30:00Z',
        is_from_me: false,
        body: 'Hello, how are you?',
      },
    })
    expect(v?.metadata.phone_number_id).toBe(PNID)
    expect(v?.contacts).toEqual([{ profile: { name: 'Saved Contact' }, wa_id: '628123456789' }])
    expect(v?.messages?.[0]).toEqual({
      id: '3EB0C127D7BACC83D6A1',
      from: '628123456789',
      timestamp: String(Date.parse('2023-10-15T10:30:00Z') / 1000),
      type: 'text',
      text: { body: 'Hello, how are you?' },
    })
  })

  it('carries the quoted message id as reply context', () => {
    const v = value({
      event: 'message',
      payload: {
        id: 'R2',
        chat_id: '628123456789@s.whatsapp.net',
        from: '628123456789@s.whatsapp.net',
        body: 'thanks',
        replied_to_id: 'R1',
      },
    })
    expect(v?.messages?.[0].context).toEqual({ id: 'R1' })
  })

  it('maps a downloaded image (caption object form) to a GOWA media id', () => {
    const v = value({
      event: 'message',
      payload: {
        id: 'IMG1',
        chat_id: '628123456789@s.whatsapp.net',
        from: '628123456789@s.whatsapp.net',
        body: 'Check this out!',
        image: { path: 'statics/media/1752404751-x.jpeg', caption: 'Check this out!' },
      },
    })
    const m = v?.messages?.[0]
    expect(m?.type).toBe('image')
    expect(m?.image?.caption).toBe('Check this out!')
    expect(m?.image?.mime_type).toBe('image/jpeg')
    expect(decodeMediaRef(m!.image!.id)).toBe('statics/media/1752404751-x.jpeg')
  })

  it('refers to the message for media GOWA did not download (CDN URL only)', () => {
    const v = value({
      event: 'message',
      payload: {
        id: 'DOC1',
        chat_id: '628123456789@s.whatsapp.net',
        from: '628123456789@s.whatsapp.net',
        body: 'Monthly report',
        document: { url: 'https://mmg.whatsapp.net/abc', filename: 'report.pdf' },
      },
    })
    const m = v?.messages?.[0]
    expect(m?.type).toBe('document')
    expect(m?.document?.filename).toBe('report.pdf')
    expect(decodeMediaRef(m!.document!.id)).toBe('msg:DOC1|628123456789@s.whatsapp.net')
  })

  it('maps audio and stickers given as plain paths', () => {
    const base = { chat_id: '1@s.whatsapp.net', from: '1@s.whatsapp.net' }
    expect(value({ event: 'message', payload: { ...base, id: 'A', audio: 'statics/media/a.ogg' } })?.messages?.[0])
      .toMatchObject({ type: 'audio', audio: { mime_type: 'audio/ogg' } })
    expect(value({ event: 'message', payload: { ...base, id: 'S', sticker: 'statics/media/s.webp' } })?.messages?.[0])
      .toMatchObject({ type: 'sticker', sticker: { mime_type: 'image/webp' } })
  })

  it('maps a location', () => {
    const v = value({
      event: 'message',
      payload: {
        id: 'L1',
        chat_id: '1@s.whatsapp.net',
        from: '1@s.whatsapp.net',
        location: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: 'Jakarta' },
      },
    })
    expect(v?.messages?.[0]).toMatchObject({
      type: 'location',
      location: { latitude: -6.2, longitude: 106.8, name: 'Jakarta' },
    })
  })

  it('maps a list selection to a Meta list_reply', () => {
    const v = value({
      event: 'message',
      payload: {
        id: 'SEL',
        chat_id: '1@s.whatsapp.net',
        from: '1@s.whatsapp.net',
        body: 'Void PNR',
        selection: { kind: 'list', text: 'Void PNR', selected_id: 'row-void-pnr' },
      },
    })
    expect(v?.messages?.[0].interactive).toEqual({
      type: 'list_reply',
      list_reply: { id: 'row-void-pnr', title: 'Void PNR', description: undefined },
    })
  })

  it('maps a reaction', () => {
    const v = value({
      event: 'message.reaction',
      payload: {
        id: 'RX',
        chat_id: '1@s.whatsapp.net',
        from: '1@s.whatsapp.net',
        reaction: '👍',
        reacted_message_id: 'TARGET',
      },
    })
    expect(v?.messages?.[0]).toMatchObject({
      type: 'reaction',
      reaction: { message_id: 'TARGET', emoji: '👍' },
    })
  })

  it('maps delivered / read receipts to Meta statuses', () => {
    const delivered = value({
      event: 'message.ack',
      timestamp: '2025-07-18T22:44:20Z',
      payload: {
        ids: ['M1', 'M2'],
        chat_id: '628123@s.whatsapp.net',
        from: '628123@s.whatsapp.net',
        receipt_type: 'delivered',
      },
    })
    expect(delivered?.statuses).toEqual([
      { id: 'M1', status: 'delivered', timestamp: rfc3339ToUnixSeconds('2025-07-18T22:44:20Z'), recipient_id: '628123' },
      { id: 'M2', status: 'delivered', timestamp: rfc3339ToUnixSeconds('2025-07-18T22:44:20Z'), recipient_id: '628123' },
    ])
    expect(delivered?.messages).toBeUndefined()

    const played = value({
      event: 'message.ack',
      payload: { ids: ['M3'], chat_id: '628123@s.whatsapp.net', receipt_type: 'played' },
    })
    expect(played?.statuses?.[0].status).toBe('read')
  })

  it.each([
    ['our own message', { is_from_me: true, body: 'x' }],
    ['a group message', { chat_id: '120363012345678901@g.us', body: 'x' }],
    ['a LID-only sender', { chat_id: '251556368777322@lid', from: '251556368777322@lid', body: 'x' }],
    ['an album header', { album: { expected_image_count: 3 } }],
    ['a message with no content', {}],
  ])('ignores %s', (_label, extra) => {
    expect(
      gowaEventToMetaEntry(
        {
          event: 'message',
          payload: { id: 'X', chat_id: '1@s.whatsapp.net', from: '1@s.whatsapp.net', ...extra },
        },
        PNID,
      ),
    ).toBeNull()
  })

  it('ignores our own read receipts and non-message events', () => {
    expect(
      value({ event: 'message.ack', payload: { ids: ['A'], chat_id: '1@s.whatsapp.net', receipt_type: 'read-self' } }),
    ).toBeUndefined()
    expect(value({ event: 'chat_presence', payload: { chat_id: '1@s.whatsapp.net' } })).toBeUndefined()
  })
})

describe('numbered replies', () => {
  const buttons = { kind: 'buttons', body: 'b', buttons: [{ id: 'sales', title: 'Sales' }, { id: 'help', title: 'Help' }] }
  const list = {
    kind: 'list',
    body: 'b',
    sections: [{ rows: [{ id: 'r1', title: 'One' }] }, { rows: [{ id: 'r2', title: 'Two', description: 'd' }] }],
  }

  it('flattens options in the order they were numbered', () => {
    expect(interactivePayloadOptions(buttons).map((o) => o.id)).toEqual(['sales', 'help'])
    expect(interactivePayloadOptions(list).map((o) => [o.id, o.list])).toEqual([
      ['r1', true],
      ['r2', true],
    ])
    expect(interactivePayloadOptions(null)).toEqual([])
  })

  it('matches a bare number to its option', () => {
    const opts = interactivePayloadOptions(buttons)
    expect(matchNumberedOption('2', opts)?.id).toBe('help')
    expect(matchNumberedOption(' 1. ', opts)?.id).toBe('sales')
    expect(matchNumberedOption('3', opts)).toBeNull()
    expect(matchNumberedOption('1 please', opts)).toBeNull()
  })
})
