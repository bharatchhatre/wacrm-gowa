# Connecting WhatsApp through GOWA

wacrm normally connects through Meta's WhatsApp Cloud API. As an
alternative, an account can connect a **regular WhatsApp number**
through a self-hosted [GOWA](https://github.com/aldinokemal/go-whatsapp-web-multidevice)
server (go-whatsapp-web-multidevice). GOWA logs in as a linked device,
the same way WhatsApp Web does, and wacrm talks to it over its REST
API and webhooks.

You don't need a Meta app, a Business verification or message
templates, and there's no 24-hour reply window.

> **Migration required:** apply `supabase/migrations/061_whatsapp_provider_gowa.sql`.

## Setup

1. Run GOWA, for example with Docker:

   ```yaml
   services:
     gowa:
       image: aldinokemal2104/go-whatsapp-web-multidevice:latest
       restart: unless-stopped
       ports:
         - '3000:3000'
       environment:
         APP_BASIC_AUTH: admin:change-me
       volumes:
         - gowa-data:/app/storages
   volumes:
     gowa-data:
   ```

2. Open GOWA's dashboard and log in: scan the QR code with WhatsApp on
   your phone (**Linked devices → Link a device**).
3. In wacrm, go to **Settings → WhatsApp → GOWA (WhatsApp Web)**. Enter
   the GOWA URL and the `APP_BASIC_AUTH` user and password, then click
   **Connect**. Fill in the Device ID only if your GOWA server has more
   than one device.
4. wacrm checks that the device is logged in, saves the connection, and
   sets the device's webhook to
   `<your wacrm URL>/api/whatsapp/gowa/webhook?key=…` with a freshly
   generated signing secret.

The webhook URL comes from `NEXT_PUBLIC_SITE_URL`, or from the request's
origin when that's unset. GOWA must be able to reach it.

If GOWA can't set the webhook itself (older GOWA versions), the
settings screen shows a `WHATSAPP_WEBHOOK` and `WHATSAPP_WEBHOOK_SECRET`
pair. Add both to GOWA's environment and restart it.

GOWA must also be able to fetch media URLs that wacrm sends, such as
your Supabase Storage URLs, since it downloads attachments before
sending them.

## What works, and how

| Feature | Over GOWA |
| --- | --- |
| Inbox: text, replies, reactions, images, video, audio, documents, stickers, locations | ✅ |
| Delivery / read receipts | ✅ (`message.ack`) |
| Received media | Fetched from GOWA (with its basic auth) and mirrored to `chat-media` as usual |
| Flows / automations: buttons and lists | Set by **Menu style** on the GOWA form. **Buttons & lists** (the default) sends real reply buttons and selection lists through GOWA's experimental `/send/interactive`. WhatsApp doesn't guarantee they render from a linked device, and a GOWA server without that endpoint gets a poll instead. **Poll** sends a single-choice poll, which every client renders. **Numbered text** sends a numbered list. A tap, a vote, a typed option title or its number all count as the tap |
| Templates and broadcasts | The template is rendered from its local copy and sent as text, or as the header image/video/document with the body as its caption. Creating a template saves it straight to `APPROVED`, since Meta doesn't review it. **Sync from Meta** isn't available |
| AI auto-reply | ✅ (no "typing…" indicator) |
| Group chats, your own messages sent from the phone | Ignored |

## Security notes

- The GOWA password is stored encrypted with `ENCRYPTION_KEY`, the same
  way the Meta access token is.
- Every webhook delivery is HMAC-SHA256-signed (`X-Hub-Signature-256`)
  with the connection's own secret. An unsigned or wrongly signed
  delivery gets a 401, and so does an unknown key, so keys can't be
  probed.
- Media references from GOWA only ever resolve to files on the
  configured GOWA server.

## Caveats

GOWA isn't an official WhatsApp API. WhatsApp can restrict or ban
numbers driven by unofficial clients, especially for bulk or
unsolicited messaging. Use it for conversations with people who
expect to hear from you, and keep broadcasts small.
