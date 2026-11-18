# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Hosting panels (e.g. Hostinger Docker Manager)

Panel-based Docker hosts store only the compose file (not the repo)
and take environment variables from their own UI, writing them to a
`.env` next to the compose file. Hostinger's Docker Manager also
**pulls images but does not build them**, so a compose file with only
`build:` never starts there. Two things in `docker-compose.yml` make
it work:

- `.env` and `.env.local` are both optional env files, so no
  `.env.local` has to exist on the server.
- `image: ${WACRM_IMAGE:-wacrm:local}` lets the panel pull a
  pre-built image instead of building one.

Because `NEXT_PUBLIC_*` values are baked into the image, build it
with **your** Supabase values on any machine with Docker, then push
it to a registry the server can pull from:

```bash
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  --build-arg NEXT_PUBLIC_SITE_URL=https://crm.example.com \
  -t ghcr.io/<you>/wacrm:latest --push .
```

(`--platform linux/amd64` matters when building on Apple Silicon for
an x86 VPS.) The image contains no server secrets — only the
`NEXT_PUBLIC_*` values, which ship to every browser anyway — so it
can be public; a private image needs registry credentials on the
server. Then, in the panel:

1. Paste this repo's `docker-compose.yml`.
2. Add `WACRM_IMAGE=ghcr.io/<you>/wacrm:latest` plus every runtime
   variable from `.env.local.example` (`SUPABASE_SERVICE_ROLE_KEY`,
   `ENCRYPTION_KEY`, `META_APP_SECRET`, …) in its environment section.
3. Deploy. The app listens on port 3000 inside the container; set
   `HOST_PORT` to publish it on a different host port.

To update, rebuild and push the image, then redeploy (or "Update")
the project in the panel.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`. This includes
  `NEXT_PUBLIC_APP_LOCALE` (`en | ko | pt | es`), so the UI language is
  fixed per image.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env.local` via
  `env_file` and is never baked into the image — safe to change with
  just a container restart.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Notes

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Received attachments are copied into the `chat-media` Supabase
  Storage bucket, because Meta deletes media roughly 30 days after it
  arrives and the copy is the only thing that outlives that. It grows
  with inbound volume, so it's worth watching your project's storage
  quota. Turn it off per account under Settings → WhatsApp →
  Attachment Storage; attachments received while it's off become
  unviewable once Meta drops them. Files over 16 MB (the bucket's
  limit) are never copied.
- Nothing inside the container is scheduled. If you use automation
  Wait steps or flows, point an external scheduler at
  `GET /api/automations/cron` and `GET /api/flows/cron` on this
  deployment, sending the shared secret in the `x-cron-secret` header
  (`AUTOMATION_CRON_SECRET`, see `.env.local.example`). Both return
  503 until that variable is set.
