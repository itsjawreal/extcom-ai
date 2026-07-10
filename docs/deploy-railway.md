# Deploy to Railway

## Requirements

- Railway account with a GitHub repo connected
- An OpenRouter (or OpenAI) API key
- A Railway Volume for SQLite persistence

## Build

Railway detects the root `Dockerfile` automatically — no `railway.toml` is
required. If you want to pin the builder explicitly, copy
[`docs/examples/railway.toml.example`](examples/railway.toml.example) to the
repo root as `railway.toml`.

## Environment variables

Set the same variables documented in `.env.example`, at minimum:

```env
AI_DEFAULT_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key
AUTH_TOKENS=your-long-random-token:power
DATABASE_PATH=/data/extcom-ai.db
```

Railway injects `PORT` automatically; the Dockerfile already defaults it to
`3000` if Railway doesn't override it.

## Volume

Create a Railway Volume and mount it to:

```txt
/data
```

Without it, the SQLite database (issued tokens, usage counters) is lost on
every redeploy or restart.

## Healthcheck

The backend exposes `GET /health`:

```bash
curl https://your-app.up.railway.app/health
```

## Common error

If a deploy fails with:

```txt
dockerfile invalid: docker VOLUME is not supported, use Railway Volumes
```

you're on an older Dockerfile that still had `VOLUME /data`. The current
Dockerfile only does `RUN mkdir -p /data` at build time — persistence is
handled entirely by the Railway Volume mounted at `/data`.
