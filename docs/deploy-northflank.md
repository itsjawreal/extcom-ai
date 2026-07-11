# Deploy to Northflank

## Requirements

- Northflank account with a GitHub repo connected
- An OpenRouter (or OpenAI) API key

## Build

Create a new **Service** → **Deploy from Git** → select this repo.
Northflank detects the root `Dockerfile` and builds from it automatically
— no extra build config needed.

## Environment variables

In the service's **Environment variables** tab, set the same variables
documented in `.env.example`, at minimum:

```env
AI_DEFAULT_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key
AUTH_TOKENS=your-long-random-token:power
DATABASE_PATH=/data/extcom-ai.db
```

## Volume

Open the service's **Volumes** page → **Add volume**:

- Pick any name (e.g. `extcom-ai-data`)
- Access mode: **Single Read/Write** (this backend runs as a single
  instance — SQLite doesn't support multiple writers)
- Container mount path: `/data`
- Leave the volume mount path blank (mounts the whole volume at `/data`)

Without it, the SQLite database (issued tokens, usage counters) is lost
on every redeploy or restart.

## Healthcheck

The backend exposes `GET /health`. Set it as the service's healthcheck
path in **Health checks**, or verify manually:

```bash
curl https://your-app.northflank.app/health
```
