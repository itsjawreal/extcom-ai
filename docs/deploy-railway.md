# Deploy to Railway

## Requirements

- Railway account with a GitHub repo connected
- An OpenRouter (or OpenAI) API key
- A Railway Volume for SQLite persistence

## Build

The root [`railway.toml`](../railway.toml) pins the Dockerfile builder and
deployment healthcheck. Railway combines it with the service settings from its
dashboard; config in the repository takes precedence for those fields.

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 300
```

The explicit start command matches the final Docker image layout. It also
overrides Railway's JavaScript-monorepo auto-import default, which otherwise
tries `npm run start --workspace=...`; the production image intentionally does
not contain `/app/package.json`, so that generated npm command crashes with
`ENOENT`.

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
