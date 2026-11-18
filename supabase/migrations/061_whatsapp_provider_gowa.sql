-- ============================================================
-- 061: second WhatsApp provider — GOWA (go-whatsapp-web-multidevice)
--
-- An account connects WhatsApp EITHER through Meta's Cloud API (the
-- default, unchanged) OR through a self-hosted GOWA server that drives
-- a regular WhatsApp account as a linked device.
--
-- A GOWA row reuses the existing columns so every send path keeps
-- reading (phone_number_id, access_token) unchanged:
--   phone_number_id = 'gowa:<webhook key>'   (UNIQUE, routes inbound)
--   access_token    = encrypted GOWA credential (base URL, basic-auth
--                     user/password, device id) — see gowa-api.ts
-- The columns below are what the settings screen shows and what the
-- inbound route needs to verify GOWA's signature.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS gowa_base_url TEXT,
  ADD COLUMN IF NOT EXISTS gowa_jid TEXT,
  ADD COLUMN IF NOT EXISTS gowa_webhook_secret TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_provider_check'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_check
      CHECK (provider IN ('meta', 'gowa'));
  END IF;
END $$;

COMMENT ON COLUMN whatsapp_config.provider IS
  '''meta'' = WhatsApp Cloud API (default). ''gowa'' = self-hosted GOWA '
  'server; phone_number_id is then ''gowa:<webhook key>'' and access_token '
  'holds the encrypted GOWA credential.';
COMMENT ON COLUMN whatsapp_config.gowa_base_url IS
  'GOWA server URL, for display. The copy inside access_token is the one used.';
COMMENT ON COLUMN whatsapp_config.gowa_jid IS
  'JID of the WhatsApp account the GOWA device is logged in as, e.g. '
  '628123456789@s.whatsapp.net. Shown in settings; stops two accounts '
  'connecting the same number.';
COMMENT ON COLUMN whatsapp_config.gowa_webhook_secret IS
  'Encrypted HMAC secret GOWA signs webhook deliveries with (X-Hub-Signature-256).';
