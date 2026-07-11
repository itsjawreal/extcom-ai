# Deploy to Zeabur

## Requirements

- Zeabur account with a GitHub repo connected
- An OpenRouter (or OpenAI) API key

## Build

Create a new **Project** → **Deploy New Service** → **Git** → select this
repo. Zeabur detects the root `Dockerfile` and builds from it
automatically.

## Environment variables

On the service page, open **Variables** and set the same values
documented in `.env.example`, at minimum:

```env
AI_DEFAULT_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key
AUTH_TOKENS=your-long-random-token:power
DATABASE_PATH=/data/extcom-ai.db
```

## Volume

Open the service's **Volumes** tab → **Mount Volumes**:

- Volume ID: any identifier (e.g. `data`)
- Mount Directory: `/data`

Without it, the SQLite database (issued tokens, usage counters) is lost
on every redeploy or restart. Note that mounting a volume clears whatever
is already in that directory at mount time (harmless here — the
Dockerfile only ever creates an empty `/data` dir) and disables
zero-downtime restarts for this service, which doesn't matter for a
single-instance backend like this one.

## Healthcheck

The backend exposes `GET /health`:

```bash
curl https://your-app.zeabur.app/health
```
